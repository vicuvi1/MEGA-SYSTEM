import { describe, expect, it } from 'vitest'
import { appHour, dayKey } from './dates'

describe('the app day turns at 04:00 (N8)', () => {
  it('after midnight it is still the evening before', () => {
    expect(appHour(new Date(2026, 10, 5, 1, 30))).toBe(25)
    expect(appHour(new Date(2026, 10, 5, 4, 0))).toBe(4)
    expect(appHour(new Date(2026, 10, 5, 20, 0))).toBe(20)
    expect(dayKey(new Date(2026, 10, 5, 1, 30))).toBe('2026-11-04')
  })
})
