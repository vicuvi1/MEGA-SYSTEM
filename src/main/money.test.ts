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
})
