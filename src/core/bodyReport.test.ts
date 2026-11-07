import { describe, expect, it } from 'vitest'
import { bodyWeek, sleepWeek, stalledMoves, type BodyWeekInput } from './bodyReport'

const today = '2026-11-08'
const base: BodyWeekInput = {
  today,
  protein: { avg: 130, days: 6, goal: 135 },
  weight: { nudge: 'hold', perMonthKg: 0.3, now: 70.4 },
  sets: { push: 12, pull: 10, core: 10, legs: 14 },
  sleep: { avgMin: 460, nights: 7, debtMin: 140 },
  steps: null,
  workouts: 3,
  stalls: []
}
const set = (reps: number[]) => reps.map((r, i) => ({ reps: r, id: `${r}${i}` }))

describe('weekly body report (BD18)', () => {
  it('finds moves that stalled', () => {
    const log = { '2026-10-22': { p: set([12, 11]) }, '2026-10-29': { p: set([13, 12]) }, '2026-11-05': { p: set([13, 11]) }, '2026-11-06': { s: set([20]) } }
    const st = stalledMoves(log, [{ id: 'p', name: 'Push-ups', target: 30, move: 'pushup' }, { id: 's', name: 'Squats', target: 40, move: 'squat' }], today)
    expect(st).toEqual([{ name: 'Push-ups', before: 13, now: 13 }])
  })
  it('sleep debt against 8 h', () => {
    expect(sleepWeek([{ day: '2026-11-07', minutes: 420 }, { day: '2026-11-06', minutes: 390 }, { day: '2026-10-20', minutes: 200 }], today)).toEqual({ avgMin: 405, nights: 2, debtMin: 150 })
    expect(sleepWeek([], today).avgMin).toBeNull()
  })
  it('a good week: keep going', () => {
    const r = bodyWeek(base)
    expect(r.focus).toMatch(/Keep it going/)
    expect(r.lines.map((l) => l.label)).toEqual(['Protein', 'Weight trend', 'Hard sets', 'Sleep'])
    expect(r.html).toContain('Your body this week')
  })
  it('low protein and short sleep explain a stall', () => {
    const r = bodyWeek({ ...base, protein: { avg: 80, days: 5, goal: 135 }, sleep: { avgMin: 380, nights: 6, debtMin: 600 }, stalls: [{ name: 'Push-ups', before: 15, now: 15 }], steps: 6200 })
    expect(r.cause).toBe('Low protein (80 g) and short sleep (6h20) are the likely reason push-ups stalled at 15.')
    expect(r.lines.find((l) => l.label === 'Steps')?.value).toBe('6,200 a day on average')
  })
  it('low sets for a muscle become the focus', () => {
    expect(bodyWeek({ ...base, sets: { push: 12, pull: 4, core: 10, legs: 12 } }).focus).toMatch(/More sets for pull/)
  })
})
