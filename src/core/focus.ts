// Focus, plans and goals (pure, tested): the part of Life System that is about
// studying and working. Coins come from real focused minutes, the day starts
// with 1–3 must-dos and ends with a 30-second review, goals with a deadline
// turn into a weekly hours target, and fun time costs coins.
import { addDays, daysBetween } from './dates'

/** Coins for a focus session: 1 per 5 minutes, +5 for a full 50-minute block. */
export function focusCoins(minutes: number): number {
  const m = Math.max(0, Math.floor(minutes))
  return Math.floor(m / 5) + (m >= 50 ? 5 : 0)
}
/** At most this many focus coins a day (beyond that, minutes still count). */
export const FOCUS_DAILY_COINS = 80
/** A session longer than planned counts up to 30 minutes extra; never more than 4 hours. */
export function sessionMinutes(startedAt: string, planned: number, now: Date): number {
  const elapsed = Math.round((now.getTime() - Date.parse(startedAt)) / 60000)
  return Math.max(1, Math.min(elapsed, planned + 30, 240))
}
/** Fun (games, YouTube, scrolling) costs 1 coin a minute. */
export const funCost = (minutes: number) => Math.max(1, Math.round(minutes))
/** Coins for each must-do of the day you finish (up to 3 a day). */
export const PLAN_ITEM_COINS = 10

export interface PlanItem {
  text: string
  done: boolean
}
export interface DayPlan {
  day: string
  items: PlanItem[]
  review: string | null
  reasons: string[]
}
/** Why a must-do didn't happen (one tap in the evening). */
export const REASONS = ['Tired', 'Phone / social media', 'Task unclear', 'No time', 'Forgot', 'Other'] as const

/** "1. Essay\n2) gym; call Leo" → ["Essay", "gym", "call Leo"] (at most 5). */
export function parsePlan(text: string): string[] {
  return String(text || '')
    .split(/\n|;|•/)
    .flatMap((l) => (/,/.test(l) && !/\d,\d/.test(l) && l.split(',').length <= 3 && l.length < 120 ? l.split(',') : [l]))
    .map((l) => l.replace(/^\s*(\d+[.)]|[-*✅⬜☐]|\[\s?[xX]?\s?\])\s*/, '').trim())
    .filter((l) => l.length > 0)
    .slice(0, 5)
}

export interface FocusGoal {
  id: number
  title: string
  subject: string
  deadline: string
  hours: number
  createdDay: string
}
export interface GoalProgress extends FocusGoal {
  doneMin: number
  /** Hours a week still needed to make the deadline. */
  perWeekH: number
  /** Ahead (+) or behind (−) a steady pace, in hours. */
  aheadH: number
  daysLeft: number
}

/** Where a goal stands: hours done, the weekly target from here, ahead or behind. */
export function goalProgress(g: FocusGoal, doneMin: number, today: string): GoalProgress {
  const total = Math.max(1, daysBetween(g.createdDay, g.deadline))
  const elapsed = Math.min(total, Math.max(0, daysBetween(g.createdDay, today)))
  const daysLeft = Math.max(0, daysBetween(today, g.deadline))
  const leftH = Math.max(0, g.hours - doneMin / 60)
  const perWeekH = leftH === 0 ? 0 : leftH / Math.max(1, daysLeft / 7)
  const expectedH = (g.hours * elapsed) / total
  return { ...g, doneMin, perWeekH: Math.round(perWeekH * 10) / 10, aheadH: Math.round((doneMin / 60 - expectedH) * 10) / 10, daysLeft }
}

export interface FocusSession {
  id: number
  day: string
  subject: string
  minutes: number
  coins: number
}

export interface WeekReport {
  from: string
  to: string
  totalMin: number
  bySubject: { subject: string; minutes: number }[]
  byDay: { day: string; minutes: number }[]
  planDone: number
  planTotal: number
  topReasons: { reason: string; count: number }[]
  funMin: number
}

/** The last 7 days (today included), for the weekly review. */
export function weekReport(sessions: FocusSession[], plans: DayPlan[], funMin: number, today: string): WeekReport {
  const from = addDays(today, -6)
  const inWeek = (d: string) => d >= from && d <= today
  const s = sessions.filter((x) => inWeek(x.day))
  const bySub = new Map<string, number>()
  for (const x of s) bySub.set(x.subject, (bySub.get(x.subject) ?? 0) + x.minutes)
  const byDay = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(from, i)
    return { day, minutes: s.filter((x) => x.day === day).reduce((t, x) => t + x.minutes, 0) }
  })
  const p = plans.filter((x) => inWeek(x.day))
  const reasons = new Map<string, number>()
  for (const x of p) for (const r of x.reasons) reasons.set(r, (reasons.get(r) ?? 0) + 1)
  return {
    from,
    to: today,
    totalMin: s.reduce((t, x) => t + x.minutes, 0),
    bySubject: [...bySub].map(([subject, minutes]) => ({ subject, minutes })).sort((a, b) => b.minutes - a.minutes),
    byDay,
    planDone: p.reduce((t, x) => t + x.items.filter((i) => i.done).length, 0),
    planTotal: p.reduce((t, x) => t + x.items.length, 0),
    topReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 3),
    funMin
  }
}

/** "2h 05m", "45m". */
export const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${Math.max(0, Math.round(min))}m`)
