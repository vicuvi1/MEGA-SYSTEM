import { describe, expect, it } from 'vitest'
import { patternLines, riskWindows, topTriggers, upcomingRisk, windowLabel, type UrgeEvent } from './urgePatterns'

const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).toISOString()
const now = new Date(2026, 10, 20, 21, 30) // Fri 20 Nov 2026, 21:30

describe('urge patterns', () => {
  it('finds a late-night window that repeats on different days', () => {
    const ev: UrgeEvent[] = [
      { kind: 'urge', ts: at(10, 23, 10) },
      { kind: 'urge', ts: at(12, 22, 40) },
      { kind: 'reset', ts: at(15, 23, 50) },
      { kind: 'urge', ts: at(3, 9) } // one-off morning: not a pattern
    ]
    const w = riskWindows(ev, now)
    expect(w).toHaveLength(1)
    expect(windowLabel(w[0])).toBe('every day 22:00–00:00')
    expect(w[0]).toMatchObject({ urges: 2, resets: 1 })
  })

  it('a weekday-only window (Tuesdays after class)', () => {
    // 3, 10, 17 Nov 2026 are Tuesdays
    const ev: UrgeEvent[] = [{ kind: 'urge', ts: at(3, 15) }, { kind: 'urge', ts: at(10, 14, 30) }, { kind: 'urge', ts: at(17, 15, 30) }]
    expect(riskWindows(ev, now).map(windowLabel)).toEqual(['Tue 14:00–16:00'])
  })

  it('warns within the hour before, and while it is on', () => {
    const w = riskWindows([{ kind: 'urge', ts: at(10, 23) }, { kind: 'urge', ts: at(12, 22) }, { kind: 'reset', ts: at(15, 23) }], now)
    expect(upcomingRisk(w, new Date(2026, 10, 20, 21, 10))).not.toBeNull()
    expect(upcomingRisk(w, new Date(2026, 10, 20, 22, 30))).not.toBeNull()
    expect(upcomingRisk(w, new Date(2026, 10, 20, 19, 0))).toBeNull()
  })

  it('top triggers, resets count double; lines for Ben', () => {
    const notes = [
      { at: at(10, 23), kind: 'urge' as const, trigger: 'Phone in bed' },
      { at: at(12, 22), kind: 'urge' as const, trigger: 'Bored' },
      { at: at(15, 23), kind: 'reset' as const, trigger: 'Phone in bed' }
    ]
    expect(topTriggers(notes, now)[0]).toEqual({ trigger: 'Phone in bed', n: 3 })
    expect(patternLines([], [], now)).toEqual([])
    expect(patternLines([{ kind: 'urge', ts: at(10, 23) }, { kind: 'urge', ts: at(12, 22) }, { kind: 'reset', ts: at(15, 23) }], notes, now).join(' ')).toContain('every day 22:00–00:00')
  })
})
