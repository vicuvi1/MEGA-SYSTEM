import { computeDailyExpenseSummary, validateExpense, type DailyExpenseSummary, type Expense } from '@core/money'
import { judgeMoneyDays, liveLog, moneyDay, type DayTx, type JudgedMoneyDay } from '@core/moneyDays'
import { savingStreak, SAVING_STREAK_BONUS } from '@core/funBudget'
import { addDays } from '@core/dates'
import { LedgerError } from '@core/ledger'
import type { DB } from './db'
import { getSetting, setSetting } from './settings'
import type { Wallet } from './wallet'
import type { FinanceHost } from './apps/finance'

/** The ledger note of the points a free day paid (so undo only takes back those). */
export const FREE_DAY_NOTE = 'Spending logged (free day, no spending)'

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
      }).then((r) => {
        // Remember which Finance Helper record it made, so deleting it here removes it there (P5).
        if (r?.ok && r.txId) this.link(row.id, r.txId)
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

  private links(): Record<string, string> {
    try {
      return JSON.parse(getSetting(this.db, 'fin_tx_links') || '{}')
    } catch {
      return {}
    }
  }
  private link(expenseId: number, txId: string | null): void {
    const all = this.links()
    if (txId) all[String(expenseId)] = txId
    else delete all[String(expenseId)]
    setSetting(this.db, 'fin_tx_links', JSON.stringify(Object.fromEntries(Object.entries(all).slice(-500))))
  }

  deleteExpense(id: number): NativeMoneySummary {
    this.db.prepare('DELETE FROM expenses WHERE id = ?').run(id)
    // The desktop's Finance Helper record goes too (P5).
    const txId = this.links()[String(id)]
    if (txId && this.financeHost?.removeTransaction) {
      void this.financeHost.removeTransaction(txId).catch(() => false)
      this.link(id, null)
    }
    // …and out of Finance Helper too.
    this.toFinance?.({ id: `life-exp-${id}`, amount: 0, category: '', note: '', date: this.wallet.today(), at: Date.now(), remove: true })
    return this.state()
  }

  // ---- Honest money days (FX3, RL6) ----

  private days(key: 'money_nothing_spent' | 'money_cooked_days'): string[] {
    try {
      const v = JSON.parse(getSetting(this.db, key) || '[]')
      return Array.isArray(v) ? v.filter((d) => typeof d === 'string') : []
    } catch {
      return []
    }
  }
  private addDay(key: 'money_nothing_spent' | 'money_cooked_days', day: string): void {
    const list = [...new Set([...this.days(key), day])].sort().slice(-90)
    setSetting(this.db, key, JSON.stringify(list))
  }

  /** Expenses logged here, as money days (a record made on its own day is live). */
  nativeDayTx(): DayTx[] {
    const dayOf = (ms: number) => this.wallet.today(new Date(ms))
    return this.expenses(300).map((e) => ({ date: e.day, type: 'expense', category: e.category, note: e.note ?? '', amount: e.amount, live: liveLog(e.day, Date.parse(e.createdAt), dayOf) }))
  }

  /** Days you tapped "Nothing spent today" / confirmed cooking at home. */
  marks(): { nothingSpent: string[]; cooked: string[] } {
    return { nothingSpent: this.days('money_nothing_spent'), cooked: this.days('money_cooked_days') }
  }

  /**
   * "Nothing spent today": counts today as a no-spend day once it is over
   * (if no spending shows up for it by then). Pays nothing now.
   * `other`: records from Finance Helper, to check you didn't log spending already.
   */
  nothingSpent(other: DayTx[] = [], now = new Date()): { day: string; already: boolean } {
    const day = this.wallet.today(now)
    const m = moneyDay([...this.nativeDayTx(), ...other], day)
    if (m.everydayBani > 0) throw new LedgerError('You already logged spending today, so it is not a no-spend day')
    const already = this.days('money_nothing_spent').includes(day)
    if (!already) this.addDay('money_nothing_spent', day)
    return { day, already }
  }

  /**
   * A free day: "No spending today". Marks today as a no-spend day and pays
   * "Spending logged" once, with the same ref a real spend uses (so a spend
   * logged later the same day never pays again). Only for today, at the time.
   */
  freeDay(other: DayTx[] = [], now = new Date()): { day: string; already: boolean; paid: number; ledgerId: number | null } {
    const day = this.wallet.today(now)
    const m = moneyDay([...this.nativeDayTx(), ...other], day)
    if (m.everydayBani > 0) throw new LedgerError('You already logged spending today, so it is not a free day')
    const already = this.days('money_nothing_spent').includes(day)
    if (!already) this.addDay('money_nothing_spent', day)
    const ref = `fin:logged:${day}`
    if (this.wallet.effective().some((e) => e.ref === ref)) return { day, already, paid: 0, ledgerId: null }
    const before = this.wallet.summary().balance
    const ledgerId = this.wallet.awardRule('money.logged', { now, day, ref, note: FREE_DAY_NOTE })
    return { day, already, paid: this.wallet.summary().balance - before, ledgerId }
  }

  /** Takes today's free day back, with the points it paid (a real spend's points stay). */
  undoFreeDay(now = new Date()): { day: string } {
    const day = this.wallet.today(now)
    setSetting(this.db, 'money_nothing_spent', JSON.stringify(this.days('money_nothing_spent').filter((d) => d !== day)))
    const paid = this.wallet.effective().find((e) => e.ref === `fin:logged:${day}` && e.note === FREE_DAY_NOTE)
    if (paid) this.wallet.undo(paid.id, 'Free day undone', now)
    return { day }
  }

  /** "I cooked at home today": you confirm it, then it pays (once a day). */
  confirmCooked(now = new Date()): number {
    const day = this.wallet.today(now)
    const ref = `money:cooked:${day}`
    if (this.wallet.entries().some((e) => e.ref === ref || e.ref === `fin:cooked:${day}`)) throw new LedgerError('Cooking at home is already counted today')
    const id = this.wallet.awardRule('money.cooked_home', { now, day, ref, note: 'Cooked at home (you confirmed)' })
    this.addDay('money_cooked_days', day)
    return id
  }

  /** The finished days from `from` to yesterday, judged from live logs only. */
  judged(other: DayTx[] = [], from?: string, now = new Date()): JudgedMoneyDay[] {
    const today = this.wallet.today(now)
    const m = this.marks()
    return judgeMoneyDays({ tx: [...this.nativeDayTx(), ...other], from: from ?? addDays(today, -30), today, budgetBani: this.dailyBudgetSet(), nothingSpent: m.nothingSpent })
  }

  /** The daily budget days are judged on: the one the Money page shows (bani, 0 = off). */
  dailyBudgetSet(): number {
    return this.dailyBudget()
  }

  /** RL6: days in a row under budget (finished days with a live log), and the next bonus. */
  savingStreak(other: DayTx[] = [], now = new Date()): { days: number; next: { days: number; points: number } | null } {
    const days = savingStreak(this.judged(other, undefined, now))
    return { days, next: SAVING_STREAK_BONUS.find((b) => b.days > days) ?? null }
  }

  /**
   * Pays the finished days once each (FX3): a no-spend day (a live log or
   * your "Nothing spent today", no everyday spending), under budget (a live
   * log, at or under your daily budget; never back-dated or imported days),
   * and the saving-streak bonuses at 3, 7 and 14 days (RL6). Days from
   * `since` (when money was first connected), the last 7 at most.
   */
  payDays(other: DayTx[] = [], since?: string, now = new Date()): number {
    const today = this.wallet.today(now)
    const week = addDays(today, -7)
    const from = since && since > week ? since : week
    const refs = new Set(this.wallet.entries().map((e) => e.ref ?? '').filter(Boolean))
    let paid = 0
    const pay = (rule: string, day: string, ref: string, note: string, also: string[] = []) => {
      if (refs.has(ref) || also.some((r) => refs.has(r))) return
      try {
        this.wallet.awardRule(rule, { day, ref, note, now })
        refs.add(ref)
        paid++
      } catch (e) {
        if (!(e instanceof LedgerError)) throw e
      }
    }
    for (const d of this.judged(other, from, now)) {
      if (d.noSpend) pay('money.no_spend', d.day, `fin:nospend:${d.day}`, d.logged ? 'No-spend day' : 'No-spend day (you said nothing was spent)')
      if (d.under) pay('money.under_budget', d.day, `money:under:${d.day}`, 'Stayed under your daily budget')
    }
    const streak = savingStreak(this.judged(other, addDays(today, -120), now))
    const start = addDays(today, -streak)
    for (const b of SAVING_STREAK_BONUS) {
      if (streak < b.days) continue
      // One bonus per streak: the ref names the day the streak started.
      const ref = `money:streak${b.days}:${start}`
      const pre = `money:streak${b.days}:`
      if ([...refs].some((r) => r.startsWith(pre) && r.slice(pre.length) >= start)) continue
      this.wallet.append({ ts: now.toISOString(), day: today, module: 'money', kind: 'earn', coins: b.points, xp: 0, ref, note: `${b.days} days in a row under budget` })
      refs.add(ref)
      paid++
    }
    return paid
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
