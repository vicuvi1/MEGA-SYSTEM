// Deadlines planned backward into study sessions (pure, tested in
// planDeadlines.test.ts). The data is the existing deadline goals
// ("Etica exam on 20 Nov, needs 8 hours": focus goals with a subject, a
// deadline and hours; hours done come from focus sessions).
//
// Each deadline's hours left are cut into sessions of 25–90 minutes and placed
// over the days before it, working back from the day before the deadline and
// spread out (not all crammed at the end), heavy days of the week plan first,
// never more than a day has room for (its limits, its fixed events, what the
// earlier deadlines already took). The day plan gets today's sessions as
// normal blocks with a "why" line ("exam in 5 days, session 2 of 4").
//
// A missed session needs no special case: the hours left grow, so the next
// plan spreads them over the days left (the existing re-booking). When the
// days left can't hold them, the deadline says so plainly: "Not enough room
// before Friday 20 Nov: 3h short". Session ids are made from the goal and the
// day, so planning again never makes a second session (planDedupe merges by
// id and title). Nothing here pays points or writes anywhere.
import { addDays, daysBetween } from './dates'
import { fmtH } from './planLimits'
import type { GoalPlan } from './goalPlan'

export interface DeadlineGoal {
  id: number | string
  title: string
  subject: string
  /** YYYY-MM-DD. The deadline day itself is not a study day. */
  deadline: string
  /** Minutes still to do (today's sessions so far already taken off). */
  leftMin: number
  /** Behind a steady pace, in hours (positive = behind), when known. */
  behindH?: number
}

/** How much deadline study a day can take, and how much it is wanted there. */
export interface DayRoom {
  day: string
  /** Minutes free for deadline sessions that day (after limits, events and the free share). */
  minutes: number
  /** heavy 3, normal 2, light 1 (the week plan). */
  weight: number
}

export interface Session {
  /** Stable: the same goal and day always give the same id. */
  id: string
  goalId: number | string
  /** The block title: subject first (the focus timer counts it for the goal). */
  title: string
  day: string
  minutes: number
  n: number
  of: number
  /** "exam in 5 days, session 2 of 4". */
  why: string
}

export interface DeadlinePlan {
  goalId: number | string
  title: string
  deadline: string
  leftMin: number
  sessions: Session[]
  /** Minutes that don't fit before the deadline. */
  shortMin: number
  /** The plain warning (null: it fits). */
  line: string | null
}

export const SESSION_MAX = 90
export const SESSION_MIN = 25
const r5 = (m: number) => Math.round(m / 5) * 5

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Friday 20 Nov". */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** What kind of deadline, in one word, from its title ("exam", "essay", "report"), else "deadline". */
export function deadlineWord(title: string): string {
  const m = /\b(exam|test|quiz|essay|report|thesis|project|presentation|assignment|paper)\b/i.exec(title)
  return m ? m[1].toLowerCase() : 'deadline'
}

/** The session block's title: the subject first, like the goal blocks (core/goalPlan goalBlockTitle). */
export const sessionTitle = (g: Pick<DeadlineGoal, 'subject' | 'title'>) => (g.subject?.trim() && g.subject.trim().toLowerCase() !== g.title.trim().toLowerCase() ? `${g.subject.trim()}: ${g.title.trim()}` : g.title.trim())

/** Session id: goal and day (and the k-th session that day). Letters, digits and dashes only. */
export const sessionId = (goalId: number | string, day: string, k = 0) => `dl-${String(goalId).replace(/[^a-zA-Z0-9]/g, '')}-${day.replace(/-/g, '')}${k ? `-${k}` : ''}`

/**
 * Plans every deadline backward. `rooms` covers today and the days after
 * (missing days have no room). Earlier deadlines get room first. Pure: the
 * same inputs give the same sessions.
 */
export function planDeadlines(goals: DeadlineGoal[], rooms: DayRoom[], today: string): DeadlinePlan[] {
  const left = new Map(rooms.filter((r) => r.day >= today).map((r) => [r.day, Math.max(0, Math.floor(r.minutes / 5) * 5)]))
  const weight = new Map(rooms.map((r) => [r.day, r.weight]))
  const open = goals.filter((g) => g.leftMin > 0 && g.deadline > today).sort((a, b) => a.deadline.localeCompare(b.deadline) || String(a.id).localeCompare(String(b.id)))
  const out: DeadlinePlan[] = []
  for (const g of open) {
    // Study days: today up to the day before the deadline, latest first.
    const days: string[] = []
    for (let d = addDays(g.deadline, -1); d >= today && days.length < 60; d = addDays(d, -1)) days.push(d)
    const want = r5(g.leftMin)
    const n = Math.max(1, Math.ceil(want / SESSION_MAX))
    // Even sessions over the days there are (fewer days than sessions: longer ones, up to 90 min).
    const size = Math.min(SESSION_MAX, Math.max(SESSION_MIN, Math.ceil(want / Math.max(1, Math.min(n, days.length)) / 5) * 5))
    const taken: { day: string; minutes: number }[] = []
    let rest = want
    // One session per deadline a day, at most 90 minutes (a second one would be a second block of the same name).
    const used = (day: string) => taken.filter((t) => t.day === day).reduce((s, t) => s + t.minutes, 0)
    const take = (day: string, cap: number): boolean => {
      const room = Math.min(left.get(day) ?? 0, SESSION_MAX - used(day))
      const m = Math.min(cap, room, rest)
      // A last bit under 25 min is still a session when it is all that is left.
      if (m < SESSION_MIN && !(m === rest && m >= 10)) return false
      left.set(day, (left.get(day) ?? 0) - m)
      rest -= m
      taken.push({ day, minutes: m })
      return true
    }
    // 1. Spread: n days evenly over the study days, from the day before the deadline back;
    //    within each stretch the heaviest day of the week plan (then the latest) that has room.
    if (days.length) {
      const stride = days.length / Math.min(n, days.length)
      for (let i = 0; i < Math.min(n, days.length) && rest > 0; i++) {
        const stretch = days.slice(Math.floor(i * stride), Math.max(Math.floor(i * stride) + 1, Math.floor((i + 1) * stride)))
        const pick = [...stretch].filter((d) => Math.min(left.get(d) ?? 0, SESSION_MAX - used(d)) >= Math.min(SESSION_MIN, rest)).sort((a, b) => (weight.get(b) ?? 2) - (weight.get(a) ?? 2) || b.localeCompare(a))[0]
        if (pick) take(pick, size)
      }
    }
    // 2. What is still left: any study day with room, heaviest then latest first, a session at a time.
    for (let guard = 0; rest > 0 && guard < 200; guard++) {
      const pick = [...days].filter((d) => Math.min(left.get(d) ?? 0, SESSION_MAX - used(d)) >= Math.min(SESSION_MIN, rest)).sort((a, b) => used(a) - used(b) || (weight.get(b) ?? 2) - (weight.get(a) ?? 2) || b.localeCompare(a))[0]
      if (!pick || !take(pick, size)) break
    }
    // One session per day: two on the same day become one longer one (up to the day's room).
    const byDay = new Map<string, number>()
    for (const t of taken) byDay.set(t.day, (byDay.get(t.day) ?? 0) + t.minutes)
    const order = [...byDay.keys()].sort()
    const of = order.length
    const word = deadlineWord(g.title)
    const sessions: Session[] = order.map((day, i) => {
      const d = daysBetween(day, g.deadline)
      return { id: sessionId(g.id, day), goalId: g.id, title: sessionTitle(g), day, minutes: byDay.get(day)!, n: i + 1, of, why: `${word} ${d === 1 ? 'tomorrow' : `in ${d} days`}, session ${i + 1} of ${of}` }
    })
    const shortMin = Math.max(0, rest)
    out.push({ goalId: g.id, title: g.title, deadline: g.deadline, leftMin: want, sessions, shortMin, line: shortLine(g, shortMin) })
  }
  return out
}

/** "Etica exam: not enough room before Friday 20 Nov: 3h short" (and "behind by 2h" when it is). */
export function shortLine(g: Pick<DeadlineGoal, 'title' | 'deadline' | 'behindH'>, shortMin: number): string | null {
  if (shortMin < 15) return null
  const behind = g.behindH != null && g.behindH >= 1 ? ` You are behind by ${Math.round(g.behindH)}h.` : ''
  return `${g.title}: not enough room before ${dayLabel(g.deadline)}: ${fmtH(r5(shortMin))} short.${behind}`
}

/** Today's sessions, ready for the packer (`goals`) with their why line and stable id. */
export function sessionsOn(plans: DeadlinePlan[], day: string): Session[] {
  return plans.flatMap((p) => p.sessions.filter((s) => s.day === day))
}

/** Planned minutes per day (all deadlines). */
export function minutesByDay(plans: DeadlinePlan[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of plans.flatMap((p) => p.sessions)) m.set(s.day, (m.get(s.day) ?? 0) + s.minutes)
  return m
}

/**
 * The deadline goals from the goal plans (core/goalPlan): what is left from the
 * start of today (today's minutes done count toward today's session), and how
 * far behind a steady pace.
 */
export function fromGoalPlans(plans: GoalPlan[]): DeadlineGoal[] {
  return plans
    .filter((p) => p.leftMin > 0 && p.daysLeft > 0)
    .map((p) => ({ id: p.goalId, title: p.title, subject: p.subject, deadline: p.deadline, leftMin: p.leftMin + doneToday(p), behindH: p.aheadH < 0 ? -p.aheadH : 0 }))
}

/** Minutes done today on a goal (its share for today minus what is still left today). */
export const doneToday = (p: Pick<GoalPlan, 'perDayMin' | 'todayLeftMin'>) => Math.max(0, p.perDayMin - p.todayLeftMin)
