import { describe, expect, it } from 'vitest'
import { computeDailyExpenseSummary, formatMoney, validateExpense, type Expense } from './money'

describe('money core', () => {
  it('validates expense input', () => {
    expect(() => validateExpense(0, 'food')).toThrow('greater than zero')
    expect(() => validateExpense(-10, 'food')).toThrow('greater than zero')
    expect(() => validateExpense(500, '')).toThrow('Category is required')
    expect(() => validateExpense(1500, 'food')).not.toThrow()
  })

  it('computes daily expense summary separating everyday spending from bills', () => {
    const list: Expense[] = [
      { id: 1, day: '2026-10-27', amount: 5000, category: 'food', note: 'lunch', createdAt: '' },
      { id: 2, day: '2026-10-27', amount: 1500, category: 'transit', note: 'bus', createdAt: '' },
      { id: 3, day: '2026-10-27', amount: 20000, category: 'bills', note: 'electricity', createdAt: '' },
      { id: 4, day: '2026-10-26', amount: 3000, category: 'groceries', note: '', createdAt: '' }
    ]

    const summary = computeDailyExpenseSummary(list, '2026-10-27', 10000) // 100 MDL budget (10000 bani)
    expect(summary.totalSpent).toBe(26500)
    expect(summary.everydaySpent).toBe(6500) // 5000 + 1500 (bills excluded)
    expect(summary.remaining).toBe(3500) // 10000 - 6500
    expect(summary.underBudget).toBe(true)
    expect(summary.byCategory['food']).toBe(5000)
    expect(summary.byCategory['bills']).toBe(20000)
  })

  it('formats money nicely', () => {
    expect(formatMoney(2500, 'MDL')).toBe('25 MDL')
    expect(formatMoney(2550, 'EUR')).toBe('25.50 EUR')
  })
})
