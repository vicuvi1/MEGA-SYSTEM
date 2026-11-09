// The coach's day: one pure, deterministic plan from data the app already
// keeps (the split, the training log, the food goal, the standard day, the
// accepted calorie changes), the checklist, and ticks that follow real logs.
// Nothing here pays points: ticks are only a picture of the day.
import { addDays } from './dates'
import { todayPlan, TYPE_NAME, type DoneSession, type SessionType, type TrainWeek } from './trainWeek'
import { dayTotals, itemsText, slotItems, totalsOf, type FoodSaved } from './foodSaved'
import type { AdjLogEntry } from './foodGoals'
import type { MealType } from './food'
import { rampKcal, TRAINING_STEPS, type CoachConfig, type MorningStep } from './coachConfig'
import { addOnsFor, bloodTestDue, floorKcal, lowIntake, BLOOD_TEXT } from './coachSafety'

export interface PlanMove {
  name: string
  sets: number
  /** "Last time: 9 · 8 · 8 → aim to beat it", or the range on a first time. */
  last: string
}

export interface PlanInputs {
  date: string
  config: CoachConfig
  week: TrainWeek
  done: DoneSession[]
  /** Each session at your current level. */
  moves: Record<SessionType, PlanMove[]>
  minutes: Record<SessionType, number>
  /** The food counter's goal for the day (already with accepted changes). */
  food: { goal: number; protein: number; saved: FoodSaved; adjLog: AdjLogEntry[] }
  /** Logged kcal of recent days (for the low-intake note). */
  intake: { day: string; kcal: number }[]
  /** A lighter week is on (70% reps). */
  lighter?: boolean
  /** A workout is already logged today another way (Sport Track, a workout row): the day's training is done. */
  trained?: boolean
}

export type TipKey = 'eat-more' | 'ramp' | 'catch-up' | 'beat-last' | 'rest-eat' | 'recover' | 'sleep' | 'protein' | 'weigh'

export type PlanTraining =
  | { kind: 'session'; type: SessionType; title: string; line: string; catchUp: boolean; moves: PlanMove[]; minutes: number; lighter: boolean }
  | { kind: 'rest'; title: string; line: string; anyway: SessionType | null }
  | { kind: 'done'; type: SessionType | null; title: string; line: string }

export interface PlanMeal {
  /** The standard day's slot id (`ds-…`), or `m1`… without one. */
  id: string
  label: string
  type: MealType
  items: string
  kcal: number
  protein: number
}

export type CheckKind = 'workout' | 'meal' | 'weigh' | 'bed'
export interface PlanCheck {
  id: string
  kind: CheckKind
  label: string
  /** You may tick it yourself (meals, bed). A workout or a weigh-in ticks only from a real log. */
  manual: boolean
}

export interface DailyPlan {
  date: string
  training: PlanTraining
  food: {
    kcal: number
    protein: number
    /** Ramp-up week (1 or 2), null when done. */
    ramp: number | null
    meals: PlanMeal[]
    /** Easy add-ons that fill the gap between the standard day and the goal. */
    extras: string[]
    /** The newest accepted change in the last 7 days ("+200 kcal this week: …"). */
    change: string | null
    standard: number
  }
  morning: MorningStep[]
  focus: TipKey
  checks: PlanCheck[]
  /** Calm notes from the safety rules (low intake, the blood test). */
  notes: { id: 'low' | 'blood'; text: string }[]
}

const GENERIC_MEALS: { label: string; type: MealType }[] = [
  { label: 'Breakfast', type: 'breakfast' },
  { label: 'Lunch', type: 'lunch' },
  { label: 'Snack', type: 'snack' },
  { label: 'Dinner', type: 'dinner' },
  { label: 'Evening snack', type: 'snack' },
  { label: 'Late snack', type: 'snack' }
]

/** The day's meals: the standard day's slots, else generic ones from the config. */
export function mealsOf(saved: FoodSaved, count: number): PlanMeal[] {
  if (saved.day.slots.length)
    return saved.day.slots.map((s) => {
      const items = slotItems(s)
      const t = totalsOf(saved, items)
      return { id: s.id, label: s.label, type: s.slot, items: itemsText(saved, items), kcal: Math.round(t.kcal), protein: Math.round(t.protein) }
    })
  return GENERIC_MEALS.slice(0, count).map((m, i) => ({ id: `m${i + 1}`, label: m.label, type: m.type, items: '', kcal: 0, protein: 0 }))
}

/** The newest accepted change in the 7 days up to `date`, in words. */
export function changeLine(log: AdjLogEntry[], date: string): string | null {
  const e = log.find((x) => x.day <= date && x.day > addDays(date, -7))
  if (!e) return null
  if (e.delta > 0) return `+${e.delta} kcal this week: ${addOnsFor(e.delta).map((a) => a.label.replace(/^\+/, '')).join(' + ')} a day`
  return `${e.delta} kcal this week (your weight rose fast)`
}

export function dailyPlan(i: PlanInputs, date = i.date): DailyPlan {
  const cfg = i.config
  // Training: the split and what you actually did (the 48 h rule and missed sessions live in todayPlan).
  const tp = todayPlan(i.week, i.done, date)
  let training: PlanTraining
  const doneLine = 'Done for today. Eat well and sleep: that is when muscle grows.'
  if (tp.why === 'done' && tp.type !== 'rest') training = { kind: 'done', type: tp.type, title: `Done: ${TYPE_NAME[tp.type]}`, line: doneLine }
  // Trained today another way (Sport Track sets, a logged workout): never "Rest day" next to "you trained".
  else if (i.trained) training = { kind: 'done', type: tp.type === 'rest' ? null : tp.type, title: tp.type === 'rest' ? 'Done: workout' : `Done: ${TYPE_NAME[tp.type]}`, line: doneLine }
  else if (tp.type === 'rest') training = { kind: 'rest', title: 'Rest day', line: 'Rest day: walk 20 min, eat everything.', anyway: tp.anyway }
  else {
    const t = tp.type
    const minutes = Math.min(cfg.train.maxMin, i.minutes[t] || cfg.train.maxMin)
    const reps = `${cfg.train.reps[0]}–${cfg.train.reps[1]} reps, stop with ${cfg.train.rir[0]}–${cfg.train.rir[1]} reps left`
    training = {
      kind: 'session',
      type: t,
      title: TYPE_NAME[t],
      line: tp.why === 'catch-up' ? `${tp.line} ${reps}.` : `${minutes} min at home. ${reps}.${i.lighter ? ' Lighter week: 70% of your usual reps.' : ''}`,
      catchUp: tp.why === 'catch-up',
      moves: i.moves[t] ?? [],
      minutes,
      lighter: !!i.lighter
    }
  }

  // Food: the goal (ramp-up in the first 2 weeks), never under the floor; add-ons fill the gap to the standard day.
  const ramp = rampKcal(cfg, i.food.goal, date)
  const kcal = floorKcal(ramp.kcal)
  const meals = mealsOf(i.food.saved, cfg.meals)
  const standard = i.food.saved.day.slots.length ? Math.round(dayTotals(i.food.saved).kcal) : 0
  const extras = standard ? addOnsFor(kcal - standard).map((a) => a.label) : []

  const isSession = training.kind === 'session'
  const morning = cfg.morning.filter((s) => isSession || !TRAINING_STEPS.includes(s.id))

  const notes: DailyPlan['notes'] = []
  const low = lowIntake(i.intake, date)
  if (low) notes.push({ id: 'low', text: low.text })
  if (bloodTestDue(cfg, date)) notes.push({ id: 'blood', text: BLOOD_TEXT })

  const focus: TipKey = low
    ? 'eat-more'
    : ramp.week
      ? 'ramp'
      : training.kind === 'session' && training.catchUp
        ? 'catch-up'
        : training.kind === 'session'
          ? 'beat-last'
          : training.kind === 'rest'
            ? 'rest-eat'
            : (['recover', 'sleep', 'protein', 'weigh'] as TipKey[])[new Date(`${date}T12:00:00Z`).getUTCDay() % 4]

  const checks: PlanCheck[] = [
    ...(isSession || training.kind === 'done' ? [{ id: 'workout', kind: 'workout' as const, label: 'Workout', manual: false }] : []),
    ...meals.map((m) => ({ id: `meal:${m.id}`, kind: 'meal' as const, label: m.label, manual: true })),
    { id: 'weigh', kind: 'weigh', label: 'Weigh-in', manual: false },
    { id: 'bed', kind: 'bed', label: `In bed by ${cfg.sleep.bed}`, manual: true }
  ]

  return {
    date,
    training,
    food: { kcal, protein: Math.round(i.food.protein), ramp: ramp.week, meals, extras, change: changeLine(i.food.adjLog, date), standard },
    morning,
    focus,
    checks,
    notes
  }
}

// ---------- ticks ----------

/** What really happened today, from the logs. */
export interface DayFacts {
  workout: boolean
  /** Meals logged today: their standard-day slot (if any) and type. */
  meals: { slot?: string | null; type: MealType }[]
  weigh: boolean
  /** Bed on time from the sleep log (known the next morning), null: not known. */
  bed: boolean | null
}

export type Tick = 'auto' | 'manual' | null

/**
 * Each check's tick: real logs first (a workout, a meal of that slot, else of
 * the same type not taken by another slot, a weigh-in, bed on time), then your
 * own tick where that is allowed.
 */
export function ticksOf(plan: Pick<DailyPlan, 'checks' | 'food'>, facts: DayFacts, manual: Record<string, number> = {}): Record<string, Tick> {
  const out: Record<string, Tick> = {}
  const meals = facts.meals.slice()
  const taken = new Set<number>()
  // Meals logged with a slot tick that slot first.
  for (const m of plan.food.meals) {
    const k = meals.findIndex((x, n) => !taken.has(n) && x.slot === m.id)
    if (k >= 0) {
      taken.add(k)
      out[`meal:${m.id}`] = 'auto'
    }
  }
  for (const m of plan.food.meals) {
    if (out[`meal:${m.id}`]) continue
    const k = meals.findIndex((x, n) => !taken.has(n) && !x.slot && x.type === m.type)
    if (k >= 0) {
      taken.add(k)
      out[`meal:${m.id}`] = 'auto'
    }
  }
  for (const c of plan.checks) {
    if (out[c.id]) continue
    const real = c.kind === 'workout' ? facts.workout : c.kind === 'weigh' ? facts.weigh : c.kind === 'bed' ? facts.bed === true : false
    out[c.id] = real ? 'auto' : c.manual && manual[c.id] ? 'manual' : null
  }
  return out
}

export const doneCount = (ticks: Record<string, Tick>) => Object.values(ticks).filter(Boolean).length

// ---------- the day store (synced setting coach_days) ----------

export interface Checkin {
  /** 1 (empty) … 5 (great). */
  energy: number
  /** 1 (none) … 5 (very sore). */
  soreness: number
  note?: string
  at: number
}

export interface DayLine {
  line: string
  tip: string
  src: 'ai' | 'template'
  lang: 'en' | 'ro'
  at: number
  tries: number
  /** The plan it was written for (training + kcal): a changed plan gets a fresh line. */
  key?: string
}

export interface CoachDay {
  /** What the day was (for the weekly review and Ben). */
  snap?: { train: 'upper' | 'legs' | 'rest' | 'done'; kcal: number; checks: number; ticked: number }
  /** Your own ticks: check id → when. */
  manual: Record<string, number>
  ai?: DayLine
  checkin?: Checkin
}

export interface CoachDays {
  v: 1
  days: Record<string, CoachDay>
}

export const DAYS_KEEP = 120
export const DAYS_MAX_CHARS = 120_000

const DAY = /^\d{4}-\d{2}-\d{2}$/
const n15 = (v: unknown) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(1, Math.min(5, n)) : 3
}

function cleanDay(x: any): CoachDay {
  const manual: Record<string, number> = {}
  if (x?.manual && typeof x.manual === 'object') for (const [k, v] of Object.entries(x.manual)) if (/^(meal:[\w-]{1,30}|bed)$/.test(k) && Number(v) > 0) manual[k] = Number(v)
  const out: CoachDay = { manual }
  const s = x?.snap
  if (s && typeof s === 'object' && ['upper', 'legs', 'rest', 'done'].includes(s.train)) out.snap = { train: s.train, kcal: Math.round(Number(s.kcal) || 0), checks: Math.round(Number(s.checks) || 0), ticked: Math.round(Number(s.ticked) || 0) }
  const a = x?.ai
  if (a && typeof a.line === 'string') out.ai = { line: a.line.slice(0, 600), tip: String(a.tip ?? '').slice(0, 300), src: a.src === 'ai' ? 'ai' : 'template', lang: a.lang === 'ro' ? 'ro' : 'en', at: Number(a.at) || 0, tries: Math.max(0, Math.round(Number(a.tries) || 0)), ...(typeof a.key === 'string' ? { key: a.key.slice(0, 40) } : {}) }
  const c = x?.checkin
  if (c && typeof c === 'object') out.checkin = { energy: n15(c.energy), soreness: n15(c.soreness), ...(c.note ? { note: String(c.note).slice(0, 300) } : {}), at: Number(c.at) || 0 }
  return out
}

/** The saved days, cleaned and capped (the last 120 days, and under the size cap: oldest go first). */
export function cleanDays(raw: unknown, today?: string): CoachDays {
  const o = (raw && typeof raw === 'object' ? raw : {}) as any
  const days: Record<string, CoachDay> = {}
  const keys = Object.keys(o.days ?? {})
    .filter((k) => DAY.test(k) && (!today || (k <= addDays(today, 1) && k > addDays(today, -DAYS_KEEP))))
    .sort()
  for (const k of keys) days[k] = cleanDay(o.days[k])
  const out: CoachDays = { v: 1, days }
  const order = Object.keys(days).sort()
  while (order.length > 1 && JSON.stringify(out).length > DAYS_MAX_CHARS) delete days[order.shift() as string]
  return out
}

export const dayOf = (d: CoachDays, date: string): CoachDay => d.days[date] ?? { manual: {} }

/** Your own tick on or off (only checks that allow it). */
export function toggleManual(d: CoachDays, plan: Pick<DailyPlan, 'checks'>, date: string, id: string, now: number): CoachDays {
  const c = plan.checks.find((x) => x.id === id)
  if (!c || !c.manual) return d
  const day = dayOf(d, date)
  const manual = { ...day.manual }
  if (manual[id]) delete manual[id]
  else manual[id] = now
  return { ...d, days: { ...d.days, [date]: { ...day, manual } } }
}

/** The day's short record for history (written only when it changes). */
export function snapOf(plan: DailyPlan, ticks: Record<string, Tick>): NonNullable<CoachDay['snap']> {
  const t = plan.training
  return { train: t.kind === 'session' ? t.type : t.kind === 'done' ? 'done' : 'rest', kcal: plan.food.kcal, checks: plan.checks.length, ticked: doneCount(ticks) }
}

export function withSnap(d: CoachDays, date: string, snap: NonNullable<CoachDay['snap']>): CoachDays | null {
  const day = dayOf(d, date)
  if (JSON.stringify(day.snap) === JSON.stringify(snap)) return null
  return { ...d, days: { ...d.days, [date]: { ...day, snap } } }
}

export function withCheckin(d: CoachDays, date: string, c: { energy: number; soreness: number; note?: string }, now: number): CoachDays {
  const day = dayOf(d, date)
  return { ...d, days: { ...d.days, [date]: { ...day, checkin: cleanDay({ checkin: { ...c, at: now } }).checkin } } }
}

// ---------- for the next step (check-in, nudges, chat) ----------

/** The day's check-in data: the plan's short record, ticks and the check-in (if any). */
export function checkinData(d: CoachDays, date: string): { date: string; snap: CoachDay['snap'] | null; manual: string[]; checkin: Checkin | null } {
  const day = dayOf(d, date)
  return { date, snap: day.snap ?? null, manual: Object.keys(day.manual), checkin: day.checkin ?? null }
}

/** A compact context for Ben: the config, the last 7 days and today's plan (a few short lines). */
export function coachContext(cfg: CoachConfig, d: CoachDays, plan: DailyPlan | null, today: string): string {
  const lines = [
    `Coach: slow gain +${cfg.gain.lo}–${cfg.gain.hi} kg/week; home training max ${cfg.train.maxMin} min (${cfg.train.when}), ${cfg.train.reps[0]}–${cfg.train.reps[1]} reps @${cfg.train.rir[0]}–${cfg.train.rir[1]} RIR; bed by ${cfg.sleep.bed}, ${cfg.sleep.hours[0]}–${cfg.sleep.hours[1]} h.`
  ]
  if (plan) {
    const t = plan.training
    lines.push(`Today: ${t.kind === 'session' ? `${t.title} ${t.minutes} min (${t.moves.map((m) => m.name).join(', ')})` : t.title}; food ${plan.food.kcal} kcal, ${plan.food.protein} g protein over ${plan.food.meals.length} meals${plan.food.ramp ? ` (ramp-up week ${plan.food.ramp})` : ''}.`)
  }
  const past: string[] = []
  for (let i = 7; i >= 1; i--) {
    const k = addDays(today, -i)
    const day = d.days[k]
    if (!day?.snap) continue
    past.push(`${k.slice(5)} ${day.snap.train} ${day.snap.ticked}/${day.snap.checks}${day.checkin ? ` energy ${day.checkin.energy} sore ${day.checkin.soreness}` : ''}`)
  }
  if (past.length) lines.push(`Last days: ${past.join('; ')}.`)
  return lines.join('\n')
}

export interface NudgeInput {
  /** Minutes since midnight now. */
  minute: number
  plan: Pick<DailyPlan, 'training' | 'food'>
  proteinEaten: number
  checkinDone: boolean
  /** Kinds already sent today. */
  sent: string[]
}

/** Which coach nudges are due now: the morning plan, midday protein (< 40% by 14:00) and the evening check-in. */
export function nudgeConditions(i: NudgeInput): { morning: boolean; protein: boolean; checkin: boolean } {
  const m = i.minute
  return {
    morning: m >= 6 * 60 && m < 10 * 60 && !i.sent.includes('morning'),
    protein: m >= 14 * 60 && m < 20 * 60 && i.plan.food.protein > 0 && i.proteinEaten < i.plan.food.protein * 0.4 && !i.sent.includes('protein'),
    checkin: m >= 20 * 60 + 30 && m < 23 * 60 + 30 && !i.checkinDone && !i.sent.includes('checkin')
  }
}
