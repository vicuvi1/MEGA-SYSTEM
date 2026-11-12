import { describe, expect, it } from 'vitest'
import { hubView, nudgeFacts, weekMoneyLine } from './moneyHub'

// Made-up Finance Helper data: a wallet, a salary, rent as a bill, a limit.
const TODAY = '2026-11-10'
const tx = (id: string, date: string, type: string, lei: number, category: string, account = 'wallet') => ({ id, createdAt: 1, updatedAt: 1, type, amount: lei * 100, currency: 'MDL', rate: 1, base: lei * 100, date, category, account, note: '' })
const state = {
  settings: { currency: 'MDL', limit: { on: true, amount: 300000 }, accounts: [{ id: 'wallet', name: 'Wallet', kind: 'cash', currency: 'MDL', start: 500000, updatedAt: 1 }] },
  tx: [tx('s', '2026-11-01', 'income', 9000, 'work'), tx('r', '2026-11-03', 'expense', 2500, 'home'), ...Array.from({ length: 10 }, (_, i) => tx(`f${i}`, `2026-11-${String(i + 1).padStart(2, '0')}`, 'expense', 100, 'food'))],
  goals: [{ id: 'g', name: 'Bike', emoji: '🚲', target: 500000, account: 'manual', saved: 100000, history: [], updatedAt: 1 }],
  people: [],
  deleted: {}
}

describe('the Money hub view (Finance Helper data → numbers)', () => {
  it('bills stay out of the limit; the day and month levels follow it', () => {
    const v = hubView(state, TODAY)!
    expect(v.hero.limit).toEqual({ amount: 300000, spent: 100000 })
    expect(v.hero.leftFor).toBe('limit')
    expect(v.hero.left).toBe(200000)
    expect(v.hero.leftDays).toBe(21)
    expect(v.hero.monthLevel).toBe('ok')
    expect(v.hero.spentToday).toBe(10000)
    expect(v.compare.byCat.map((c) => c.id)).toEqual(['home', 'food'])
    expect(v.goals[0]).toMatchObject({ name: 'Bike', ratio: 0.2 })
    expect(v.mainAccount).toBe('wallet')
    expect(v.loggedToday).toBe(true)
  })

  it("Ben's facts and the Sunday line", () => {
    const f = nudgeFacts(state, TODAY)!
    expect(f.limit).toEqual({ amount: 300000, spent: 100000, daysLeft: 21 })
    expect(f.loggedToday).toBe(true)
    expect(weekMoneyLine(state, TODAY)).toBe('This week: 200\u00a0MDL, the same as the same days last week.')
    expect(hubView(null, TODAY)).toBeNull()
  })
})
