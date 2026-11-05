import { describe, expect, it } from 'vitest'
import { dayLabel, dayRange } from './dates'

describe('one date style (V11)', () => {
  it('reads like "Thu 5 Nov" and "30 Oct – 5 Nov"', () => {
    expect(dayLabel('2026-11-05')).toBe('Thu 5 Nov')
    expect(dayLabel('2026-11-05', false)).toBe('5 Nov')
    expect(dayRange('2026-10-30', '2026-11-05')).toBe('30 Oct – 5 Nov')
  })
})
