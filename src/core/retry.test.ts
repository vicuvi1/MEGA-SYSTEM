import { describe, expect, it } from 'vitest'
import { breaker, retryDelay } from './retry'

describe('retryDelay (CL7)', () => {
  const mid = () => 0.5
  it('doubles from 5 s and stops at 10 minutes', () => {
    expect([0, 1, 2, 3].map((n) => retryDelay(n, { random: mid }))).toEqual([5000, 10000, 20000, 40000])
    expect(retryDelay(20, { random: mid })).toBe(600_000)
    expect(retryDelay(1000, { random: mid })).toBe(600_000)
  })
  it('spreads the wait a little, never past the limit', () => {
    expect(retryDelay(0, { random: () => 0 })).toBe(4000)
    expect(retryDelay(0, { random: () => 1 })).toBe(6000)
    expect(retryDelay(30, { random: () => 1 })).toBe(600_000)
  })
})

describe('breaker (CL7)', () => {
  it('pauses polling after 3 failures in a row and opens again after one success', () => {
    const b = breaker({ random: () => 0.5 })
    b.fail(0)
    b.fail(0)
    expect(b.allow(1)).toBe(true)
    b.fail(0)
    expect(b.allow(1)).toBe(false)
    expect(b.allow(60_000)).toBe(true)
    b.fail(60_000)
    expect(b.allow(60_000 + 100_000)).toBe(false)
    b.ok()
    expect(b.allow(60_001)).toBe(true)
    expect(b.fails).toBe(0)
  })
})
