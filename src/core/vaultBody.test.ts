import { describe, expect, it } from 'vitest'
import { weekBody, weekBodyLine } from './vaultBody'

const p = (day: string, weight: number | null, waist: number | null = null) => ({ day, weight, waist, fat: null, muscle: null })

describe('Photo Locker: the week under a progress photo', () => {
  it("averages that week's weigh-ins and takes the last waist (made-up numbers)", () => {
    const pts = [p('2026-11-01', 80), p('2026-11-02', 78, 82), p('2026-11-04', 78.5), p('2026-11-06', 78.2, 81.5), p('2026-11-09', 77)]
    const b = weekBody(pts, '2026-11-05')
    expect(b).toEqual({ week: '2026-11-02', weight: 78.2, weighIns: 3, waist: 81.5 })
    expect(weekBodyLine(b)).toBe('That week: 78.2 kg (3 weigh-ins) · waist 81.5 cm')
    expect(weekBody(pts, '2026-10-20')).toBeNull()
    expect(weekBodyLine(null)).toBeNull()
  })
})
