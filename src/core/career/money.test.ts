import { describe, expect, it } from 'vitest'
import { answerPay, careerFund, cleanPlan, DEFAULT_PLAN, emergencyFund, incomeSource, incomeView, monthlyCosts, payAsks, payStreak, projection, savingsBalance, type PayAnswer } from './money'

const T = '2026-11-07'
let n = 0
const tx = (date: string, type: string, lei: number, extra: Record<string, unknown> = {}) => ({ id: `t${n++}`, date, type, amount: lei * 100, base: lei * 100, category: 'food', account: 'card', ...extra })
const finance = {
  settings: { accounts: [{ id: 'card', start: 100000 }, { id: 'safe', savings: true, start: 300000 }] },
  tx: [
    tx('2026-08-10', 'expense', 4000),
    tx('2026-09-10', 'expense', 3000),
    tx('2026-10-05', 'expense', 2500),
    tx('2026-10-20', 'expense', 500),
    tx('2026-11-02', 'expense', 9999),
    tx('2026-10-01', 'income', 6000, { category: 'work', note: 'Shift pay' }),
    tx('2026-11-01', 'income', 6000, { category: 'work', note: 'Salary' }),
    tx('2026-11-04', 'income', 800, { category: 'other', note: 'Freelance bot for a client' }),
    tx('2026-11-05', 'income', 500, { category: 'gift', note: 'Scholarship' }),
    tx('2026-11-06', 'transfer', 1000, { from: 'card', to: 'safe' }),
    tx('2026-10-15', 'expense', 50, { deleted: true })
  ]
}

describe('emergency fund', () => {
  it('monthly costs: the average of the last 3 full months with spending', () => {
    expect(monthlyCosts(finance, T)).toEqual({ lei: 3333, months: 3 })
    expect(monthlyCosts({ tx: [] }, T)).toBeNull()
  })
  it('the savings account balance, with transfers', () => {
    expect(savingsBalance(finance)).toBe(4000)
    expect(savingsBalance({ settings: { accounts: [{ id: 'a' }] } })).toBeNull()
  })
  it('the target is N months of costs; the career fund is not counted as safety money', () => {
    const fund = careerFund({ ...DEFAULT_PLAN, careerPct: 25 }, [{ txId: 'x', day: T, moved: 2000, answered: T }], [])
    expect(fund).toMatchObject({ in: 500, left: 500 })
    const ef = emergencyFund(DEFAULT_PLAN, finance, T, fund)
    expect(ef).toMatchObject({ costs: 3333, target: 9999, saved: 3500, pct: 35, left: 6499, monthsCovered: 1.1, source: 'savings account', full: false })
  })
  it('without a savings account: your starting number plus what you moved', () => {
    const f = { ...finance, settings: { accounts: [] } }
    const fund = careerFund({ ...DEFAULT_PLAN, careerPct: 10 }, [], [])
    expect(emergencyFund({ ...DEFAULT_PLAN, fundStart: 1000 }, f, T, fund, 2000).saved).toBe(3000)
  })
})

describe('pay yourself first', () => {
  it('asks once per new income (last 14 days), newest first', () => {
    const asks = payAsks(finance, [], T, 20)
    expect(asks.map((a) => [a.income, a.ask])).toEqual([
      [500, 100],
      [800, 160],
      [6000, 1200]
    ])
    const answered = answerPay([], asks[0], 100, T)
    expect(payAsks(finance, answered, T, 20)).toHaveLength(2)
  })
  it('the streak counts yeses in a row, a no breaks it', () => {
    const a = (day: string, moved: number): PayAnswer => ({ txId: day, day, moved, answered: day })
    expect(payStreak([a('2026-09-01', 500), a('2026-09-15', 0), a('2026-10-01', 600), a('2026-10-15', 300), a('2026-11-01', 1200)])).toEqual({ now: 3, best: 3, total: 2600 })
  })
  it('career fund: spending comes off, the ring fills toward the goal', () => {
    expect(careerFund({ ...DEFAULT_PLAN, careerPct: 50, careerGoal: 1000 }, [{ txId: 'a', day: T, moved: 1200, answered: T }], [{ id: 's', what: 'Lab month', lei: 100, day: T }])).toEqual({ in: 600, spent: 100, left: 500, goal: 1000, pct: 50 })
  })
})

describe('income growth', () => {
  it('sorts income by source', () => {
    expect([incomeSource({ note: 'Salary' }), incomeSource({ note: 'bursa de merit' }), incomeSource({ category: 'other', note: 'Upwork client' }), incomeSource({ note: 'gift' })]).toEqual(['shift', 'scholarship', 'freelance', 'other'])
  })
  it("this month's income against the target", () => {
    const v = incomeView(finance, T, 10000)
    expect(v).toMatchObject({ month: '2026-11', total: 7300, bySource: { shift: 6000, freelance: 800, scholarship: 500, other: 0 }, pct: 73, gap: 2700, avg3: 6000 })
    expect(v.history).toHaveLength(6)
  })
})

describe('investing projection (educational)', () => {
  it('compounds monthly; the band is lower and higher; zero rate is just the sum', () => {
    const p = projection(500, 5, 10)
    expect(p).toHaveLength(11)
    expect(p[0]).toEqual({ year: 0, paid: 0, value: 0, low: 0, high: 0 })
    expect(p[10].paid).toBe(60000)
    expect(p[10].value).toBeGreaterThan(77000)
    expect(p[10].value).toBeLessThan(79000)
    expect(p[10].low).toBeLessThan(p[10].value)
    expect(p[10].high).toBeGreaterThan(p[10].value)
    expect(projection(100, 0, 2)[2].value).toBe(2400)
  })
  it('cleans the plan', () => {
    expect(cleanPlan({ months: 40, payPct: 0, investRate: 30, incomeTarget: -5 })).toMatchObject({ months: 12, payPct: 1, investRate: 12, incomeTarget: null })
  })
})
