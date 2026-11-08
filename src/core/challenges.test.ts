import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHALLENGES, challengeProgress, cleanCustom, dailyTarget, defOf, honestDay, snapToday, type Joined, type SportLog } from './challenges'

// Made-up data only. Times are local; the app day turns at 04:00.
const at = (day: string, hour = 18) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).getTime()
const EX = [
  { id: 'p', name: 'Push-ups', move: 'pushup', unit: 'reps' },
  { id: 'a', name: 'Archer push-ups', move: 'archer_pushup', unit: 'reps' },
  { id: 'd', name: 'Diamond push-ups', move: 'diamond_pushup', unit: 'reps' },
  { id: 'k', name: 'Plank', move: 'plank', unit: 'sec' },
  { id: 's', name: 'Squats', move: 'squat', unit: 'reps' }
]
const def = (id: string) => CHALLENGES.find((c) => c.id === id)!
const sets = (day: string, ...reps: number[]) => reps.map((r, i) => ({ reps: r, at: at(day) + i * 60000 }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2031-03-10T20:00:00'))
})
afterEach(() => vi.useRealTimers())

describe('honest days', () => {
  it('sets count on the day they were logged; a set saved later for an earlier day does not', () => {
    const log: SportLog = { exercises: EX, sets: { '2031-03-08': { p: [...sets('2031-03-08', 20, 20), { reps: 50, at: at('2031-03-10') }] } } }
    expect(honestDay(log, '2031-03-08', '2031-03-10')).toEqual({ p: 40 })
  })

  it('a set at 01:30 belongs to the evening before (the app day turns at 04:00)', () => {
    const log: SportLog = { exercises: EX, sets: { '2031-03-08': { p: [{ reps: 30, at: at('2031-03-09', 1) }] } } }
    expect(honestDay(log, '2031-03-08', '2031-03-10')).toEqual({ p: 30 })
  })

  it('today’s total counts live; an earlier total only if the app saw it that day; imports never', () => {
    const log: SportLog = { exercises: EX, days: { '2031-03-09': { p: 100 }, '2031-03-10': { p: 70, s: 40 } }, importedDays: { '2031-03-10': ['s'] } }
    expect(honestDay(log, '2031-03-10', '2031-03-10')).toEqual({ p: 70 })
    expect(honestDay(log, '2031-03-09', '2031-03-10')).toEqual({})
    expect(honestDay(log, '2031-03-09', '2031-03-10', { '2031-03-09': { p: 60 } })).toEqual({ p: 60 })
  })
})

describe('challenge progress', () => {
  it('10,000 reps: only from the day you joined, holds not counted', () => {
    const log: SportLog = {
      exercises: EX,
      sets: { '2031-03-07': { p: sets('2031-03-07', 500) }, '2031-03-08': { p: sets('2031-03-08', 300, 200), k: sets('2031-03-08', 60) } },
      days: { '2031-03-10': { s: 1000 } }
    }
    const pr = challengeProgress(def('reps10k'), { id: 'reps10k', joinedOn: '2031-03-08' }, log, '2031-03-10')
    expect(pr.value).toBe(1500)
    expect(pr.status).toBe('active')
    expect(pr.pct).toBeCloseTo(0.15)
    expect(pr.line).toBe('1,500 of 10,000 reps')
    expect(pr.daysLeft).toBe(28)
  })

  it('no credit for back-dated imports: a Telegram import inside the window adds nothing', () => {
    const log: SportLog = { exercises: EX, days: { '2031-03-09': { p: 400 } }, importedDays: { '2031-03-09': ['p'] } }
    const j: Joined = { id: 'reps10k', joinedOn: '2031-03-08', snaps: { '2031-03-09': { p: 400 } } }
    // Even if a snapshot somehow holds it, an imported day is skipped.
    expect(challengeProgress(def('reps10k'), j, log, '2031-03-10').value).toBe(0)
  })

  it('3 workouts this week: done on the third training day, with a badge day', () => {
    const log: SportLog = { exercises: EX, sets: { '2031-03-04': { s: sets('2031-03-04', 20) }, '2031-03-06': { p: sets('2031-03-06', 15) }, '2031-03-07': { k: sets('2031-03-07', 40) } } }
    const pr = challengeProgress(def('week3'), { id: 'week3', joinedOn: '2031-03-04' }, log, '2031-03-10')
    expect(pr.done).toBe(true)
    expect(pr.doneOn).toBe('2031-03-07')
    expect(pr.status).toBe('done')
  })

  it('a window that closed first is "ended"', () => {
    const pr = challengeProgress(def('week3'), { id: 'week3', joinedOn: '2031-03-01' }, { exercises: EX }, '2031-03-10')
    expect(pr.status).toBe('ended')
    expect(pr.daysLeft).toBe(0)
  })

  it('30-day push-ups: the daily target grows; any push-up variation counts; today shows what is left', () => {
    const d = def('pushup30')
    expect(dailyTarget(d, 0)).toBe(60)
    expect(dailyTarget(d, 29)).toBe(150)
    const log: SportLog = { exercises: EX, sets: { '2031-03-09': { p: sets('2031-03-09', 40), a: sets('2031-03-09', 25) } }, days: { '2031-03-10': { p: 30 } } }
    const pr = challengeProgress(d, { id: 'pushup30', joinedOn: '2031-03-09' }, log, '2031-03-10')
    expect(pr.value).toBe(1)
    expect(pr.today).toEqual({ target: dailyTarget(d, 1), done: 30 })
  })

  it('plank ladder: steps from the best single hold logged that day', () => {
    const log: SportLog = { exercises: EX, sets: { '2031-03-09': { k: sets('2031-03-09', 40, 65) } } }
    const pr = challengeProgress(def('plank'), { id: 'plank', joinedOn: '2031-03-09' }, log, '2031-03-10')
    expect(pr.value).toBe(3)
    expect(pr.line).toBe('3 of 5 steps · next: 90 s')
  })

  it('first archer push-up: the ring climbs the ladder, done with a real archer set', () => {
    const j: Joined = { id: 'archer', joinedOn: '2031-03-08' }
    const part = challengeProgress(def('archer'), j, { exercises: EX, sets: { '2031-03-08': { d: sets('2031-03-08', 8) } } }, '2031-03-10')
    expect(part.done).toBe(false)
    expect(part.pct).toBeGreaterThan(0.4)
    expect(part.line).toMatch(/diamond/)
    const done = challengeProgress(def('archer'), j, { exercises: EX, sets: { '2031-03-10': { a: sets('2031-03-10', 1) } } }, '2031-03-10')
    expect(done.done).toBe(true)
    // An archer set typed later for a day before you joined does not count.
    const old = challengeProgress(def('archer'), j, { exercises: EX, sets: { '2031-03-07': { a: [{ reps: 3, at: at('2031-03-10') }] } } }, '2031-03-10')
    expect(old.done).toBe(false)
  })

  it('your own challenge', () => {
    const j: Joined = { id: 'custom:1', joinedOn: '2031-03-09', custom: cleanCustom({ kind: 'reps', family: 'squat', goal: 100, days: 14, name: '' }) }
    const d = defOf(j)!
    expect(d.name).toBe('100 squats')
    const pr = challengeProgress(d, j, { exercises: EX, sets: { '2031-03-09': { s: sets('2031-03-09', 60, 50), p: sets('2031-03-09', 40) } } }, '2031-03-10')
    expect(pr.done).toBe(true)
    expect(cleanCustom({ kind: 'days', goal: 99, days: 10, family: 'nope' })).toMatchObject({ goal: 10, family: 'any' })
  })

  it('snapToday keeps today’s totals inside the window only, so they still count tomorrow', () => {
    const j: Joined = { id: 'reps10k', joinedOn: '2031-03-09' }
    const log: SportLog = { exercises: EX, days: { '2031-03-10': { p: 120 } } }
    const kept = snapToday(j, def('reps10k'), log, '2031-03-10')
    expect(kept.snaps).toEqual({ '2031-03-10': { p: 120 } })
    expect(snapToday(kept, def('reps10k'), log, '2031-03-10')).toBe(kept)
    vi.setSystemTime(new Date('2031-03-11T20:00:00'))
    // Tomorrow: a later edit of the 10th (now 500) does not change what counted.
    expect(challengeProgress(def('reps10k'), kept, { exercises: EX, days: { '2031-03-10': { p: 500 } } }, '2031-03-11').value).toBe(120)
  })
})
