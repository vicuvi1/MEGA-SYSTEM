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
})
