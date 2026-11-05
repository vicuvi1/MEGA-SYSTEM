import { describe, expect, it } from 'vitest'
import { DEFAULT_LEI_PER_POINT, leiForPoints, pointValue, pointValueLine, pointsForLei } from './pointValue'

describe('a point has a real lei value (RL1)', () => {
  it('normal effort buys exactly the fun budget', () => {
    const v = pointValue({ funBudgetLei: 600, earnPerDay: 100 })
    expect(v.source).toBe('budget')
    expect(v.leiPerPoint).toBe(0.2)
    expect(leiForPoints(3000, v)).toBe(600)
    expect(pointsForLei(150, v)).toBe(750)
    expect(pointValueLine(v)).toBe('1 point ≈ 0.20 lei')
  })
  it('falls back to 10 points = 1 lei without a budget or history', () => {
    expect(pointValue({ funBudgetLei: null, earnPerDay: 100 }).leiPerPoint).toBe(DEFAULT_LEI_PER_POINT)
    expect(pointValue({ funBudgetLei: 600, earnPerDay: 0 }).source).toBe('default')
  })
  it('is clamped', () => {
    expect(pointValue({ funBudgetLei: 100000, earnPerDay: 2 }).leiPerPoint).toBe(2)
    expect(pointValue({ funBudgetLei: 1, earnPerDay: 1000 }).leiPerPoint).toBe(0.02)
  })
})
