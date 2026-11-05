import { describe, expect, it } from 'vitest'
import type { CalEvent } from './dayTime'
import { countdown, daySummary, meetingNow, nextUp } from './dayGlance'

const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m)
const ev = (id: string, h1: number, h2: number, o: Partial<CalEvent> = {}): CalEvent => ({ id, calendarId: 'c', title: id, start: at(h1).toISOString(), end: at(h2).toISOString(), allDay: false, ...o })

describe('today at a glance (T1, T3, T4)', () => {
  const day = [ev('Lecture', 9, 11), ev('Deep block', 11, 12, { ours: true }), ev('Seminar', 14, 16), ev('Declined', 16, 17, { declined: true })]
  it('next up and a countdown', () => {
    expect(nextUp(day, at(12, 30).getTime())?.id).toBe('Seminar')
    expect(countdown(23 * 60_000)).toBe('in 23 min')
    expect(countdown(299_000)).toBe('in 4:59')
    expect(countdown(65 * 60_000)).toBe('in 1h 05m')
  })
  it('in a class right now (not your own block)', () => {
    expect(meetingNow(day, at(10).getTime())?.id).toBe('Lecture')
    expect(meetingNow(day, at(11, 30).getTime())).toBeNull()
  })
  it('one summary line', () => {
    const s = daySummary(day, at(12).getTime(), '23:30')
    expect(s.text).toBe('2 events · 1 block · 9h free · done at 16:00 · bed 23:30')
  })
})
