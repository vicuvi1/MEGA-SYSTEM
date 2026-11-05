import { describe, expect, it } from 'vitest'
import { pointValue } from './pointValue'
import {
  financeFunCategory,
  funBudgetLei,
  funSpentLei,
  hoursOfWork,
  leftoverLei,
  migrateRewardBudget,
  parseFunBudget,
  repriceSuggestions,
  rewardFinId,
  savingStreak,
  suggestPoints,
  toLei,
  txLei
} from './funBudget'

const finance = (budget = 50000, extra: any[] = []) => ({
  settings: { currency: 'MDL', categories: [{ id: 'food', name: 'Food', type: 'expense', budget: 100000 }, { id: 'c-9', name: 'Entertainment', type: 'expense', budget }] },
  rates: { usd: { USD: 1, MDL: 18, EUR: 0.9 } },
  tx: [
    { id: 't1', type: 'expense', category: 'c-9', amount: 10000, base: 10000, date: '2026-11-02' },
    { id: 't2', type: 'expense', category: 'c-9', amount: 5000, base: 5000, date: '2026-10-30' },
    { id: rewardFinId(7), type: 'expense', category: 'c-9', amount: 15000, base: 15000, date: '2026-11-03' },
    { id: 't3', type: 'expense', category: 'food', amount: 9900, base: 9900, date: '2026-11-03' },
    ...extra
  ]
})

describe('the monthly fun budget (RL3)', () => {
  it('reads the setting and moves the old reward budget once', () => {
    expect(parseFunBudget('{"lei":600,"source":"manual"}')).toEqual({ lei: 600, source: 'manual' })
    expect(parseFunBudget('null')).toBeNull()
    expect(parseFunBudget('nope')).toBeNull()
    expect(migrateRewardBudget(null, '400')).toEqual({ lei: 400, source: 'manual' })
    expect(migrateRewardBudget('{"lei":600,"source":"manual"}', '400')).toBeNull()
    expect(migrateRewardBudget(null, '0')).toBeNull()
  })
  it('takes a Fun or Entertainment limit from Finance Helper', () => {
    expect(financeFunCategory(finance())).toEqual({ id: 'c-9', name: 'Entertainment', lei: 500 })
    expect(financeFunCategory({ settings: { categories: [{ id: 'x', name: 'Food', type: 'expense', budget: 100 }] } })).toBeNull()
    expect(funBudgetLei({ lei: 300, source: 'finance' }, finance())).toBe(500)
    expect(funBudgetLei({ lei: 300, source: 'finance' }, null)).toBe(300)
    expect(funBudgetLei({ lei: 300, source: 'manual' }, finance())).toBe(300)
    expect(funBudgetLei(null, finance())).toBeNull()
  })
  it('counts rewards bought plus the category, never the same buy twice', () => {
    expect(funSpentLei({ month: '2026-11', rewardBuysLei: [150], finance: finance(), setting: { lei: 0, source: 'finance' } })).toBe(250)
    expect(funSpentLei({ month: '2026-11', rewardBuysLei: [150], finance: finance(), setting: { lei: 600, source: 'manual' } })).toBe(150)
  })
})

describe('money in lei', () => {
  it('converts with Finance Helper rates, never adds dollars as lei', () => {
    expect(toLei(10, 'USD', { usd: { USD: 1, MDL: 18 } })).toBe(180)
    expect(toLei(10, 'MDL')).toBe(10)
    expect(toLei(10, 'XYZ')).toBeNull()
    expect(txLei({ amount: 1000, currency: 'USD' }, { usd: { USD: 1, MDL: 18 } })).toBe(180)
    expect(txLei({ amount: 1000, base: 18000, currency: 'USD' })).toBe(180)
  })
})

describe('real prices (RL2, RL5)', () => {
  const v = pointValue({ funBudgetLei: 600, earnPerDay: 100 }) // 1 point = 0.20 lei
  it('suggests points from a real cost', () => {
    expect(suggestPoints(150, v)).toBe(750)
  })
  it('suggests new prices for the old points = 10 × lei, only suggests', () => {
    const rows = repriceSuggestions(
      [
        { id: 1, title: 'Cinema', price: 1500, realCost: 150 },
        { id: 2, title: 'Free walk', price: 50, realCost: 0 },
        { id: 3, title: 'Board game', price: 750, realCost: 150 }
      ],
      v
    )
    expect(rows).toEqual([{ id: 1, title: 'Cinema', price: 1500, suggested: 750, lei: 150, why: 'old-fixed' }])
  })
  it('hours of work, null when the rate is unknown', () => {
    expect(hoursOfWork(150, 60)).toBe(2.5)
    expect(hoursOfWork(150, null)).toBeNull()
  })
})

describe('saving streak and leftovers (RL6, RL7)', () => {
  it('counts judged days under budget from real logs only', () => {
    const d = (day: string, logged: boolean, under: boolean) => ({ day, logged, under })
    expect(savingStreak([d('2026-11-04', true, true), d('2026-11-03', true, true), d('2026-11-02', false, true), d('2026-11-01', true, true)])).toBe(2)
    expect(savingStreak([d('2026-11-04', true, false)])).toBe(0)
  })
  it('leftover is what is really left', () => {
    expect(leftoverLei(600, 450.5)).toBe(149)
    expect(leftoverLei(600, 700)).toBe(0)
    expect(leftoverLei(null, 0)).toBe(0)
  })
})
