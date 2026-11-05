import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from './db'
import { MoneyService } from './money'
import { Wallet } from './wallet'

let dir: string
let db: DB
let wallet: Wallet
let money: MoneyService

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-money-test-'))
  db = openDb(join(dir, 'life.db'))
  wallet = new Wallet(db, 'UTC')
  money = new MoneyService(db, wallet)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('MoneyService backend', () => {
  it('adds an expense and awards money.logged rule', () => {
    const now = new Date('2026-10-27T12:00:00Z')
    const res = money.addExpense(4500, 'food', 'Lunch with friend', now)

    expect(res.expense.amount).toBe(4500)
    expect(res.expense.category).toBe('food')
    expect(res.expense.note).toBe('Lunch with friend')
    expect(res.awarded).toBe(true)
    expect(wallet.summary(now).balance).toBe(3) // +3 for money.logged
  })

  it('second expense on same day does not duplicate award', () => {
    const now = new Date('2026-10-27T12:00:00Z')
    money.addExpense(4500, 'food', 'Lunch', now)
    const res2 = money.addExpense(1500, 'transit', 'Bus fare', now)

    expect(res2.awarded).toBe(false)
    expect(wallet.summary(now).balance).toBe(3)
    expect(res2.state.today.everydaySpent).toBe(6000)
  })

  it('deletes an expense correctly', () => {
    const now = new Date('2026-10-27T12:00:00Z')
    const { expense } = money.addExpense(2000, 'groceries', '', now)
    expect(money.expenses().length).toBe(1)

    const state = money.deleteExpense(expense.id)
    expect(state.recentExpenses.length).toBe(0)
    expect(money.expenses().length).toBe(0)
  })

  it('updates budget and currency preferences', () => {
    money.setCurrency('EUR')
    expect(money.currency()).toBe('EUR')

    money.setBudget(15000)
    expect(money.dailyBudget()).toBe(15000)
  })

  it('dual-writes to FinanceHost when configured', async () => {
    let syncedTx: any = null
    const mockFinanceHost: any = {
      addTransaction: async (tx: any) => {
        syncedTx = tx
        return { ok: true, txId: 'tx-123', balanceTotal: 50000, accountName: 'Cash' }
      }
    }
    money.setFinanceHost(mockFinanceHost)
    const now = new Date('2026-10-27T12:00:00Z')
    money.addExpense(3500, 'food', 'Coffee', now)

    expect(syncedTx).toEqual({
      type: 'expense',
      amount: 3500,
      category: 'food',
      note: 'Coffee'
    })
  })
})

import { budgetBani } from './money'
describe('one daily budget, in bani (P1)', () => {
  it('reads bani, and an old whole-lei value as lei', () => {
    expect(budgetBani('15000')).toBe(15000)
    expect(budgetBani('150')).toBe(15000)
    expect(budgetBani('0')).toBe(0)
    expect(budgetBani(null)).toBe(10000)
  })
})

describe('saving streak (RL6)', () => {
  it('pays 3 days in a row under budget once, from live logs only', () => {
    money.setBudget(10000)
    for (const day of ['2026-11-01', '2026-11-02', '2026-11-03']) money.addExpense(3000, 'food', 'Lunch', new Date(`${day}T12:00:00Z`))
    // A back-dated record does not count as a log on its day.
    db.prepare('INSERT INTO expenses (day, amount, category, note, created_at) VALUES (?, ?, ?, ?, ?)').run('2026-10-31', 1000, 'food', null, '2026-11-03T13:00:00Z')
    const now = new Date('2026-11-04T09:00:00Z')
    expect(money.savingStreak([], now)).toEqual({ days: 3, next: { days: 7, points: 25 } })
    const paid = money.payDays([], '2026-10-25', now)
    expect(paid).toBe(3 + 1) // three days under budget + the 3-day bonus
    const bonus = wallet.entries().filter((e) => e.ref?.startsWith('money:streak3:'))
    expect(bonus.map((e) => e.coins)).toEqual([10])
    expect(wallet.entries().some((e) => e.ref === 'money:under:2026-10-31')).toBe(false)
    expect(money.payDays([], '2026-10-25', new Date('2026-11-04T20:00:00Z'))).toBe(0)
  })
})
