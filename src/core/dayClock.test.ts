import { describe, expect, it } from 'vitest'
import { dayKey } from './dates'
import { sportToday } from './sportShared'

describe('one day clock', () => {
  it('the app day ends at 04:00; the calendar and Sport Track day at midnight (local, never UTC)', () => {
    const late = new Date(2026, 10, 5, 1, 30) // 01:30 local, 5 Nov
    expect(dayKey(late)).toBe('2026-11-04')
    expect(dayKey(late, undefined, 0)).toBe('2026-11-05')
    expect(sportToday(late)).toBe('2026-11-05')
    expect(sportToday(new Date(2026, 10, 5, 23, 50))).toBe('2026-11-05')
  })
})
