// The plan score (pure and tested, planScore.test.ts): one number 0-100 per
// day for "how realistic was the plan", from the end-of-day check
// (core/planReview.ts). It judges the plan, not your effort, and pays no points.
//
//   score = 50% minutes done of minutes planned (each block counts up to its length)
//         + 30% blocks done in their time (real minutes at most 1.25x the plan, or no number)
//         + 20% blocks that did not slip or drop
//
// Partly counts its real minutes (half the block when no number was given).
// Only blocks you checked count; a day with no check has no score.
import { addDays } from './dates'
import type { ReviewItem, ReviewStore } from './planReview'

export interface DayScore {
  day: string
  score: number
  plannedMin: number
  doneMin: number
  blocks: number
  done: number
  slipped: number
}

export const ON_TIME = 1.25

export function scoreItems(day: string, items: ReviewItem[]): DayScore | null {
  if (!items.length) return null
  let plannedMin = 0
  let doneMin = 0
  let onTime = 0
  let slipped = 0
  let done = 0
  for (const it of items) {
    plannedMin += it.planned
    if (it.outcome === 'done') {
      done++
      doneMin += Math.min(it.planned, it.actual ?? it.planned)
      if (it.actual == null || it.actual <= it.planned * ON_TIME) onTime++
    } else if (it.outcome === 'part') doneMin += Math.min(it.planned, it.actual ?? Math.round(it.planned / 2))
    else slipped++
  }
  const n = items.length
  const raw = 0.5 * (plannedMin ? doneMin / plannedMin : 0) + 0.3 * (onTime / n) + 0.2 * (1 - slipped / n)
  return { day, score: Math.max(0, Math.min(100, Math.round(raw * 100))), plannedMin, doneMin, blocks: n, done, slipped }
}

/** One day's score (null: not checked). */
export function dayScore(store: ReviewStore, day: string): DayScore | null {
  return scoreItems(day, Object.values(store.days[day]?.items ?? {}))
}

/** The last 7 days up to `today` (oldest first), null where the day was not checked. */
export function weekScores(store: ReviewStore, today: string): { day: string; score: number | null }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i - 6)
    return { day, score: dayScore(store, day)?.score ?? null }
  })
}

/** "Yesterday's plan: 72% realistic" (null: yesterday was not checked). */
export function yesterdayLine(store: ReviewStore, today: string): string | null {
  const s = dayScore(store, addDays(today, -1))
  return s ? `Yesterday's plan: ${s.score}% realistic` : null
}

/** The Week tab's line: "Plan realism, last 7 days: 72% on average (4 days checked)". */
export function weekLine(store: ReviewStore, today: string): string | null {
  const xs = weekScores(store, today)
    .map((d) => d.score)
    .filter((x): x is number => x != null)
  if (!xs.length) return null
  const avg = Math.round(xs.reduce((t, x) => t + x, 0) / xs.length)
  return `Plan realism, last 7 days: ${avg}% on average (${xs.length} day${xs.length === 1 ? '' : 's'} checked)`
}
