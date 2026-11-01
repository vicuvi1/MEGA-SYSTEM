import { describe, expect, it } from 'vitest'
import { blocksToApply, layoutColumns, repeatRule, templateFromDay, upsertTemplate } from './calTemplates'
import type { CalEvent } from './dayTime'

const day = '2026-11-02'
const ev = (title: string, s: string, e: string, d = day): CalEvent => ({ id: title, calendarId: 'c', title, start: new Date(`${d}T${s}:00`).toISOString(), end: new Date(`${d}T${e}:00`).toISOString(), allDay: false })

describe('calendar helpers', () => {
  it('puts overlapping events side by side', () => {
    const out = layoutColumns([
      { id: 'a', start: 540, end: 600 },
      { id: 'b', start: 570, end: 630 },
      { id: 'c', start: 640, end: 700 },
      { id: 'd', start: 545, end: 560 }
    ])
    const by = Object.fromEntries(out.map((o) => [o.id, o]))
    expect(by.a).toMatchObject({ col: 0, cols: 2 })
    expect(by.d).toMatchObject({ col: 1, cols: 2 })
    expect(by.b).toMatchObject({ col: 1, cols: 2 }) // d has ended: b reuses its column
    expect(by.c).toMatchObject({ col: 0, cols: 1 })
  })

  it('saves a day as a template and applies it where it fits', () => {
    const t = templateFromDay('Study day', [ev('Deep block', '09:00', '11:00'), ev('Sport', '17:00', '17:30'), ev('Other day', '09:00', '10:00', '2026-11-03')], day)
    expect(t).toEqual({ name: 'Study day', blocks: [{ title: 'Deep block', start: '09:00', end: '11:00' }, { title: 'Sport', start: '17:00', end: '17:30' }] })
    const fit = blocksToApply(t, '2026-11-04', [ev('Class', '10:00', '12:00', '2026-11-04')])
    expect(fit.map((b) => b.title)).toEqual(['Sport'])
    expect(upsertTemplate([{ name: 'study day', blocks: [] }], t)).toEqual([t])
  })

  it('repeat rules always end', () => {
    expect(repeatRule('none', day)).toEqual([])
    expect(repeatRule('weekly', day)).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=12'])
    expect(repeatRule('weekdays', day)[0]).toContain('BYDAY=MO,TU,WE,TH,FR')
    expect(repeatRule('daily', day)[0]).toContain('COUNT=28')
  })
})
