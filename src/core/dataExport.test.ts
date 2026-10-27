import { describe, expect, it } from 'vitest'
import { toExpensesCsv, toWorkoutsCsv } from './dataExport'
import type { Workout } from './body'
import type { Expense } from './money'

describe('dataExport core', () => {
  it('exports workouts to clean CSV', () => {
    const workouts: Workout[] = [
      {
        id: 1,
        day: '2026-10-27',
        ts: '2026-10-27T10:00:00Z',
        title: 'Morning Push',
        note: 'Solid morning push',
        items: [{ exerciseId: 'pushups', name: 'Push-ups', amount: 50, unit: 'reps' }]
      }
    ]

    const csv = toWorkoutsCsv(workouts)
    expect(csv).toContain('Date,Title,Notes,Exercises')
    expect(csv).toContain('"2026-10-27","Morning Push","Solid morning push","Push-ups:50reps"')
  })

  it('exports expenses to clean CSV', () => {
    const expenses: Expense[] = [
      {
        id: 1,
        day: '2026-10-27',
        amount: 4550,
        category: 'food',
        note: 'Steak & Salad',
        createdAt: ''
      }
    ]

    const csv = toExpensesCsv(expenses, 'MDL')
    expect(csv).toContain('Date,Amount,Currency,Category,Note')
    expect(csv).toContain('"2026-10-27",45.50,"MDL","food","Steak & Salad"')
  })
})
