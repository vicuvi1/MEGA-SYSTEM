// TL6: the money coach answers from made-up Finance Helper data.
import { describe, expect, it } from 'vitest'
import { affordAnswer, affordReply, etaAfter, moneyFacts, readAfford } from './moneyCoach'

const today = '2026-11-15'
const tx = (date: string, type: string, lei: number, extra: object = {}) => ({ id: `${type}-${date}-${lei}`, date, type, amount: lei * 100, ...extra })
// Three months of 10 000 lei income and 8 000 lei spending: a 20% savings rate.
const history = ['2026-08', '2026-09', '2026-10'].flatMap((m) => [tx(`${m}-05`, 'income', 10000), tx(`${m}-10`, 'expense', 5000), tx(`${m}-20`, 'expense', 3000)])
const finance = {
  settings: { limit: { on: true, amount: 600000 } },
  tx: [...history, tx('2026-11-03', 'expense', 2500), tx('2026-11-09', 'expense', 1500), tx('2026-11-10', 'expense', 999, { deleted: true })],
  goals: [{ name: 'New laptop', target: 1200000, saved: 600000 }]
}

describe('reading the ask', () => {
  it('with and without a price', () => {
    expect(readAfford('Can I afford headphones this month?')).toEqual({ what: 'headphones', price: null })
    expect(readAfford('can i buy a jacket for 900 lei')).toEqual({ what: 'jacket', price: 90000 })
    expect(readAfford('should I get AirPods 2400?')).toEqual({ what: 'AirPods', price: 240000 })
    expect(readAfford('can I go to the gym later')).toBeNull()
  })
})

describe('the numbers', () => {
  it('budget left, savings rate, fun budget and goal ETA from real data', () => {
    const f = moneyFacts(finance, today, { budgetLei: 1500, leftLei: 1100 })
    expect(f.monthSpent).toBe(400000)
    expect(f.limitLeft).toBe(200000)
    expect(f.daysLeft).toBe(16)
    expect(f.safeToday).toBe(12500)
    expect(f.savingsRate).toBe(0.2)
    expect(f.savedPerMonth).toBe(200000)
    expect(f.fun).toEqual({ budget: 150000, left: 110000 })
    expect(f.goals[0]).toEqual({ title: 'New laptop', left: 600000, etaMonths: 3 })
    expect(etaAfter(f.goals[0], f.savedPerMonth, 100000)).toBe(3.5)
  })
  it('says unknown instead of guessing when there is no data', () => {
    const f = moneyFacts({ tx: [] }, today)
    expect(f.savingsRate).toBeNull()
    expect(f.limit).toBeNull()
    const a = affordAnswer({ what: 'headphones', price: 50000 }, f)
    expect(a.verdict).toBe('unknown')
    expect(a.title).toMatch(/can't tell/)
  })
})

describe('the answer', () => {
  const f = moneyFacts(finance, today, { budgetLei: 1500, leftLei: 1100 })
  it('no price: shows the numbers and asks for it', () => {
    const a = affordAnswer({ what: 'headphones', price: null }, f)
    expect(a.verdict).toBe('unknown')
    expect(a.lines.join('\n')).toMatch(/Budget left this month: 2,000 lei of 6,000 lei/)
    expect(a.lines.join('\n')).toMatch(/Savings rate \(last 3 months\): 20%/)
    expect(a.lines.join('\n')).toMatch(/New laptop.*3 months/)
  })
  it('a cheap buy fits the fun budget', () => {
    const a = affordAnswer({ what: 'headphones', price: 40000 }, f)
    expect(a.verdict).toBe('yes')
    expect(affordReply(a)).toMatch(/^🟢 Yes, headphones for 400 lei fits\./)
    expect(a.lines.join('\n')).toMatch(/fits the fun budget: 700 lei would be left/)
  })
  it('a big buy is a no, with its effect on the goal', () => {
    const a = affordAnswer({ what: 'a phone', price: 400000 }, f)
    expect(a.verdict).toBe('no')
    expect(a.lines.join('\n')).toMatch(/5 months after this buy \(\+2 months\)/)
    expect(a.chips).toContain('Wait 48 hours')
  })
})
