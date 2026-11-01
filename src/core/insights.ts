// Insights: your year at a glance and your streaks. A day "counts" for each
// good thing that happened (50+ minutes of focus, on-time wake-up, workout,
// clean day, a Todoist task done, a must-do done); the heatmap colors days by
// how many. Pure: the Insights page and the coach read it.
import { addDays } from './dates'
import type { ProgressInput } from './progress'

export type HabitId = 'focus' | 'wake' | 'sport' | 'clean' | 'tasks'

export interface DayCell {
  day: string
  /** 0–4, for the heatmap color. */
  level: number
  /** How many good things (0–6). */
  count: number
  focusMin: number
  /** What counted, for the tooltip. */
  parts: string[]
}

export interface Streak {
  id: HabitId
  label: string
  /** Days in a row up to today (today counts when already done, else up to yesterday). */
  current: number
  best: number
}

export interface Insights {
  days: DayCell[]
  streaks: Streak[]
  /** Days with at least one good thing, in the period. */
  activeDays: number
  totalFocusMin: number
  /** The best weekday by average count ("Tuesday"), null when too little data. */
  bestWeekday: string | null
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Weekday of a YYYY-MM-DD (0 = Sunday), without local-time Date math. */
export function weekday(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * Clean days, the same way the Discipline streak counts them: after your
 * current start date (the latest 'start'), each day after it or after a
 * reset is clean; the start day and reset days are not.
 */
export function cleanSet(ev: { kind: string; day: string }[], from: string, to: string): Set<string> {
  const out = new Set<string>()
  const starts = ev.filter((e) => e.kind === 'start').map((e) => e.day)
  if (!starts.length) return out
  const start = starts[starts.length - 1]
  const resets = new Set(ev.filter((e) => e.kind === 'reset' && e.day > start).map((e) => e.day))
  for (let d = addDays(start > from ? start : addDays(from, -1), 1); d <= to; d = addDays(d, 1)) if (!resets.has(d)) out.add(d)
  return out
}

/** Days in a row ending today (or yesterday, when today isn't done yet). */
export function currentStreak(done: Set<string>, today: string): number {
  let d = done.has(today) ? today : addDays(today, -1)
  let n = 0
  while (done.has(d)) {
    n++
    d = addDays(d, -1)
  }
  return n
}

/** The longest run of consecutive days. */
export function bestStreak(done: Set<string>): number {
  const days = [...done].sort()
  let best = 0
  let run = 0
  let prev = ''
  for (const d of days) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1
    best = Math.max(best, run)
    prev = d
  }
  return best
}

export function insights(i: ProgressInput, length = 364): Insights {
  const to = i.today
  const from = addDays(to, -(length - 1))
  const focus = new Map<string, number>()
  for (const r of i.focus) if (r.day >= from && r.day <= to) focus.set(r.day, (focus.get(r.day) ?? 0) + r.minutes)
  const sets: Record<HabitId, Set<string>> = {
    focus: new Set([...focus].filter(([, m]) => m >= 50).map(([d]) => d)),
    wake: new Set(i.wakes.filter((w) => w.onTime).map((w) => w.day)),
    sport: new Set(i.workouts.map((w) => w.day)),
    clean: cleanSet(i.discipline, from, to),
    tasks: new Set([...i.todoist.map((t) => t.day), ...(i.mustdos ?? []).filter((m) => m.done).map((m) => m.day)])
  }
  const LABEL: Record<HabitId, string> = { focus: '50+ min focus', wake: 'On-time wake-up', sport: 'Workout', clean: 'Clean day', tasks: 'Task done' }

  const days: DayCell[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const parts = (Object.keys(sets) as HabitId[]).filter((k) => sets[k].has(d)).map((k) => LABEL[k])
    const count = parts.length
    days.push({ day: d, count, level: count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count <= 3 ? 3 : 4, focusMin: focus.get(d) ?? 0, parts })
  }

  // Every streak is days in a row; for workouts a rest day ends the run.
  const streaks: Streak[] = (Object.keys(sets) as HabitId[]).map((id) => ({ id, label: LABEL[id], current: currentStreak(sets[id], to), best: bestStreak(new Set([...sets[id]].filter((d) => d >= from && d <= to))) }))

  const byWd = Array.from({ length: 7 }, () => ({ n: 0, t: 0 }))
  for (const c of days) {
    const w = byWd[weekday(c.day)]
    w.n++
    w.t += c.count
  }
  const active = days.filter((c) => c.count > 0)
  const ranked = byWd.map((w, k) => ({ k, avg: w.n ? w.t / w.n : 0 })).sort((a, b) => b.avg - a.avg)
  return {
    days,
    streaks,
    activeDays: active.length,
    totalFocusMin: days.reduce((t, c) => t + c.focusMin, 0),
    bestWeekday: active.length >= 14 && ranked[0].avg > 0 ? WEEKDAYS[ranked[0].k] : null
  }
}
