import { describe, expect, it } from 'vitest'
import { monthStory, type MonthInput } from './benStakes'
import { aimFor, aimLine, cleanAims, compareMonths, monthArchive, setAim, shiftMonth } from './monthReview'
import { recapSeason, yearRecap } from './yearRecap'

const input = (month: string, today: string): MonthInput => ({
  month,
  today,
  focus: [
    { day: '2026-10-02', minutes: 120 },
    { day: '2026-10-03', minutes: 60 },
    { day: '2026-11-02', minutes: 180 },
    { day: '2026-11-03', minutes: 60 }
  ],
  workouts: ['2026-10-02', '2026-11-02', '2026-11-03'],
  restDays: [],
  sleep: [{ day: '2026-11-02', bed: '23:00', wake: '07:00' }],
  spent: [
    { day: '2026-10-02', bani: 50000 },
    { day: '2026-11-02', bani: 30000 }
  ],
  moods: [{ day: '2026-11-02', mood: 4 }],
  stakes: { kept: 0, lost: 0 },
  promises: { kept: 0, missed: 0 }
})

describe('month review (FT11)', () => {
  it('moves months and keeps one aim per month', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    const now = new Date('2026-11-05T10:00:00Z')
    let aims = setAim([], '2026-12', '  Finish the  Rust book ', now)
    aims = setAim(aims, '2026-11', 'Sleep by 23:30', now)
    expect(aimFor(aims, '2026-12')?.text).toBe('Finish the Rust book')
    expect(aimLine(aims, '2026-11-05')).toMatch(/this month.*Sleep by 23:30.*next month: "Finish the Rust book"/)
    expect(setAim(aims, '2026-12', '', now).map((a) => a.month)).toEqual(['2026-11'])
    expect(cleanAims([{ month: 'x', text: 'a' }, { month: '2026-10', text: ' b ' }])).toEqual([{ month: '2026-10', text: 'b', at: '' }])
  })
  it('compares this month with the same days of last month and lists past months', () => {
    const now = monthStory(input('2026-11', '2026-11-05'))
    const prev = monthStory(input('2026-10', '2026-11-05'))
    const rows = compareMonths(now, prev)
    expect(rows.find((r) => r.label === 'Focus')).toEqual({ label: 'Focus', now: '4h', prev: '3h', better: true })
    expect(rows.find((r) => r.label === 'Spent')).toMatchObject({ better: true })
    const archive = monthArchive([prev, monthStory(input('2026-09', '2026-11-05'))], [{ month: '2026-10', text: 'Gym 3x', at: '' }], { '2026-10': 'Good month.' })
    expect(archive).toEqual([{ month: '2026-10', label: 'October 2026', focusH: 3, trained: 1, avgSleep: null, moodAvg: null, aim: 'Gym 3x', letter: true }])
  })
})

describe('your year (FT12)', () => {
  it('adds up the year: focus by subject, workouts, clean days, saved money, best month, letters', () => {
    const r = yearRecap({
      year: 2026,
      today: '2026-12-10',
      sessions: [
        { day: '2026-03-01', subject: 'Rust', minutes: 60 },
        { day: '2026-03-02', subject: 'rust', minutes: 60 },
        { day: '2026-03-03', subject: 'Math', minutes: 30 },
        { day: '2025-12-31', subject: 'Math', minutes: 600 }
      ],
      workouts: ['2026-03-01', '2026-03-02', '2026-05-01'],
      wakes: [{ day: '2026-03-01', onTime: true }, { day: '2026-03-02', onTime: false }],
      cleanDays: ['2026-04-01', '2026-04-02', '2026-04-03'],
      money: [
        { day: '2026-02-01', bani: 1000000, type: 'income' },
        { day: '2026-02-02', bani: 400000, type: 'expense' }
      ],
      letters: { '2026-03': 'Strong March.', '2025-11': 'old' }
    })
    expect(r.focusH).toBe(2.5)
    expect(r.bySubject).toEqual([{ subject: 'Rust', hours: 2 }, { subject: 'Math', hours: 0.5 }])
    expect(r).toMatchObject({ workouts: 3, cleanDays: 3, onTimeWakes: 1, savedBani: 600000, running: true, empty: false })
    expect(r.bestMonth).toMatchObject({ month: '2026-03', label: 'March', focusH: 2.5, workouts: 2 })
    expect(r.streaks.find((s) => s.id === 'clean')?.best).toBe(3)
    expect(r.streaks.find((s) => s.id === 'focus')?.best).toBe(2)
    expect(r.letters).toEqual([{ month: '2026-03', label: 'March', text: 'Strong March.' }])
  })
  it('no money data means no saved number, not zero', () => {
    expect(yearRecap({ year: 2026, today: '2026-12-01', sessions: [], workouts: [], wakes: [], cleanDays: [], money: null, letters: {} })).toMatchObject({ savedBani: null, empty: true, bestMonth: null })
  })
  it('offers itself in December and the first days of January', () => {
    expect(recapSeason('2026-12-01')).toBe(2026)
    expect(recapSeason('2027-01-03')).toBe(2026)
    expect(recapSeason('2026-11-05')).toBeNull()
  })
})
