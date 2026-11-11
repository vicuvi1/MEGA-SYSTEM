import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lateNow, nightNudgeDue, nightText, pickOpen } from './benOneJob'

const at = (hm: string) => new Date(`2026-11-11T${hm}:00`)

describe("Ben's one job", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at('21:00'))
  })
  afterEach(() => vi.useRealTimers())

  it('says "go to sleep" once a night, from 23:15 until 04:00', () => {
    expect(lateNow(at('23:14'))).toBe(false)
    expect(lateNow(at('23:15'))).toBe(true)
    expect(lateNow(at('01:30'))).toBe(true)
    expect(lateNow(at('04:00'))).toBe(false)
    expect(nightNudgeDue(at('23:20'), null, '2026-11-11')).toBe(true)
    expect(nightNudgeDue(at('23:40'), '2026-11-11', '2026-11-11')).toBe(false)
    expect(nightNudgeDue(at('22:00'), null, '2026-11-11')).toBe(false)
    expect(nightText(at('23:20'))).toMatch(/asleep by 23:30/)
    expect(nightText(at('00:10'))).toMatch(/past 23:30/)
  })

  it('keeps the 21:15 question open for 3 hours', () => {
    const pick = { day: '2026-11-11', at: at('21:15').toISOString() }
    expect(pickOpen(pick, at('21:40'))).toBe(true)
    expect(pickOpen(pick, new Date(at('21:15').getTime() + 3 * 3600_000 + 1))).toBe(false)
    expect(pickOpen(null, at('21:40'))).toBe(false)
  })
})
