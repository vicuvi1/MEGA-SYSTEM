import { describe, expect, it } from 'vitest'
import { migrateRoutine } from './sportRoutine'

const base = () => ({
  exercises: [
    { id: 'ex_pushups', name: 'Push-ups', target: 45, endTarget: 123, unit: 'reps', active: true },
    { id: 'ex_situps', name: 'Sit-ups', target: 45, endTarget: 60, unit: 'reps', active: true },
    { id: 'ex_press', name: 'press', target: 50, unit: 'reps', active: true },
    { id: 'ex_squat', name: 'Squat', target: 30, unit: 'reps', active: false, plan: true }
  ] as any[],
  sportySettings: { coach: 'beast' } as any
})

describe('migrateRoutine', () => {
  it('turns the plan off and gives back the old exercises and targets', () => {
    const s = migrateRoutine(base())
    expect(s.sportySettings.planFollow).toBe(false)
    expect(s.sportySettings.progressMode).toBe('strength') // Strength is the default goal now
    expect(s.exercises.filter((e) => e.active).map((e) => e.name)).toEqual(['Push-ups', 'Sit-ups', 'press'])
    expect(s.exercises.map((e) => e.target)).toEqual([123, 60, 50, 30])
    expect(s.exercises[0].endTarget).toBeUndefined()
  })
  it('runs once, so a later choice of the plan stays', () => {
    const s = migrateRoutine(base())
    s.sportySettings.planFollow = true
    s.sportySettings.progressMode = 'grow'
    const again = migrateRoutine(s)
    expect(again.sportySettings.planFollow).toBe(true)
    expect(again.sportySettings.progressMode).toBe('grow')
  })
  it('an older v2 routine gets the coach, with its exercises and targets untouched', () => {
    const b = base()
    b.sportySettings = { routineV: 2, progressMode: 'endurance', planFollow: false }
    b.exercises[0].target = 123
    const s = migrateRoutine(b)
    expect(s.sportySettings.progressMode).toBe('strength')
    expect(s.sportySettings.routineV).toBe(4)
    expect(s.exercises.map((e) => e.target)).toEqual([123, 60, 50, 30].map((_, i) => b.exercises[i].target))
    expect(s.exercises.filter((e) => e.active).length).toBe(3)
  })
  it('v4: a coach user moves to Strength, a Simple totals choice made at v3 stays', () => {
    const a = base()
    a.sportySettings = { routineV: 3, progressMode: 'grow' }
    expect(migrateRoutine(a).sportySettings.progressMode).toBe('strength')
    const b = base()
    b.sportySettings = { routineV: 3, progressMode: 'endurance' }
    expect(migrateRoutine(b).sportySettings.progressMode).toBe('endurance')
  })
  it('keeps a plan chosen on purpose', () => {
    const b = base()
    b.sportySettings.planFollow = true
    expect(migrateRoutine(b).sportySettings.planFollow).toBe(true)
  })
  it('never leaves the routine empty, and never turns on a plan-only move', () => {
    const b = base()
    b.exercises.forEach((e) => (e.active = false))
    const s = migrateRoutine(b)
    expect(s.exercises.map((e) => e.active)).toEqual([true, true, true, false])
  })
})
