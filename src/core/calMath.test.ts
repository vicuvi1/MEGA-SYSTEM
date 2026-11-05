import { describe, expect, it } from 'vitest'
import { addLocalDays, dayDiff, dragSpan, hmOf, isoWeek, lenLabel, snapMinute, toMin, tzAhead, weekStartOf } from './calMath'

describe('calendar math (LT11)', () => {
  it('days and weeks', () => {
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(weekStartOf('2026-11-05', 1)).toBe('2026-11-02') // a Thursday → Monday
    expect(weekStartOf('2026-11-05', 0)).toBe('2026-11-01') // → Sunday
    expect(weekStartOf('2026-11-05', 6)).toBe('2026-10-31') // → Saturday
    expect(isoWeek('2026-01-01')).toBe(1)
    expect(isoWeek('2026-12-31')).toBe(53)
    expect(dayDiff('2026-11-01', '2026-11-05')).toBe(4)
  })
  it('minutes and labels', () => {
    expect(toMin('07:30')).toBe(450)
    expect(hmOf(450)).toBe('07:30')
    expect(hmOf(24 * 60 + 15)).toBe('00:15')
    expect([lenLabel(45), lenLabel(90), lenLabel(120)]).toEqual(['45 min', '1 h 30', '2 h'])
    expect(tzAhead('Not/AZone')).toBe(0)
  })
  it('a pointer snaps to 15 minutes inside the shown hours', () => {
    // 72 px an hour, the grid starts at 06:00
    expect(snapMinute(72 * 2 + 20, 72, 6, 24)).toBe(8 * 60 + 15)
    expect(snapMinute(-50, 72, 6, 24)).toBe(6 * 60)
    expect(snapMinute(72 * 30, 72, 6, 24)).toBe(24 * 60)
  })
  it('a moved block keeps its length and stays on the grid; a resize or new block is at least 15 minutes', () => {
    expect(dragSpan({ kind: 'move', len: 60, offset: 15 }, '2026-11-06', 10 * 60, 6, 24)).toEqual({ day: '2026-11-06', start: 9 * 60 + 45, end: 10 * 60 + 45 })
    expect(dragSpan({ kind: 'move', len: 60, offset: 0 }, '2026-11-06', 23 * 60 + 45, 6, 24)).toEqual({ day: '2026-11-06', start: 23 * 60, end: 24 * 60 })
    expect(dragSpan({ kind: 'resize', day: '2026-11-05', start: 600 }, '2026-11-06', 590, 6, 24)).toEqual({ day: '2026-11-05', start: 600, end: 615 })
    expect(dragSpan({ kind: 'create', day: '2026-11-05', from: 600 }, '2026-11-05', 540, 6, 24)).toEqual({ day: '2026-11-05', start: 540, end: 615 })
  })
})
