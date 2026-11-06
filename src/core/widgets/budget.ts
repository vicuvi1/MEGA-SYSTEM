// PL11: a speed budget per widget and per user script. A widget that keeps
// the PC busy is paused and labelled "slowed down" (you can try it again).
// The island pings each widget every few seconds: a late answer means its
// page was stuck; the frame also reports how long its own work took. Pure and
// tested (budget.test.ts).

export const PING_MS = 3000
/** Busy time allowed per ping window (5 % of the time). */
export const BUSY_PER_WINDOW_MS = 150
/** An answer this late is a strike. */
export const LATE_MS = 1000
/** Stuck this long at once: slowed down straight away. */
export const STUCK_MS = 2500
/** Strikes within a minute before it is slowed down. */
export const STRIKES = 3

export interface Budget {
  strikes: number[]
  slowed: boolean
  why: string
}
export const FRESH_BUDGET: Budget = { strikes: [], slowed: false, why: '' }

export type BudgetEvent =
  /** A ping answered `lateMs` after it was due (0 = on time). */
  | { kind: 'pong'; lateMs: number }
  /** No answer at all to the last ping. */
  | { kind: 'silent' }
  /** The frame's own report of its busy time in the last window. */
  | { kind: 'busy'; ms: number }
  /** A user script ran past its time limit. */
  | { kind: 'timeout' }

export function budgetStep(b: Budget, ev: BudgetEvent, now: number): Budget {
  if (b.slowed) return b
  const strike = (why: string, hard = false): Budget => {
    const strikes = [...b.strikes.filter((t) => now - t < 60_000), now]
    return hard || strikes.length >= STRIKES ? { strikes, slowed: true, why } : { strikes, slowed: false, why: '' }
  }
  switch (ev.kind) {
    case 'pong':
      if (ev.lateMs >= STUCK_MS) return strike('It froze the island for a moment', true)
      return ev.lateMs >= LATE_MS ? strike('It answered too slowly') : b
    case 'silent':
      return strike('It stopped answering')
    case 'busy':
      return ev.ms > BUSY_PER_WINDOW_MS ? strike('It used too much of the PC') : b
    case 'timeout':
      return strike('It ran too long')
  }
}

/** How often a widget may get fresh data: its manifest's rate, never faster than every 15 s, and never while hidden. */
export function dataDue(lastAt: number, refreshSec: number, now: number, visible: boolean): boolean {
  if (!visible) return false
  return now - lastAt >= Math.max(15, refreshSec) * 1000
}
