// Finance Helper's business and personal books (Money v2 phase 2): a record's
// book comes from its account unless it says otherwise, the views are
// read-only, Both = Personal + Business minus money between them, pay
// yourself is never counted twice, moves undo exactly, and the new fields
// survive the v3 sync. Made-up records only.
import { describe, expect, it } from 'vitest'
// @ts-ignore plain JS modules
import { bookOf, bookView, bookLens, bookTotals, booksOn, crossKind, moveToBook, undoMove, moveBatches, setAccountBook, stampBook, drawTx, readBook, saveBook, categoriesFor, FROM_BIZ } from '../../public/apps/finance/js/books.js'
// @ts-ignore
import { defaultState, normalizeState, accountBalances, monthSummary, report, account } from '../../public/apps/finance/js/model.js'
// @ts-ignore
import { mergeStates, toCloud } from '../../public/apps/finance/js/sync.js'
// @ts-ignore
import { save, saveSoon } from '../../public/apps/finance/js/store.js'
import { FINANCE } from './financeSync'

let n = 0
const tx = (over: any = {}) => ({ id: `t${++n}`, createdAt: n, updatedAt: n, type: 'expense', amount: 1000, currency: 'MDL', rate: 1, base: over.amount ?? 1000, date: '2026-10-05', category: 'food', account: 'wallet', ...over })

function books() {
  const s = defaultState()
  s.settings.accounts.push({ id: 'biz', name: 'Business bank', kind: 'business', currency: 'MDL', start: 0, book: 'business', holdings: [], updatedAt: 1 })
  s.settings.categories.push({ id: 'fees', type: 'expense', name: 'Work fees', jar: 'none', book: 'business' })
  s.people.push({ id: 'p-acme', name: 'Acme Studio', client: true, updatedAt: 1 })
  s.tx = [
    tx({ type: 'income', category: 'work', account: 'biz', amount: 50000, person: 'p-acme' }), // client pays the business
    tx({ category: 'fees', account: 'biz', amount: 4000 }), // business cost
    tx({ category: 'food', account: 'wallet', amount: 3000 }), // personal spending
    tx({ type: 'income', category: 'family', account: 'card', amount: 7000 }), // personal income
    tx({ type: 'transfer', from: 'biz', to: 'card', amount: 20000, base: 20000, category: undefined, account: undefined, draw: true }), // pay yourself
    tx({ type: 'transfer', from: 'card', to: 'biz', amount: 1500, base: 1500, category: undefined, account: undefined }), // money put in
    tx({ category: 'learning', account: 'card', amount: 900, book: 'business' }), // business tool paid with a personal card
    tx({ category: 'fun', account: 'biz', amount: 600, book: 'personal' }), // personal treat paid from the business account
    tx({ type: 'income', category: 'side', account: 'card', amount: 2500, book: 'business' }), // business income into a personal card
    tx({ type: 'transfer', from: 'wallet', to: 'safe', amount: 5000, base: 5000, category: undefined, account: undefined }), // personal transfer
    tx({ category: 'food', account: 'wallet', amount: 800, loan: true }), // a loan: never spending
  ]
  return s
}

const all = (s: any, b: string) => bookTotals(s, '2026-10-01', '2026-10-31', b)

describe('the book of a record', () => {
  it('no book field anywhere: books are off and the personal view equals both', () => {
    const s = defaultState()
    s.tx = [tx(), tx({ type: 'income', category: 'work', amount: 9000 }), tx({ type: 'transfer', from: 'wallet', to: 'safe', category: undefined })]
    expect(booksOn(s)).toBe(false)
    const v = bookView(s, 'personal')
    expect(v.tx).toEqual(s.tx)
    expect(monthSummary(v, '2026-10')).toEqual(monthSummary(s, '2026-10'))
    expect(report(v, '2026-10-01', '2026-10-31', { withPrev: false })).toEqual(report(s, '2026-10-01', '2026-10-31', { withPrev: false }))
    expect(bookView(s, 'business').tx).toEqual([])
    expect(bookView(s, 'both')).toBe(s)
  })

  it('comes from the account unless the record says otherwise', () => {
    const s = books()
    expect(booksOn(s)).toBe(true)
    expect(bookOf(s, s.tx[0])).toBe('business')
    expect(bookOf(s, s.tx[2])).toBe('personal')
    expect(bookOf(s, s.tx[6])).toBe('business')
    expect(bookOf(s, s.tx[7])).toBe('personal')
    expect(crossKind(s, s.tx[4])).toBe('draw')
    expect(crossKind(s, s.tx[5])).toBe('ownerIn')
    expect(crossKind(s, s.tx[6])).toBe('paidForBiz')
    expect(crossKind(s, s.tx[7])).toBe('personalFromBiz')
    expect(crossKind(s, s.tx[8])).toBe('bizIncomeToPersonal')
    expect(crossKind(s, s.tx[9])).toBe(null)
  })

  it('a new record takes the view, the category or the account; an edit keeps its book', () => {
    const s = books()
    expect(stampBook(s, { type: 'expense', account: 'wallet', category: 'food' }, null, 'both').book).toBeUndefined()
    expect(stampBook(s, { type: 'expense', account: 'wallet', category: 'fees' }, null, 'both').book).toBe('business')
    expect(stampBook(s, { type: 'expense', account: 'wallet', category: 'food' }, null, 'business').book).toBe('business')
    expect(stampBook(s, { type: 'expense', account: 'biz', category: 'food' }, null, 'business').book).toBeUndefined()
    const moved = { from: null, at: 5, batch: 'mv-x' }
    expect(stampBook(s, { type: 'expense', account: 'card' }, { book: 'business', moved }, 'personal')).toMatchObject({ book: 'business', moved })
  })

  it('offers each book its own categories and those for both', () => {
    const s = books()
    expect(categoriesFor(s, 'personal', 'expense').some((c: any) => c.id === 'fees')).toBe(false)
    expect(categoriesFor(s, 'business', 'expense').some((c: any) => c.id === 'fees')).toBe(true)
    expect(categoriesFor(s, 'business', 'expense').some((c: any) => c.id === 'food')).toBe(true)
  })
})

describe('totals per book', () => {
  it('personal and business each count their own money', () => {
    const s = books()
    const p = all(s, 'personal')
    const b = all(s, 'business')
    expect(b.extIncome).toBe(50000 + 2500)
    expect(b.spent).toBe(4000 + 900)
    expect(b.draws).toBe(20000 + 600)
    expect(b.ownerIn).toBe(1500)
    expect(p.extIncome).toBe(7000)
    expect(p.income).toBe(7000 + 20000 + 2500) // paid to you and business money landing on your card
    expect(p.spent).toBe(3000 + 600)
  })

  it('both = personal + business minus the money between them', () => {
    const s = books()
    const p = all(s, 'personal')
    const b = all(s, 'business')
    const both = all(s, 'both')
    expect(both.income).toBe(p.extIncome + b.extIncome)
    expect(both.income).toBe(p.income + b.income - p.draws)
    expect(both.spent).toBe(p.spent + b.spent)
    const sum = monthSummary(s, '2026-10')
    expect(both.income).toBe(sum.income)
    expect(both.spent).toBe(sum.expense)
  })

  it('pay yourself is income in Personal, "paid to you" in Business, and nothing in Both', () => {
    const s = defaultState()
    s.settings.accounts.push({ id: 'biz', name: 'Biz', kind: 'business', currency: 'MDL', start: 0, book: 'business', holdings: [] })
    s.tx = [tx({ type: 'income', category: 'work', account: 'biz', amount: 30000 })]
    const d = drawTx(s, { from: 'biz', to: 'card', amount: 10000, date: '2026-10-10', now: 99 })
    expect(d).toMatchObject({ type: 'transfer', draw: true, from: 'biz', to: 'card' })
    s.tx.push(d)
    const p = all(s, 'personal')
    const b = all(s, 'business')
    const both = all(s, 'both')
    expect(p.income).toBe(10000)
    expect(p.extIncome).toBe(0)
    expect(b.spent).toBe(0) // never a cost
    expect(b.draws).toBe(10000)
    expect(both.income).toBe(30000) // the client money once
    expect(both.spent).toBe(0)
    const pv = bookView(s, 'personal')
    expect(pv.tx.find((t: any) => t.of === d.id)).toMatchObject({ type: 'income', category: FROM_BIZ, synthetic: true, id: d.id })
    expect(pv.settings.categories.some((c: any) => c.id === FROM_BIZ)).toBe(true)
    // A draw needs a business account and a personal one.
    expect(drawTx(s, { from: 'card', to: 'wallet', amount: 100, date: '2026-10-10' })).toBeNull()
  })

  it("each account's balance is the same in its own book and in Both (random states)", () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const pick = (a: any[]) => a[Math.floor(rnd() * a.length)]
    for (let round = 0; round < 40; round++) {
      const s = books()
      s.settings.accounts.push({ id: 'biz2', name: 'Biz card', kind: 'card', currency: 'MDL', start: 500, book: 'business', holdings: [] })
      const accs = s.settings.accounts.map((a: any) => a.id)
      s.tx = []
      for (let i = 0; i < 30; i++) {
        const type = pick(['income', 'expense', 'transfer'])
        const amount = 100 + Math.floor(rnd() * 5000)
        const book = pick([undefined, undefined, 'personal', 'business'])
        if (type === 'transfer') {
          const from = pick(accs)
          const to = pick(accs.filter((a: string) => a !== from))
          s.tx.push(tx({ type, from, to, amount, base: amount, category: undefined, account: undefined }))
        } else s.tx.push(tx({ type, amount, base: amount, account: pick(accs), category: type === 'income' ? 'work' : 'food', ...(book ? { book } : {}), ...(rnd() < 0.1 ? { loan: true } : {}) }))
      }
      const both = accountBalances(s)
      for (const book of ['personal', 'business']) {
        const v = bookView(s, book)
        const bal = accountBalances(v)
        for (const a of v.settings.accounts) expect(bal[a.id]).toBe(both[a.id])
      }
      const p = all(s, 'personal')
      const b = all(s, 'business')
      const bo = all(s, 'both')
      expect(bo.income).toBe(p.extIncome + b.extIncome)
      expect(bo.spent).toBe(p.spent + b.spent)
    }
  })

  it('the views are read-only: never saved, and a lens cannot replace the lists', () => {
    const s = books()
    const v = bookView(s, 'business')
    expect(Object.isFrozen(v)).toBe(true)
    expect(JSON.stringify(v)).not.toContain('_view')
    const mem = new Map<string, string>()
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, x: string) => void mem.set(k, x), removeItem: (k: string) => void mem.delete(k) }
    expect(save(v, storage)).toBe(false)
    expect(saveSoon(v, storage)).toBe(false)
    expect(mem.size).toBe(0)
    const lens: any = bookLens(s, 'personal')
    const count = s.tx.length
    lens.tx = []
    lens.settings.accounts = []
    lens.settings.logView = 'sheet'
    lens.meta.seen = 1
    expect(s.tx.length).toBe(count)
    expect(s.settings.accounts.length).toBe(4)
    expect(s.settings.logView).toBe('sheet')
    expect(s.meta.seen).toBe(1)
    expect(save(lens, storage)).toBe(false)
    // An account of the other book still has a name in a view.
    expect(account(v, 'card')?.name).toBe('Card')
    // A business tool paid with a personal card is money leaving that card in Personal, to "Business".
    const pv = bookView(s, 'personal')
    const paid = pv.tx.find((t: any) => t.of === s.tx[6].id)
    expect(paid).toMatchObject({ type: 'transfer', from: 'card', synthetic: true, cross: 'paidForBiz' })
    expect(account(pv, paid.to)?.name).toBe('Business')
    expect(paid.note).toMatch(/^Paid for business/)
  })
})

describe('moving between books', () => {
  it('moves records and undoes the move exactly', () => {
    const s = books()
    const before = JSON.parse(JSON.stringify(s.tx))
    const ids = [s.tx[2].id, s.tx[6].id, s.tx[4].id]
    const r = moveToBook(s, ids, 'business', 1000)
    expect(r.moved).toBe(1) // tx[6] is already business; the transfer follows its accounts
    expect(s.tx[2]).toMatchObject({ book: 'business', moved: { from: null, at: 1000, batch: r.batch }, updatedAt: 1000 })
    expect(moveBatches(s)).toEqual([{ batch: r.batch, at: 1000, count: 1, to: 'business' }])
    const r2 = moveToBook(s, [s.tx[0].id, s.tx[7].id], 'personal', 2000)
    expect(r2.moved).toBe(1)
    expect(s.tx[0].book).toBe('personal')
    expect(s.tx[7].book).toBe('personal') // already personal: untouched
    expect(undoMove(s, r2.batch, 3000)).toEqual({ restored: 1, keptEdited: 0 })
    expect(undoMove(s, r.batch, 3001)).toEqual({ restored: 1, keptEdited: 0 })
    const strip = (l: any[]) => l.map(({ updatedAt, ...t }) => t)
    expect(strip(s.tx)).toEqual(strip(before))
  })

  it('moving back to the account\'s own book clears the field; an edit after the move is kept', () => {
    const s = books()
    const t = s.tx[6] // business tool on a personal card
    const r = moveToBook(s, [t.id], 'personal', 1000)
    expect(t.book).toBeUndefined()
    expect(t.moved.from).toBe('business')
    t.note = 'edited'
    t.updatedAt = 1500
    expect(undoMove(s, r.batch, 2000)).toEqual({ restored: 0, keptEdited: 1 })
    expect(t.book).toBeUndefined()
  })

  it('marking an account Business moves its records with it and turns books on; Personal undoes it', () => {
    const s = defaultState()
    s.tx = [tx({ account: 'card' }), tx({ account: 'card', book: 'personal' }), tx({ account: 'wallet' })]
    expect(booksOn(s)).toBe(false)
    const r = setAccountBook(s, 'card', 'business', 500)
    expect(r).toEqual({ before: 'personal', records: 1 })
    expect(booksOn(s)).toBe(true)
    expect(s.settings.books.on).toBe(true)
    expect(bookOf(s, s.tx[0])).toBe('business')
    expect(bookOf(s, s.tx[1])).toBe('personal')
    setAccountBook(s, 'card', 'personal', 600)
    expect(s.settings.accounts.find((a: any) => a.id === 'card').book).toBeUndefined()
    expect(bookOf(s, s.tx[0])).toBe('personal')
  })

  it('remembers the view on this device; a broken store falls back', () => {
    const mem = new Map<string, string>()
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
    const s = defaultState()
    expect(readBook(s, store)).toBe('both')
    s.settings.accounts[0].book = 'business'
    expect(readBook(s, store)).toBe('personal')
    saveBook('business', store)
    expect(readBook(s, store)).toBe('business')
    saveBook('nonsense', store)
    expect(readBook(s, store)).toBe('business')
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(readBook(s, broken)).toBe('personal')
    expect(() => saveBook('both', broken)).not.toThrow()
  })
})

describe('the book fields survive the v3 sync', () => {
  const fields = () => {
    const s = books()
    s.settings.accounts[0].moved = { from: 'personal', at: 3 }
    s.settings.categories.find((c: any) => c.id === 'fees').budgetBiz = 120000
    s.settings.books = { on: true, updatedAt: 5 }
    moveToBook(s, [s.tx[2].id], 'business', 50)
    s.settings.updatedAt = 10
    return s
  }

  it('round-trips through toCloud, normalizeState and mergeStates without loss', () => {
    const s = fields()
    const cloud = JSON.parse(JSON.stringify(toCloud(s, 'dev-a', 100)))
    const back = normalizeState({ ...cloud.data, version: cloud.schema })
    expect(back.settings.books).toEqual({ on: true, updatedAt: 5 })
    expect(back.settings.accounts.find((a: any) => a.id === 'biz').book).toBe('business')
    expect(back.settings.accounts[0].moved).toEqual({ from: 'personal', at: 3 })
    expect(back.settings.categories.find((c: any) => c.id === 'fees')).toMatchObject({ book: 'business', budgetBiz: 120000 })
    for (const t of s.tx) {
      const b = back.tx.find((x: any) => x.id === t.id)
      expect(b.book).toEqual(t.book)
      expect(b.moved).toEqual(t.moved)
      expect(b.draw).toEqual(t.draw)
    }
    // A device that never saw books merges in the copy that has them.
    const old = normalizeState(JSON.parse(JSON.stringify({ ...toCloud(defaultState(), 'dev-b', 1).data, version: 3 })))
    const merged = mergeStates(old, cloud).state
    expect(merged.settings.books).toEqual({ on: true, updatedAt: 5 })
    expect(merged.tx.find((t: any) => t.id === s.tx[2].id)).toMatchObject({ book: 'business', moved: { at: 50 } })
    expect(merged.settings.accounts.find((a: any) => a.id === 'biz').book).toBe('business')
    // ...and the other way round.
    const merged2 = mergeStates(s, toCloud(old, 'dev-b', 2)).state
    expect(merged2.tx.find((t: any) => t.id === s.tx[2].id).book).toBe('business')
    expect(merged2.settings.books.on).toBe(true)
  })

  it("Life's sync (share, fromShared, merge) keeps them too", () => {
    const s = fields()
    const shared = JSON.parse(JSON.stringify(FINANCE.share!(s)))
    const back = FINANCE.fromShared!(shared)
    expect(back.settings.books.on).toBe(true)
    expect(back.tx.find((t: any) => t.id === s.tx[2].id).moved.batch).toMatch(/^mv-/)
    const mine = defaultState()
    const merged = FINANCE.merge(mine, shared, false)
    expect(merged.tx.find((t: any) => t.draw)).toBeTruthy()
    expect(merged.settings.accounts.find((a: any) => a.id === 'biz').book).toBe('business')
    // A later move on one device wins over the older copy.
    const later = JSON.parse(JSON.stringify(s))
    undoMove(later, later.tx[2].moved.batch, 900)
    const m2 = FINANCE.merge(s, FINANCE.share!(later), false)
    expect(m2.tx.find((t: any) => t.id === s.tx[2].id).book).toBeUndefined()
  })
})

describe("Life's Money page follows the switch", () => {
  it('shows one book, the business card in Business, and Both = today', async () => {
    const { hubView } = await import('./moneyHub')
    const s = books()
    for (const t of s.tx) t.date = '2026-10-15'
    const today = '2026-10-15'
    const both = hubView(s, today, 'both')!
    const p = hubView(s, today, 'personal')!
    const b = hubView(s, today, 'business')!
    expect(both.book).toBe('both')
    expect(p.business).toBeNull()
    expect(b.business).toMatchObject({ currency: 'MDL', income: 52500, costs: 4900, profit: 47600, draws: 20600, hasBusiness: true })
    // Spending of the day in each book adds up to Both.
    const day = (v: any) => v.week.find((d: any) => d.day === today)?.spent ?? 0
    expect(day(p) + day(b)).toBe(day(both))
    expect(day(both)).toBeGreaterThan(0)
    // No pick: Personal once books are on (Ben, nudges); a USD report converts.
    expect(hubView(s, today)!.book).toBe('personal')
    expect(hubView(defaultState(), today)!.book).toBe('both')
    s.rates = { usd: { MDL: 20 }, crypto: {}, history: {}, fetchedAt: 1 }
    expect(hubView(s, today, 'business', 'USD')!.business!.costs).toBe(Math.round(4900 / 20))
  })
})
