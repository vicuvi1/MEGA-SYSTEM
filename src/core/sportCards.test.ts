import { describe, expect, it } from 'vitest'
import { allDone, applyWorkoutTap, defaultSport, progression, recordWorkoutDay, removeExercise, setExercise, waterCard, workoutCard, type WorkoutLog } from './sportCards'

const today = '2026-11-02'

describe("Ben's water and workout cards", () => {
  it('shows water with buttons', () => {
    const st = defaultSport(today)
    st.water.currentMl = 1000
    const c = waterCard(st, today)
    expect(c.text).toContain('1.0 of 2.7 L')
    expect(c.text).toContain('4 of 11 glasses')
    expect(c.text).toContain('1700 ml')
    expect(c.keyboard.inline_keyboard.flat().map((b) => b.callback_data)).toEqual(['wa|250', 'wa|500', 'wa|1000', 'wa|-250', 'wk|show'])
  })

  it('runs a workout with taps until done', () => {
    let st = defaultSport(today)
    expect(workoutCard(st, today).text).toContain("Today's workout</b> · 0%")
    st = applyWorkoutTap(st, today, '0|25')
    st = applyWorkoutTap(st, today, '0|10')
    expect(st.exercises[0].doneToday).toBe(35)
    st = applyWorkoutTap(st, today, '1|all')
    expect(st.exercises[1].doneToday).toBe(60)
    expect(allDone(st)).toBe(false)
    st = applyWorkoutTap(st, today, 'all')
    expect(allDone(st)).toBe(true)
    const c = workoutCard(st, today)
    expect(c.text).toContain('Workout done for today')
    expect(c.keyboard.inline_keyboard.flat().map((b) => b.callback_data)).toEqual(['wa|show'])
    // yesterday's reps don't count today
    expect(applyWorkoutTap(st, '2026-11-03', '0|10').exercises[0].doneToday).toBe(10)
  })

  it('harder after the full target twice, and only while you keep up', () => {
    let log: WorkoutLog = { days: {} }
    let st = defaultSport(today)
    for (const d of ['2026-11-01', '2026-11-02']) {
      st = applyWorkoutTap({ ...st, lastDate: d }, d, 'all')
      log = recordWorkoutDay(log, st, d)
    }
    const up = progression(log, st, '2026-11-02')
    expect(up.find((x) => x.name === 'Push-ups')).toMatchObject({ from: 100, to: 105 })
    // At the new target, the old full days don't count: no second jump yet.
    st = setExercise(st, '2026-11-02', 'Push-ups', 105).st
    expect(progression(log, st, '2026-11-02').find((x) => x.name === 'Push-ups')).toBeUndefined()
    expect(progression({ days: { [today]: log.days['2026-11-02'] } }, st)).toEqual([])
  })

  it('lighter after two weeks away (not for someone new)', () => {
    let log: WorkoutLog = { days: {} }
    let st = defaultSport('2026-10-01')
    st = applyWorkoutTap({ ...st, lastDate: '2026-10-01' }, '2026-10-01', 'all')
    log = recordWorkoutDay(log, st, '2026-10-01')
    const down = progression(log, st, '2026-11-05').find((x) => x.name === 'Push-ups')
    expect(down).toMatchObject({ from: 100, to: 90 })
    expect(progression({ days: {} }, defaultSport(today), today)).toEqual([])
  })

  it('edits the plan', () => {
    let st = defaultSport(today)
    let r = setExercise(st, today, 'push-ups', 110)
    expect(r.line).toBe('🏋️ Push-ups: target 100 → 110 reps')
    r = setExercise(r.st, today, 'Pull-ups', 20)
    expect(r.st.exercises.find((e: any) => e.name === 'Pull-ups').target).toBe(20)
    r = removeExercise(r.st, today, 'Press')
    expect(r.st.exercises.find((e: any) => e.name === 'Press').active).toBe(false)
    expect(workoutCard(r.st, today).text).not.toContain('Press')
  })
})
