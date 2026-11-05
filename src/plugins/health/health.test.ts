import { describe, expect, it } from 'vitest'
import { cleanHealth, healthLine, mergeDay, parseSteps } from './health'

describe('phone health numbers', () => {
  it('accepts believable numbers for today or the last 14 days', () => {
    expect(cleanHealth({ weight: '72,5', steps: 8000.4, sleepHours: 7.25 }, '2026-11-05')).toEqual({ ok: true, input: { day: '2026-11-05', weight: 72.5, steps: 8000, sleepHours: 7.3 } })
    expect(cleanHealth({ steps: 100, day: '2026-11-01' }, '2026-11-05')).toEqual({ ok: true, input: { day: '2026-11-01', steps: 100 } })
  })

  it('refuses odd input with a plain reason', () => {
    expect(cleanHealth(null, '2026-11-05').ok).toBe(false)
    expect(cleanHealth({}, '2026-11-05')).toMatchObject({ ok: false, error: expect.stringMatching(/Nothing to save/) })
    expect(cleanHealth({ weight: 900 }, '2026-11-05')).toMatchObject({ ok: false, error: expect.stringMatching(/weight/) })
    expect(cleanHealth({ steps: -1 }, '2026-11-05').ok).toBe(false)
    expect(cleanHealth({ steps: 1, day: '2026-11-06' }, '2026-11-05').ok).toBe(false)
    expect(cleanHealth({ steps: 1, day: '2026-10-01' }, '2026-11-05').ok).toBe(false)
  })

  it('keeps one record a day (later numbers replace earlier ones) and 60 days at most', () => {
    let d = mergeDay(null, { day: '2026-11-05', steps: 3000 }, 'a')
    d = mergeDay(d, { day: '2026-11-05', sleepHours: 7 }, 'b')
    d = mergeDay(d, { day: '2026-11-05', steps: 9000 }, 'c')
    expect(d.days['2026-11-05']).toEqual({ steps: 9000, sleepHours: 7, at: 'c' })
    for (let i = 1; i <= 70; i++) d = mergeDay(d, { day: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}`, steps: i }, 'x')
    expect(Object.keys(d.days).length).toBeLessThanOrEqual(60)
  })

  it("writes Ben's line", () => {
    const d = { days: { '2026-11-05': { steps: 6200, sleepHours: 6.5, at: '' }, '2026-11-04': { steps: 9800, at: '' } } }
    expect(healthLine(d, '2026-11-05')).toBe('From his phone: 6,200 steps today; slept 6.5 h last night; 7-day average 8,000 steps.')
    expect(healthLine({ days: {} }, '2026-11-05')).toBeNull()
  })

  it('reads the steps action', () => {
    expect(parseSteps('8000')).toEqual({ steps: 8000 })
    expect(parseSteps('8,000 | 2026-11-04')).toEqual({ steps: 8000, day: '2026-11-04' })
    expect(parseSteps('0')).toBeNull()
    expect(parseSteps('8000 | yesterday')).toBeNull()
  })
})
