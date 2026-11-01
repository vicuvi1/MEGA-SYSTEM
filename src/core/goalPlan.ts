// Goals planned backward from the deadline: the hours left become weekly
// milestones and minutes per day, booked as blocks in your free time. When a
// day is missed, the rest is spread again so the deadline still holds, and the
// cost is said out loud ("+12 min/day now"). Pure and tested.
import { addDays, daysBetween } from './dates'
import { freeGaps, suggestBlocks, type CalEvent } from './dayTime'
import type { GoalProgress } from './focus'

export interface Milestone {
  /** Last day of the milestone week (or the deadline). */
  by: string
  /** Hours done by then (cumulative). */
  targetH: number
  state: 'past' | 'now' | 'next'
}

export interface GoalPlan {
  goalId: number
  title: string
  subject: string
  deadline: string
  leftMin: number
  /** Study days left, today included (the deadline day itself is not one). */
  daysLeft: number
  /** Minutes a day from now on to make it. */
  perDayMin: number
  /** Minutes still to do today (perDayMin minus today's focus on it). */
  todayLeftMin: number
  status: 'done' | 'ahead' | 'on track' | 'behind' | 'late'
  aheadH: number
  milestones: Milestone[]
}

const round5 = (m: number) => Math.ceil(m / 5) * 5

/** Minutes a day to finish `leftMin` in `days` days. */
export const perDay = (leftMin: number, days: number) => (leftMin <= 0 ? 0 : round5(leftMin / Math.max(1, days)))

/** The plan for one goal, from its progress (hours done) and today's focus on it. */
export function planGoal(g: GoalProgress, today: string, todayMin = 0): GoalPlan {
  const leftMin = Math.max(0, Math.round(g.hours * 60 - g.doneMin))
  const daysLeft = Math.max(0, daysBetween(today, g.deadline))
  // Today's minutes already count in doneMin: the per-day share is from the start of today.
  const pd = perDay(leftMin + todayMin, daysLeft)
  const status: GoalPlan['status'] = leftMin === 0 ? 'done' : daysLeft === 0 ? 'late' : g.aheadH >= 1 ? 'ahead' : g.aheadH <= -1 ? 'behind' : 'on track'
  const milestones: Milestone[] = []
  if (leftMin > 0 && daysLeft > 0) {
    const doneH = g.doneMin / 60
    const last = addDays(g.deadline, -1)
    let d = today
    while (d <= last && milestones.length < 12) {
      const wd = new Date(`${d}T12:00:00Z`).getUTCDay()
      const sunday = addDays(d, (7 - wd) % 7)
      const by = sunday < last ? sunday : last
      const daysTo = daysBetween(today, by) + 1
      const target = Math.min(g.hours, doneH + ((leftMin + todayMin) / 60) * (daysTo / daysLeft) - todayMin / 60)
      milestones.push({ by, targetH: Math.round(target * 10) / 10, state: milestones.length === 0 ? 'now' : 'next' })
      d = addDays(by, 1)
    }
  }
  return { goalId: g.id, title: g.title, subject: g.subject, deadline: g.deadline, leftMin, daysLeft, perDayMin: pd, todayLeftMin: Math.max(0, pd - todayMin), status, aheadH: g.aheadH, milestones }
}

/** What missing today costs: the per-day minutes from tomorrow if nothing more is done today. */
export function missCost(p: GoalPlan): number {
  if (p.daysLeft <= 1 || p.todayLeftMin <= 0) return 0
  return Math.max(0, perDay(p.leftMin, p.daysLeft - 1) - p.perDayMin)
}

/** The block title: the subject first (so the focus timer counts it for the goal). */
export const goalBlockTitle = (p: Pick<GoalPlan, 'subject' | 'title'>) => `${p.subject}: ${p.title}`

/** Is this calendar event one of our blocks for this goal? */
export const isGoalBlock = (e: Pick<CalEvent, 'title' | 'ours'>, p: Pick<GoalPlan, 'subject' | 'title'>) => !!e.ours && e.title.trim() === goalBlockTitle(p)

export interface BookedBlock {
  goalId: number
  title: string
  day: string
  start: string
  minutes: number
}

/**
 * Blocks for the next `days` days (today from `now`), in free time between
 * 08:00 and 22:00: each goal's minutes per day, in chunks of 25–90 minutes,
 * the most urgent goal first.
 */
export function bookBlocks(plans: GoalPlan[], events: CalEvent[], today: string, now: string, days = 7): BookedBlock[] {
  const out: BookedBlock[] = []
  const urgent = plans.filter((p) => p.leftMin > 0 && p.daysLeft > 0).sort((a, b) => a.daysLeft - b.daysLeft || a.aheadH - b.aheadH)
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i)
    const items: { title: string; minutes: number; goalId: number }[] = []
    for (const p of urgent) {
      if (day >= p.deadline) continue
      const need = i === 0 ? p.todayLeftMin : p.perDayMin
      if (need < 20) continue
      // Even chunks of at most 90 minutes (100 → 2 × 50, not 90 + 10).
      const n = Math.ceil(need / 90)
      const chunk = Math.max(25, round5(need / n))
      for (let k = 0; k < n; k++) items.push({ title: goalBlockTitle(p), minutes: chunk, goalId: p.goalId })
    }
    if (!items.length) continue
    const gaps = freeGaps(events, day, { from: '08:00', to: '22:00', ...(i === 0 ? { after: now } : {}), minMinutes: 25 })
    const placed = suggestBlocks(gaps, items)
    for (const b of placed) out.push({ goalId: items.find((x) => x.title === b.title)!.goalId, title: b.title, day, start: b.start, minutes: b.minutes })
  }
  return out
}

/** One line per goal for the coach and the evening review. */
export function planLine(p: GoalPlan): string {
  if (p.status === 'done') return `${p.title}: done 🎉`
  if (p.status === 'late') return `${p.title}: deadline reached, ${(p.leftMin / 60).toFixed(1)}h still open`
  const cost = missCost(p)
  return `${p.title} (${p.subject}, due ${p.deadline}, ${p.daysLeft} days): ${(p.leftMin / 60).toFixed(1)}h left → ${p.perDayMin} min/day${p.todayLeftMin ? `, ${p.todayLeftMin} min still today` : ', today done'}${p.status === 'behind' ? `, ${Math.abs(p.aheadH)}h behind` : p.status === 'ahead' ? `, ${p.aheadH}h ahead` : ''}${cost ? `. Skipping today costs +${cost} min/day` : ''}`
}
