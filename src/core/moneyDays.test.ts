import { describe, expect, it } from 'vitest'
import { financeSummary, isImported, judgeMoneyDays, liveLog, moneyDay, underBudget } from './moneyDays'

const t = (date: string, category: string, note = '', amount = 10000, live = true) => ({ date, type: 'expense', category, note, amount, live })

describe('honest no-spend days (FX3)', () => {
  it('bills do not break a no-spend day; anything else does', () => {
    expect(moneyDay([t('2026-11-04', 'Home & bills', 'internet')], '2026-11-04').noSpend).toBe(true)
    expect(moneyDay([t('2026-11-04', 'Transport', 'taxi')], '2026-11-04').noSpend).toBe(false)
  })
  it('a day you forgot to log is not a no-spend day', () => {
    expect(moneyDay([], '2026-11-04').noSpend).toBe(false)
    // A bill typed in a week later is not a log on that day either.
    expect(moneyDay([t('2026-11-04', 'Home & bills', 'rent', 10000, false)], '2026-11-04').noSpend).toBe(false)
  })
  it('"Nothing spent today" counts, unless spending shows up for that day', () => {
    expect(moneyDay([], '2026-11-04', { nothingSpent: true }).noSpend).toBe(true)
    expect(moneyDay([t('2026-11-04', 'Food', 'lunch', 5000, false)], '2026-11-04', { nothingSpent: true }).noSpend).toBe(false)
  })
})

describe('cooked at home (FX3)', () => {
  it('pays only when you confirm; groceries and no eating out are just a guess', () => {
    const m = moneyDay([t('2026-11-02', 'Groceries', 'Linella')], '2026-11-04')
    expect(m.cooked).toBe(false)
    expect(m.cookedGuess).toBe(true)
    expect(moneyDay([t('2026-11-02', 'Groceries'), t('2026-11-04', 'Food', 'Glovo pizza')], '2026-11-04').cookedGuess).toBe(false)
    expect(moneyDay([], '2026-11-04', { cookedConfirmed: true }).cooked).toBe(true)
  })
})

describe('live logs only', () => {
  const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  it('a record made on its own day (or before 04:00 next morning) is live', () => {
    expect(liveLog('2026-11-04', Date.parse('2026-11-04T19:00:00Z'), dayOf)).toBe(true)
    expect(liveLog('2026-11-04', Date.parse('2026-11-05T02:30:00Z'), dayOf)).toBe(true)
    expect(liveLog('2026-11-04', Date.parse('2026-11-07T10:00:00Z'), dayOf)).toBe(false)
    expect(liveLog('2026-11-04', Date.parse('2026-11-04T19:00:00Z'), dayOf, true)).toBe(false)
    expect(liveLog('2026-11-04', null, dayOf)).toBe(false)
  })
  it('bank statement lines are imported', () => {
    expect(isImported({ id: 'tg-life-bank-1a2b3c4d' })).toBe(true)
    expect(isImported({ id: 'x', source: 'telegram' })).toBe(false)
  })
})

describe('under budget (FX3)', () => {
  it('needs a live log; an empty day is not "under"', () => {
    expect(underBudget(moneyDay([], '2026-11-04'), 10000)).toBe(false)
    expect(underBudget(moneyDay([t('2026-11-04', 'Food', '', 8000)], '2026-11-04'), 10000)).toBe(true)
    expect(underBudget(moneyDay([t('2026-11-04', 'Food', '', 8000, false)], '2026-11-04'), 10000)).toBe(false)
    expect(underBudget(moneyDay([t('2026-11-04', 'Food', '', 12000)], '2026-11-04'), 10000)).toBe(false)
    expect(underBudget(moneyDay([t('2026-11-04', 'Food', '', 100)], '2026-11-04'), 0)).toBe(false)
  })
  it('judges only finished days', () => {
    const days = judgeMoneyDays({ tx: [t('2026-11-03', 'Food', '', 5000), t('2026-11-05', 'Food', '', 5000)], from: '2026-11-02', today: '2026-11-05', budgetBani: 10000, nothingSpent: ['2026-11-04'] })
    expect(days.map((d) => [d.day, d.under, d.noSpend])).toEqual([
      ['2026-11-02', false, false],
      ['2026-11-03', true, false],
      ['2026-11-04', false, true]
    ])
  })
})

describe('the Money page numbers (FX7)', () => {
  it('keeps bills out of everyday spending and fills the last days', () => {
    const s = financeSummary([t('2026-11-05', 'Food', '', 5000), t('2026-11-05', 'Home & bills', 'rent', 300000), { date: '2026-11-01', type: 'income', category: 'Work', amount: 900000, live: true }], '2026-11-05', 3)
    expect(s.today).toEqual({ logged: true, everydaySpent: 5000 })
    expect(s.month).toEqual({ spent: 305000, everyday: 5000, income: 900000, days: 1 })
    expect(s.days.map((d) => [d.day, d.judged])).toEqual([
      ['2026-11-05', false],
      ['2026-11-04', true],
      ['2026-11-03', true]
    ])
  })
})
