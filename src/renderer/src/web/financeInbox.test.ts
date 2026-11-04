import { describe, expect, it } from 'vitest'
import { applyInbox, type InboxEntry } from './financeInbox'

const finance = () => ({
  settings: {
    currency: 'MDL',
    accounts: [
      { id: 'usd', name: 'Dollars', currency: 'USD' },
      { id: 'card', name: 'Card' },
      { id: 'wallet', name: 'Wallet' }
    ],
    categories: [
      { id: 'work', type: 'income', name: 'Work' },
      { id: 'other-in', type: 'income', name: 'Other income' },
      { id: 'food', type: 'expense', name: 'Food' },
      { id: 'transport', type: 'expense', name: 'Transport' },
      { id: 'other', type: 'expense', name: 'Other' }
    ]
  },
  tx: [{ id: 'a', type: 'expense', amount: 100, account: 'wallet', date: '2026-10-30', createdAt: 1 }],
  deleted: { 'tg-life-old': 5 } as Record<string, number>
})

const entry = (id: string, category = 'food'): InboxEntry => ({ id, amount: 4500, category, note: 'lunch', date: '2026-10-31', at: 10 })

describe('Telegram expenses into Finance Helper', () => {
  it('adds new ones once, on the account you last paid from, in Finance categories', () => {
    const { state, added } = applyInbox(finance(), [entry('tg-life-1'), entry('tg-life-2', 'transit')])
    expect(added).toBe(2)
    expect(state.tx.slice(1)).toMatchObject([
      { id: 'tg-life-1', type: 'expense', amount: 4500, base: 4500, currency: 'MDL', account: 'wallet', category: 'food', date: '2026-10-31', note: 'lunch' },
      { id: 'tg-life-2', category: 'transport' }
    ])
    expect(applyInbox(state, [entry('tg-life-1')]).added).toBe(0)
  })

  it("doesn't bring back one you deleted, and skips a locked or missing Finance", () => {
    expect(applyInbox(finance(), [entry('tg-life-old')]).added).toBe(0)
    expect(applyInbox(null, [entry('x')]).added).toBe(0)
  })

  it('"+500 salary" lands as income (Work), not as an expense', () => {
    const { state } = applyInbox(finance(), [{ ...entry('tg-life-3', 'income'), note: 'salary', type: 'income' }])
    expect(state.tx[1]).toMatchObject({ type: 'income', category: 'work', amount: 4500 })
  })
})

describe('deletes reach Finance Helper', () => {
  it('a removed expense leaves Finance Helper with a deletion marker and never comes back', async () => {
    const { applyInbox } = await import('./financeInbox')
    const state = { settings: { currency: 'MDL', accounts: [{ id: 'a', currency: 'MDL' }], categories: [{ id: 'food', type: 'expense' }] }, tx: [{ id: 'life-exp-7', type: 'expense', amount: 5000, date: '2026-11-04' }], deleted: {} }
    const r = applyInbox(state, [{ id: 'life-exp-7', amount: 5000, category: 'food', note: 'x', date: '2026-11-04', at: 1 }, { id: 'life-exp-7', amount: 0, category: '', note: '', date: '2026-11-04', at: 2, remove: true }], 99)
    expect(r.state.tx).toHaveLength(0)
    expect(r.state.deleted['life-exp-7']).toBe(99)
    expect(applyInbox(r.state, [{ id: 'life-exp-7', amount: 5000, category: 'food', note: 'x', date: '2026-11-04', at: 1 }]).added).toBe(0)
  })
})
