// One goals list (pure, FT3). Goals live in a few places: goals with a
// deadline and hours (focus_goals, also what Ben's "goal:" action writes),
// goals Ben tracks with you ("aim:", coach_mind), the week plan's big 3 and
// the Sunday call's big 3. This puts them in one list: deadline, hours left,
// this week's share, today's block and whether you're on track.
import { addDays, daysBetween } from './dates'
import { blockSubject, isFocusBlock, localDay, type CalEvent } from './dayTime'
import { isGoalBlock, type GoalPlan } from './goalPlan'
import type { MindGoal } from './coachMind'

export interface BoardGoal {
  key: string
  source: 'goal' | 'aim'
  /** focus_goals id (source 'goal'). */
  id: number | null
  title: string
  subject: string | null
  deadline: string | null
  daysLeft: number | null
  hoursLeft: number | null
  /** Minutes still to do this week (to Sunday or the deadline) to stay on plan. */
  weekLeftMin: number | null
  todayLeftMin: number | null
  todayBlock: { title: string; start: string; end: string } | null
  status: GoalPlan['status'] | 'tracked'
  /** null when there are no hours to measure (an aim). */
  onTrack: boolean | null
  weekly: string | null
  aheadH: number | null
}

export interface WeekItem {
  text: string
  done: boolean
  from: 'week plan' | 'Sunday call'
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const same = (a: string, b: string) => {
  const x = norm(a)
  const y = norm(b)
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x))
}
const hhmm = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Days from today to Sunday (today included), never past the deadline day. */
export function daysThisWeek(today: string, deadline: string | null): number {
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay()
  const sunday = addDays(today, (7 - wd) % 7)
  const last = deadline && addDays(deadline, -1) < sunday ? addDays(deadline, -1) : sunday
  return Math.max(0, daysBetween(today, last) + 1)
}

export function goalsBoard(i: { today: string; plans: GoalPlan[]; aims: MindGoal[]; events: CalEvent[]; weekPlan: { text: string; done: boolean }[]; callBig3: string[] }): { goals: BoardGoal[]; week: WeekItem[] } {
  const todayEvents = i.events.filter((e) => !e.allDay && localDay(e.start) === i.today).sort((a, b) => a.start.localeCompare(b.start))
  const goals: BoardGoal[] = i.plans.map((p) => {
    const block = todayEvents.find((e) => isGoalBlock(e, p)) ?? todayEvents.find((e) => isFocusBlock(e) && norm(blockSubject(e.title)) === norm(p.subject))
    const open = p.status !== 'done' && p.status !== 'late'
    return {
      key: `g${p.goalId}`,
      source: 'goal',
      id: p.goalId,
      title: p.title,
      subject: p.subject,
      deadline: p.deadline,
      daysLeft: p.daysLeft,
      hoursLeft: Math.round((p.leftMin / 60) * 10) / 10,
      weekLeftMin: open ? Math.max(0, p.perDayMin * daysThisWeek(i.today, p.deadline) - (p.perDayMin - p.todayLeftMin)) : 0,
      todayLeftMin: open ? p.todayLeftMin : 0,
      todayBlock: block ? { title: block.title, start: hhmm(block.start), end: hhmm(block.end) } : null,
      status: p.status,
      onTrack: p.status === 'done' || p.status === 'ahead' || p.status === 'on track',
      weekly: null,
      aheadH: p.aheadH
    }
  })
  for (const a of i.aims) {
    if (goals.some((g) => same(g.title, a.title))) continue
    goals.push({
      key: `a${norm(a.title).slice(0, 30)}`,
      source: 'aim',
      id: null,
      title: a.title,
      subject: null,
      deadline: a.deadline || null,
      daysLeft: a.deadline ? Math.max(0, daysBetween(i.today, a.deadline)) : null,
      hoursLeft: null,
      weekLeftMin: null,
      todayLeftMin: null,
      todayBlock: null,
      status: 'tracked',
      onTrack: null,
      weekly: a.weekly || null,
      aheadH: null
    })
  }
  // Nearest deadline first; goals without one at the end.
  goals.sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'))
  const week: WeekItem[] = i.weekPlan.map((b) => ({ text: b.text, done: b.done, from: 'week plan' as const }))
  for (const t of i.callBig3) if (!week.some((w) => same(w.text, t))) week.push({ text: t, done: false, from: 'Sunday call' })
  return { goals, week: week.slice(0, 6) }
}
