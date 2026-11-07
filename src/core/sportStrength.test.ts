import { describe, expect, it } from 'vitest'
import { moveById } from './sportMoves'
import { addSets, type SetLog } from './sportSets'
import { familySeries, isRecord, loadOf, setScore, strengthChange, strengthScore } from './sportStrength'

const T = Date.parse('2026-03-10T09:00:00Z')
const EX = [
  { id: 'a', name: 'Push-ups', target: 45, move: 'pushup', active: false },
  { id: 'b', name: 'Wide push-ups', target: 30, move: 'wide_pushup' },
  { id: 'c', name: 'Squats', target: 60, move: 'squat' }
]
const L = (rows: [string, string, number[]][]) => rows.reduce<SetLog>((l, [d, id, r]) => addSets(l, d, id, r, T), {})

describe('strength', () => {
  it('a harder step counts more, so moving up a level is growth', () => {
    expect(loadOf(moveById('incline_pushup')!)).toBe(1)
    expect(loadOf(moveById('pushup')!)).toBeCloseTo(1.44)
    // 15 push-ups, then 8 of the next step: still stronger.
    expect(setScore(moveById('wide_pushup')!, 8)).toBeGreaterThan(setScore(moveById('pushup')!, 15))
    expect(setScore(moveById('plank')!, 60)).toBe(setScore({ id: 'plank', family: 'plank', unit: 'reps' }, 20))
  })

  it('one line per family across its steps, the best set each day', () => {
    const log = L([['2026-02-01', 'a', [12, 10]], ['2026-02-20', 'a', [15, 15, 15]], ['2026-03-05', 'b', [9, 8, 8]]])
    const s = familySeries(log, EX, 'pushup')
    expect(s.map((p) => [p.day, p.reps, p.move])).toEqual([['2026-02-01', 12, 'pushup'], ['2026-02-20', 15, 'pushup'], ['2026-03-05', 9, 'wide_pushup']])
  })

  it('"X% stronger than 4 weeks ago"', () => {
    const log = L([['2026-02-10', 'a', [10, 9, 9]], ['2026-02-12', 'c', [15, 14]], ['2026-03-08', 'b', [9, 8]], ['2026-03-09', 'c', [20, 18]]])
    const c = strengthChange(log, EX, '2026-03-10')
    expect(c.families.map((f) => f.family).sort()).toEqual(['pushup', 'squat'])
    expect(c.pct).toBeGreaterThan(10)
    expect(c.since).toBe('2026-02-10')
  })

  it('no comparison without older sets', () => {
    expect(strengthChange(L([['2026-03-09', 'c', [20]]]), EX, '2026-03-10').pct).toBeNull()
  })

  it('a score per muscle group from the last 4 weeks', () => {
    const log = L([['2026-03-08', 'b', [9]], ['2026-03-09', 'c', [20]], ['2026-01-01', 'a', [30]]])
    const s = strengthScore(log, EX, '2026-03-10')
    expect(s.by.push).toBe(setScore(moveById('wide_pushup')!, 9))
    expect(s.by.legs).toBe(setScore(moveById('squat')!, 20))
    expect(s.total).toBe(s.by.push + s.by.legs)
  })

  it('a record beats every set before it (not the very first set)', () => {
    const log = L([['2026-03-01', 'a', [14]]])
    expect(isRecord(log, EX, moveById('pushup')!, 15, '2026-03-10')).toBe(true)
    expect(isRecord(log, EX, moveById('pushup')!, 14, '2026-03-10')).toBe(false)
    expect(isRecord({}, EX, moveById('pushup')!, 20, '2026-03-10')).toBe(false)
  })
})
