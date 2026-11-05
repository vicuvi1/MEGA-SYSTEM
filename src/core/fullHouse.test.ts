import { describe, expect, it } from 'vitest'
import { fullHouse, weekOf } from './fullHouse'

describe('weekly full house', () => {
  it('all four → a hit; otherwise what is missing', () => {
    expect(fullHouse({ sleepScore: 80, workouts: 3, slips: 0, spent: 900, usualSpent: 1000 }).hit).toBe(true)
    const r = fullHouse({ sleepScore: 60, workouts: 2, slips: 0, spent: 900, usualSpent: 1000 })
    expect(r.hit).toBe(false)
    expect(r.missing).toEqual(['steady sleep (60/100, need 70)', '1 more workout'])
  })
  it('weeks start Monday', () => {
    expect(weekOf('2026-11-08')).toBe('2026-11-02')
  })
})
