import { describe, expect, it } from 'vitest'
import { focusStreak, liveScore } from './liveScore'

describe('the score you can raise', () => {
  it('shows what each open thing adds, biggest first', () => {
    const r = liveScore({ mustDone: 1, openMustDos: ['Sport 20 min', 'Read 10 min'], focusMin: 0, focusGoal: 50, waterMl: 1300, waterTarget: 2700, workoutDone: false })
    expect(r.score).toBeGreaterThan(0)
    expect(r.gains[0].points).toBeGreaterThanOrEqual(r.gains[r.gains.length - 1].points)
    expect(r.gains.find((g) => g.label === 'Sport 20 min')!.points).toBe(13)
    expect(r.gains.find((g) => g.kind === 'focus')).toMatchObject({ label: '25 min focus', points: 15 })
    expect(r.gains.find((g) => g.kind === 'workout')!.points).toBe(15)
    // Doing them really adds that much.
    const after = liveScore({ mustDone: 2, openMustDos: ['Read 10 min'], focusMin: 0, focusGoal: 50, waterMl: 1300, waterTarget: 2700, workoutDone: false })
    expect(after.score - r.score).toBe(13)
  })
  it('a perfect day has nothing left to add', () => {
    expect(liveScore({ mustDone: 3, openMustDos: [], focusMin: 120, focusGoal: 50, waterMl: 3000, waterTarget: 2700, workoutDone: true })).toEqual({ score: 100, gains: [] })
  })
  it('focus streak counts back from today (or yesterday)', () => {
    const w = (mins: number[]) => mins.map((min, i) => ({ day: `2026-11-0${i + 1}`, min }))
    expect(focusStreak(w([60, 0, 55, 70, 80, 90, 10]))).toBe(4)
    expect(focusStreak(w([60, 0, 55, 70, 80, 90, 60]))).toBe(5)
    expect(focusStreak(w([0, 0, 0, 0, 0, 0, 0]))).toBe(0)
  })
})
