import { describe, expect, it } from 'vitest'
import { calendarChanges } from './calWatch'

const ev = (title: string, s: string, e: string) => ({ title, start: new Date(`2026-11-05T${s}:00`).toISOString(), end: new Date(`2026-11-05T${e}:00`).toISOString() })
describe('calendar watch', () => {
  const at = new Date('2026-11-05T09:00:00')
  it('says when a class is added or cancelled (not on the first look)', () => {
    const before = { a: ev('Algebra', '10:00', '11:30'), b: ev('Lab', '14:00', '15:00') }
    const after = { b: ev('Lab', '14:00', '15:00'), c: ev('Seminar', '16:00', '17:00') }
    const ch = calendarChanges(before, after, at, 'Lab report')
    expect(ch.map((c) => c.kind)).toEqual(['added', 'cancelled'])
    expect(ch[1].freeMin).toBe(90)
    expect(ch[1].text).toMatch(/Algebra.*90 free minutes. Use them for “Lab report”/)
    expect(calendarChanges(null, after, at)).toEqual([])
  })
  it('things already over do not count', () => {
    expect(calendarChanges({ a: ev('Early', '07:00', '08:00') }, {}, at)).toEqual([])
  })
})
