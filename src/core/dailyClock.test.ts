import { describe, expect, it } from 'vitest'
import { DAILY_AT, dailyDue, dailyGate, localMinute } from './dailyClock'

describe('daily messages by local time (LT2)', () => {
  it('is due from its local time, for a while, then not', () => {
    expect(dailyDue(8 * 60 + 29)).toEqual([])
    expect(dailyDue(8 * 60 + 30)).toEqual(['morning'])
    expect(dailyDue(10 * 60 + 5)).toEqual(['morning', 'reask'])
    expect(dailyDue(12 * 60)).toEqual(['reask'])
    expect(dailyDue(13 * 60)).toEqual(['midday'])
    expect(dailyDue(16 * 60)).toEqual([])
    expect(dailyDue(21 * 60 + 40)).toEqual(['evening'])
    expect(dailyDue(23 * 60 + 59)).toEqual(['evening'])
    expect(dailyDue(0)).toEqual([])
  })
  it('reads the local time in the given time zone, daylight saving included', () => {
    // 06:30 UTC is 08:30 in Chisinau in winter and 09:30 in summer.
    expect(localMinute(new Date('2026-01-15T06:30:00Z'), 'Europe/Chisinau')).toBe(DAILY_AT.morning)
    expect(localMinute(new Date('2026-07-15T06:30:00Z'), 'Europe/Chisinau')).toBe(9 * 60 + 30)
    expect(localMinute(new Date('2026-07-15T23:05:00Z'), 'UTC')).toBe(23 * 60 + 5)
  })
  it('uses the same once-a-day slot as the Vercel cron', () => {
    expect(dailyGate('morning')).toBe('daily:morning')
  })
})
