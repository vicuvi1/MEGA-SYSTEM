import { describe, expect, it } from 'vitest'
import { parseWhen } from './whenParse'
import { customRule } from './calTemplates'

const now = new Date(2026, 10, 5, 14, 2) // Thursday 5 Nov 2026, 14:02

describe('type the time (D4)', () => {
  it('days and times', () => {
    expect(parseWhen('fri 18:00', now)).toEqual({ day: '2026-11-06', start: 18 * 60, end: null, every: null })
    expect(parseWhen('tomorrow 9-10:30', now)).toEqual({ day: '2026-11-06', start: 9 * 60, end: 10 * 60 + 30, every: null })
    expect(parseWhen('today 14:00 for 45m', now)).toEqual({ day: '2026-11-05', start: 14 * 60, end: 14 * 60 + 45, every: null })
    expect(parseWhen('12 nov 10:00', now)?.day).toBe('2026-11-12')
    expect(parseWhen('6pm', now)?.start).toBe(18 * 60)
    expect(parseWhen('thu 9:00', now)?.day).toBe('2026-11-12') // next Thursday, not today
  })
  it('in 2h, every mon', () => {
    expect(parseWhen('in 2h', now)).toMatchObject({ day: '2026-11-05', start: 16 * 60 })
    expect(parseWhen('every mon 8:00', now)).toEqual({ day: '2026-11-09', start: 8 * 60, end: null, every: [1] })
  })
  it('past midnight, and 9-1 as the afternoon', () => {
    expect(parseWhen('tomorrow 22:30-01:00', now)).toEqual({ day: '2026-11-06', start: 22 * 60 + 30, end: 25 * 60, every: null })
    expect(parseWhen('today 9-1', now)?.end).toBe(13 * 60)
  })
  it('not a time', () => {
    expect(parseWhen('study math', now)).toBeNull()
    expect(parseWhen('', now)).toBeNull()
  })
})

describe('repeat you shape (D5)', () => {
  it('every 2 weeks on Mon and Wed until a date', () => {
    expect(customRule({ freq: 'weekly', interval: 2, days: [3, 1], until: '2026-12-20', count: null }, '2026-11-09')).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261220T235959Z'])
    expect(customRule({ freq: 'daily', interval: 1, days: [], until: null, count: 10 }, '2026-11-09')).toEqual(['RRULE:FREQ=DAILY;COUNT=10'])
  })
})
