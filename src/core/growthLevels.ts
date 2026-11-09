// Growth levels: one honest level for the long game, built from real
// milestones only. No points, nothing stored: the level, its XP and its
// history are recomputed from your logs every time, so they can't drift.
//
// Only rows logged at the time count (a weigh-in, set, meal or night saved on
// its day or the day after): imports, back-dated logs and Telegram-imported
// days never move you up. Milestones (XP):
//   lean      each +0.5 kg on the weekly average (3+ weigh-ins) with the waist under control   40
//   roadmap   each roadmap level-up, after a session on the level before it                   30
//   strength  strength score +5% (average over muscle groups against your first score)        20
//   week      a week with every planned session done                                          25
//   protein   each 7 days in a row at the protein goal                                        20
//   month     a month with 12+ sessions                                                       40
//   sleep     a week with 5+ nights of 7 h or more                                            15
import { addDays, daysBetween } from './dates'
import { mondayOf } from './bodyComp'
import type { Muscle } from './sportSets'
import { GROWTH_MUSCLES, honestSets, planPerWeek, proteinGoalOn, roadmapUps, strengthIndex, strengthOn, trainingDays, type GrowthInput } from './growthBody'

export type MilestoneKind = 'lean' | 'roadmap' | 'strength' | 'week' | 'protein' | 'month' | 'sleep'

export const XP: Record<MilestoneKind, number> = { lean: 40, roadmap: 30, strength: 20, week: 25, protein: 20, month: 40, sleep: 15 }

export const LEVELS: { name: string; xp: number; line: string }[] = [
  { name: 'Seedling', xp: 0, line: 'You started. Log it, every week.' },
  { name: 'Sprout', xp: 150, line: 'The habit is taking root.' },
  { name: 'Builder', xp: 400, line: 'Weeks of real work behind you.' },
  { name: 'Solid', xp: 800, line: 'Training, food and sleep hold together.' },
  { name: 'Athlete', xp: 1400, line: 'Months of steady, lean growth.' },
  { name: 'Strong', xp: 2200, line: 'Harder moves, more muscle, waist in check.' },
  { name: 'Powerhouse', xp: 3300, line: 'A year-scale engine.' },
  { name: 'Elite', xp: 4800, line: 'Few people keep this up this long.' },
  { name: 'Titan', xp: 7000, line: 'Years of honest growth.' },
  { name: 'Legend', xp: 10000, line: 'The best version, still building.' }
]

export const SLEEP_GOOD_MIN = 420
export const LEAN_STEP_KG = 0.5
export const MONTH_SESSIONS = 12
export const SLEEP_NIGHTS = 5

export interface GrowthEvent {
  day: string
  kind: MilestoneKind
  xp: number
  text: string
}

export interface NextStep {
  kind: MilestoneKind
  xp: number
  text: string
}

export interface GrowthLevel {
  xp: number
  index: number
  name: string
  line: string
  next: { name: string; xp: number } | null
  /** XP still needed for the next level (0 at the top). */
  toNext: number
  /** 0…1 inside the current level. */
  progress: number
  /** Every milestone, oldest first. */
  events: GrowthEvent[]
  /** Each level reached and the day (Seedling: the first day of data). */
  history: { index: number; name: string; day: string }[]
  /** "Next level: what to do": the closest milestones, at most 4. */
  steps: NextStep[]
}

const r2 = (n: number) => Math.round(n * 100) / 100
const avg = (l: number[]) => l.reduce((t, v) => t + v, 0) / l.length
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export function levelOfXp(xp: number): number {
  let i = 0
  for (let k = 0; k < LEVELS.length; k++) if (xp >= LEVELS[k].xp) i = k
  return i
}

// ---------------------------------------------------------------- milestones

interface Track {
  events: GrowthEvent[]
  steps: NextStep[]
}

function leanTrack(input: GrowthInput): Track {
  const pts = input.honestPoints
  const events: GrowthEvent[] = []
  if (!pts.length) return { events, steps: [{ kind: 'lean', xp: XP.lean, text: 'Weigh in 3 mornings this week to start your lean-gain track' }] }
  let base: number | null = null
  let baseWaist: number | null = null
  let k = 0
  let lastAvg: number | null = null
  for (let w = mondayOf(pts[0].day); w <= mondayOf(input.today); w = addDays(w, 7)) {
    const end = addDays(w, 6)
    const week = pts.filter((p) => p.day >= w && p.day <= end && p.day <= input.today && p.weight != null)
    if (baseWaist == null) baseWaist = pts.find((p) => p.waist != null && p.day <= end && p.day >= addDays(w, -21))?.waist ?? null
    if (week.length < 3) continue
    const a = avg(week.map((p) => p.weight as number))
    lastAvg = a
    if (base == null) {
      base = a
      continue
    }
    const waist = [...pts].reverse().find((p) => p.waist != null && p.day <= end && p.day >= addDays(end, -21))?.waist ?? null
    while (a >= base + LEAN_STEP_KG * (k + 1) - 1e-9) {
      const gain = LEAN_STEP_KG * (k + 1)
      const ok = baseWaist != null && waist != null && waist - baseWaist <= Math.max(1, gain)
      if (!ok) break
      k++
      events.push({ day: week[week.length - 1].day, kind: 'lean', xp: XP.lean, text: `+${gain.toFixed(1)} kg on the weekly average, waist in check` })
    }
  }
  const steps: NextStep[] = []
  if (base == null) steps.push({ kind: 'lean', xp: XP.lean, text: 'Weigh in 3 mornings a week for 2 weeks to start your lean-gain track' })
  else {
    const left = r2(base + LEAN_STEP_KG * (k + 1) - (lastAvg ?? base))
    const noWaist = !pts.some((p) => p.waist != null && p.day >= addDays(input.today, -21))
    steps.push({ kind: 'lean', xp: XP.lean, text: noWaist ? 'Log your waist this week: lean gain needs it to count' : `Weekly average up ${Math.max(0.1, left).toFixed(1)} kg more with your waist steady` })
  }
  return { events, steps }
}

function roadmapTrack(input: GrowthInput): Track {
  const events = roadmapUps(input.sport, true).map((u) => ({ day: u.day, kind: 'roadmap' as const, xp: XP.roadmap, text: `Roadmap: up to ${u.name}` }))
  return { events, steps: [{ kind: 'roadmap', xp: XP.roadmap, text: 'Move up a level on your training roadmap' }] }
}

function strengthTrack(input: GrowthInput): Track {
  const log = honestSets(input.sport?.sets)
  const idx = strengthIndex(log, Array.isArray(input.sport?.exercises) ? input.sport.exercises : [])
  const days = Object.keys(log).filter((d) => d <= input.today).sort()
  const base: Partial<Record<Muscle, number>> = {}
  const events: GrowthEvent[] = []
  let k = 0
  let index = 1
  for (const d of days) {
    const by = strengthOn(idx, d)
    for (const m of GROWTH_MUSCLES) if (base[m] == null && by[m] > 0) base[m] = by[m]
    const l = GROWTH_MUSCLES.filter((m) => base[m] && by[m] > 0).map((m) => by[m] / (base[m] as number))
    if (!l.length) continue
    index = avg(l)
    while (index >= 1 + 0.05 * (k + 1) - 1e-9) {
      k++
      events.push({ day: d, kind: 'strength', xp: XP.strength, text: `Strength score +${5 * k}% since your first sets` })
    }
  }
  const left = Math.max(1, Math.round((1 + 0.05 * (k + 1) - index) * 100))
  return { events, steps: [{ kind: 'strength', xp: XP.strength, text: days.length ? `Beat your best sets: strength score +${left}% more` : 'Log your sets in Training: strength counts from the first one' }] }
}

function sessionTracks(input: GrowthInput): Track {
  const days = trainingDays(input).filter((d) => d.onTime && d.day <= input.today).map((d) => d.day)
  const plan = Math.max(1, planPerWeek(input.sport))
  const events: GrowthEvent[] = []
  const byWeek = new Map<string, string[]>()
  const byMonth = new Map<string, string[]>()
  for (const d of days) {
    byWeek.set(mondayOf(d), [...(byWeek.get(mondayOf(d)) ?? []), d])
    byMonth.set(d.slice(0, 7), [...(byMonth.get(d.slice(0, 7)) ?? []), d])
  }
  for (const [, l] of byWeek) if (l.length >= plan) events.push({ day: l[plan - 1], kind: 'week', xp: XP.week, text: `Full training week (${plan}/${plan} sessions)` })
  for (const [, l] of byMonth) if (l.length >= MONTH_SESSIONS) events.push({ day: l[MONTH_SESSIONS - 1], kind: 'month', xp: XP.month, text: `${MONTH_SESSIONS} sessions in a month` })
  const steps: NextStep[] = []
  const thisWeek = (byWeek.get(mondayOf(input.today)) ?? []).length
  const weekLeft = 7 - daysBetween(mondayOf(input.today), input.today)
  if (thisWeek < plan && plan - thisWeek <= weekLeft) steps.push({ kind: 'week', xp: XP.week, text: `Train ${plural(plan - thisWeek, 'more time')} this week to finish your plan` })
  const thisMonth = (byMonth.get(input.today.slice(0, 7)) ?? []).length
  if (thisMonth < MONTH_SESSIONS) steps.push({ kind: 'month', xp: XP.month, text: `${plural(MONTH_SESSIONS - thisMonth, 'more session')} this month to reach ${MONTH_SESSIONS}` })
  return { events, steps }
}

function proteinTrack(input: GrowthInput): Track {
  const hit = new Set(input.food.filter((f) => f.day <= input.today && f.proteinOnTime > 0 && f.proteinOnTime >= proteinGoalOn(input.honestPoints, f.day, input.gPerKg)).map((f) => f.day))
  const events: GrowthEvent[] = []
  const sorted = [...hit].sort()
  let run = 0
  let prev: string | null = null
  for (const d of sorted) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1
    prev = d
    if (run % 7 === 0) events.push({ day: d, kind: 'protein', xp: XP.protein, text: `${run} days in a row at your protein goal` })
  }
  const live = prev && daysBetween(prev, input.today) <= 1 ? run % 7 : 0
  return { events, steps: [{ kind: 'protein', xp: XP.protein, text: `Hit your protein goal ${plural(7 - live, 'more day')} in a row` }] }
}

function sleepTrack(input: GrowthInput): Track {
  const good = input.sleep.filter((s) => s.onTime && s.day <= input.today && s.minutes != null && s.minutes >= SLEEP_GOOD_MIN).map((s) => s.day).sort()
  const byWeek = new Map<string, string[]>()
  for (const d of good) byWeek.set(mondayOf(d), [...(byWeek.get(mondayOf(d)) ?? []), d])
  const events: GrowthEvent[] = []
  for (const [, l] of byWeek) if (l.length >= SLEEP_NIGHTS) events.push({ day: l[SLEEP_NIGHTS - 1], kind: 'sleep', xp: XP.sleep, text: `${SLEEP_NIGHTS} nights of 7 h+ in a week` })
  const n = (byWeek.get(mondayOf(input.today)) ?? []).length
  const left = 7 - daysBetween(mondayOf(input.today), input.today)
  const steps: NextStep[] = n < SLEEP_NIGHTS && SLEEP_NIGHTS - n <= left ? [{ kind: 'sleep', xp: XP.sleep, text: `Sleep 7 h+ ${plural(SLEEP_NIGHTS - n, 'more night')} this week (log it in Sleep)` }] : []
  return { events, steps }
}

const ORDER: MilestoneKind[] = ['lean', 'roadmap', 'strength', 'week', 'month', 'protein', 'sleep']

/** The growth level from your logs (pure, deterministic). */
export function growthLevel(input: GrowthInput, firstDay?: string): GrowthLevel {
  const tracks = [leanTrack(input), roadmapTrack(input), strengthTrack(input), sessionTracks(input), proteinTrack(input), sleepTrack(input)]
  const events = tracks
    .flatMap((t) => t.events)
    .filter((e) => e.day <= input.today)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (a.text < b.text ? -1 : 1)))
  let xp = 0
  const history: GrowthLevel['history'] = [{ index: 0, name: LEVELS[0].name, day: firstDay ?? events[0]?.day ?? input.today }]
  for (const e of events) {
    xp += e.xp
    const i = levelOfXp(xp)
    while (history[history.length - 1].index < i) {
      const n = history[history.length - 1].index + 1
      history.push({ index: n, name: LEVELS[n].name, day: e.day })
    }
  }
  const index = levelOfXp(xp)
  const cur = LEVELS[index]
  const nxt = LEVELS[index + 1] ?? null
  const steps = tracks
    .flatMap((t) => t.steps)
    .sort((a, b) => ['week', 'protein', 'sleep', 'month', 'lean', 'strength', 'roadmap'].indexOf(a.kind) - ['week', 'protein', 'sleep', 'month', 'lean', 'strength', 'roadmap'].indexOf(b.kind))
    .slice(0, 4)
  return {
    xp,
    index,
    name: cur.name,
    line: cur.line,
    next: nxt ? { name: nxt.name, xp: nxt.xp } : null,
    toNext: nxt ? nxt.xp - xp : 0,
    progress: nxt ? (xp - cur.xp) / (nxt.xp - cur.xp) : 1,
    events,
    history,
    steps
  }
}

/** The level name you were on at the end of a day (from the history). */
export function levelOn(level: Pick<GrowthLevel, 'history'>, day: string): string {
  let name = LEVELS[0].name
  for (const h of level.history) if (h.day <= day) name = h.name
  return name
}

/** A level reached since the one this device last showed (null: nothing new). */
export function newLevel(level: Pick<GrowthLevel, 'index' | 'history'>, seen: number | null): { index: number; name: string; day: string } | null {
  if (seen == null || level.index <= seen) return null
  return level.history.find((h) => h.index === level.index) ?? null
}
