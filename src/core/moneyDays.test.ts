import { describe, expect, it } from 'vitest'
import { moneyDay } from './moneyDays'

const t = (date: string, category: string, note = '', amount = 10000) => ({ date, type: 'expense', category, note, amount })
describe('no-spend and cooked-at-home days', () => {
  it('bills do not break a no-spend day; anything else does', () => {
    expect(moneyDay([t('2026-11-04', 'Home & bills', 'internet')], '2026-11-04').noSpend).toBe(true)
    expect(moneyDay([t('2026-11-04', 'Transport', 'taxi')], '2026-11-04').noSpend).toBe(false)
    expect(moneyDay([], '2026-11-04').noSpend).toBe(true)
  })
  it('cooked at home: groceries in the last days and no eating out', () => {
    expect(moneyDay([t('2026-11-02', 'Groceries', 'Linella')], '2026-11-04').cooked).toBe(true)
    expect(moneyDay([t('2026-11-02', 'Groceries'), t('2026-11-04', 'Food', 'Glovo pizza')], '2026-11-04').cooked).toBe(false)
    expect(moneyDay([], '2026-11-04').cooked).toBe(false)
  })
})
