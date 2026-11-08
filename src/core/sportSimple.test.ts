import { describe, expect, it } from 'vitest'
import { harderChoices, makeEasier, makeHarder, restoreOwnRoutine, setCoachMode, type SimpleEx } from './sportSimple'
import { migrateRoutine } from './sportRoutine'
import { logBotSets } from './sportBot'

const ON = Date.parse('2026-11-07T20:00:00Z')
// The owner's state after best-set onboarding: their own moves are off, the coach's moves are on.
const afterOnboarding = () => ({
  onboarded: '2026-11-07',
  exercises: [
    { id: 'ex_pushups', name: 'Push-ups', target: 45, endTarget: 123, unit: 'reps', active: false },
    { id: 'ex_press', name: 'Press', target: 50, unit: 'reps', active: true },
    { id: 'ex_situps', name: 'Sit-ups', target: 30, endTarget: 60, unit: 'reps', active: true },
    { id: 'ex_1700000000000', name: 'Squats', target: 40, unit: 'reps', active: false, move: 'squat' },
    { id: `ex_${ON}1`, name: 'Archer push-ups', target: 21, unit: 'reps', active: true, move: 'archer_pushup' },
    { id: `ex_${ON}2`, name: 'Hollow body rocks', target: 24, unit: 'reps', active: true, move: 'hollow_rock' },
    { id: `ex_${ON}3`, name: 'Pseudo-planche leans', target: 45, unit: 'sec', active: true, move: 'pseudo_planche' }
  ] as any[],
  sportySettings: { routineV: 4, progressMode: 'strength' } as any
})

describe('restoring your own routine', () => {
  it('shows push-ups, press, sit-ups and squats with your own targets, and hides the coach moves', () => {
    const s: any = migrateRoutine(afterOnboarding())
    const on = s.exercises.filter((e: any) => e.active)
    expect(on.map((e: any) => e.name)).toEqual(['Push-ups', 'Press', 'Sit-ups'].concat([]).filter((n) => on.some((e: any) => e.name === n)))
    expect(on.find((e: any) => e.name === 'Push-ups').target).toBe(123)
    expect(on.find((e: any) => e.name === 'Sit-ups').target).toBe(60)
    expect(on.some((e: any) => /Archer|Hollow|planche/i.test(e.name))).toBe(false)
    expect(s.exercises.length).toBe(7) // nothing is deleted
    expect(s.exercises.filter((e: any) => e.coach).length).toBe(3)
    expect(s.sportySettings.coachMode).toBe(false)
    expect(s.sportySettings.routineV).toBe(5)
  })
  it('keeps the squats you added on, and runs once', () => {
    const st = afterOnboarding()
    st.exercises[3].active = true
    const s: any = migrateRoutine(st)
    expect(s.exercises.filter((e: any) => e.active).map((e: any) => e.name)).toEqual(['Push-ups', 'Press', 'Sit-ups', 'Squats'])
    expect(migrateRoutine(s)).toBe(s)
  })
  it('Coach mode brings the coach moves back, and off again gives your routine back', () => {
    const s: any = migrateRoutine(afterOnboarding())
    const on: any = setCoachMode(s, true)
    expect(on.exercises.filter((e: any) => e.active).map((e: any) => e.name)).toContain('Archer push-ups')
    expect(on.exercises.find((e: any) => e.id === 'ex_pushups').active).toBe(false)
    const off: any = setCoachMode(on, false)
    expect(off.exercises.filter((e: any) => e.active).map((e: any) => e.name)).toEqual(s.exercises.filter((e: any) => e.active).map((e: any) => e.name))
    expect(off.sportySettings.coachMode).toBe(false)
  })
  it('a new user gets Simple mode and the same routine', () => {
    const s: any = migrateRoutine({ exercises: [{ id: 'ex_pushups', name: 'Push-ups', target: 100, active: true }], sportySettings: { autoProgression: true } })
    expect(s.sportySettings.coachMode).toBe(false)
    expect(s.exercises[0].active).toBe(true)
  })
  it('never empties the routine', () => {
    const s: any = restoreOwnRoutine({ exercises: [{ id: `ex_${ON}9`, name: 'Hollow body rocks', target: 20, active: true, move: 'hollow_rock' }], onboarded: '2026-11-07' })
    expect(s.exercises[0].active).toBe(true)
  })
})

describe('Harder and Easier', () => {
  const list = (): SimpleEx[] => [
    { id: 'a', name: 'Push-ups', target: 120, unit: 'reps', active: true },
    { id: 'b', name: 'Sit-ups', target: 60, unit: 'reps', active: true }
  ]
  it('+reps raises only that target by 5, and Easier takes it back', () => {
    const r = makeHarder(list(), 'a', 'reps')!
    expect(r.exercises.map((e) => e.target)).toEqual([125, 60])
    const back = makeEasier(r.exercises, 'a')!
    expect(back.exercises.map((e) => e.target)).toEqual([120, 60])
    expect(makeEasier(back.exercises, 'a')).toBeNull()
  })
  it('+1 set adds a third of the target', () => {
    expect(harderChoices(list()[0]).set.by).toBe(40)
    expect(makeHarder(list(), 'b', 'set')!.exercises.map((e) => e.target)).toEqual([120, 80])
  })
  it('a harder version swaps only that exercise, and Easier goes back to the old one and target', () => {
    const c = harderChoices(list()[0])
    expect(c.version).not.toBeNull()
    const r = makeHarder(list(), 'a', 'version', 'ex_new')!
    expect(r.id).toBe('ex_new')
    expect(r.exercises.find((e) => e.id === 'a')!.active).toBe(false)
    expect(r.exercises.find((e) => e.id === 'b')).toMatchObject({ active: true, target: 60 })
    const now = r.exercises.find((e) => e.id === 'ex_new')!
    expect(now).toMatchObject({ active: true, move: c.version!.moveId, target: c.version!.target })
    const back = makeEasier(r.exercises, 'ex_new')!
    expect(back.id).toBe('a')
    expect(back.exercises.find((e) => e.id === 'a')).toMatchObject({ active: true, target: 120 })
    expect(back.exercises.find((e) => e.id === 'ex_new')!.active).toBe(false)
  })
  it('has no harder version for your own made-up exercise', () => {
    expect(harderChoices({ id: 'x', name: 'Zzz thing', target: 10 }).version).toBeNull()
  })
})

describe('Ben in Simple mode', () => {
  it('only confirms the log and gives today\'s total', () => {
    const st = { exercises: [{ id: 'ex_p', name: 'Push-ups', target: 120, doneToday: 45 }], sets: {}, sportySettings: { coachMode: false } }
    const r = logBotSets(st, 'push-ups', [15, 15, 15], '2026-11-08')!
    expect(r.line).toMatch(/Logged/)
    expect(r.line).toMatch(/Today: <b>45<\/b> of 120/)
    expect(r.line).not.toMatch(/Level|Next|best set/i)
  })
})
