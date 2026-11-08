// Challenges on Body → Training: built-in ones (30-day push-ups, 3 workouts
// this week, a plank ladder, 10,000 reps in a month, the first archer
// push-up) and your own. Progress comes ONLY from real logs made at the time,
// from the day you joined:
// - sets count on the day they were logged (a set saved later for an earlier
//   day does not count);
// - a day's total counts on that day (today live; an earlier day only if the
//   app saw it on that day, `snaps`);
// - Telegram-imported days never count.
// Finishing gives a badge. Challenges pay NO points. Pure and tested.
import { dayKey } from './dates'
import { FAMILIES } from './sportMoves'
import { moveOf, type SportEx } from './sportLadders'
import { shiftDay } from './sportSets'

export type ChallengeKind = 'daily' | 'days' | 'reps' | 'holdSteps' | 'firstMove'

export interface ChallengeDef {
  id: string
  name: string
  blurb: string
  kind: ChallengeKind
  /** Length of the window in days, from the day you join. */
  days: number
  /** daily: days to hit; days: training days; reps: total reps; holdSteps: steps; firstMove: 1. */
  goal: number
  /** A ladder family, or 'any'. */
  family: string
  /** daily: the day's target goes from `from` to `to`. */
  daily?: { from: number; to: number }
  /** holdSteps: seconds of each step. */
  steps?: number[]
  /** firstMove: the move to reach (or anything harder on its ladder). */
  move?: string
  badge: string
  custom?: boolean
}

export const CHALLENGES: ChallengeDef[] = [
  { id: 'pushup30', name: '30-day push-ups', blurb: 'A daily push-up target that grows from 60 to 150. Hit it on 25 of 30 days. Any push-up variation counts.', kind: 'daily', days: 30, goal: 25, family: 'pushup', daily: { from: 60, to: 150 }, badge: 'Push-up month' },
  { id: 'week3', name: '3 workouts this week', blurb: 'Train on 3 different days in the next 7.', kind: 'days', days: 7, goal: 3, family: 'any', badge: 'Steady week' },
  { id: 'plank', name: 'Plank ladder', blurb: 'One plank hold of 30 s, then 45, 60, 90 and 120 s, within 4 weeks.', kind: 'holdSteps', days: 28, goal: 5, family: 'plank', steps: [30, 45, 60, 90, 120], badge: 'Iron middle' },
  { id: 'reps10k', name: '10,000 reps month', blurb: '10,000 reps of anything in 30 days (holds not counted). About 333 a day.', kind: 'reps', days: 30, goal: 10000, family: 'any', badge: '10K club' },
  { id: 'archer', name: 'First archer push-up', blurb: 'Climb the push-up ladder until you log a real archer push-up. 60 days.', kind: 'firstMove', days: 60, goal: 1, family: 'pushup', move: 'archer_pushup', badge: 'Archer' }
]

/** Your own challenge: total reps of a ladder (or anything), or training days, in N days. */
export interface CustomSpec {
  name: string
  kind: 'reps' | 'days'
  family: string
  goal: number
  days: number
}

export interface Joined {
  /** Built-in id, or 'custom:<stamp>'. */
  id: string
  joinedOn: string
  custom?: CustomSpec
  /** Day totals the app saw on that day (day → exercise id → reps). */
  snaps?: Record<string, Record<string, number>>
}

export interface SportLog {
  exercises: (Pick<SportEx, 'id' | 'name' | 'move'> & { unit?: string })[]
  days?: Record<string, Record<string, number>> | null
  sets?: Record<string, Record<string, { reps: number; at?: number | string }[]>> | null
  importedDays?: Record<string, string[]> | null
}

const clampInt = (n: unknown, lo: number, hi: number, d: number) => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d
}

/** A custom spec made safe. */
export function cleanCustom(x: Partial<CustomSpec>): CustomSpec {
  const kind = x.kind === 'days' ? 'days' : 'reps'
  const family = x.family && (x.family === 'any' || FAMILIES[x.family]) ? x.family : 'any'
  const days = clampInt(x.days, 3, 90, 30)
  const goal = kind === 'days' ? clampInt(x.goal, 1, days, Math.min(days, 12)) : clampInt(x.goal, 10, 100000, 1000)
  const name = String(x.name ?? '').trim().slice(0, 40) || (kind === 'days' ? `${goal} training days` : `${goal.toLocaleString('en-US')} ${family === 'any' ? 'reps' : FAMILIES[family].name.toLowerCase()}`)
  return { name, kind, family, goal, days }
}

/** The definition behind a joined challenge (built-in or yours). */
export function defOf(j: Joined): ChallengeDef | null {
  if (j.custom) {
    const c = cleanCustom(j.custom)
    const what = c.family === 'any' ? 'anything' : FAMILIES[c.family].name.toLowerCase()
    return {
      id: j.id,
      name: c.name,
      blurb: c.kind === 'days' ? `Train ${what} on ${c.goal} days in ${c.days}.` : `${c.goal.toLocaleString('en-US')} reps of ${what} in ${c.days} days.`,
      kind: c.kind,
      days: c.days,
      goal: c.goal,
      family: c.family,
      badge: c.name,
      custom: true
    }
  }
  return CHALLENGES.find((c) => c.id === j.id) ?? null
}

const famOf = (ex: SportLog['exercises'][number]) => moveOf(ex)?.family ?? null
const unitOf = (ex: SportLog['exercises'][number]) => (ex.unit === 'sec' || moveOf(ex)?.unit === 'sec' ? 'sec' : 'reps')
const atDay = (at: number | string | undefined) => {
  if (at == null || at === '') return null
  const d = new Date(typeof at === 'number' ? at : String(at))
  return Number.isNaN(d.getTime()) ? null : dayKey(d)
}

/** What really counts for one day, per exercise id: the larger of the sets logged that day and the day's total seen that day. */
export function honestDay(log: SportLog, day: string, today: string, snaps?: Joined['snaps']): Record<string, number> {
  const out: Record<string, number> = {}
  const sets = log.sets?.[day] ?? {}
  for (const [id, list] of Object.entries(sets)) {
    const n = (Array.isArray(list) ? list : []).filter((s) => atDay(s.at) === day).reduce((t, s) => t + (Number(s.reps) || 0), 0)
    if (n > 0) out[id] = n
  }
  const imported = new Set(log.importedDays?.[day] ?? [])
  const totals = day === today ? (log.days?.[day] ?? {}) : (snaps?.[day] ?? {})
  for (const [id, v] of Object.entries(totals)) {
    if (imported.has(id)) continue
    const n = Number(v) || 0
    if (n > (out[id] ?? 0)) out[id] = n
  }
  return out
}

/** The best single set (seconds or reps) of a family on a day, from sets logged that day. */
function bestSetOn(log: SportLog, day: string, match: (ex: SportLog['exercises'][number]) => boolean): number {
  let best = 0
  for (const [id, list] of Object.entries(log.sets?.[day] ?? {})) {
    const ex = log.exercises.find((e) => String(e.id) === id)
    if (!ex || !match(ex)) continue
    for (const s of Array.isArray(list) ? list : []) if (atDay(s.at) === day) best = Math.max(best, Number(s.reps) || 0)
  }
  return best
}

export interface ChallengeProgress {
  value: number
  goal: number
  /** 0–1 for the ring. */
  pct: number
  done: boolean
  doneOn: string | null
  /** active: still running; done: finished; ended: the window closed first. */
  status: 'active' | 'done' | 'ended'
  daysLeft: number
  endsOn: string
  /** "18 of 25 days", "6,420 of 10,000 reps". */
  line: string
  /** daily: today's target and what is done. */
  today?: { target: number; done: number }
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)

/** The daily target on day i (0-based) of a daily challenge. */
export const dailyTarget = (def: ChallengeDef, i: number) => (def.daily ? Math.round(def.daily.from + ((def.daily.to - def.daily.from) * Math.max(0, Math.min(def.days - 1, i))) / Math.max(1, def.days - 1)) : 0)

/** Progress of one joined challenge on `today`, from honest logs only. */
export function challengeProgress(def: ChallengeDef, j: Joined, log: SportLog, today: string): ChallengeProgress {
  const endsOn = shiftDay(j.joinedOn, def.days - 1)
  const last = today < endsOn ? today : endsOn
  const inFam = (ex: SportLog['exercises'][number]) => def.family === 'any' || famOf(ex) === def.family
  const exById = new Map(log.exercises.map((e) => [String(e.id), e]))
  let value = 0
  let doneOn: string | null = null
  let todayInfo: ChallengeProgress['today']
  const ladder = def.move ? (FAMILIES[def.family]?.steps ?? []) : []
  const goalIdx = def.move ? ladder.indexOf(def.move) : -1
  let hardest = -1
  for (let d = j.joinedOn, i = 0; d <= last; d = shiftDay(d, 1), i++) {
    const day = honestDay(log, d, today, j.snaps)
    const entries = Object.entries(day).map(([id, n]) => ({ ex: exById.get(id), n })).filter((x) => x.ex && x.n > 0) as { ex: SportLog['exercises'][number]; n: number }[]
    if (def.kind === 'reps') value += entries.filter((x) => inFam(x.ex) && unitOf(x.ex) === 'reps').reduce((t, x) => t + x.n, 0)
    else if (def.kind === 'days') value += entries.some((x) => inFam(x.ex)) ? 1 : 0
    else if (def.kind === 'daily') {
      const target = dailyTarget(def, i)
      const n = entries.filter((x) => inFam(x.ex) && unitOf(x.ex) === 'reps').reduce((t, x) => t + x.n, 0)
      if (n >= target) value++
      if (d === today) todayInfo = { target, done: n }
    } else if (def.kind === 'holdSteps') {
      const best = bestSetOn(log, d, (ex) => inFam(ex) && unitOf(ex) === 'sec')
      const cleared = (def.steps ?? []).filter((s) => best >= s).length
      value = Math.max(value, cleared)
    } else if (def.kind === 'firstMove') {
      for (const x of entries) {
        const m = moveOf(x.ex)
        if (m && m.family === def.family) hardest = Math.max(hardest, ladder.indexOf(m.id))
      }
      value = hardest >= goalIdx && goalIdx >= 0 ? 1 : 0
    }
    if (!doneOn && value >= def.goal) doneOn = d
  }
  if (def.kind === 'daily' && !todayInfo && today >= j.joinedOn && today <= endsOn) todayInfo = { target: dailyTarget(def, dayDiff(j.joinedOn, today)), done: 0 }
  const done = value >= def.goal
  const pct = def.kind === 'firstMove' ? (done ? 1 : goalIdx > 0 ? Math.max(0, hardest + 1) / (goalIdx + 1) : 0) : Math.min(1, value / Math.max(1, def.goal))
  const status = done ? 'done' : today > endsOn ? 'ended' : 'active'
  const daysLeft = Math.max(0, dayDiff(today, endsOn) + 1)
  const line =
    def.kind === 'reps' ? `${fmt(value)} of ${fmt(def.goal)} reps`
    : def.kind === 'days' ? `${value} of ${def.goal} days`
    : def.kind === 'daily' ? `${value} of ${def.goal} days hit`
    : def.kind === 'holdSteps' ? `${value} of ${def.goal} steps${value < (def.steps?.length ?? 0) ? ` · next: ${def.steps![value]} s` : ''}`
    : done ? 'Done: you did it!'
    : hardest >= 0 ? `Hardest so far: ${moveName(ladder[hardest])}`
    : 'Log a push-up set to start'
  return { value, goal: def.goal, pct, done, doneOn: done ? doneOn : null, status, daysLeft, endsOn, line, ...(todayInfo ? { today: todayInfo } : {}) }
}

const moveName = (id: string) => {
  const m = moveOf({ name: '', move: id } as SportEx)
  return m ? m.name.toLowerCase() : id
}

/**
 * Keeps today's day totals in the challenge (only for days inside its window), so a total typed today
 * still counts tomorrow. A later edit of an earlier day changes nothing here.
 */
export function snapToday(j: Joined, def: ChallengeDef, log: SportLog, today: string): Joined {
  const endsOn = shiftDay(j.joinedOn, def.days - 1)
  if (today < j.joinedOn || today > endsOn) return j
  const imported = new Set(log.importedDays?.[today] ?? [])
  const now: Record<string, number> = {}
  for (const [id, v] of Object.entries(log.days?.[today] ?? {})) if (!imported.has(id) && Number(v) > 0) now[id] = Number(v)
  const before = j.snaps?.[today] ?? {}
  if (JSON.stringify(before) === JSON.stringify(now)) return j
  const snaps: Record<string, Record<string, number>> = {}
  for (const [d, m] of Object.entries(j.snaps ?? {})) if (d >= j.joinedOn && d <= endsOn) snaps[d] = m
  snaps[today] = now
  return { ...j, snaps }
}

/** A badge earned: the challenge's badge name and the day. Badges pay no points. */
export interface Badge {
  key: string
  id: string
  name: string
  day: string
}
