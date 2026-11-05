// The one "Do this now" decision, shared: the Now card (DayFlow) decides it,
// Today's top row shows the same one, and its button asks the card to run it
// (window event 'life-do-now'), so the two can never disagree.
import { useSyncExternalStore } from 'react'
import type { DoNow } from '@core/doNow'

let current: DoNow | null = null
const subs = new Set<() => void>()

export function publishNow(d: DoNow | null): void {
  if (current?.key === d?.key && current?.why === d?.why && current?.tag === d?.tag) return
  current = d
  subs.forEach((f) => f())
}

export function useSharedNow(): DoNow | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => current,
    () => null
  )
}

/** Ask the Now card to run its action. */
export const runSharedNow = () => window.dispatchEvent(new CustomEvent('life-do-now'))

/** Skip the current "Do this now" for today (F3): the next one comes up. */
export const skipSharedNow = () => window.dispatchEvent(new CustomEvent('life-skip-now'))
