import { describe, expect, it } from 'vitest'
import { addReps, addWater, sharedView } from './sportShared'

const st = { lastDate: '2026-11-01', water: { currentMl: 1950, targetMl: 2700, glassSizeMl: 250 }, exercises: [{ id: 'ex_pushups', name: 'Push-ups', target: 123, doneToday: 246 }, { id: 'ex_situps', name: 'Sit-ups', target: 60, doneToday: 120 }] }

describe('shared water and reps', () => {
  it('shows today and resets on a new day', () => {
    expect(sharedView(st, '2026-11-01')).toEqual({ date: '2026-11-01', water: { ml: 1950, target: 2700, glass: 250 }, exercises: [{ id: 'ex_pushups', name: 'Push-ups', target: 123, done: 246 }, { id: 'ex_situps', name: 'Sit-ups', target: 60, done: 120 }] })
    expect(sharedView(st, '2026-11-02').water.ml).toBe(0)
    expect(sharedView(st, '2026-11-02').exercises[0].done).toBe(0)
    expect(sharedView(null, '2026-11-02').water).toEqual({ ml: 0, target: 2700, glass: 250 })
  })
  it('adds and removes water, never below 0', () => {
    expect(addWater(st, 250, '2026-11-01').water.currentMl).toBe(2200)
    expect(addWater(st, -5000, '2026-11-01').water.currentMl).toBe(0)
    expect(addWater(st, 500, '2026-11-02').water.currentMl).toBe(500)
  })
  it('finds exercises by loose names and adds reps', () => {
    expect(addReps(st, 'pushups', 10, '2026-11-01')?.exercise).toEqual({ name: 'Push-ups', done: 256, target: 123 })
    expect(addReps(st, 'push up', 5, '2026-11-01')?.exercise.done).toBe(251)
    expect(addReps(st, 'Situps', -500, '2026-11-01')?.exercise.done).toBe(0)
    expect(addReps(st, 'squats', 10, '2026-11-01')).toBeNull()
  })
})

describe('parseWater', () => {
  it('reads water messages and leaves money alone', async () => {
    const { parseWater } = await import('./sportShared')
    expect(parseWater('water 500')).toBe(500)
    expect(parseWater('500 ml')).toBe(500)
    expect(parseWater('+250ml')).toBe(250)
    expect(parseWater('apă 0.5 l')).toBe(500)
    expect(parseWater('2 glasses of water')).toBe(500)
    expect(parseWater('вода 300')).toBe(300)
    expect(parseWater('water 15')).toBeNull()
    expect(parseWater('water 25 lei')).toBeNull()
    expect(parseWater('coffee 35')).toBeNull()
    expect(parseWater('milk 1 l')).toBeNull()
  })
})

import { waterTargetFor } from './sportShared'
describe('water target from your weight', () => {
  it('35 ml per kg, +500 on a training day, kept sensible', () => {
    expect(waterTargetFor(70)).toBe(2450)
    expect(waterTargetFor(70, true)).toBe(2950)
    expect(waterTargetFor(150, true)).toBe(4500)
    expect(waterTargetFor(null)).toBeNull()
  })
})
