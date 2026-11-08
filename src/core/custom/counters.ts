// Custom Center: counters. Honest points: a counter never pays anything by
// itself. A counter that tracks a real thing sends its taps to that thing's
// one log (water → the water log, reps → Sport Track's reps and workout log),
// so the points and streak rules stay exactly as they are today. A purely
// custom counter only keeps its own number in `custom_state`.
import { calendarDay } from '../dates'
import type { CounterWidget, CustomState, ChecklistWidget } from './model'

/** Where a tap on a counter goes. */
export type CounterRoute =
  | { to: 'water'; ml: number }
  | { to: 'reps'; exercise: string; amount: number }
  | { to: 'local'; widget: string; amount: number }

/** The route for adding `amount` (negative takes back) to a counter. Pure: the app does the writing. */
export function counterRoute(w: Pick<CounterWidget, 'id' | 'track' | 'exercise'>, amount: number): CounterRoute {
  const n = Math.round(amount)
  if (w.track === 'water') return { to: 'water', ml: n }
  if (w.track === 'reps' && w.exercise) return { to: 'reps', exercise: w.exercise, amount: n }
  return { to: 'local', widget: w.id, amount: n }
}

/** Does this route pay points by itself? Never: only the real log's own rules can. */
export const routePays = (_r: CounterRoute): false => false

/**
 * The counter's "day" for `now`: the date the count belongs to, turning at
 * `resetAt` (e.g. 04:00: at 02:00 it still counts for yesterday).
 */
export function counterDay(now: number, resetAt: string): string {
  const d = new Date(now)
  const reset = Number(resetAt.slice(0, 2)) * 60 + Number(resetAt.slice(3, 5))
  if (d.getHours() * 60 + d.getMinutes() < reset) d.setDate(d.getDate() - 1)
  return calendarDay(d)
}

/** A custom counter's number today (0 after its reset time). */
export function localCount(state: CustomState, w: Pick<CounterWidget, 'id' | 'resetAt'>, now: number): number {
  const c = state.counters[w.id]
  return c && c.day === counterDay(now, w.resetAt) ? c.n : 0
}

/** The state after adding `amount` to a custom counter (never below 0). */
export function addLocal(state: CustomState, w: Pick<CounterWidget, 'id' | 'resetAt'>, amount: number, now: number): CustomState {
  const day = counterDay(now, w.resetAt)
  const n = Math.max(0, localCount(state, w, now) + Math.round(amount))
  return { ...state, counters: { ...state.counters, [w.id]: { day, n } } }
}

/** Ticked items of a checklist today. */
export function checksDone(state: CustomState, w: Pick<ChecklistWidget, 'id' | 'resetAt' | 'items'>, now: number): string[] {
  const c = state.checks[w.id]
  if (!c || c.day !== counterDay(now, w.resetAt)) return []
  return c.done.filter((id) => w.items.some((it) => it.id === id))
}

/** Ticks or unticks one item (pays nothing). */
export function toggleCheck(state: CustomState, w: Pick<ChecklistWidget, 'id' | 'resetAt' | 'items'>, itemId: string, now: number): CustomState {
  const done = checksDone(state, w, now)
  const next = done.includes(itemId) ? done.filter((x) => x !== itemId) : [...done, itemId]
  return { ...state, checks: { ...state.checks, [w.id]: { day: counterDay(now, w.resetAt), done: next } } }
}
