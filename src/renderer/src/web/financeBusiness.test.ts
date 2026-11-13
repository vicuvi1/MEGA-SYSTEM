// The Business view's numbers: profit, income per client, open and overdue
// invoices, hours billed, business cash, and the MDL / USD / EUR switch that
// converts each record at its own day's rate. Made-up records only.
import { describe, expect, it } from 'vitest'
// @ts-ignore plain JS modules
import { businessMonth, clientIncome, openInvoices, hoursMoney, businessCash, businessSummary, valueIn } from '../../public/apps/finance/js/business.js'
// @ts-ignore
import { defaultState } from '../../public/apps/finance/js/model.js'

let n = 0
const tx = (over: any = {}) => ({ id: `b${++n}`, createdAt: n, updatedAt: n, type: 'expense', amount: 1000, currency: 'MDL', rate: 1, base: over.amount ?? 1000, date: '2026-10-05', category: 'food', account: 'biz', ...over })

function biz() {
  const s = defaultState()
  s.settings.accounts.push({ id: 'biz', name: 'Business bank', kind: 'business', currency: 'MDL', start: 10000, book: 'business', holdings: [] })
  s.people.push({ id: 'p-a', name: 'Acme Studio', client: true }, { id: 'p-b', name: 'Blue Fox', client: true })
  // 1 USD = 18 MDL and 1 EUR = 20 MDL on 5 Oct; 1 USD = 17 MDL today.
  s.rates = { usd: { MDL: 17, EUR: 0.9 }, crypto: {}, history: { '2026-10-05': { MDL: 18, EUR: 0.9 } }, fetchedAt: 1 }
  s.tx = [
    tx({ type: 'income', category: 'work', amount: 36000, person: 'p-a' }),
    tx({ type: 'income', category: 'work', amount: 18000, person: 'p-b' }),
    tx({ type: 'income', category: 'work', amount: 100000, currency: 'USD', rate: 18, base: 1800000, person: 'p-a', date: '2026-10-05', account: 'card', book: 'business' }),
    tx({ category: 'fees', amount: 9000 }),
    tx({ type: 'transfer', from: 'biz', to: 'card', amount: 5000, base: 5000, category: undefined, account: undefined, draw: true }),
    tx({ category: 'food', account: 'wallet', amount: 7000 }), // personal: not here
  ]
  s.invoices = [
    { id: 'i1', number: 'INV-2026-001', client: 'p-a', date: '2026-10-01', due: '2026-10-10', currency: 'USD', items: [{ desc: 'Design', hours: 10, rate: 5000 }], sent: true, paidDate: null },
    { id: 'i2', number: 'INV-2026-002', client: 'p-b', date: '2026-10-03', due: '2026-11-30', currency: 'MDL', items: [{ desc: 'Fix', hours: 2, rate: 30000 }], sent: true, paidDate: null },
    { id: 'i3', number: 'INV-2026-003', client: 'p-b', date: '2026-10-04', due: '2026-10-20', currency: 'MDL', items: [{ desc: 'Draft', amount: 1000 }], sent: false, paidDate: null },
  ]
  return s
}

describe('business view', () => {
  it("this month's income, costs, profit and what you paid yourself (MDL)", () => {
    const s = biz()
    const m = businessMonth(s, '2026-10')
    expect(m.income).toBe(36000 + 18000 + 1800000)
    expect(m.costs).toBe(9000)
    expect(m.profit).toBe(m.income - 9000)
    expect(m.draws).toBe(5000)
    expect(m.byCost).toEqual([{ id: 'fees', amount: 9000 }])
  })

  it('income per client, biggest first, with shares', () => {
    const rows = clientIncome(biz(), '2026-10-01', '2026-10-31')
    expect(rows.map((r: any) => r.person?.name)).toEqual(['Acme Studio', 'Blue Fox'])
    expect(rows[0].amount).toBe(36000 + 1800000)
    expect(rows[0].share + rows[1].share).toBeCloseTo(1)
  })

  it('unpaid and overdue invoices (drafts are not unpaid)', () => {
    const r = openInvoices(biz(), '2026-10-15')
    expect(r.count).toBe(2)
    expect(r.byCurrency).toEqual({ USD: 50000, MDL: 60000 })
    expect(r.overdue.map((i: any) => i.number)).toEqual(['INV-2026-001'])
    expect(r.total).toBe(50000 * 17 + 60000) // in MDL at today's rate
  })

  it('hours billed and what an hour earned', () => {
    const h = hoursMoney(biz(), '2026-10-01', '2026-10-31', '2026-10-15')
    expect(h.hours).toBe(12)
    expect(h.earned).toBe(50000 * 17 + 60000)
    expect(h.perHour).toBe(Math.round((50000 * 17 + 60000) / 12))
  })

  it('business cash counts only business accounts', () => {
    const c = businessCash(biz())
    expect(c.byAccount.map((x: any) => x.account.id)).toEqual(['biz'])
    expect(c.total).toBe(10000 + 36000 + 18000 - 9000 - 5000)
  })

  it('USD and EUR use each record\'s own day rate; a record in that currency keeps its amount', () => {
    const s = biz()
    expect(valueIn(s, s.tx[0], 'USD')).toBe(2000) // 360 MDL / 18 on 5 Oct
    expect(valueIn(s, s.tx[2], 'USD')).toBe(100000) // already USD
    expect(valueIn(s, s.tx[0], 'EUR')).toBe(Math.round(36000 / 20))
    const usd = businessMonth(s, '2026-10', 'USD')
    expect(usd.income).toBe(2000 + 1000 + 100000)
    expect(usd.costs).toBe(500)
    // Without that day's saved rate, today's is used.
    s.rates.history = {}
    expect(valueIn(s, s.tx[0], 'USD')).toBe(Math.round(36000 / 17))
    const sum = businessSummary(s, '2026-10-15', 'EUR')
    expect(sum.currency).toBe('EUR')
    expect(sum.series).toHaveLength(6)
  })
})
