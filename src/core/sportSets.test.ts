import { describe, expect, it } from 'vitest'
import { addSets, bestSet, hardSets, hardSetsByMuscle, importSets, mergeSets, mondayOf, parseSets, sessionsOf, setsText, weeklyVolume, type SetLog } from './sportSets'

const T = Date.parse('2026-03-10T09:00:00Z')
const EX = [
  { id: 'ex_push', name: 'Push-ups', target: 45, move: 'pushup' },
  { id: 'ex_sq', name: 'Squats', target: 60, move: 'squat' },
  { id: 'ex_plank', name: 'Plank', target: 90, unit: 'sec', move: 'plank' },
  { id: 'ex_cat', name: 'Cat-cow', target: 10, move: 'cat_cow' }
]

describe('sets', () => {
  it('adds sets with ids and keeps the old log as it was', () => {
    const a: SetLog = {}
    const b = addSets(a, '2026-03-10', 'ex_push', [15, 14, 0, 12], T)
    expect(a).toEqual({})
    expect(b['2026-03-10'].ex_push.map((s) => s.reps)).toEqual([15, 14, 12])
    expect(new Set(b['2026-03-10'].ex_push.map((s) => s.id)).size).toBe(3)
  })

  it('merges two devices: sets with ids once each, lists without ids keep the longer', () => {
    const base = addSets({}, '2026-03-10', 'ex_push', [15], T)
    const phone = addSets(base, '2026-03-10', 'ex_push', [14], T + 60000)
    const pc = addSets(base, '2026-03-10', 'ex_push', [13], T + 120000)
    const m = mergeSets(phone, pc)
    expect(m['2026-03-10'].ex_push.map((s) => s.reps)).toEqual([15, 14, 13])
    const old = mergeSets({ '2026-03-01': { ex_push: [{ reps: 10 }] } }, { '2026-03-01': { ex_push: [{ reps: 10 }, { reps: 9 }] } })
    expect(old['2026-03-01'].ex_push).toHaveLength(2)
  })

  it('finds sessions and the best single set', () => {
    let log = addSets({}, '2026-03-02', 'ex_push', [12, 11, 10], T)
    log = addSets(log, '2026-03-05', 'ex_push', [14, 12, 11], T)
    log = addSets(log, '2026-03-09', 'ex_push', [13, 13, 12], T)
    expect(sessionsOf(log, 'ex_push').map((s) => s.day)).toEqual(['2026-03-02', '2026-03-05', '2026-03-09'])
    expect(bestSet(log, 'ex_push')).toEqual({ reps: 14, day: '2026-03-05' })
    expect(bestSet(log, 'ex_push', '2026-03-04')).toEqual({ reps: 12, day: '2026-03-02' })
    expect(bestSet(log, 'nope')).toBeNull()
  })

  it('counts hard sets (near the day\'s best, not warm-ups) per muscle group', () => {
    expect(hardSets([4, 15, 14, 12])).toBe(3)
    expect(hardSets([10, 30, 30], 'sec')).toBe(2)
    let log = addSets({}, '2026-03-09', 'ex_push', [15, 14, 12], T)
    log = addSets(log, '2026-03-10', 'ex_sq', [20, 18, 6], T)
    log = addSets(log, '2026-03-10', 'ex_plank', [45, 40], T)
    log = addSets(log, '2026-03-10', 'ex_cat', [10, 10], T)
    log = addSets(log, '2026-03-01', 'ex_push', [15, 15, 15], T)
    expect(hardSetsByMuscle(log, EX, '2026-03-09', '2026-03-15')).toEqual({ push: 3, pull: 0, core: 2, legs: 2 })
  })

  it('weekly volume comes from day totals, so old days without sets count', () => {
    const days = { '2026-03-02': { ex_push: 100 }, '2026-03-04': { ex_push: 30, ex_sq: 50 }, '2026-03-10': { ex_push: 45 } }
    expect(mondayOf('2026-03-15')).toBe('2026-03-09')
    expect(weeklyVolume(days, null, '2026-03-10', 2)).toEqual([{ monday: '2026-03-02', total: 180 }, { monday: '2026-03-09', total: 45 }])
    expect(weeklyVolume(days, ['ex_push'], '2026-03-10', 2)[0].total).toBe(130)
  })

  it('imports sets from sessions and records, never from day totals', () => {
    const st = {
      days: { '2026-02-01': { ex_push: 120 } },
      history: [{ id: T, day: '2026-03-01', items: [{ exerciseId: 'ex_push', amount: 41, sets: [{ reps: 15 }, { reps: 14 }, { reps: 12 }] }] }, { id: 2, day: '2026-02-01', items: [{ exerciseId: 'ex_push', amount: 120 }] }],
      best: { ex_sq: { label: '25 in one set', day: '2026-02-20' }, ex_plank: { label: '60 s in one set', day: '2026-02-21' } }
    }
    const log = importSets(st)
    expect(log['2026-03-01'].ex_push.map((s) => s.reps)).toEqual([15, 14, 12])
    expect(log['2026-02-20'].ex_sq.map((s) => s.reps)).toEqual([25])
    expect(log['2026-02-21'].ex_plank.map((s) => s.reps)).toEqual([60])
    expect(log['2026-02-01']).toBeUndefined()
  })
})

describe('parseSets', () => {
  it.each([
    ['3x15 push-ups', 'push-ups', [15, 15, 15], 'reps'],
    ['3×15 pushups', 'pushups', [15, 15, 15], 'reps'],
    ['push-ups 3x12', 'push-ups', [12, 12, 12], 'reps'],
    ['push-ups 15 14 12', 'push-ups', [15, 14, 12], 'reps'],
    ['pushups 15, 14, 12', 'pushups', [15, 14, 12], 'reps'],
    ['15 14 12 squats', 'squats', [15, 14, 12], 'reps'],
    ['plank 3x45s', 'plank', [45, 45, 45], 'sec'],
    ['plank 60s 45s', 'plank', [60, 45], 'sec'],
    ['/pushups 20 18', 'pushups', [20, 18], 'reps']
  ])('%s', (text, name, reps, unit) => {
    expect(parseSets(text)).toEqual({ name, reps, unit })
  })
  it.each(['50 pushups', 'pushups 50', 'spent 40 taxi', 'water 500', 'bed 23:40', '3x15', 'room 12 13'])('not sets: %s', (text) => {
    if (text === 'room 12 13') expect(parseSets(text)?.name).toBe('room') // a name the caller then checks against your exercises
    else expect(parseSets(text)).toBeNull()
  })
  it('writes sets back plainly', () => {
    expect(setsText([15, 15, 15])).toBe('3 × 15')
    expect(setsText([15, 14, 12])).toBe('15 · 14 · 12')
    expect(setsText([45, 40], 'sec')).toBe('45 · 40 s')
  })
})
