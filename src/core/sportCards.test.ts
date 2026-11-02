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

  it('raises targets after 3 full days in a row', () => {
    let log: WorkoutLog = { days: {} }
    let st = defaultSport(today)
    for (const d of ['2026-10-31', '2026-11-01', '2026-11-02']) {
      st = applyWorkoutTap({ ...st, lastDate: d }, d, 'all')
      log = recordWorkoutDay(log, st, d)
    }
    const up = progression(log, st)
    expect(up.find((x) => x.name === 'Push-ups')).toEqual({ name: 'Push-ups', from: 100, to: 105 })
    expect(progression({ days: { [today]: log.days[today] } }, st)).toEqual([])
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
