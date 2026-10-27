export const EXPENSE_CATEGORIES = [
  'food',
  'groceries',
  'transit',
  'shopping',
  'bills',
  'health',
  'other'
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export interface Expense {
  id: number
  day: string // YYYY-MM-DD
  amount: number // in bani/cents (positive integer)
  category: ExpenseCategory | string
  note: string | null
  createdAt: string
}

export interface DailyExpenseSummary {
  day: string
  totalSpent: number
  everydaySpent: number
  budget: number
  underBudget: boolean
  remaining: number
  byCategory: Record<string, number>
}

export function validateExpense(amount: number, category: string): void {
  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    throw new Error('Expense amount must be greater than zero')
  }
  if (!category || typeof category !== 'string' || !category.trim()) {
    throw new Error('Category is required')
  }
}

export function computeDailyExpenseSummary(
  expenses: Expense[],
  day: string,
  dailyBudgetBani: number
): DailyExpenseSummary {
  const dayExpenses = expenses.filter((e) => e.day === day)
  let totalSpent = 0
  let everydaySpent = 0
  const byCategory: Record<string, number> = {}

  for (const e of dayExpenses) {
    totalSpent += e.amount
    if (e.category !== 'bills') {
      everydaySpent += e.amount
    }
    byCategory[e.category] = (byCategory[e.category] ?? 0) + e.amount
  }

  const remaining = dailyBudgetBani - everydaySpent
  const underBudget = dailyBudgetBani > 0 && everydaySpent <= dailyBudgetBani

  return {
    day,
    totalSpent,
    everydaySpent,
    budget: dailyBudgetBani,
    underBudget,
    remaining,
    byCategory
  }
}

export function formatMoney(bani: number, currency = 'MDL'): string {
  const main = (bani / 100).toLocaleString(undefined, {
    minimumFractionDigits: bani % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })
  return `${main} ${currency}`
}
