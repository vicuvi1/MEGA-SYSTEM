import { describe, expect, it } from 'vitest'
import { moveById } from './sportMoves'
import { weekPlan } from './sportProgram'
import { muscleWeek, nextStepFor, plannedSetsByMuscle } from './sportWeekly'
import type { SetLog } from './sportSets'

const today = '2026-11-07' // a Saturday
const ex = [
  { id: 'p', name: 'Push-ups', target: 30, move: 'pushup', active: true },
  { id: 's', name: 'Squats', target: 45, move: 'squat', active: true }
]
const set = (reps: number[]) => reps.map((r, i) => ({ reps: r, id: `${r}-${i}` }))

describe('weekly sets per muscle (BD3)', () => {
  it('counts what the plan gives each muscle against 10–20', () => {
    const week = weekPlan(ex, { minutes: 30, perWeek: 3 }, today)
    const planned = plannedSetsByMuscle(week)
    expect(planned.push).toBeGreaterThanOrEqual(6)
    const mw = muscleWeek({ log: {}, exercises: ex, week, today })
    expect(mw.map((m) => m.id)).toEqual(['push', 'pull', 'core', 'legs'])
    for (const m of mw) expect(m.status === 'ok' ? m.tip === null : !!m.tip).toBe(true)
    const low = mw.find((m) => m.status === 'low')
    if (low) expect(low.tip).toMatch(/under 10|Nothing/)
  })
  it('hard sets done this week come from the log', () => {
    const week = weekPlan(ex, { minutes: 30, perWeek: 3 }, today)
    const log: SetLog = { '2026-11-02': { p: set([12, 11, 10]) }, '2026-11-04': { p: set([12, 12, 11]), s: set([20, 18]) } }
    const mw = muscleWeek({ log, exercises: ex, week, today })
    expect(mw.find((m) => m.id === 'push')!.done).toBe(6)
    expect(mw.find((m) => m.id === 'legs')!.done).toBe(2)
  })
  it('the next step: one more rep, then tempo on a plateau, the next ladder step at the top, repeat after a short night', () => {
    const push = moveById('pushup')!
    const building: SetLog = { '2026-11-03': { p: set([10, 9, 9]) } }
    expect(nextStepFor({ log: building, exId: 'p', move: push, today }).kind).toBe('rep')
    const flat: SetLog = { '2026-10-30': { p: set([10, 10, 10]) }, '2026-11-02': { p: set([10, 10, 9]) }, '2026-11-04': { p: set([10, 9, 9]) } }
    expect(nextStepFor({ log: flat, exId: 'p', move: push, today }).kind).toBe('tempo')
    const top: SetLog = { '2026-11-02': { p: set([15, 15, 15]) }, '2026-11-04': { p: set([15, 15, 15]) } }
    const s = nextStepFor({ log: top, exId: 'p', move: push, today })
    expect(s.kind).toBe('level')
    expect(s.text).toMatch(/Move up to/)
    expect(nextStepFor({ log: building, exId: 'p', move: push, today, hold: true })).toMatchObject({ kind: 'hold' })
    expect(nextStepFor({ log: {}, exId: 'p', move: push, today }).kind).toBe('start')
  })
})
