import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './ledger'
import { activity, areaOf, focusKind, weekAreas } from './rewardActivity'

let id = 0
const row = (day: string, module: string, coins: number, more: Partial<LedgerEntry> = {}): LedgerEntry => ({ id: ++id, ts: `${day}T10:00:00Z`, day, module, kind: coins >= 0 ? 'earn' : 'spend', coins, xp: 0, ...more })
// Thursday 2026-11-05; the week starts Monday 2026-11-02.
const today = '2026-11-05'

describe('where points came from', () => {
  it('sorts each row into an area', () => {
    expect(areaOf({ module: 'focus', ref: null, ruleId: 'focus.session' })).toBe('focus')
    expect(areaOf({ module: 'body', ref: null, ruleId: 'body.workout_done' })).toBe('body')
    expect(areaOf({ module: 'sleep', ref: null, ruleId: 'sleep.up_on_time' })).toBe('sleep')
    expect(areaOf({ module: 'plan', ref: 'extra:4:lucky', ruleId: null })).toBe('bonus')
    expect(areaOf({ module: 'shop', ref: 'chest:L3', ruleId: null })).toBe('bonus')
    expect(areaOf({ module: 'habits', ref: null, ruleId: 'habit.done' })).toBe('habits')
  })
  it('counts only this week, live and earned, biggest first', () => {
    const undone = row('2026-11-03', 'body', 50)
    const xs = [row('2026-11-03', 'focus', 30), row('2026-11-04', 'focus', 15), row('2026-11-04', 'sleep', 5), undone, { ...row('2026-11-04', 'body', 0), kind: 'undo' as const, undoOf: undone.id }, row('2026-10-30', 'plan', 100), row('2026-11-04', 'fun', -30)]
    const a = weekAreas(xs, today)
    expect(a.map((x) => [x.id, x.points])).toEqual([
      ['focus', 45],
      ['sleep', 5]
    ])
    expect(a[0].share).toBeCloseTo(0.9)
  })
})

describe('focus kinds', () => {
  it('reads the subject', () => {
    expect(focusKind('Rust')).toBe('code')
    expect(focusKind('CTF practice')).toBe('security')
    expect(focusKind('crypto challenges')).toBe('security')
    expect(focusKind('Exam revision')).toBe('study')
    expect(focusKind('Evening shift')).toBe('work')
    expect(focusKind('Guitar')).toBe('other')
  })
})

describe('the week in numbers', () => {
  it('adds up what you logged', () => {
    const a = activity({
      today,
      ledger: [row('2026-11-03', 'focus', 30, { ruleId: 'focus.session' }), row('2026-11-05', 'body', 10, { ruleId: 'body.workout_done' }), row('2026-11-04', 'fun', -30), row('2026-11-04', 'shop', -60, { ref: 'reward:7' }), row('2026-11-04', 'shop', -500, { ref: 'reward:8' })],
      focus: [
        { day: '2026-11-03', subject: 'Rust', minutes: 120 },
        { day: '2026-11-04', subject: 'CTF', minutes: 90 },
        { day: '2026-11-05', subject: 'Study', minutes: 50 },
        { day: '2026-10-28', subject: 'Rust', minutes: 300 }
      ],
      workoutDays: ['2026-11-03', '2026-11-04', '2026-11-05', '2026-10-30'],
      sleep: [
        { day: '2026-11-05', onTime: true, bedOnTime: true },
        { day: '2026-11-04', onTime: true, bedOnTime: false },
        { day: '2026-11-03', onTime: true },
        { day: '2026-10-20', onTime: true }
      ],
      water: { '2026-11-05': 2100, '2026-11-04': 1500, '2026-11-03': 2500 },
      musicSaved: 4,
      funRewardIds: [7]
    })
    expect(a.week).toBe('2026-11-02')
    expect(a.focusMinWeek).toBe(260)
    expect(a.focusByKind).toMatchObject({ code: 120, security: 90, study: 50 })
    expect(a.focusToday).toBe(50)
    expect(a.workoutsWeek).toBe(3)
    expect(a.workoutStreak).toBe(3)
    expect(a.workoutToday).toBe(true)
    expect(a.movedToday).toBe(true)
    expect(a.sleepNights7).toBe(2)
    expect(a.waterDays7).toBe(2)
    expect(a.earnedWeek).toBe(40)
    expect(a.spentWeek).toBe(590)
    // Fun time and a Fun reward count as fun; the 500-point gear doesn't.
    expect(a.funSpentWeek).toBe(90)
    expect(a.funTimesWeek).toBe(2)
    expect(a.musicSaved).toBe(4)
  })
})
