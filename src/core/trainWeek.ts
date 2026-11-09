// Body → Training: the weekly split (what to train on which day) and what to
// do today. Upper = push + pull + shoulders; Legs + core = single-leg + hinge
// + core. The rule that keeps it safe: no muscle group is trained hard two
// days in a row (48 hours between sessions of the same kind), Sunday → Monday
// included. Kept inside Sport Track's state (`trainWeek`, synced with it).
// Pure and tested (trainWeek.test.ts). Nothing here pays points.
import { shiftDay } from './sportSets'

export type DayType = 'upper' | 'legs' | 'rest'
export type SessionType = Exclude<DayType, 'rest'>

export interface TrainWeek {
  v: 1
  /** Monday first, 7 days. */
  days: DayType[]
  /** When it was last changed (ms): the newer device wins. */
  updatedAt: number
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Mon rest · Tue Upper · Wed Legs + core · Thu Upper · Fri rest · Sat Legs + core · Sun Upper. */
export const DEFAULT_DAYS: DayType[] = ['rest', 'upper', 'legs', 'upper', 'rest', 'legs', 'upper']

export const TYPE_NAME: Record<DayType, string> = { upper: 'Upper body', legs: 'Legs + core', rest: 'Rest' }
/** Which muscle groups a session trains hard (shoulders count as push). */
export const TYPE_MUSCLES: Record<SessionType, ('push' | 'pull' | 'legs' | 'core')[]> = { upper: ['push', 'pull'], legs: ['legs', 'core'] }

export const SESSION_RULES = {
  /** Minutes, at most. */
  minutes: 30,
  warmupMin: 4,
  rest: [60, 90] as const,
  rir: '1–3 reps in reserve'
}

export const WARMUP: Record<SessionType, string[]> = {
  upper: ['1 min arm circles, both ways', '1 min cat-cow', '10 scapula push-ups (straight arms, squeeze and spread the shoulder blades)', '1 easy set of your first move at half the reps'],
  legs: ['1 min marching or easy jumping jacks', '10 slow bodyweight squats', '10 glute bridges', '5 lunges with a twist each side']
}

const isType = (x: unknown): x is DayType => x === 'upper' || x === 'legs' || x === 'rest'

/** Any stored value into a valid week (the default when it can't be read). */
export function cleanWeek(x: unknown): TrainWeek {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, any>
  const days = Array.isArray(o.days) && o.days.length === 7 && o.days.every(isType) ? (o.days as DayType[]) : DEFAULT_DAYS
  return { v: 1, days: [...days], updatedAt: Number(o.updatedAt) || 0 }
}

/** 0 = Monday … 6 = Sunday. */
export const dowOf = (day: string) => (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)

export interface WeekCheck {
  ok: boolean
  /** The week with every clash fixed (the same week when ok). */
  days: DayType[]
  /** What was changed, in plain words (null when ok). */
  message: string | null
}

/**
 * Checks that no muscle group is trained two days in a row (Sunday → Monday too). A clash is fixed on
 * the later day: it becomes the other session when that clashes with neither neighbour, else a rest day.
 * `changed` is the day you just edited: it is kept and the day after it moves instead, when possible.
 */
export function validateWeek(input: DayType[], changed?: number): WeekCheck {
  const days = cleanWeek({ days: input }).days
  const notes: string[] = []
  const clash = (i: number) => days[i] !== 'rest' && days[i] === days[(i + 6) % 7]
  const other = (t: DayType): DayType => (t === 'upper' ? 'legs' : 'upper')
  for (let pass = 0; pass < 7; pass++) {
    let fixed = false
    for (let k = 0; k < 7; k++) {
      // Start after the day you edited, so that day is kept.
      const i = ((changed ?? 0) + 1 + k) % 7
      if (!clash(i)) continue
      // When the edited day itself clashes with the day before, move the day before instead.
      const at = i === changed ? (i + 6) % 7 : i
      const before = days[at]
      const alt = other(before)
      const ok = alt !== days[(at + 6) % 7] && alt !== days[(at + 1) % 7]
      days[at] = ok ? alt : 'rest'
      notes.push(`${WEEKDAYS[at]} is now ${ok ? TYPE_NAME[alt] : 'a rest day'}`)
      fixed = true
    }
    if (!fixed) break
  }
  if (!notes.length) return { ok: true, days, message: null }
  return { ok: false, days, message: `${notes.join(', ')}: the same muscles need 48 hours between hard sessions.` }
}

/** The plan for a date. */
export const planned = (week: TrainWeek, day: string): DayType => week.days[dowOf(day)]

/** A session you logged (from the training log). */
export interface DoneSession {
  date: string
  type: SessionType
}

export interface TodayPlan {
  /** What to do today: a session, or rest. */
  type: DayType
  /** planned: the week says so · catch-up: a missed session fits today · done: already trained today ·
   *  rest · moved: today's plan would break the 48 hours, so the other session (or rest) instead. */
  why: 'planned' | 'catch-up' | 'done' | 'rest' | 'moved'
  /** One calm line (never guilt). */
  line: string
  /** On a rest day: the session you could do instead without breaking the 48 hours (null: none). */
  anyway: SessionType | null
  /** The next planned session after today. */
  next: { day: string; type: SessionType } | null
}

/** The last day a session of this kind was logged before `day` (null: none). */
function lastOf(done: DoneSession[], type: SessionType, day: string): string | null {
  let best: string | null = null
  for (const s of done) if (s.type === type && s.date < day && (!best || s.date > best)) best = s.date
  return best
}

/** True when this session keeps 48 hours since the last one of the same kind. */
export function rested(done: DoneSession[], type: SessionType, day: string): boolean {
  const last = lastOf(done, type, day)
  return !last || daysBetween(last, day) >= 2
}

/**
 * A planned session in the last 2 days with nothing logged that day or after it (null: none). Only once
 * you train with the split (a session in the 9 days before), so a first visit is never "missed".
 */
export function missedSession(week: TrainWeek, done: DoneSession[], today: string): { day: string; type: SessionType } | null {
  if (!done.some((s) => s.date < today && daysBetween(s.date, today) <= 9)) return null
  for (let i = 1; i <= 2; i++) {
    const d = shiftDay(today, -i)
    const t = planned(week, d)
    if (t === 'rest') continue
    if (!done.some((s) => s.date >= d && s.date < today)) return { day: d, type: t }
  }
  return null
}

/**
 * Today's session from the week and what you actually did. A planned session that didn't happen in the
 * last 2 days becomes today's on a rest day, when it keeps 48 hours for those muscles. A planned session
 * that would come too soon after the same kind moves to the other one (or rest).
 */
export function todayPlan(week: TrainWeek, done: DoneSession[], today: string): TodayPlan {
  let next: TodayPlan['next'] = null
  for (let i = 1; i <= 7 && !next; i++) {
    const d = shiftDay(today, i)
    const t = planned(week, d)
    if (t !== 'rest') next = { day: d, type: t }
  }
  const nextLine = next ? ` Next: ${TYPE_NAME[next.type]} on ${WEEKDAYS[dowOf(next.day)]}.` : ''
  const todayDone = done.find((s) => s.date === today)
  if (todayDone) return { type: todayDone.type, why: 'done', line: `Done for today: ${TYPE_NAME[todayDone.type]}. Eat well and sleep: that is when muscle grows.${nextLine}`, anyway: null, next }

  const plan = planned(week, today)
  const missed = missedSession(week, done, today)
  const anyway = (['upper', 'legs'] as SessionType[])
    .filter((t) => rested(done, t, today))
    .sort((a, b) => (lastOf(done, a, today) ?? '').localeCompare(lastOf(done, b, today) ?? ''))[0] ?? null

  if (plan === 'rest') {
    if (missed && rested(done, missed.type, today))
      return { type: missed.type, why: 'catch-up', line: `${WEEKDAYS[dowOf(missed.day)]}'s ${TYPE_NAME[missed.type]} didn't happen. Today works for it: those muscles have had 48 hours.`, anyway: null, next }
    return { type: 'rest', why: 'rest', line: `Rest day: walk, stretch, eat your full food. Muscles grow today.${nextLine}`, anyway, next }
  }
  if (!rested(done, plan, today)) {
    const alt: SessionType = plan === 'upper' ? 'legs' : 'upper'
    if (rested(done, alt, today)) return { type: alt, why: 'moved', line: `You trained ${TYPE_NAME[plan].toLowerCase()} yesterday, so today is ${TYPE_NAME[alt]} instead: 48 hours for each muscle.`, anyway: null, next }
    return { type: 'rest', why: 'moved', line: `Your muscles need 48 hours: today is a rest day. Walk, stretch, eat your full food.${nextLine}`, anyway: null, next }
  }
  return { type: plan, why: 'planned', line: `${WEEKDAYS[dowOf(today)]}: ${TYPE_NAME[plan]}. Stop each set with 1–3 reps left in the tank.`, anyway: null, next }
}
