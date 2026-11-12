// Money phase 5, "less typing", on made-up data: To sort (captures), one tap
// files and teaches, the next one is filed by itself and can be undone,
// recurring bills wait for a tap, honest points, and the Telegram path.
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { BrowserDb } from './browserDb'
import { financeState, logMoney, moneyButton } from './financeBot'
import { autoFile, confirmAuto, confirmBill, dismissItem, dismissTests, fileItem, readToSort, skipBill, sortView, undoAuto, undoSort, saveRule, deleteRule, rulesOf, SortError, type ToSortList } from './moneySortCore'
import { paysLogged } from './moneySort'
import { countsAsLogged, logMoment } from '@core/moneyDays'
import { keepToSort, mergeToSort } from '@core/moneyToSort'
import { typedBani } from '@core/moneyText'
// @ts-ignore plain JS modules from the embedded app
import { normalizeState } from '../../public/apps/finance/js/model.js'
// @ts-ignore
import { addRule2 } from '../../public/apps/finance/js/learn.js'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})

const TODAY = '2026-11-12'
const NOW = Date.parse(`${TODAY}T12:00:00Z`)
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const accounts = [
  { id: 'wallet', name: 'Wallet', kind: 'cash', currency: 'MDL', updatedAt: 1 },
  { id: 'maib', name: 'Maib card', kind: 'card', currency: 'MDL', updatedAt: 1 }
]
let n = 0
const rec = (note: string, category: string, extra: Record<string, unknown> = {}) => ({ id: `r${++n}`, type: 'expense', amount: 5000, currency: 'MDL', rate: 1, base: 5000, date: '2026-11-01', category, account: 'wallet', note, createdAt: 1, updatedAt: 1, ...extra })
const finance = (tx: any[] = [], extra: Record<string, unknown> = {}) => normalizeState({ settings: { currency: 'MDL', updatedAt: 1, accounts }, tx, people: [], deleted: {}, ...extra })
const cap = (id: string, merchant: string, extra: Record<string, unknown> = {}) => ({ id, at: NOW - 3600_000, source: 'maib', amount: 14500, currency: 'MDL', merchant, kind: 'debit', state: 'new', updatedAt: 1, ...extra })
const list = (...items: any[]): ToSortList => ({ items })

describe('To sort', () => {
  it("reads Phone payments' list and shows only what waits (no second copies, declined, tests or sorted)", () => {
    expect(readToSort(JSON.stringify({ items: [cap('a', 'X')] }))).toMatchObject({ items: [{ id: 'a' }] })
    expect(readToSort('not json').items).toEqual([])
    const st = finance([rec('Bus', 'transport'), rec('Linella', 'food')])
    const v = sortView(st, list(cap('a', 'GLOVO*KITCHEN 23'), cap('b', 'GLOVO KITCHEN', { dupOf: 'a' }), cap('c', 'OTP', { kind: 'ignore', state: 'dismissed', reason: 'a code' }), cap('d', 'Done', { state: 'sorted', txId: 'cap-d' }), cap('t', 'TEST SHOP', { test: true })), TODAY, dayOf, NOW)
    expect(v.pending.map((p) => p.id)).toEqual(['a'])
    expect(v.pending[0].needsAmount).toBe(false)
    expect(v.pending[0]).toMatchObject({ amount: 14500, currency: 'MDL', merchant: 'GLOVO*KITCHEN 23', source: 'maib', date: TODAY })
    expect(v.pending[0].chips.length).toBeGreaterThanOrEqual(2)
    expect(v.pending[0].chips.length).toBeLessThanOrEqual(3)
  })

  it('one tap files it (cap-<id>, confirmed now, your choice) and teaches the rule; the next one files itself', () => {
    const st = finance([rec('Bus', 'transport')])
    const l = list(cap('a', 'GLOVO*KITCHEN 23'), cap('b', 'Glovo Kitchen 7', { at: NOW - 60_000 }))
    const { tx, undo } = fileItem(st, l, 'a', 'food', NOW, dayOf)
    expect(tx).toMatchObject({ id: 'cap-a', type: 'expense', amount: 14500, base: 14500, rate: 1, category: 'food', account: 'wallet', source: 'capture', catBy: 'you', confirmedAt: NOW, date: TODAY })
    expect(st.settings.rules).toEqual([expect.objectContaining({ match: 'glovo', category: 'food', learned: true })])
    expect(l.items[0]).toMatchObject({ state: 'sorted', txId: 'cap-a' })
    expect(undo.rule?.before).toBeNull()
    // The next GLOVO is sure now: filed by itself, marked auto, not confirmed.
    const made = autoFile(st, l, NOW + 1000, dayOf)
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ id: 'cap-b', category: 'food', catBy: 'auto', source: 'capture' })
    expect(made[0].confirmedAt).toBeUndefined()
    const v = sortView(st, l, TODAY, dayOf, NOW)
    expect(v.pending).toHaveLength(0)
    expect(v.auto).toMatchObject([{ id: 'b', txId: 'cap-b', category: { id: 'food' } }])
  })

  it('Undo of a tap takes the record out (deletion marker), puts the rule back and the item back in To sort', () => {
    const st = finance([])
    addRule2(st, { match: 'glovo', type: 'expense', category: 'fun' }, 5)
    const l = list(cap('a', 'Glovo'))
    const { undo } = fileItem(st, l, 'a', 'food', NOW, dayOf)
    expect(st.settings.rules[0].category).toBe('food')
    undoSort(st, l, undo, NOW + 10)
    expect(st.tx.some((t: any) => t.id === 'cap-a')).toBe(false)
    expect(st.deleted['cap-a']).toBe(NOW + 10)
    expect(st.settings.rules[0]).toMatchObject({ category: 'fun' })
    expect(sortView(st, l, TODAY, dayOf, NOW).pending.map((p) => p.id)).toEqual(['a'])
    // Filed again: a fresh id (the old one stays deleted).
    expect(fileItem(st, l, 'a', 'food', NOW + 20, dayOf).tx.id).toBe('cap-a-2')
  })

  it('Undo of one filed by itself: back in To sort, and it never files itself again; Undo of that brings it back', () => {
    const st = finance([])
    addRule2(st, { match: 'bolt', type: 'expense', category: 'transport' }, 5)
    const l = list(cap('a', 'BOLT.EU 12'))
    expect(autoFile(st, l, NOW, dayOf)).toHaveLength(1)
    const u = undoAuto(st, l, 'a', NOW + 1)
    expect(st.tx).toHaveLength(0)
    expect(sortView(st, l, TODAY, dayOf, NOW).pending.map((p) => p.id)).toEqual(['a'])
    expect(autoFile(st, l, NOW + 2, dayOf)).toHaveLength(0)
    undoSort(st, l, u, NOW + 3)
    expect(st.tx).toMatchObject([{ id: 'cap-a-2', catBy: 'auto' }])
    expect(sortView(st, l, TODAY, dayOf, NOW).auto.map((a) => a.id)).toEqual(['a'])
  })

  it('OK confirms one filed by itself; a different category also teaches; both undo exactly', () => {
    const st = finance([])
    addRule2(st, { match: 'bolt', type: 'expense', category: 'transport' }, 5)
    const l = list(cap('a', 'Bolt'), cap('b', 'Bolt food'))
    autoFile(st, l, NOW, dayOf)
    const ok = confirmAuto(st, l, 'a', NOW + 5)
    expect(ok.tx).toMatchObject({ catBy: 'you', confirmedAt: NOW + 5, category: 'transport' })
    undoSort(st, l, ok.undo, NOW + 6)
    const t = st.tx.find((x: any) => x.id === 'cap-a')
    expect(t.catBy).toBe('auto')
    expect(t.confirmedAt).toBeUndefined()
    const ch = confirmAuto(st, l, 'a', NOW + 7, 'fun')
    expect(ch.tx.category).toBe('fun')
    expect(st.settings.rules.find((r: any) => r.match === 'bolt').category).toBe('fun')
    undoSort(st, l, ch.undo, NOW + 8)
    expect(st.settings.rules.find((r: any) => r.match === 'bolt').category).toBe('transport')
    expect(st.tx.find((x: any) => x.id === 'cap-a').category).toBe('transport')
  })

  it('"Not mine" dismisses (raw text cleared); Undo puts it back without moving the state backwards; nothing is booked', () => {
    const st = finance([])
    const l = list(cap('a', 'Shop', { raw: 'Plata 145 MDL Shop' }))
    const u = dismissItem(st, l, 'a', NOW)
    expect(l.items[0]).toMatchObject({ state: 'dismissed' })
    expect(l.items[0].raw).toBeUndefined()
    expect(sortView(st, l, TODAY, dayOf, NOW).pending).toHaveLength(0)
    undoSort(st, l, u, NOW + 1)
    expect(l.items[0]).toMatchObject({ state: 'dismissed', reopen: true })
    expect(sortView(st, l, TODAY, dayOf, NOW).pending.map((p) => p.id)).toEqual(['a'])
    // Merged with an older copy (still 'new'), it stays dismissed + reopen; dismissing it again sticks.
    const merged = mergeToSort(list(cap('a', 'Shop')), l)
    expect(merged.items[0]).toMatchObject({ state: 'dismissed', reopen: true })
    dismissItem(st, l, 'a', NOW + 2)
    expect(sortView(st, l, TODAY, dayOf, NOW).pending).toHaveLength(0)
    expect(st.tx).toHaveLength(0)
  })

  it('an item put back by Undo is never cleaned up (keepToSort), even 40 days later', () => {
    const st = finance([])
    const l = list(cap('a', 'Shop'))
    const { undo } = fileItem(st, l, 'a', 'food', NOW, dayOf)
    undoSort(st, l, undo, NOW + 1)
    expect(keepToSort(l, st, NOW + 40 * 86400_000).items.map((x) => x.id)).toEqual(['a'])
  })

  it('an unreadable payment asks for the amount; it never files itself; the typed amount is used', () => {
    const st = finance([])
    addRule2(st, { match: 'shop', type: 'expense', category: 'food' }, 5)
    const l = list(cap('u', 'Shop', { kind: 'ignore', amount: 0, currency: '', reason: 'could not read the amount', raw: 'Shop ??? MDL' }))
    const v = sortView(st, l, TODAY, dayOf, NOW)
    expect(v.pending).toMatchObject([{ id: 'u', needsAmount: true, amount: 0, raw: 'Shop ??? MDL', currency: 'MDL' }])
    expect(autoFile(st, l, NOW, dayOf)).toHaveLength(0)
    expect(() => fileItem(st, l, 'u', 'food', NOW, dayOf)).toThrow('Type the amount')
    expect(typedBani('12,50')).toBe(1250)
    expect(typedBani('abc')).toBe(0)
    const { tx } = fileItem(st, l, 'u', 'food', NOW, dayOf, { amount: typedBani('12,50') })
    expect(tx).toMatchObject({ id: 'cap-u', amount: 1250, currency: 'MDL', base: 1250, confirmedAt: NOW })
    expect(l.items[0].raw).toBeUndefined()
  })

  it('"Send test" payments are dismissed, never filed; the day of the payment is its own `day`', () => {
    const st = finance([])
    addRule2(st, { match: 'test shop', type: 'expense', category: 'food' }, 5)
    const l = list(cap('t', 'TEST SHOP', { test: true }), cap('a', 'Kiosk', { day: '2026-11-11' }))
    expect(dismissTests(l, NOW)).toBe(1)
    expect(l.items[0].state).toBe('dismissed')
    expect(autoFile(st, l, NOW, dayOf)).toHaveLength(0)
    expect(fileItem(st, l, 'a', 'food', NOW, dayOf).tx.date).toBe('2026-11-11')
  })

  it('a refund is money back (income) and the merchant is still learned', () => {
    const st = finance([])
    const l = list(cap('r', 'Linella', { kind: 'refund' }))
    expect(sortView(st, l, TODAY, dayOf, NOW).pending[0].type).toBe('income')
    expect(fileItem(st, l, 'r', 'other-in', NOW, dayOf).tx).toMatchObject({ type: 'income' })
  })

  it('another currency is never counted 1:1: no rate, no record', () => {
    const st = finance([], { settings: { currency: 'MDL', updatedAt: 1, accounts: [...accounts, { id: 'usd', name: 'USD card', currency: 'USD', updatedAt: 1 }] } })
    const l = list(cap('a', 'Figma', { currency: 'USD', amount: 1500 }))
    expect(() => fileItem(st, l, 'a', 'subscriptions', NOW, dayOf)).toThrow(SortError)
    expect(st.tx).toHaveLength(0)
    st.rates = { usd: { USD: 1, MDL: 17.6 }, crypto: {}, history: {}, fetchedAt: NOW }
    expect(fileItem(st, l, 'a', 'subscriptions', NOW, dayOf).tx).toMatchObject({ currency: 'USD', account: 'usd', amount: 1500, base: 26400 })
  })
})

describe('recurring bills due → one tap', () => {
  const rule = (extra: Record<string, unknown> = {}) => ({ id: 'net', type: 'expense', amount: 15000, currency: 'MDL', note: 'Internet', category: 'home', account: 'maib', every: 'month', start: '2026-09-05', lastDone: '2026-10-05', auto: false, paused: false, updatedAt: 1, ...extra })

  it('a due bill waits (never booked by itself); bills that log themselves are not asked', () => {
    const st = finance([], { recurring: [rule(), rule({ id: 'gym', note: 'Gym', auto: true }), rule({ id: 'pay', type: 'income', note: 'Salary' })] })
    const v = sortView(st, list(), TODAY, dayOf, NOW)
    expect(v.bills).toMatchObject([{ ruleId: 'net', date: '2026-11-05', amount: 15000, note: 'Internet', more: 0 }])
    expect(st.tx).toHaveLength(0)
  })

  it('Paid books rec-<rule>-<date> (confirmed now, source auto), marks it done; Undo restores both', () => {
    const st = finance([], { recurring: [rule({ lastDone: '2026-09-05' })] })
    expect(sortView(st, list(), TODAY, dayOf, NOW).bills[0]).toMatchObject({ date: '2026-10-05', more: 1 })
    const { tx, undo } = confirmBill(st, 'net', '2026-10-05', NOW)
    expect(tx).toMatchObject({ id: 'rec-net-2026-10-05', amount: 15000, date: '2026-10-05', category: 'home', account: 'maib', recurring: 'net', source: 'auto', confirmedAt: NOW })
    expect(st.recurring[0].lastDone).toBe('2026-10-05')
    expect(() => confirmBill(st, 'net', '2026-10-05', NOW)).toThrow('Already booked')
    undoSort(st, list(), undo, NOW + 1)
    expect(st.tx).toHaveLength(0)
    expect(st.recurring[0].lastDone).toBe('2026-09-05')
    // Booked again after the undo: a fresh id, never a second copy.
    expect(confirmBill(st, 'net', '2026-10-05', NOW + 2).tx.id).toBe('rec-net-2026-10-05-2')
  })

  it("Didn't happen marks the date done without a record; Undo brings it back", () => {
    const st = finance([], { recurring: [rule()] })
    const u = skipBill(st, 'net', '2026-11-05', NOW)
    expect(sortView(st, list(), TODAY, dayOf, NOW).bills).toHaveLength(0)
    expect(st.tx).toHaveLength(0)
    undoSort(st, list(), u, NOW + 1)
    expect(sortView(st, list(), TODAY, dayOf, NOW).bills).toHaveLength(1)
  })
})

describe('honest points: captured and auto-logged count only by your tap that day', () => {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  it('logMoment / countsAsLogged', () => {
    expect(logMoment({ createdAt: 5 })).toEqual({ at: 5, imported: false })
    expect(logMoment({ createdAt: 5, source: 'capture' })).toEqual({ at: 0, imported: true })
    expect(logMoment({ createdAt: 5, source: 'capture', confirmedAt: 9 })).toEqual({ at: 9, imported: false })
    expect(countsAsLogged({ date: TODAY, source: 'capture', createdAt: NOW, confirmedAt: NOW }, day)).toBe(true)
    expect(countsAsLogged({ date: TODAY, source: 'capture', createdAt: NOW }, day)).toBe(false)
    expect(countsAsLogged({ date: TODAY, source: 'auto', createdAt: NOW, confirmedAt: NOW + 2 * 86400_000 }, day)).toBe(false)
  })
  it('paysLogged: auto-filed pays nothing, a same-day tap does, other records as before', () => {
    const st = finance([])
    addRule2(st, { match: 'bolt', type: 'expense', category: 'transport' }, 5)
    const l = list(cap('a', 'Bolt'), cap('b', 'Corner shop'))
    const [auto] = autoFile(st, l, NOW, dayOf)
    expect(paysLogged(auto, day)).toBe(false)
    expect(paysLogged(fileItem(st, l, 'b', 'food', NOW, dayOf).tx, day)).toBe(true)
    expect(paysLogged(confirmAuto(st, l, 'a', NOW + 2 * 86400_000).tx, day)).toBe(false)
    expect(paysLogged(rec('Bus', 'transport', { date: '2026-01-01' }), day)).toBe(true)
  })
})

describe('the Rules card', () => {
  it('saves, edits (same id) and deletes a rule (tombstone)', () => {
    const st = finance([rec('Linella', 'food'), rec('Linella 2', 'food')])
    const r = saveRule(st, { match: 'Bolt', type: 'expense', category: 'transport' }, 10)
    expect(saveRule(st, { id: r.id, match: 'bolt', type: 'expense', category: 'fun' }, 11).id).toBe(r.id)
    expect(rulesOf(st).rules).toMatchObject([{ match: 'bolt', category: 'fun' }])
    expect(rulesOf(st).learned).toMatchObject([{ merchant: 'linella', n: 2 }])
    expect(() => saveRule(st, { match: 'x', type: 'expense', category: 'fun' }, 12)).toThrow()
    deleteRule(st, r.id, 13)
    expect(rulesOf(st).rules).toEqual([])
    expect(st.deleted[r.id]).toBe(13)
  })
})

describe('Telegram quick add uses the rules', () => {
  function db(tx: any[] = [], rules: any[] = []) {
    const raw = new SQL.Database()
    raw.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const d = new BrowserDb(raw) as any
    const data = { settings: { currency: 'MDL', updatedAt: 1, accounts, rules }, tx, people: [], deleted: {} }
    d.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('app_sync_finance', JSON.stringify({ savedAt: 1, data }))
    return d
  }
  it('sure from your records: filed there, the reply says why, with a "change" button', () => {
    const d = db([rec('kiosk', 'fun'), rec('Kiosk 2', 'fun'), rec('KIOSK', 'fun')])
    const r = logMoney(d, 'kiosk 45', 'b:1', TODAY)!
    expect(r.tx).toMatchObject({ category: 'fun', catBy: 'learned' })
    expect(r.reply).toContain('sure, 3 like it before')
    expect(JSON.stringify(r.keyboard)).toContain('· change')
  })
  it('a rule is sure too', () => {
    const r = logMoney(db([], [{ id: 'r1', match: 'kiosk', type: 'expense', category: 'gifts', updatedAt: 1 }]), 'kiosk 45', 'b:2', TODAY)!
    expect(r.tx).toMatchObject({ category: 'gifts', catBy: 'rule' })
    expect(r.reply).toContain('your rule')
  })
  it('not sure: a guess (not learned from), three one-tap choices; a tap makes it your choice', () => {
    const d = db([rec('Kiosk', 'fun'), rec('Kiosk', 'gifts')])
    const r = logMoney(d, 'kiosk 45', 'b:3', TODAY)!
    expect(r.tx.catBy).toBe('auto')
    expect(r.reply).toContain('tap the right one below')
    const first = r.keyboard.inline_keyboard[0]
    expect(first).toHaveLength(3)
    expect(first.every((b: any) => b.callback_data.startsWith(`fk|${r.tx.id}|`))).toBe(true)
    moneyButton(d, `fk|${r.tx.id}|gifts`, TODAY)
    expect(financeState(d).tx.find((t: any) => t.id === r.tx.id)).toMatchObject({ category: 'gifts', catBy: 'you' })
  })
})
