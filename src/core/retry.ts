// Waiting between tries when something keeps failing (CL7): offline, the
// server down, a calendar that doesn't answer. 5 s, 10 s, 20 s … up to 10
// minutes, with a little randomness so many tabs don't all knock at once.
// Pure: the caller passes the clock and (in tests) the random numbers.

export interface RetryOpts {
  /** First wait (default 5 s). */
  base?: number
  /** Longest wait (default 10 minutes). */
  max?: number
  /** Share of the wait that is random (default 0.2 = ±20 %). */
  jitter?: number
  random?: () => number
}

/** How long to wait before try number `attempt` (0 = the first retry). */
export function retryDelay(attempt: number, o: RetryOpts = {}): number {
  const base = o.base ?? 5000
  const max = o.max ?? 10 * 60_000
  const jitter = o.jitter ?? 0.2
  const random = o.random ?? Math.random
  const n = Math.max(0, Math.min(30, Math.floor(attempt)))
  const plain = Math.min(max, base * 2 ** n)
  const spread = plain * jitter * (random() * 2 - 1)
  return Math.max(0, Math.min(max, Math.round(plain + spread)))
}

/**
 * A "stop asking for a while" switch for polling (CL7): after `after`
 * failures in a row, `allow()` says no until the wait is over; one success
 * resets it. Pressing a button still calls the service (only polling asks).
 */
export function breaker(o: RetryOpts & { after?: number } = {}) {
  const after = o.after ?? 3
  let fails = 0
  let until = 0
  return {
    allow: (now = Date.now()) => now >= until,
    ok: () => {
      fails = 0
      until = 0
    },
    fail: (now = Date.now()) => {
      fails++
      if (fails >= after) until = now + retryDelay(fails - after, { base: 60_000, max: 30 * 60_000, ...o })
    },
    get fails() {
      return fails
    },
    get pausedUntil() {
      return until
    }
  }
}
