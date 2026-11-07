import { describe, expect, it } from 'vitest'
import { moveById } from './sportMoves'
import { ladderOf, levelOf, loggedMoves, moveOf, nextStep, startTarget, suggestHarder, targetRun, type DayLog, type SportEx } from './sportLadders'

const ex = (o: Partial<SportEx>): SportEx => ({ id: 'ex_p', name: 'Push-ups', target: 100, unit: 'reps', active: true, ...o })
const days = (rows: [string, number][], id = 'ex_p'): DayLog => Object.fromEntries(rows.map(([d, n]) => [d, { [id]: n }]))

describe('ladders', () => {
  it('knows where a move sits and what comes next', () => {
    const p = moveById('pushup')!
    expect(levelOf(p)).toMatchObject({ level: 3, of: 9, family: 'pushup' })
    expect(nextStep(p)?.id).toBe('wide_pushup')
    expect(nextStep(moveById('one_arm_pushup')!)).toBeNull()
    expect(moveOf({ name: 'pushups' })?.id).toBe('pushup')
    expect(moveOf({ name: 'Anything', move: 'squat' })?.id).toBe('squat')
  })

  it('counts sessions in a row at target, skipping days off', () => {
    const d = days([['2026-11-01', 100], ['2026-11-03', 98], ['2026-11-05', 110], ['2026-10-30', 50]])
    expect(targetRun(d, 'ex_p', 100, '2026-11-06')).toBe(3)
    expect(targetRun(d, 'ex_p', 105, '2026-11-06')).toBe(1) // 98 < 95% of 105 ends it
    expect(targetRun(d, 'ex_p', 100, '2026-11-02')).toBe(1) // later days don't count
  })

  it('suggests the next step only after 3 sessions at target', () => {
    const two = days([['2026-11-04', 100], ['2026-11-05', 100]])
    expect(suggestHarder({ exercises: [ex({})], days: two, today: '2026-11-06' })).toEqual([])
    const three = days([['2026-11-03', 100], ['2026-11-04', 100], ['2026-11-05', 101]])
    const s = suggestHarder({ exercises: [ex({})], days: three, today: '2026-11-06' })
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ exId: 'ex_p', run: 3, trySet: 10 })
    expect(s[0].to.id).toBe('wide_pushup')
    expect(s[0].swapTarget).toBeLessThanOrEqual(40)
  })

  it('respects "not yet", a move already in the routine, and turned-off exercises', () => {
    const three = days([['2026-11-03', 100], ['2026-11-04', 100], ['2026-11-05', 100]])
    expect(suggestHarder({ exercises: [ex({})], days: three, today: '2026-11-06', notYet: { wide_pushup: '2026-11-12' } })).toEqual([])
    expect(suggestHarder({ exercises: [ex({})], days: three, today: '2026-11-13', notYet: { wide_pushup: '2026-11-12' } })).toHaveLength(1)
    expect(suggestHarder({ exercises: [ex({}), ex({ id: 'ex_w', name: 'Wide push-ups' })], days: three, today: '2026-11-06' })).toEqual([])
    expect(suggestHarder({ exercises: [ex({ active: false })], days: three, today: '2026-11-06' })).toEqual([])
    // Not a library move: nothing to suggest.
    expect(suggestHarder({ exercises: [ex({ name: 'Bench press' })], days: three, today: '2026-11-06' })).toEqual([])
  })

  it('starts the harder move lower', () => {
    const p = moveById('pushup')!
    const d = moveById('diamond_pushup')!
    expect(startTarget(p, d, 50)).toBe(30) // capped at the usual start
    expect(startTarget(p, d, 20)).toBe(12) // 20 × 0.6 for one step of difficulty
    expect(startTarget(p, d, 5)).toBe(8) // never below one set
    expect(startTarget(moveById('plank')!, moveById('side_plank')!, 90)).toBe(50)
    expect(startTarget(null, d, 50)).toBe(d.start)
    expect(startTarget(moveById('crunch')!, moveById('hollow_hold')!, 40)).toBe(60) // reps → seconds: its own start
  })

  it('shows your ladder: done, current, next, later', () => {
    const exs = [ex({}), ex({ id: 'ex_k', name: 'Knee push-ups', active: false })]
    const logged = loggedMoves({ '2026-11-01': { ex_k: 20, ex_p: 0 } }, exs)
    expect([...logged]).toEqual(['knee_pushup'])
    const steps = ladderOf('pushup', logged, new Set(['pushup']))
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'next', 'later', 'later', 'later', 'later', 'later'])
  })
})
