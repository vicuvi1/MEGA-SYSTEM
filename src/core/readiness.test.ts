import { describe, expect, it } from 'vitest'
import { nightMinutes, readiness } from './readiness'

describe('readiness', () => {
  it('pairs bedtime and wake-up of the same night', () => {
    expect(nightMinutes({ bedTime: '23:30', wakeTime: '07:00' })).toBe(450)
    expect(nightMinutes({ bedTime: '01:00', wakeTime: '08:00' })).toBe(420)
    expect(nightMinutes({ bedTime: null, wakeTime: '07:00' })).toBeNull()
  })
  it('full, light or rest from sleep and soreness', () => {
    expect(readiness({ sleptMin: 480, soreness: 2 }).kind).toBe('full')
    expect(readiness({ sleptMin: 360, soreness: 3 }).kind).toBe('light')
    expect(readiness({ sleptMin: 300, soreness: 5 }).kind).toBe('rest')
    expect(readiness({ sleptMin: null, soreness: null }).kind).toBe('full')
    expect(readiness({ sleptMin: 450, soreness: 4, quality: 2 }).why).toMatch(/sore, slept badly/)
  })
})
