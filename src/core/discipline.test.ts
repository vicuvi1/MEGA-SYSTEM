import { describe, expect, it } from 'vitest'
import {
  campaignMap, milestoneRef, milestonesOf, planCheckIn, planUrgeFinish, QUOTES, quoteFor, rankFor, startOf, statsOf,
  validateStart, type DisciplineEvent
} from './discipline'

let id = 1
const ev = (kind: DisciplineEvent['kind'], day: string, ts = `${day}T09:00:00Z`): DisciplineEvent => ({ id: id++, kind, day, ts })
const setupDay = (e: DisciplineEvent) => e.ts.slice(0, 10)

describe('discipline', () => {
  it('counts days since the start date', () => {
    const events = [ev('start', '2026-10-15', '2026-10-25T09:00:00Z')]
    expect(statsOf(events, '2026-10-25')).toMatchObject({ current: 10, best: 10, relapses: 0 })
    expect(startOf(events)?.day).toBe('2026-10-15')
  })

  it('a reset starts the count again but keeps best and total', () => {
    const events = [ev('start', '2026-09-01'), ev('reset', '2026-09-21')]
    expect(statsOf(events, '2026-10-01')).toMatchObject({ current: 10, best: 20, totalClean: 30, relapses: 1, since: '2026-09-21' })
  })

  it('pays milestones only for days reached after the streak was entered', () => {
    // Entered on 10-25 with a start 10 days earlier: 3, 7 and 10 are already behind.
    const events = [ev('start', '2026-10-15', '2026-10-25T09:00:00Z')]
    const ms = milestonesOf(events, '2026-10-25', new Set(), setupDay)
    expect(ms.find((m) => m.days === 7)?.status).toBe('before-setup')
    expect(ms.find((m) => m.days === 10)?.status).toBe('claimable') // reached today, the setup day
    expect(ms.find((m) => m.days === 14)?.status).toBe('locked')
    const later = milestonesOf(events, '2026-10-29', new Set([milestoneRef('2026-10-15', 10)]), setupDay)
    expect(later.find((m) => m.days === 10)?.status).toBe('claimed')
    expect(later.find((m) => m.days === 14)?.status).toBe('claimable')
  })

  it('milestones belong to one streak; after a reset they can be earned again', () => {
    const events = [ev('start', '2026-09-01'), ev('reset', '2026-10-01')]
    const ms = milestonesOf(events, '2026-10-04', new Set([milestoneRef('2026-09-01', 3)]), setupDay)
    expect(ms.find((m) => m.days === 3)?.status).toBe('claimable')
  })

  it('validates the start date', () => {
    expect(() => validateStart('2026-10-30', '2026-10-25', [])).toThrow('future')
    expect(() => validateStart('2026-10-01', '2026-10-25', [ev('reset', '2026-10-10')])).toThrow('reset')
    expect(() => validateStart('2026-10-01', '2026-10-25', [])).not.toThrow()
  })

  it('allows one check-in a day, not on a reset day', () => {
    expect(() => planCheckIn([], '2026-10-25')).toThrow('start date')
    const events = [ev('start', '2026-10-01')]
    expect(() => planCheckIn(events, '2026-10-25')).not.toThrow()
    expect(() => planCheckIn([...events, ev('checkin', '2026-10-25')], '2026-10-25')).toThrow('Already')
    expect(() => planCheckIn([...events, ev('reset', '2026-10-25')], '2026-10-25')).toThrow('reset day')
  })

  it('makes the urge crusher run its full time', () => {
    const start = '2026-10-25T10:00:00.000Z'
    expect(() => planUrgeFinish(null, new Date())).toThrow('Start')
    expect(() => planUrgeFinish(start, new Date('2026-10-25T10:01:00Z'))).toThrow('110 more seconds')
    expect(() => planUrgeFinish(start, new Date('2026-10-25T10:02:51Z'))).not.toThrow()
  })

  it('ranks, quotes and the campaign map', () => {
    expect(rankFor(0)).toEqual({ name: 'Initiate', next: { name: 'Squire', days: 3 } })
    expect(rankFor(10).name).toBe('Warrior')
    expect(rankFor(400).next).toBeNull()
    expect(QUOTES).toContain(quoteFor('2026-10-25'))
    expect(quoteFor('2026-10-25')).toBe(quoteFor('2026-10-25'))
    const map = campaignMap({ current: 10, best: 10, totalClean: 10, relapses: 0, since: '2026-10-15' })
    expect(map).toHaveLength(90)
    expect(map[9]).toMatchObject({ day: 10, state: 'done', milestone: true })
    expect(map[10].state).toBe('today')
  })
})

describe('dayNumber: one "Day N" everywhere', () => {
  it('start day is Day 1; after a reset the reset day is Day 0', async () => {
    const { dayNumber } = await import('./discipline')
    expect(dayNumber({ current: 0, resets: 0 })).toBe(1)
    expect(dayNumber({ current: 10, resets: 0 })).toBe(11)
    expect(dayNumber({ current: 0, resets: 1 })).toBe(0)
    expect(dayNumber({ current: 3, resets: 2 })).toBe(3)
    expect(dayNumber({ current: 5, resets: 0, setup: false })).toBe(0)
  })
})
