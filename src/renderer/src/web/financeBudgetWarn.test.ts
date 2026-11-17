// Money budget warnings (#8): 80% and 100% of a category's budget, once each per category per
// month, through the 4-a-day push budget. Made-up data; the clock is pinned.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-ignore plain JS modules from the embedded app
import * as M from '../../public/apps/finance/js/model.js'
// @ts-ignore
import { budgetCrossings, newWarnings, warningsOn, thisMonthKeys } from '../../public/apps/finance/js/budgetwarn.js'
import { checkBudgetWarnings, SENT_KEY } from '../money/budgetWarnRunner'
import { budgetNoticeText, budgetNotices, alreadyInBell } from '@core/budgetNotice'
import { budgetCheck, slotOfId, slotText, dueSlot, type PushSlot } from '@core/notifyBudget'

let n = 0
const sp = (x: string) => x.replace(/[\u00a0\u202f]/g, ' ')
const tx = (amount: number, over: any = {}) => ({ id: `t${++n}`, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-11-05', account: 'card', category: 'food', note: '', createdAt: 1, updatedAt: 1, ...over })
const money = (list: any[], budget = 200000, settings: any = {}) => {
  const s = M.normalizeState({ settings: { currency: 'MDL', accounts: [{ id: 'card', name: 'Card', kind: 'card', currency: 'MDL', start: 0 }], ...settings }, tx: list })
  const food = s.settings.categories.find((c: any) => c.id === 'food')
  food.budget = budget
  food.name = 'Food'
  return s
}

const memStore = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), m }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T12:00:00'))
})
afterEach(() => vi.useRealTimers())

describe('crossing 80% and 100% (Finance numbers)', () => {
  it('finds the level reached; under 80% is nothing', () => {
    expect(budgetCrossings(money([tx(150000)]), '2026-11-17')).toEqual([])
    expect(budgetCrossings(money([tx(160000)]), '2026-11-17')).toMatchObject([{ month: '2026-11', cat: 'food', name: 'Food', level: 80, pct: 80, spent: 160000, budget: 200000 }])
    expect(budgetCrossings(money([tx(200000)]), '2026-11-17')[0].level).toBe(100)
    // Last month's spending and refunds count like everywhere else.
    expect(budgetCrossings(money([tx(190000, { date: '2026-10-20' })]), '2026-11-17')).toEqual([])
    expect(budgetCrossings(money([tx(170000), { ...tx(20000), type: 'income', refund: true }]), '2026-11-17')).toEqual([])
  })

  it('80% then 100% fire once each; a jump past both sends only 100%; next month starts over', () => {
    let sent: string[] = []
    const step = (s: any, day: string) => { const r = newWarnings(budgetCrossings(s, day), thisMonthKeys(sent, day.slice(0, 7))); sent = r.keys; return r.warn.map((w: any) => w.level) }
    expect(step(money([tx(170000)]), '2026-11-17')).toEqual([80])
    expect(step(money([tx(180000)]), '2026-11-18')).toEqual([])
    expect(step(money([tx(210000)]), '2026-11-19')).toEqual([100])
    expect(step(money([tx(260000)]), '2026-11-20')).toEqual([])
    // A new month with spending already past 100% at once: one warning, the 100% one.
    expect(step(money([tx(250000, { date: '2026-12-02' })]), '2026-12-02')).toEqual([100])
    expect(step(money([tx(250000, { date: '2026-12-02' })]), '2026-12-03')).toEqual([])
  })

  it('switch: on by default, off with settings.budgetWarn = false', () => {
    expect(warningsOn(money([]))).toBe(true)
    expect(warningsOn(money([], 1, { budgetWarn: false }))).toBe(false)
  })
})

describe('the notification', () => {
  const c = { month: '2026-11', cat: 'food', name: 'Food', level: 80 as const, pct: 80, spent: 160000, budget: 200000 }
  it('says the percentage and the amounts, or the percentage only when amounts are hidden', () => {
    expect(sp(budgetNoticeText(c, 'MDL', false))).toBe("Food: 80% of this month's budget used (1 600 of 2 000 MDL)")
    expect(budgetNoticeText(c, 'MDL', true)).toBe("Food: 80% of this month's budget used")
    expect(budgetNoticeText({ ...c, level: 100, pct: 112, spent: 224000 }, 'MDL', true)).toBe("Food: 112% of this month's budget used")
  })

  it('uses the budgetwarn slot of the 4-a-day budget and is not added twice in a month', () => {
    const [n1] = budgetNotices([c], { day: '2026-11-17', now: new Date(), currency: 'MDL', hideAmounts: false, bellIds: [] })
    expect(n1.id).toBe('budget:budgetwarn:2026-11-17:food:80')
    expect(slotOfId(n1.id)).toBe('budgetwarn')
    expect(n1.action).toEqual({ kind: 'page', page: 'money', label: 'Open Money' })
    expect(alreadyInBell([n1.id], '2026-11', 'food', 80)).toBe(true)
    expect(alreadyInBell([n1.id], '2026-11', 'food', 100)).toBe(false)
    expect(alreadyInBell([n1.id], '2026-12', 'food', 80)).toBe(false)
    expect(budgetNotices([c], { day: '2026-11-20', now: new Date(), currency: 'MDL', hideAmounts: false, bellIds: [n1.id] })).toEqual([])
  })

  it("slot 'budgetwarn': once a day, inside the 4 a day, no fixed time", () => {
    const day = '2026-11-17'
    const first = budgetCheck(null, 'budgetwarn', day)
    expect(first.ok).toBe(true)
    expect(budgetCheck(first.next, 'budgetwarn', day).ok).toBe(false)
    const full = { day, sent: ['morning', 'plan', 'winddown', 'salary'] as PushSlot[] }
    expect(budgetCheck(full, 'budgetwarn', day).ok).toBe(false)
    for (let m = 0; m < 1440; m += 15) expect(dueSlot(m, 0)).not.toBe('budgetwarn')
    expect(slotText('budgetwarn', { mustDone: 0, mustTotal: 0 })).toMatch(/budget/)
  })
})

describe('the app-side check (pinned clock)', () => {
  const run = async (store: ReturnType<typeof memStore>, bell: string[]) => {
    const added: any[] = []
    const out = await checkBudgetWarnings({ store, add: async (x) => { added.push(x); bell.push(x.id) }, bellIds: async () => [...bell], now: new Date() })
    return { out, added }
  }

  it('fires once at 80% and once at 100% per category per month; nothing lost from Money', async () => {
    const store = memStore()
    const bell: string[] = []
    const s = money([tx(170000)])
    const before = JSON.stringify(s)
    store.setItem('finance-helper.state', before)
    expect((await run(store, bell)).added.map((x) => sp(x.title))).toEqual(["Food: 85% of this month's budget used (1 700 of 2 000 MDL)"])
    expect((await run(store, bell)).added).toEqual([])
    expect(store.getItem('finance-helper.state')).toBe(before) // read only
    s.tx.push(tx(40000))
    store.setItem('finance-helper.state', JSON.stringify(s))
    const second = await run(store, bell)
    expect(second.added.map((x) => x.id)).toEqual(['budget:budgetwarn:2026-11-17:food:100'])
    expect((await run(store, bell)).added).toEqual([])
    expect(JSON.parse(store.getItem(SENT_KEY)!).keys.sort()).toEqual(['2026-11:food:100', '2026-11:food:80'])
  })

  it('another device already warned this month: not again (its bell entry synced here)', async () => {
    const store = memStore()
    store.setItem('finance-helper.state', JSON.stringify(money([tx(170000)])))
    const { added } = await run(store, ['budget:budgetwarn:2026-11-03:food:80'])
    expect(added).toEqual([])
  })

  it('hidden amounts: percentage only; switched off or locked Money: nothing', async () => {
    const hidden = memStore()
    hidden.setItem('finance-helper.state', JSON.stringify(money([tx(170000)], 200000, { hideAmounts: true })))
    expect((await run(hidden, [])).added[0].title).toBe("Food: 85% of this month's budget used")
    const off = memStore()
    off.setItem('finance-helper.state', JSON.stringify(money([tx(250000)], 200000, { budgetWarn: false })))
    expect((await run(off, [])).added).toEqual([])
    const locked = memStore() // encrypted Money keeps no plain copy
    locked.setItem('finance-helper.enc', '{"v":1}')
    expect((await run(locked, [])).added).toEqual([])
  })
})
