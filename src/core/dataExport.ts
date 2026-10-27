import type { Workout } from './body'
import type { Expense } from './money'

export function toWorkoutsCsv(workouts: Workout[]): string {
  const header = 'Date,Title,Notes,Exercises'
  const rows = workouts.map((w) => {
    const exs = w.items.map((i) => `${i.name || i.exerciseId}:${i.amount}${i.unit}`).join(';')
    const note = (w.note ?? '').replace(/"/g, '""')
    const title = (w.title ?? '').replace(/"/g, '""')
    return `"${w.day}","${title}","${note}","${exs}"`
  })
  return [header, ...rows].join('\n')
}

export function toExpensesCsv(expenses: Expense[], currency = 'MDL'): string {
  const header = 'Date,Amount,Currency,Category,Note'
  const rows = expenses.map((e) => {
    const amt = (e.amount / 100).toFixed(2)
    const note = (e.note ?? '').replace(/"/g, '""')
    return `"${e.day}",${amt},"${currency}","${e.category}","${note}"`
  })
  return [header, ...rows].join('\n')
}
