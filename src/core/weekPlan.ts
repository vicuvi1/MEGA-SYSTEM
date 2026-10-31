// The week plan (made on Sunday in about 15 minutes): one area to focus on
// and your 3 big tasks. Pure helpers; saved in settings by main/weekPlan.ts.
import { addDays } from './dates'
import type { Metric, MetricId, ProgressReport } from './progress'

export interface WeekPlan {
  /** Monday the plan is for (YYYY-MM-DD). */
  week: string
  /** The one area for the week (a Progress metric). */
  focus: MetricId
  /** Your words for it, e.g. "up at 7:00 every day". */
  note: string
  big3: { text: string; done: boolean; todoistId?: string | null }[]
  savedAt: string
}

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay() // 0 = Sunday

/**
 * The week a plan made today is for: this week's Monday, but on Sunday the
 * coming week (Sunday is planning day).
 */
export function planWeek(today: string): string {
  const wd = weekday(today)
  return wd === 0 ? addDays(today, 1) : addDays(today, 1 - wd)
}

/** The Monday of the week today is in (Sunday counts with the week before). */
export function currentWeek(today: string): string {
  const wd = weekday(today)
  return addDays(today, wd === 0 ? -6 : 1 - wd)
}

/** Sunday, or no plan for this week yet: time to plan. */
export function shouldPlan(plan: WeekPlan | null, today: string): boolean {
  if (weekday(today) === 0) return !plan || plan.week !== planWeek(today)
  return !plan || plan.week !== currentWeek(today)
}

/** The plan in force today (made last Sunday or during this week). */
export function activePlan(plan: WeekPlan | null, today: string): WeekPlan | null {
  return plan && plan.week === currentWeek(today) ? plan : null
}

/** The area to suggest: the one that got worse, else the furthest from a good week. */
export function suggestFocus(r: ProgressReport): Metric | null {
  const worse = r.metrics.find((m) => m.trend === 'worse' && m.target)
  if (worse) return worse
  const withTarget = r.metrics.filter((m) => m.target)
  return withTarget.sort((a, b) => a.now / a.target! - b.now / b.target!)[0] ?? null
}

/** Checks and tidies a plan before it's saved. */
export function cleanPlan(p: Partial<WeekPlan>, today: string, now = new Date()): WeekPlan {
  const big3 = (p.big3 ?? [])
    .map((b) => ({ text: String(b?.text ?? '').trim().slice(0, 140), done: !!b?.done, todoistId: b?.todoistId ? String(b.todoistId) : null }))
    .filter((b) => b.text)
    .slice(0, 3)
  return {
    week: p.week && /^\d{4}-\d{2}-\d{2}$/.test(p.week) ? p.week : planWeek(today),
    focus: (p.focus ?? 'focus') as MetricId,
    note: String(p.note ?? '').trim().slice(0, 140),
    big3,
    savedAt: now.toISOString()
  }
}
