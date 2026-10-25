import { describe, expect, it } from 'vitest'
import { fuzzyScore } from './Palette'

describe('palette search', () => {
  it('matches whole words first, then letters in order', () => {
    expect(fuzzyScore('Workout done', 'work')).toBeGreaterThan(fuzzyScore('Workout done', 'wkd'))
    expect(fuzzyScore('Workout done', 'wkd')).toBeGreaterThan(0)
    expect(fuzzyScore('Workout done', 'xyz')).toBe(0)
    expect(fuzzyScore('Money', '')).toBe(1)
    expect(fuzzyScore('Finance Helper', 'fin')).toBeGreaterThan(fuzzyScore('Shop', 'fin'))
  })
})
