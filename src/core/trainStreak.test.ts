import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hardSetsWeeks, keptDay, photoDue, repsPerExercise, sessionsPerWeek, trainStreak } from './trainStreak'
import { DEFAULT_DAYS, type DoneSession, type TrainWeek } from './trainWeek'

// Made-up data. 2026-11-09 is a Monday; the default week is rest · Upper · Legs · Upper · rest · Legs · Upper.
const week: TrainWeek = { v: 1, days: DEFAULT_DAYS, updatedAt: 1 }
const S = (date: string, type: 'upper' | 'legs'): DoneSession => ({
  date,
  type
})

describe('the training streak', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-20T08:30:00'))
  })
  afterEach(() => vi.useRealTimers())

  it('rest days never break it', () => {
    // Every planned session of two weeks done: Tue, Wed, Thu, Sat, Sun, Tue, Wed, Thu. Today Friday (rest).
    const done = ['2026-11-10:upper', '2026-11-11:legs', '2026-11-12:upper', '2026-11-14:legs', '2026-11-15:upper', '2026-11-17:upper', '2026-11-18:legs', '2026-11-19:upper'].map((x) =>
      S(x.split(':')[0], x.split(':')[1] as any)
    )
    const s = trainStreak(week, done, '2026-11-20')
    expect(s).toEqual({ sessions: 8, since: '2026-11-10', brokenOn: null })
  })

  it('a missed planned session breaks it', () => {
    // Saturday 14th (Legs) missed and never made up.
    const done = [S('2026-11-12', 'upper'), S('2026-11-15', 'upper'), S('2026-11-17', 'upper'), S('2026-11-18', 'legs'), S('2026-11-19', 'upper')]
    const s = trainStreak(week, done, '2026-11-20')
    expect(s.brokenOn).toBe('2026-11-14')
    expect(s.sessions).toBe(4)
    expect(s.since).toBe('2026-11-15')
  })

  it('a session made up within 2 days keeps it, and today or yesterday can still be done', () => {
    // Saturday's Legs done on Monday (a rest day) instead.
    const done = [S('2026-11-12', 'upper'), S('2026-11-15', 'upper'), S('2026-11-16', 'legs'), S('2026-11-17', 'upper'), S('2026-11-18', 'legs')]
    expect(keptDay(week, done, '2026-11-14')).toBe(true)
    // Thursday 19th (Upper) not done yet, today Friday: still open.
    const s = trainStreak(week, done, '2026-11-20')
    expect(s.brokenOn).toBeNull()
    expect(s.sessions).toBe(5)
    // An extra session on a rest day counts too.
    expect(trainStreak(week, [...done, S('2026-11-20', 'upper')], '2026-11-20').sessions).toBe(6)
  })

  it('no sessions, no streak', () => {
    expect(trainStreak(week, [], '2026-11-20')).toEqual({
      sessions: 0,
      since: null,
      brokenOn: null
    })
  })
})

describe('the progress numbers', () => {
  it('counts sessions per week against the plan', () => {
    const done = [S('2026-11-10', 'upper'), S('2026-11-11', 'legs'), S('2026-11-17', 'upper')]
    const w = sessionsPerWeek(week, done, '2026-11-18', 3)
    expect(w).toEqual([
      { monday: '2026-11-02', done: 0, planned: 5 },
      { monday: '2026-11-09', done: 2, planned: 5 },
      { monday: '2026-11-16', done: 1, planned: 5 }
    ])
  })

  it('hard sets per muscle per week and reps per exercise per week', () => {
    const exercises = [
      { id: 'p', name: 'Push-ups', move: 'pushup', unit: 'reps' },
      { id: 's', name: 'Squats', move: 'squat', unit: 'reps' }
    ] as any[]
    const sets = {
      '2026-11-10': { p: [{ reps: 12 }, { reps: 11 }, { reps: 10 }] },
      '2026-11-17': { p: [{ reps: 13 }, { reps: 12 }] }
    }
    const hs = hardSetsWeeks(sets, exercises, '2026-11-18', 2)
    expect(hs.map((w) => w.sets.push)).toEqual([3, 2])
    const days = { '2026-11-10': { p: 33 }, '2026-11-17': { p: 25, s: 60 } }
    const r = repsPerExercise(days, exercises, '2026-11-18', 2)
    expect(r.map((x) => [x.name, x.total, x.weeks.map((w) => w.total)])).toEqual([
      ['Squats', 60, [0, 60]],
      ['Push-ups', 58, [33, 25]]
    ])
  })

  it('a progress photo is due once a month', () => {
    expect(photoDue(null, '2026-11-18').due).toBe(true)
    expect(photoDue('2026-10-20', '2026-11-18')).toMatchObject({ due: true })
    expect(photoDue('2026-11-01', '2026-11-18')).toEqual({
      due: false,
      line: 'Last progress photo 17 days ago. Next one in 11 days.'
    })
  })
})
