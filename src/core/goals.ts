// Measurable goals (pure): "raise profit to 5,000 lei by 31 Dec", "lose 5 kg
// by March", "reach 100 GitHub stars". They live next to the hour goals in
// focus_goals (kind 'measure'), their check-ins in goal_checkins (append-only).
// This file is the maths: the pace line (where you should be today), the
// status (ahead / on track / behind / at risk), what it takes from here
// ("+120 lei a week"), when you'll get there at this pace, milestones, the
// check-in rhythm and its streak. No database, no clock: today comes in.
import { addDays, daysBetween } from './dates'
import type { GoalMeta, GoalType, PeriodInfo } from './goalKinds'

export type GoalUnit = 'lei' | 'eur' | 'usd' | 'kg' | 'km' | 'pct' | 'count' | 'hours' | 'ml' | 'custom'
export const GOAL_UNITS: { id: GoalUnit; label: string }[] = [
  { id: 'lei', label: 'lei' },
  { id: 'eur', label: '€' },
  { id: 'usd', label: '$' },
  { id: 'kg', label: 'kg' },
  { id: 'km', label: 'km' },
  { id: 'pct', label: '%' },
  { id: 'count', label: 'count' },
  { id: 'hours', label: 'hours' },
  { id: 'ml', label: 'ml' },
  { id: 'custom', label: 'custom' }
]

export type Cadence = 'daily' | 'weekly' | 'biweekly' | 'monthly'
export const CADENCES: { id: Cadence; label: string }[] = [
  { id: 'daily', label: 'Every day' },
  { id: 'weekly', label: 'Every week' },
  { id: 'biweekly', label: 'Every 2 weeks' },
  { id: 'monthly', label: 'Every month' }
]

/**
 * Where the number comes from. 'manual': you check in. The others are read
 * from data the app already has, so they never ask (and never pay points for
 * the number moving by itself).
 */
export type SourceKind =
  | 'manual'
  | 'money.profit'
  | 'money.income'
  | 'money.saved'
  | 'money.spent'
  | 'body.weight'
  | 'body.workouts'
  | 'sport.reps'
  | 'water'
  | 'sleep.bed'
  | 'focus.hours'
  | 'pc.work'
  | 'pc.kind'
  | 'tasks.done'
  | 'habit.clean'
export interface GoalSource {
  kind: SourceKind
  /** The exercise (sport.reps) or the focus subject (focus.hours). */
  arg?: string
}
export const SOURCES: { id: SourceKind; label: string; unit: GoalUnit | null; hint: string; needsArg?: string }[] = [
  { id: 'manual', label: 'I check in', unit: null, hint: 'Ben asks you for the number on your rhythm' },
  { id: 'money.profit', label: 'Profit this month', unit: 'lei', hint: 'Income minus spending this month, from Finance Helper' },
  { id: 'money.income', label: 'Income this month', unit: 'lei', hint: 'Money in this month, from Finance Helper' },
  { id: 'money.saved', label: 'Money saved', unit: 'lei', hint: 'Income minus spending (Finance Helper)' },
  { id: 'money.spent', label: 'Money spent', unit: 'lei', hint: 'What you spent (Finance Helper)' },
  { id: 'body.weight', label: 'Body weight', unit: 'kg', hint: 'Your latest weight from Body' },
  { id: 'body.workouts', label: 'Workouts done', unit: 'count', hint: 'Workouts logged since the goal started' },
  { id: 'sport.reps', label: 'Reps of an exercise', unit: 'count', hint: 'Reps logged in Sport Track', needsArg: 'Exercise, e.g. Pushups' },
  { id: 'water', label: 'Water', unit: 'ml', hint: 'Water you logged on Body or the island' },
  { id: 'sleep.bed', label: 'Nights in bed on time', unit: 'count', hint: 'Bedtimes from Sleep (Waky) before a time', needsArg: 'In bed by, e.g. 00:00' },
  { id: 'focus.hours', label: 'Focus hours', unit: 'hours', hint: 'Focus timer hours (one subject, or leave it empty for all)', needsArg: 'Subject, e.g. Rust' },
  { id: 'pc.work', label: 'Work time on the PC', unit: 'hours', hint: 'Coding, study, CTF and writing time the island saw (if you share PC totals)' },
  { id: 'pc.kind', label: 'PC time on one thing', unit: 'hours', hint: 'Time the island saw on one kind: gaming, video, social, coding, study, ctf', needsArg: 'Kind, e.g. gaming' },
  { id: 'tasks.done', label: 'Todoist tasks done', unit: 'count', hint: 'Tasks you closed (add words to count only tasks that have them, e.g. ctf)' },
  { id: 'habit.clean', label: 'Clean streak', unit: 'count', hint: 'Your current Discipline streak in days' }
]
export const isAuto = (s: GoalSource | null | undefined) => !!s && s.kind !== 'manual'
/** Sources that count from the goal's first day (they start at 0); the others start where you are now. */
export const countsFromStart = (k: SourceKind) => k !== 'manual' && k !== 'money.profit' && k !== 'money.income' && k !== 'body.weight' && k !== 'habit.clean'
/** Sources whose extra word may stay empty (focus: all subjects; tasks: all tasks). */
export const argOptional = (k: SourceKind) => k === 'focus.hours' || k === 'tasks.done'

/** How the expected line bends: straight, slow start (savings, skills), or fast start (weight). */
export type PaceCurve = 'line' | 'ramp' | 'front'

export interface Milestone {
  value: number
  label?: string
}

export interface MeasureGoal {
  id: number
  title: string
  unit: GoalUnit
  /** The word for a custom unit ("stars", "books"). */
  unitLabel?: string
  start: number
  target: number
  startDay: string
  deadline: string
  why: string
  area: string
  cadence: Cadence
  source: GoalSource
  milestones: Milestone[]
  curve: PaceCurve
  /** When it was reached (YYYY-MM-DD), or null. */
  doneDay: string | null
}

export interface CheckIn {
  id: string
  goalId: number
  at: string
  day: string
  value: number
  by: 'me' | 'auto' | 'ben' | 'skip'
  note?: string | null
}

export type GoalStatus = 'done' | 'ahead' | 'on track' | 'behind' | 'at risk' | 'missed' | 'not started'

const round = (n: number, d = 2) => {
  const k = 10 ** d
  return Math.round(n * k) / k
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** Going down (lose weight, cut spending) or up. */
export const goingDown = (g: Pick<MeasureGoal, 'start' | 'target'>) => g.target < g.start

/** Share of the way from start to target (0–1, can pass 1 when beaten). */
export function progressOf(g: Pick<MeasureGoal, 'start' | 'target'>, value: number): number {
  const span = g.target - g.start
  if (span === 0) return value === g.target ? 1 : 0
  return Math.max(0, (value - g.start) / span)
}

function bend(t: number, curve: PaceCurve): number {
  const x = clamp01(t)
  if (curve === 'ramp') return x ** 1.6
  if (curve === 'front') return 1 - (1 - x) ** 1.6
  return x
}

/** Share of the time used on `day` (0 at the start day, 1 on the deadline). */
export function timeShare(g: Pick<MeasureGoal, 'startDay' | 'deadline'>, day: string): number {
  const total = daysBetween(g.startDay, g.deadline)
  if (total <= 0) return 1
  return clamp01(daysBetween(g.startDay, day) / total)
}

/** Where you should be on `day` on the pace line. */
export function expectedAt(g: Pick<MeasureGoal, 'start' | 'target' | 'startDay' | 'deadline' | 'curve'>, day: string): number {
  return round(g.start + (g.target - g.start) * bend(timeShare(g, day), g.curve ?? 'line'))
}

/** The newest real number: the last check-in that carries a value (skips don't), else the start. */
export function currentValue(g: Pick<MeasureGoal, 'start'>, checkins: CheckIn[]): number {
  const real = checkins.filter((c) => c.by !== 'skip').sort((a, b) => a.at.localeCompare(b.at))
  return real.length ? real[real.length - 1].value : g.start
}

/**
 * Ahead / on track / behind / at risk from how far you are from the line,
 * measured as a share of the whole distance (5 % either side is on track,
 * 15 % behind is at risk, and so is "behind" with a tenth of the time left).
 */
export function goalStatus(g: MeasureGoal, value: number, today: string): GoalStatus {
  const p = progressOf(g, value)
  if (p >= 1 || g.doneDay) return 'done'
  if (today > g.deadline) return 'missed'
  if (today < g.startDay) return 'not started'
  const e = progressOf(g, expectedAt(g, today))
  const diff = p - e
  if (diff >= 0.05) return 'ahead'
  if (diff > -0.05) return 'on track'
  if (diff <= -0.15) return 'at risk'
  return timeShare(g, today) >= 0.9 ? 'at risk' : 'behind'
}

/** Days left to the deadline (0 on the day itself). */
export const daysLeftOf = (g: Pick<MeasureGoal, 'deadline'>, today: string) => Math.max(0, daysBetween(today, g.deadline))

/** What it takes per day from here to make it (positive = up, negative = down), or 0 when done. */
export function requiredPerDay(g: MeasureGoal, value: number, today: string): number {
  const left = g.target - value
  if ((goingDown(g) ? left >= 0 : left <= 0)) return 0
  const days = Math.max(1, daysBetween(today, g.deadline))
  return left / days
}

/**
 * Your real pace per day: the change over the last 28 days when there is a
 * number at least 7 days old in that window, else since the start. null
 * with too little to tell (under 3 days).
 */
export function currentPerDay(g: MeasureGoal, checkins: CheckIn[], today: string): number | null {
  const real = checkins.filter((c) => c.by !== 'skip').sort((a, b) => a.at.localeCompare(b.at))
  const now = currentValue(g, real)
  const windowFrom = addDays(today, -28)
  const old = real.filter((c) => c.day >= windowFrom && daysBetween(c.day, today) >= 7)[0]
  if (old) return (now - old.value) / Math.max(1, daysBetween(old.day, today))
  const days = daysBetween(g.startDay, today)
  if (days < 3) return null
  return (now - g.start) / days
}

/** The day you'd reach the target at your current pace, or null (no pace, or going the wrong way). */
export function etaDay(g: MeasureGoal, value: number, perDay: number | null, today: string): string | null {
  if (progressOf(g, value) >= 1) return today
  if (perDay == null || perDay === 0) return null
  const left = g.target - value
  if (Math.sign(left) !== Math.sign(perDay)) return null
  const days = Math.ceil(left / perDay)
  return days > 3650 ? null : addDays(today, days)
}

/** The milestones to use: yours, else 25 %, 50 % and 75 % of the way. */
export function milestonesOf(g: Pick<MeasureGoal, 'start' | 'target' | 'milestones' | 'unit'>): Milestone[] {
  const down = g.target < g.start
  const inside = (v: number) => (down ? v < g.start && v > g.target : v > g.start && v < g.target)
  const own = (g.milestones ?? []).filter((m) => Number.isFinite(m.value) && inside(m.value))
  if (own.length) return [...own].sort((a, b) => (down ? b.value - a.value : a.value - b.value))
  const whole = g.unit !== 'kg' && g.unit !== 'km' && g.unit !== 'pct'
  return [0.25, 0.5, 0.75].map((k) => {
    const v = g.start + (g.target - g.start) * k
    return { value: whole ? Math.round(v) : round(v, 1), label: `${k * 100}%` }
  })
}

/** Milestones passed when the number moved from `before` to `after` (in order). */
export function milestonesCrossed(g: Pick<MeasureGoal, 'start' | 'target' | 'milestones' | 'unit'>, before: number, after: number): Milestone[] {
  const pb = progressOf(g, before)
  const pa = progressOf(g, after)
  if (pa <= pb) return []
  return milestonesOf(g).filter((m) => {
    const pm = progressOf(g, m.value)
    return pm > pb && pm <= pa
  })
}

/** The next milestone ahead of `value` (the target itself when they're all passed). */
export function nextMilestone(g: Pick<MeasureGoal, 'start' | 'target' | 'milestones' | 'unit'>, value: number): Milestone & { index: number } {
  const p = progressOf(g, value)
  const list = milestonesOf(g)
  const i = list.findIndex((m) => progressOf(g, m.value) > p)
  return i >= 0 ? { ...list[i], index: i } : { value: g.target, label: 'Goal', index: list.length }
}

// ------------------------------------------------------------ the rhythm

const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7))

/** The check-in period a day belongs to ("2026-11-06", "w2026-11-02", "b2026-11-02", "m2026-11"). */
export function periodKey(cadence: Cadence, day: string, startDay = day): string {
  if (cadence === 'daily') return day
  if (cadence === 'monthly') return `m${day.slice(0, 7)}`
  const mon = mondayOf(day)
  if (cadence === 'weekly') return `w${mon}`
  const base = mondayOf(startDay)
  const weeks = Math.floor(daysBetween(base, mon) / 7)
  return `b${addDays(base, Math.floor(weeks / 2) * 14)}`
}

/** The first day of the period after the one `day` is in. */
export function nextPeriodStart(cadence: Cadence, day: string, startDay = day): string {
  if (cadence === 'daily') return addDays(day, 1)
  if (cadence === 'monthly') {
    const [y, m] = day.split('-').map(Number)
    return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`
  }
  const key = periodKey(cadence, day, startDay)
  return addDays(key.slice(1), cadence === 'weekly' ? 7 : 14)
}

/** Check-ins that count for the rhythm: yours or Ben's (a skip counts as answered). */
const answered = (c: CheckIn) => c.by === 'me' || c.by === 'ben' || c.by === 'skip'

/**
 * Is a check-in due today? Only for manual goals that are still open, never
 * on the day the goal was made, once per period: answered (or skipped) in
 * this period means not due.
 */
export function checkinDue(g: MeasureGoal, checkins: CheckIn[], today: string): boolean {
  if (isAuto(g.source) || g.doneDay || today > g.deadline || today <= g.startDay) return false
  const key = periodKey(g.cadence, today, g.startDay)
  return !checkins.some((c) => c.goalId === g.id && answered(c) && periodKey(g.cadence, c.day, g.startDay) === key)
}

/** Is this check-in the first real one of its period (the one that may pay)? */
export function firstOfPeriod(g: MeasureGoal, checkins: CheckIn[], day: string): boolean {
  const key = periodKey(g.cadence, day, g.startDay)
  return !checkins.some((c) => c.goalId === g.id && (c.by === 'me' || c.by === 'ben') && periodKey(g.cadence, c.day, g.startDay) === key)
}

/** Periods in a row (to this one, or the last one if this one is still open) with a real check-in. */
export function checkinStreak(g: MeasureGoal, checkins: CheckIn[], today: string): number {
  const keys = new Set(checkins.filter((c) => c.goalId === g.id && (c.by === 'me' || c.by === 'ben')).map((c) => periodKey(g.cadence, c.day, g.startDay)))
  if (!keys.size) return 0
  // Walk back period by period from today.
  let day = today
  let n = 0
  let first = true
  for (let guard = 0; guard < 400; guard++) {
    const key = periodKey(g.cadence, day, g.startDay)
    if (keys.has(key)) n++
    else if (!first) break
    first = false
    // the day before this period starts
    const start = g.cadence === 'daily' ? day : g.cadence === 'monthly' ? `${day.slice(0, 7)}-01` : key.slice(1)
    day = addDays(start, -1)
    if (day < g.startDay) break
  }
  return n
}

// ------------------------------------------------------------ one card

export interface GoalCard {
  goal: MeasureGoal
  value: number
  pct: number
  expected: number
  expectedPct: number
  status: GoalStatus
  daysLeft: number
  perDayNeeded: number
  perDayNow: number | null
  /** "+44 lei/day", "+310 lei a week", "−0.4 kg a week" (empty when done). */
  need: string
  eta: string | null
  next: Milestone & { index: number }
  milestones: (Milestone & { reached: boolean })[]
  streak: number
  due: boolean
  auto: boolean
  /** For the chart: your numbers over time (start first). */
  series: { day: string; value: number }[]
  lastAt: string | null
  /** What kind of goal (goalKinds.ts); a goal saved before kinds is a 'target'. */
  kind?: GoalType
  meta?: GoalMeta
  /** Habit, limit and repeating goals: this week or month. */
  period?: PeriodInfo | null
  /** One small thing for today ("+25 pushups today", "Work out today · 2 of 4"). */
  todayStep?: string
  /** "On track", "3 days behind: 12 pushups today gets you back". */
  pace?: string
  /** "Best week: +450 lei (w/c 26 Oct)". */
  best?: string | null
  paused?: boolean
  pinned?: boolean
}

export function goalCard(g: MeasureGoal, all: CheckIn[], today: string): GoalCard {
  const mine = all.filter((c) => c.goalId === g.id).sort((a, b) => a.at.localeCompare(b.at))
  const value = currentValue(g, mine)
  const status = goalStatus(g, value, today)
  const per = requiredPerDay(g, value, today)
  const now = currentPerDay(g, mine, today)
  const daysLeft = daysLeftOf(g, today)
  const expected = expectedAt(g, today)
  const real = mine.filter((c) => c.by !== 'skip')
  // One point per day (the day's last number), starting at the start value.
  const byDay = new Map<string, number>([[g.startDay, g.start]])
  for (const c of real) byDay.set(c.day, c.value)
  const series = [...byDay].map(([day, v]) => ({ day, value: v })).sort((a, b) => a.day.localeCompare(b.day))
  return {
    goal: g,
    value,
    pct: Math.round(clamp01(progressOf(g, value)) * 100),
    expected,
    expectedPct: Math.round(clamp01(progressOf(g, expected)) * 100),
    status,
    daysLeft,
    perDayNeeded: per,
    perDayNow: now,
    need: status === 'done' || status === 'missed' ? '' : needText(g, per, daysLeft),
    eta: etaDay(g, value, now, today),
    next: nextMilestone(g, value),
    milestones: milestonesOf(g).map((m) => ({ ...m, reached: progressOf(g, value) >= progressOf(g, m.value) })),
    streak: checkinStreak(g, mine, today),
    due: checkinDue(g, mine, today),
    auto: isAuto(g.source),
    series,
    lastAt: real.length ? real[real.length - 1].at : null
  }
}

/** On track first? No: the ones needing you first (due, at risk, behind), then the rest by deadline. */
export function sortCards(cards: GoalCard[]): GoalCard[] {
  const rank: Record<GoalStatus, number> = { 'at risk': 0, behind: 1, 'on track': 2, ahead: 3, 'not started': 4, missed: 5, done: 6 }
  return [...cards].sort((a, b) => Number(b.due) - Number(a.due) || rank[a.status] - rank[b.status] || a.goal.deadline.localeCompare(b.goal.deadline))
}

// ------------------------------------------------------------ words

const SYMBOL: Partial<Record<GoalUnit, string>> = { eur: '€', usd: '$' }

/** "3,200 lei", "€3,200", "72.5 kg", "40%", "12h", "12 stars". */
export function fmtValue(unit: GoalUnit, n: number, unitLabel?: string): string {
  const abs = Math.abs(n)
  const digits = abs >= 100 || unit === 'lei' || unit === 'eur' || unit === 'usd' ? 0 : abs >= 10 || unit === 'count' || unit === 'custom' ? (abs >= 10 && (unit === 'count' || unit === 'custom') ? 0 : 1) : 2
  const num = Number(round(n, digits)).toLocaleString('en-US', { maximumFractionDigits: digits })
  if (SYMBOL[unit]) return n < 0 ? `-${SYMBOL[unit]}${num.replace('-', '')}` : `${SYMBOL[unit]}${num}`
  if (unit === 'pct') return `${num}%`
  if (unit === 'hours') return `${num}h`
  if (unit === 'count') return num
  if (unit === 'custom') return unitLabel ? `${num} ${unitLabel}` : num
  return `${num} ${unit}`
}

/** "3,200 of 5,000 lei" (the unit once), "€3,200 of €5,000". */
export function fmtPair(unit: GoalUnit, a: number, b: number, unitLabel?: string): string {
  const after = unit === 'lei' || unit === 'kg' || unit === 'km' || unit === 'ml' || unit === 'custom'
  const first = after ? fmtValue(unit === 'custom' ? 'count' : unit, a).replace(/ (lei|kg|km|ml)$/, '') : fmtValue(unit, a, unitLabel)
  return `${first} of ${fmtValue(unit, b, unitLabel)}`
}

/** "+44 lei" / "−0.4 kg": a change with its sign. */
export function fmtDelta(unit: GoalUnit, n: number, unitLabel?: string): string {
  const s = fmtValue(unit, Math.abs(n), unitLabel)
  return `${n < 0 ? '−' : '+'}${s}`
}

/** What it takes, per day or per week, whichever reads better. */
export function needText(g: Pick<MeasureGoal, 'unit' | 'unitLabel' | 'cadence'>, perDay: number, daysLeft: number): string {
  if (!perDay) return ''
  const week = daysLeft > 14 && g.cadence !== 'daily'
  const month = daysLeft > 75 && g.cadence === 'monthly'
  if (month) return `${fmtDelta(g.unit, perDay * 30, g.unitLabel)} a month`
  return week ? `${fmtDelta(g.unit, perDay * 7, g.unitLabel)} a week` : `${fmtDelta(g.unit, perDay, g.unitLabel)}/day`
}

export const STATUS_TEXT: Record<GoalStatus, string> = { done: 'Done', ahead: 'Ahead', 'on track': 'On track', behind: 'Behind', 'at risk': 'At risk', missed: 'Deadline passed', 'not started': 'Starts soon' }

/** "31 Dec", from YYYY-MM-DD. */
export const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** One line about a goal: "Profit 5,000 lei by 31 Dec: 3,200 (64%), behind, need +44 lei/day". */
export function cardLine(c: GoalCard): string {
  const g = c.goal
  const v = (n: number) => fmtValue(g.unit, n, g.unitLabel)
  return `${g.title}: ${fmtPair(g.unit, c.value, g.target, g.unitLabel)} by ${shortDay(g.deadline)} (${c.pct}%), ${STATUS_TEXT[c.status].toLowerCase()}${c.status === 'done' ? '' : `, ${c.daysLeft} day${c.daysLeft === 1 ? '' : 's'} left`}${c.need ? `, need ${c.need}` : ''}`
}
