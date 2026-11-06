import { describe, expect, it } from 'vitest'
import { bestRun, computeBadges, newBadges, type BadgeInput } from './sportBadges'
import type { DayLog, SportEx } from './sportLadders'

const exs: SportEx[] = [
  { id: 'p', name: 'Push-ups', target: 50, unit: 'reps', active: true },
  { id: 'k', name: 'Knee push-ups', target: 30, unit: 'reps', active: false },
  { id: 'pl', name: 'Plank', target: 60, unit: 'sec', active: true },
  { id: 'b', name: 'Bench press', target: 5, unit: 'sets', active: true }
]
const day = (n: number) => `2026-10-${String(n).padStart(2, '0')}`
const input = (o: Partial<BadgeInput>): BadgeInput => ({ days: {}, exercises: exs, sessions: [], today: '2026-11-06', ...o })
const get = (bs: ReturnType<typeof computeBadges>, id: string) => bs.find((b) => b.id === id)!

describe('badges', () => {
  it('nothing logged: nothing earned, no points anywhere', () => {
    const bs = computeBadges(input({}))
    expect(bs.length).toBeGreaterThanOrEqual(18)
    expect(bs.every((b) => !b.done)).toBe(true)
    expect(bs.every((b) => !('points' in b))).toBe(true)
  })

  it('first workout and streaks come from logged days; planned rest days keep a run going', () => {
    const days = Object.fromEntries([1, 2, 3, 5, 6, 7, 8].map((d) => [day(d), { p: 50 }]))
    const bs = computeBadges(input({ days, restDays: [day(4)] }))
    expect(get(bs, 'first')).toMatchObject({ done: true, day: day(1) })
    expect(get(bs, 'streak3')).toMatchObject({ done: true, day: day(3) })
    expect(get(bs, 'streak7')).toMatchObject({ done: true, day: day(8), cur: 7 })
    expect(get(computeBadges(input({ days })), 'streak7').done).toBe(false) // without the rest day: 4 days
    expect(bestRun([day(1), day(3)], [], [3]).best).toBe(1)
  })

  it('volume counts reps of one exercise, not seconds or sets', () => {
    const days: DayLog = { [day(1)]: { p: 60, pl: 900, b: 5 }, [day(2)]: { p: 45 } }
    const bs = computeBadges(input({ days }))
    expect(get(bs, 'reps100')).toMatchObject({ done: true, day: day(2), what: 'Push-ups' })
    expect(get(bs, 'reps1000')).toMatchObject({ done: false, cur: 105 })
  })

  it('level up: a harder version first logged after an easier one', () => {
    const before = computeBadges(input({ days: { [day(1)]: { k: 30 }, [day(2)]: { k: 30 } } }))
    expect(get(before, 'levelup').done).toBe(false)
    const after = computeBadges(input({ days: { [day(1)]: { k: 30 }, [day(5)]: { p: 10 } } }))
    expect(get(after, 'levelup')).toMatchObject({ done: true, day: day(5) })
    // Starting on the harder one isn't levelling up.
    const same = computeBadges(input({ days: { [day(1)]: { p: 10, k: 10 } } }))
    expect(get(same, 'levelup').done).toBe(false)
  })

  it('perfect week, early bird, night owl and records from your sessions', () => {
    const sessions = [2, 3, 4, 5, 6].map((d) => ({ day: `2026-11-0${d}`, hour: 18, full: true }))
    expect(get(computeBadges(input({ sessions })), 'perfectweek')).toMatchObject({ done: true, day: '2026-11-06' })
    expect(get(computeBadges(input({ sessions: sessions.slice(1) })), 'perfectweek')).toMatchObject({ done: false, cur: 4 })
    expect(get(computeBadges(input({ sessions: [{ day: day(9), hour: 7 }] })), 'earlybird')).toMatchObject({ done: true, day: day(9) })
    expect(get(computeBadges(input({ sessions: [{ day: day(9), hour: 8 }] })), 'earlybird').done).toBe(false)
    expect(get(computeBadges(input({ sessions: [{ day: day(9), hour: 22 }] })), 'nightowl').done).toBe(true)
    expect(get(computeBadges(input({ records: 1 })), 'record').done).toBe(true)
  })

  it('holds, weekends and comebacks', () => {
    expect(get(computeBadges(input({ days: { [day(1)]: { pl: 120 } } })), 'ironcore').done).toBe(true)
    expect(get(computeBadges(input({ days: { [day(1)]: { pl: 90 } } })), 'ironcore').cur).toBe(90)
    // 2026-10-10 is a Saturday.
    expect(get(computeBadges(input({ days: { [day(10)]: { p: 5 }, [day(11)]: { p: 5 } } })), 'weekend')).toMatchObject({ done: true, day: day(11) })
    expect(get(computeBadges(input({ days: { [day(1)]: { p: 5 }, [day(12)]: { p: 5 } } })), 'comeback')).toMatchObject({ done: true, day: day(12) })
  })

  it('new badges are the earned ones not seen yet', () => {
    const bs = computeBadges(input({ days: { [day(1)]: { p: 120 } } }))
    expect(newBadges(bs, null).map((b) => b.id).sort()).toEqual(['first', 'reps100'])
    expect(newBadges(bs, { first: day(1) }).map((b) => b.id)).toEqual(['reps100'])
  })
})
