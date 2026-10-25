import { addDays, daysBetween } from './dates'

/**
 * Consecutive days ending today. If today isn't done yet the streak is still
 * alive as long as yesterday was.
 */
export function dayStreak(doneDays: Iterable<string>, today: string): number {
  const set = new Set(doneDays)
  let cursor = set.has(today) ? today : addDays(today, -1)
  let n = 0
  while (set.has(cursor)) {
    n++
    cursor = addDays(cursor, -1)
  }
  return n
}

export function bestDayStreak(doneDays: Iterable<string>): number {
  const days = [...new Set(doneDays)].sort()
  let best = 0
  let run = 0
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && daysBetween(days[i - 1], days[i]) === 1 ? run + 1 : 1
    best = Math.max(best, run)
  }
  return best
}

export interface CleanStats {
  current: number
  best: number
  totalClean: number
  relapses: number
  since: string | null
}

/**
 * Clean-day stats derived from a start date and relapse dates. The count is
 * the number of whole days since the last reset, so it can't be bumped by hand.
 */
export function cleanStats(start: string | null, relapses: string[], today: string): CleanStats {
  if (!start) return { current: 0, best: 0, totalClean: 0, relapses: 0, since: null }
  const resets = relapses.filter((d) => d >= start && d <= today).sort()
  const points = [start, ...resets, today]
  const segments: number[] = []
  for (let i = 0; i < points.length - 1; i++) segments.push(Math.max(0, daysBetween(points[i], points[i + 1])))
  const since = resets.length ? resets[resets.length - 1] : start
  return {
    current: segments[segments.length - 1] ?? 0,
    best: Math.max(0, ...segments),
    totalClean: segments.reduce((s, n) => s + n, 0),
    relapses: resets.length,
    since
  }
}
