import { describe, expect, it } from 'vitest'
import { addHourCtx, bestHours, ctxHours, historyFacts, latestHour, preferSlot } from './bestHours'

const T = Date.parse('2026-11-04T08:00:00')

describe('your best hours (SI22, SI25)', () => {
  it('ranks hours by good focus minutes, spreading a session over its hours', () => {
    const focus = [
      { at: '2026-11-02T09:30:00', minutes: 90, pct: 90 },
      { at: '2026-11-03T09:00:00', minutes: 50, pct: 80 },
      { at: '2026-11-03T21:00:00', minutes: 40, pct: 40 }
    ]
    expect(bestHours(focus)).toEqual([9, 10])
  })
  it('knows when a kind happens and the latest hour it ever did', () => {
    let a = addHourCtx(undefined, 10, 'study', 30)
    a = addHourCtx(a, 20, 'study', 15)
    const b = addHourCtx(undefined, 10, 'study', 25)
    expect(latestHour([a, b], 'study')).toBe(20)
    expect(ctxHours([a, b], 'study')).toEqual([10])
  })
  it('books into a best hour when one is free today', () => {
    const blocks = [{ title: 'Class', start: Date.parse('2026-11-04T09:00:00'), end: Date.parse('2026-11-04T10:00:00') }]
    const s = preferSlot(blocks, T, 45, [9, 14])
    expect(new Date(s!.start).getHours()).toBe(14)
    expect(s!.best).toBe(true)
    expect(preferSlot(blocks, T, 45, [])!.best).toBe(false)
  })
  it('facts for the morning plan', () => {
    const days = [addHourCtx(addHourCtx(undefined, 10, 'study', 40), 18, 'study', 20), addHourCtx(undefined, 11, 'study', 30), addHourCtx(undefined, 9, 'coding', 50)]
    const line = historyFacts({ focus: [{ at: '2026-11-02T10:00:00', minutes: 60, pct: 90 }], hours: days, totals: { coding: 720, study: 300, idle: 900 } })
    expect(line).toContain('Best focus hours (focus quality × minutes, last 7 days): 10:00')
    expect(line).toContain('He never did study after 19:00 last week')
    expect(line).toContain('Last week on the PC: coding 12h, study 5h')
  })
})
