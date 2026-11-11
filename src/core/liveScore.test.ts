import { describe, expect, it } from 'vitest'
import { focusStreak, liveScore } from './liveScore'

describe('the score you can raise', () => {
  it('shows what each open thing adds, biggest first (the honest score of the 3 numbers)', () => {
    const r = liveScore({ mustDone: 1, openMustDos: ['Sport 20 min', 'Read 10 min'], focusBlocks: 0, sleep: null })
    expect(r.score).toBe(11)
    expect(r.gains[0].points).toBeGreaterThanOrEqual(r.gains[r.gains.length - 1].points)
    expect(r.gains.find((g) => g.label === 'Sport 20 min')!.points).toBe(11)
    expect(r.gains.find((g) => g.kind === 'focus')).toMatchObject({ label: 'Start a focus block', points: 11 })
    // Doing them really adds that much.
    const after = liveScore({ mustDone: 2, openMustDos: ['Read 10 min'], focusBlocks: 0, sleep: null })
    expect(after.score - r.score).toBe(11)
  })
  it('an empty day is 0, a perfect day has nothing left to add', () => {
    expect(liveScore({ mustDone: 0, openMustDos: [], focusBlocks: 0, sleep: null }).score).toBe(0)
    expect(liveScore({ mustDone: 3, openMustDos: [], focusBlocks: 3, sleep: { bedTime: '23:00', wakeTime: '06:40' } })).toEqual({ score: 100, gains: [] })
  })
  it('focus streak counts back from today (or yesterday)', () => {
    const w = (mins: number[]) => mins.map((min, i) => ({ day: `2026-11-0${i + 1}`, min }))
    expect(focusStreak(w([60, 0, 55, 70, 80, 90, 10]))).toBe(4)
    expect(focusStreak(w([60, 0, 55, 70, 80, 90, 60]))).toBe(5)
    expect(focusStreak(w([0, 0, 0, 0, 0, 0, 0]))).toBe(0)
  })
})
