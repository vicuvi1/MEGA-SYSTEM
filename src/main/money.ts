import { computeDailyExpenseSummary, validateExpense, type DailyExpenseSummary, type Expense } from '@core/money'
import type { DB } from './db'
import { getSetting, setSetting } from './settings'
import type { Wallet } from './wallet'
import type { FinanceHost } from './apps/finance'

interface ExpenseRow {
  id: number
  day: string
  amount: number
  category: string
  note: string | null
  created_at: string
}

export interface NativeMoneySummary {
  currency: string
  dailyBudget: number // in bani
  today: DailyExpenseSummary
  monthSpent: number
  recentExpenses: Expense[]
}

function toExpense(r: ExpenseRow): Expense {
  return {
    id: r.id,
    day: r.day,
    amount: r.amount,
    category: r.category,
    note: r.note,
    createdAt: r.created_at
  }
}

export class MoneyService {
  private financeHost?: FinanceHost

  constructor(private db: DB, private wallet: Wallet) {}

  setFinanceHost(fh: FinanceHost): void {
    this.financeHost = fh
  }

  currency(): string {
    return getSetting(this.db, 'money_currency') || 'MDL'
  }

  setCurrency(cur: string): NativeMoneySummary {
    setSetting(this.db, 'money_currency', cur || 'MDL')
    return this.state()
  }

  dailyBudget(): number {
    return budgetBani(getSetting(this.db, 'money_daily_budget'))
  }

  setBudget(budgetBani: number): NativeMoneySummary {
    setSetting(this.db, 'money_daily_budget', String(Math.max(0, budgetBani)))
    return this.state()
  }

  expenses(limit = 100): Expense[] {
    const rows = this.db.prepare('SELECT * FROM expenses ORDER BY day DESC, id DESC LIMIT ?').all(limit) as ExpenseRow[]
    return rows.map(toExpense)
  }

  state(now = new Date()): NativeMoneySummary {
    const today = this.wallet.today(now)
    const all = this.expenses(300)
    const budget = this.dailyBudget()
    const todaySummary = computeDailyExpenseSummary(all, today, budget)

    const thisMonth = today.slice(0, 7)
    const monthExpenses = all.filter((e) => e.day.startsWith(thisMonth))
    const monthSpent = monthExpenses.reduce((s, e) => s + e.amount, 0)

    return {
      currency: this.currency(),
      dailyBudget: budget,
      today: todaySummary,
      monthSpent,
      recentExpenses: all.slice(0, 25)
    }
  }

  addExpense(
    amountBani: number,
    category: string,
    note?: string,
    now = new Date(),
    skipFinanceSync = false
  ): { expense: Expense; state: NativeMoneySummary; awarded: boolean } {
    validateExpense(amountBani, category)
    const today = this.wallet.today(now)
    const roundedBani = Math.round(amountBani)

    const info = this.db
      .prepare('INSERT INTO expenses (day, amount, category, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(today, roundedBani, category.trim(), note?.trim() || null, now.toISOString())

    const row = this.db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid) as ExpenseRow

    let awarded = false
    try {
      this.wallet.award('money.logged', `Logged expense: ${category}`, now)
      awarded = true
    } catch {
      // already logged today
    }

    // No Finance Helper on this machine (the web app): it gets the expense through the inbox.
    if (!skipFinanceSync && !this.financeHost && this.toFinance) {
      this.toFinance({ id: `life-exp-${row.id}`, amount: roundedBani, category: category.trim(), note: note?.trim() || category.trim(), date: today, at: now.getTime() })
    }
    if (!skipFinanceSync && this.financeHost) {
      this.financeHost.addTransaction({
        type: 'expense',
        amount: roundedBani,
        category: category.trim(),
        note: note?.trim() || undefined
      }).catch((err) => {
        console.warn('FinanceHost dual-write warning:', err)
      })
    }

    return {
      expense: toExpense(row),
      state: this.state(now),
      awarded
    }
  }

  deleteExpense(id: number): NativeMoneySummary {
    this.db.prepare('DELETE FROM expenses WHERE id = ?').run(id)
    // …and out of Finance Helper too.
    this.toFinance?.({ id: `life-exp-${id}`, amount: 0, category: '', note: '', date: this.wallet.today(), at: Date.now(), remove: true })
    return this.state()
  }

  /** Where expenses go when Finance Helper isn't on this machine (the web app's inbox). */
  toFinance?: (e: { id: string; amount: number; category: string; note: string; date: string; at: number; remove?: boolean }) => void
}

/**
 * money_daily_budget is kept in bani (P1). Finance's screen once saved it in
 * whole lei ("150"); a value under 1 000 bani (10 lei) can only be that, so it
 * reads as lei. Empty: 100 lei.
 */
export function budgetBani(raw: string | null | undefined): number {
  const n = parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n) || n < 0 || raw === '' || raw == null) return 10000
  return n > 0 && n < 1000 ? n * 100 : n
}
