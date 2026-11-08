// Week planning (pure, tested in planWeek.test.ts). You set the week once on
// Today → Week: which days are heavy study days, which are gym days, which
// day is light. Synced setting `plan_week`. It is a standing template: it
// holds every week until you change it (the date says when you last did).
//
// Each morning's day plan is built from it: a light day has at most 2h of
// work, deadline sessions go to heavy days first, the workout slot is booked
// on gym days only (once any gym day is set). The week summary shows planned
// hours per day against the limits, and whether each deadline is covered.
// Changing the week re-plans only draft days: today when its plan is still a
// draft, and the days ahead (they are worked out when needed). Past days and
// an approved plan are never changed. Only plan data; no points.
import { addDays } from './dates'
import { freeGaps, type CalEvent } from './dayTime'
import { endWith, limitsFor, withProtected, type DayLimits, type PlanLimits } from './planLimits'
import { planDeadlines, type DayRoom, type DeadlineGoal, type DeadlinePlan } from './planDeadlines'

export type DayType = 'heavy' | 'normal' | 'light'

export interface WeekDay {
  type: DayType
  gym: boolean
}

export interface WeekShape {
  /** Monday … Sunday. */
  days: WeekDay[]
  /** When you last set it (YYYY-MM-DD). */
  setOn: string | null
}

export const PLAN_WEEK = 'plan_week'
export const WEEK_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** A light day holds at most this much work (your own limit can make it lower). */
export const LIGHT_CAP = 120
export const DAY_WEIGHT: Record<DayType, number> = { heavy: 3, normal: 2, light: 1 }
/** The share of a day's room that deadline sessions may take, by kind of day (the rest is for the day's tasks). */
export const DEADLINE_SHARE: Record<DayType, number> = { heavy: 0.8, normal: 0.5, light: 0.3 }

export const EMPTY_WEEK: WeekShape = { days: WEEK_NAMES.map(() => ({ type: 'normal' as DayType, gym: false })), setOn: null }

/** Checks and tidies what was saved. */
export function cleanWeek(raw: unknown): WeekShape {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const list = Array.isArray(r.days) ? r.days : []
  const days = WEEK_NAMES.map((_, i) => {
    const d = list[i] ?? {}
    const type: DayType = d.type === 'heavy' || d.type === 'light' ? d.type : 'normal'
    return { type, gym: d.gym === true }
  })
  return { days, setOn: typeof r.setOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.setOn) ? r.setOn : null }
}

/** Monday = 0 … Sunday = 6. */
export const weekIndex = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7
/** The Monday of the week `day` is in. */
export const mondayOf = (day: string) => addDays(day, -weekIndex(day))

export interface DayRules {
  type: DayType
  gym: boolean
  /** The day's limits (a light day caps work at LIGHT_CAP). */
  limits: DayLimits
  /** false: no workout slot today (gym days are set and this isn't one). */
  train: boolean
}

/** What the week plan and your limits say for one day. */
export function dayRules(week: WeekShape, limits: PlanLimits, day: string): DayRules {
  const d = week.days[weekIndex(day)] ?? { type: 'normal', gym: false }
  const anyGym = week.days.some((x) => x.gym)
  return { type: d.type, gym: d.gym, limits: limitsFor(limits, day, d.type === 'light' ? LIGHT_CAP : null), train: !anyGym || d.gym }
}

/**
 * How much deadline study each day can hold: the free time between events
 * (from `from`, or from now today, to the off time or 22:00), minus the free
 * share, times the day's deadline share, never more than its work limit or
 * the study cap.
 */
export function dayRooms(o: { today: string; now: string; days: number; events: CalEvent[]; week: WeekShape; limits: PlanLimits; freeShare?: number; from?: string; endBy?: string }): DayRoom[] {
  const out: DayRoom[] = []
  for (let i = 0; i < o.days; i++) {
    const day = addDays(o.today, i)
    const r = dayRules(o.week, o.limits, day)
    const end = endWith(o.endBy ?? '22:00', r.limits)
    const evs = withProtected(o.events, r.limits, day)
    const gaps = freeGaps(evs, day, { from: o.from ?? '08:00', to: end, ...(i === 0 ? { after: o.now } : {}), minMinutes: 25 })
    const free = gaps.reduce((t, g) => t + g.minutes, 0) * (1 - Math.max(0, Math.min(0.5, o.freeShare ?? 0.15)))
    let room = free * DEADLINE_SHARE[r.type]
    if (r.limits.maxFocusMin != null) room = Math.min(room, r.limits.maxFocusMin)
    const study = r.limits.caps.find((c) => c.kind === 'study')
    if (study) room = Math.min(room, study.minutes)
    out.push({ day, minutes: Math.max(0, Math.floor(room / 5) * 5), weight: DAY_WEIGHT[r.type] })
  }
  return out
}

export interface WeekRow {
  day: string
  name: string
  type: DayType
  gym: boolean
  today: boolean
  /** Planned work minutes: today's plan for today (its deadline sessions when there is no plan), deadline sessions for the days ahead. */
  plannedMin: number
  /** The day's work limit (null: none). */
  capMin: number | null
  /** Deadline sessions that day. */
  sessions: { title: string; minutes: number; why: string }[]
  over: boolean
}

export interface WeekSummary {
  rows: WeekRow[]
  deadlines: { title: string; deadline: string; needMin: number; plannedMin: number; shortMin: number; line: string | null; sessions: number }[]
}

/**
 * The next 7 days at a glance (today first, so it is useful on any day,
 * Sunday included): planned hours per day against the limits, and the
 * deadlines' coverage. `todayMin`: the work minutes in today's plan (null: no
 * plan). The past is not shown, so nothing in it can change.
 */
export function weekSummary(o: { today: string; week: WeekShape; limits: PlanLimits; plans: DeadlinePlan[]; todayMin: number | null }): WeekSummary {
  const rows: WeekRow[] = WEEK_NAMES.map((_, i) => {
    const day = addDays(o.today, i)
    const r = dayRules(o.week, o.limits, day)
    const sessions = o.plans.flatMap((p) => p.sessions.filter((s) => s.day === day).map((s) => ({ title: s.title, minutes: s.minutes, why: s.why })))
    const isToday = i === 0
    const plannedMin = isToday && o.todayMin != null ? o.todayMin : sessions.reduce((t, s) => t + s.minutes, 0)
    const capMin = r.limits.maxFocusMin
    return { day, name: WEEK_NAMES[weekIndex(day)], type: r.type, gym: r.gym, today: isToday, plannedMin, capMin, sessions, over: capMin != null && plannedMin > capMin }
  })
  const deadlines = o.plans.map((p) => {
    const plannedMin = p.sessions.reduce((t, s) => t + s.minutes, 0)
    return { title: p.title, deadline: p.deadline, needMin: p.leftMin, plannedMin, shortMin: p.shortMin, line: p.line, sessions: p.sessions.length }
  })
  return { rows, deadlines }
}

/** Plans the deadlines with the week plan and your limits, for `days` days from today. */
export function weekDeadlines(o: { today: string; now: string; goals: DeadlineGoal[]; events: CalEvent[]; week: WeekShape; limits: PlanLimits; freeShare?: number; endBy?: string }): DeadlinePlan[] {
  const last = o.goals.filter((g) => g.leftMin > 0 && g.deadline > o.today).map((g) => g.deadline).sort().pop()
  if (!last) return []
  const span = Math.min(60, Math.max(1, Math.round((Date.parse(`${last}T12:00:00Z`) - Date.parse(`${o.today}T12:00:00Z`)) / 86400000)))
  const rooms = dayRooms({ today: o.today, now: o.now, days: span, events: o.events, week: o.week, limits: o.limits, freeShare: o.freeShare, endBy: o.endBy })
  return planDeadlines(o.goals, rooms, o.today)
}

/** Which days a week change re-plans: today only while its plan is a draft; never a past day. */
export function draftDays(today: string, todayStatus: 'proposed' | 'approved' | null): { replanToday: boolean; from: string } {
  return { replanToday: todayStatus !== 'approved', from: todayStatus === 'approved' ? addDays(today, 1) : today }
}
