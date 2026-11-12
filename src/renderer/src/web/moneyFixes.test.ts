// The six Money fixes (owner, 2026-11-12), on made-up data:
// 1 foreign currency converted through USD (and the re-price review for old entries),
// 2 imports warn about rows with no rate, 3 one "counts as spending" rule,
// 4 one money formatter, 6 debounced saves that keep the sync merge, and the
// Telegram inbox that never drops an entry silently. (5, the one no-spend
// button, is in honestMoney.test.ts.)
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { moneyText, totalText } from '@core/moneyText'
import { leiText } from '@core/moneyHub'
import { BrowserDb } from './browserDb'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { createAppSync } from './appSync'
import { FINANCE } from './financeSync'
import { financeState, logMoney, previewMoney } from './financeBot'
import { hubView } from './moneyHub'
import { inboxWarning, keepInbox, queueFinanceExpense, type InboxEntry } from './financeInbox'
// @ts-ignore plain JS modules from the embedded app
import { rateToBase, pairRate } from '../../public/apps/finance/js/fx.js'
// @ts-ignore
import { repriceRows, applyReprice, undoReprice, repriced } from '../../public/apps/finance/js/reprice.js'
// @ts-ignore
import { importRows, rateGaps, fillRate, fillKnownRates, skipNoRate } from '../../public/apps/finance/js/importer.js'
// @ts-ignore
import { categoryShares, countsAsSpending } from '../../public/apps/finance/js/catshare.js'
// @ts-ignore
import { saveSoon, flushSave, save, onSaved, hasPendingSave, wipeStore, load, SAVE_DELAY } from '../../public/apps/finance/js/store.js'
// @ts-ignore
import { mergeLocal, mergeStates, toCloud } from '../../public/apps/finance/js/sync.js'
// @ts-ignore
import { normalizeState, B } from '../../public/apps/finance/js/model.js'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const TODAY = '2026-11-10'
// Units per 1 USD: 1 EUR = 17.6 / 0.88 = 20 MDL.
const RATES = { usd: { USD: 1, MDL: 17.6, EUR: 0.88 }, crypto: {}, history: {}, fetchedAt: Date.parse('2026-11-10T09:00:00Z') }
const accounts = [
  { id: 'wallet', name: 'Wallet', kind: 'cash', currency: 'MDL', updatedAt: 1 },
  { id: 'rev', name: 'Revolut', kind: 'card', currency: 'EUR', updatedAt: 1 }
]
const rec = (id: string, extra: any = {}) => ({ id, type: 'expense', amount: 1000, currency: 'MDL', rate: 1, base: 1000, date: '2026-11-01', category: 'food', account: 'wallet', note: id, createdAt: 1, updatedAt: 1, ...extra })

function botDb(data: any) {
  const raw = new SQL.Database()
  raw.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const d = new BrowserDb(raw) as any
  d.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('app_sync_finance', JSON.stringify({ savedAt: 1, data }))
  return d
}

describe('1. foreign currency is converted through USD, never counted 1:1', () => {
  const data = (extra: any = {}) => ({ settings: { currency: 'MDL', updatedAt: 1, accounts }, tx: [], people: [], deleted: {}, lastRates: { date: '2026-11-10', usd: { MDL: 17.6, EUR: 0.88, USD: 1 } }, ...extra })

  it('a 10 EUR quick add or Telegram entry counts as 200 MDL', () => {
    const d = botDb(data())
    const r = logMoney(d, 'coffee 10 revolut', 'q:eur', TODAY, Date.now(), { mainAccount: true })!
    expect(r.tx).toMatchObject({ amount: 1000, currency: 'EUR', rate: 20, base: 20000, account: 'rev' })
    // The Telegram path (no main-account rule) is the same.
    const t = logMoney(d, 'lunch 10 revolut', 'tg:1', TODAY)!
    expect(t.tx).toMatchObject({ currency: 'EUR', rate: 20, base: 20000 })
    // The preview names the record's own currency.
    expect(previewMoney(d, 'coffee 10 revolut', { mainAccount: true })).toMatchObject({ amount: 1000, currency: 'EUR' })
    // And the Money hub counts it as 200 MDL.
    const v = hubView(financeState(d), TODAY)!
    expect(v.week.find((x) => x.day === TODAY)!.spent).toBe(40000)
  })

  it('lei stays 1:1; with no rate saved it uses the last real rate for that currency', () => {
    const st = { settings: { currency: 'MDL' }, rates: null, tx: [rec('a', { currency: 'EUR', rate: 1, base: 1000, date: '2026-11-09' }), rec('b', { currency: 'EUR', rate: 19.5, base: 19500, date: '2026-11-02' })] }
    expect(rateToBase(st, 'MDL')).toBe(1)
    // 'a' was counted 1:1 (a bad record): it is not a rate to copy.
    expect(rateToBase(st, 'EUR')).toBe(19.5)
    expect(rateToBase({ settings: { currency: 'MDL' }, rates: null, tx: [] }, 'EUR')).toBeNull()
    expect(rateToBase({ settings: { currency: 'MDL' }, rates: RATES, tx: [] }, 'EUR')).toBe(20)
    expect(pairRate('EUR', 'MDL', RATES)).toBeCloseTo(20)
  })

  it('no rate anywhere: kept at 1 and listed by the re-price review', () => {
    const d = botDb(data({ lastRates: undefined }))
    const r = logMoney(d, 'coffee 10 revolut', 'q:norate', TODAY, Date.now(), { mainAccount: true })!
    expect(r.tx).toMatchObject({ currency: 'EUR', base: 1000 })
    const st = financeState(d)
    expect(repriceRows(st)).toEqual([]) // no rate known yet: nothing to offer
    st.rates = RATES
    expect(repriceRows(st).map((x: any) => x.id)).toEqual([r.tx.id])
  })
})

describe('1. re-price past entries: detect, apply, undo', () => {
  const state = () =>
    normalizeState({
      settings: { currency: 'MDL', accounts },
      tx: [
        rec('eur-1to1', { currency: 'EUR', account: 'rev', rate: 1, base: 1000, date: '2026-11-03' }),
        rec('eur-norate', { currency: 'EUR', account: 'rev', rate: null, base: 2550, amount: 2550, date: '2026-11-05' }),
        rec('eur-ok', { currency: 'EUR', account: 'rev', rate: 19.8, base: 19800, date: '2026-11-04' }),
        rec('lei', {}),
        rec('income-eur', { type: 'income', category: 'work', currency: 'EUR', account: 'rev', rate: 1, base: 50000, amount: 50000, date: '2026-11-01' }),
        { id: 'move', type: 'transfer', amount: 1000, currency: 'EUR', rate: 1, base: 1000, date: '2026-11-01', from: 'rev', to: 'wallet', createdAt: 1, updatedAt: 1 }
      ],
      rates: { ...RATES, history: { '2026-11-03': { USD: 1, MDL: 17.6, EUR: 0.8 } } }
    })

  it('lists only foreign records counted 1:1, with the value before and after (the day rate when saved)', () => {
    const rows = repriceRows(state())
    expect(rows.map((r: any) => r.id).sort()).toEqual(['eur-1to1', 'eur-norate', 'income-eur'])
    const one = rows.find((r: any) => r.id === 'eur-1to1')
    // That day's rate: 17.6 / 0.8 = 22.
    expect(one).toMatchObject({ before: 1000, after: 22000, rate: 22, currency: 'EUR' })
    expect(rows.find((r: any) => r.id === 'eur-norate')).toMatchObject({ before: 2550, after: 51000, rate: 20 })
  })

  it('applies only after confirm, keeps the old values, leaves every other record alone; undo puts them back exactly', () => {
    const st = state()
    const untouched = JSON.stringify(st.tx.filter((t: any) => !['eur-1to1', 'eur-norate', 'income-eur'].includes(t.id)))
    const before = JSON.parse(JSON.stringify(st.tx))
    const rows = repriceRows(st)
    expect(applyReprice(st, rows, 5000)).toBe(3)
    const a = st.tx.find((t: any) => t.id === 'eur-1to1')
    expect(a).toMatchObject({ amount: 1000, currency: 'EUR', rate: 22, base: 22000, updatedAt: 5000 })
    expect(a.repricedFrom).toMatchObject({ rate: 1, base: 1000, amount: 1000, currency: 'EUR' })
    expect(JSON.stringify(st.tx.filter((t: any) => !['eur-1to1', 'eur-norate', 'income-eur'].includes(t.id)))).toBe(untouched)
    // Nothing left to review, and running it again changes nothing.
    expect(repriceRows(st)).toEqual([])
    expect(applyReprice(st, rows, 6000)).toBe(0)
    expect(repriced(st)).toHaveLength(3)
    // Undo: the exact old rate and value, the marker gone.
    expect(undoReprice(st, null, 7000)).toBe(3)
    for (const t of st.tx) {
      const was = before.find((x: any) => x.id === t.id)
      expect({ ...t, updatedAt: 0 }).toEqual({ ...was, updatedAt: 0 })
    }
  })

  it('a record you edited after the re-price keeps your edit on undo', () => {
    const st = state()
    applyReprice(st, repriceRows(st), 5000)
    const a = st.tx.find((t: any) => t.id === 'eur-1to1')
    a.amount = 3000
    a.base = Math.round(3000 * a.rate)
    expect(undoReprice(st, ['eur-1to1'], 6000)).toBe(0)
    expect(a.base).toBe(66000)
  })

  it('the re-price reaches other devices through the sync merge (newer copy wins), and so does the undo', () => {
    const pc = state()
    const phone = state()
    applyReprice(pc, repriceRows(pc), 5000)
    const merged = mergeStates(phone, toCloud(pc, '')).state
    expect(merged.tx.find((t: any) => t.id === 'eur-1to1')).toMatchObject({ base: 22000, rate: 22 })
    undoReprice(pc, null, 6000)
    const back = mergeStates(merged, toCloud(pc, '')).state
    expect(back.tx.find((t: any) => t.id === 'eur-1to1')).toMatchObject({ base: 1000, rate: 1 })
    expect(back.tx.find((t: any) => t.id === 'eur-1to1').repricedFrom).toBeUndefined()
  })
})

describe('2. an import warns about rows with no rate', () => {
  const csv = [
    ['Date', 'Type', 'Amount', 'Currency', 'Category', 'Account', 'Note'],
    ...Array.from({ length: 12 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, '0')}`, 'Spent', '10', 'EUR', 'Food', 'Wallet', `eur ${i}`]),
    ['2026-10-20', 'Spent', '45', 'MDL', 'Food', 'Wallet', 'lunch']
  ]
  const st = (rates: any = null) => normalizeState({ settings: { currency: 'MDL', accounts }, tx: [], rates })

  it('lists the rows per currency; they can get one rate, the fetched rates, or be skipped', () => {
    const s = st()
    const res = importRows(csv, s)
    expect(res.tx).toHaveLength(13)
    expect(rateGaps(res.tx, 'MDL')).toEqual([{ currency: 'EUR', count: 12 }])
    // Set one rate.
    const a = JSON.parse(JSON.stringify(res.tx))
    expect(fillRate(a, 'EUR', 19.9, 'MDL')).toBe(12)
    expect(rateGaps(a, 'MDL')).toEqual([])
    expect(a[0]).toMatchObject({ rate: 19.9, base: 19900 })
    // Skip them: only the lei row stays.
    const b = skipNoRate(JSON.parse(JSON.stringify(res.tx)), 'EUR', 'MDL')
    expect(b.map((t: any) => t.note)).toEqual(['lunch'])
    // Rates fetched: each row takes them.
    const c = JSON.parse(JSON.stringify(res.tx))
    expect(fillKnownRates(c, st(RATES))).toBe(12)
    expect(c[0]).toMatchObject({ rate: 20, base: 20000 })
  })

  it('with rates known there is nothing to warn about', () => {
    const res = importRows(csv, st(RATES))
    expect(rateGaps(res.tx, 'MDL')).toEqual([])
    expect(res.tx[0]).toMatchObject({ currency: 'EUR', base: 20000 })
  })
})

describe('3. one "counts as spending" rule for the donut and the Money hub', () => {
  it('a reward bought with points (life-reward-…) is left out of both', () => {
    const data = normalizeState({
      settings: { currency: 'MDL', accounts },
      tx: [rec('f1', { date: TODAY, base: 5000, amount: 5000 }), rec('life-reward-7', { date: TODAY, base: 1500, amount: 1500, category: 'fun' })]
    })
    expect(countsAsSpending(data.tx[1])).toBe(false)
    const donut = categoryShares(data.tx, { from: '2026-11-01', to: TODAY, prev: { from: '2026-10-01', to: '2026-10-10' } }, B)
    const v = hubView(data, TODAY)!
    expect(v.week.find((x) => x.day === TODAY)!.spent).toBe(5000)
    expect(v.compare.thisTotal).toBe(5000)
    expect(donut.total).toBe(v.compare.thisTotal)
  })
})

describe('4. one money formatter, shared with Finance Helper', () => {
  it('single amounts keep their bani; totals round; one label (MDL)', () => {
    expect(moneyText(1250)).toBe('12,50 MDL')
    expect(moneyText(1200)).toBe('12 MDL')
    expect(moneyText(1250, 'EUR')).toBe('12,50 EUR')
    expect(totalText(1250)).toBe('13 MDL')
    expect(totalText(124000)).toBe('1 240 MDL')
    expect(leiText(124049)).toBe('1 240 MDL')
    expect(leiText(1000)).not.toContain('lei')
  })
})

// ---- 6. debounced saves, and the sync merge still holds --------------------

function memStore() {
  const m = new Map<string, string>()
  const writes: string[] = []
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      writes.push(k)
      m.set(k, String(v))
    },
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
    writes
  } as unknown as Storage & { writes: string[] }
}
const KEY = 'finance-helper.state'
const fin = (tx: any[], deleted: Record<string, number> = {}) => ({ version: 9, settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', updatedAt: 1 }], categories: [{ id: 'food', type: 'expense', name: 'Food', updatedAt: 1 }] }, tx, people: [], deleted, meta: {} })
const ids = (s: Storage) => (JSON.parse(s.getItem(KEY) || 'null')?.tx ?? []).map((t: any) => t.id).sort()

describe('6. saves wait a moment and write once', () => {
  it('a burst of changes is one write; leaving the page (flush) writes at once', () => {
    vi.useFakeTimers()
    const store = memStore()
    const state = normalizeState(fin([]))
    const seen: boolean[] = []
    const off = onSaved((ok: boolean) => seen.push(ok))
    for (let i = 0; i < 5; i++) {
      state.tx.push(rec(`t${i}`))
      expect(saveSoon(state, store)).toBe(true)
    }
    expect(store.writes).toEqual([])
    expect(hasPendingSave()).toBe(true)
    vi.advanceTimersByTime(SAVE_DELAY + 1)
    expect(store.writes).toEqual([KEY])
    expect(ids(store)).toEqual(['t0', 't1', 't2', 't3', 't4'])
    expect(seen).toEqual([true])
    // flushSave writes a waiting save right away (pagehide, before reading back).
    state.tx.push(rec('t5'))
    saveSoon(state, store)
    expect(flushSave()).toBe(true)
    expect(ids(store)).toContain('t5')
    expect(hasPendingSave()).toBe(false)
    vi.advanceTimersByTime(SAVE_DELAY * 2)
    expect(store.writes).toHaveLength(2)
    off()
  })

  it('a direct save or a reset cancels a waiting one (an older copy never lands later)', () => {
    vi.useFakeTimers()
    const store = memStore()
    const old = normalizeState(fin([rec('old')]))
    saveSoon(old, store)
    const fresh = normalizeState(fin([rec('new')]))
    save(fresh, store)
    vi.advanceTimersByTime(SAVE_DELAY * 2)
    expect(ids(store)).toEqual(['new'])
    saveSoon(old, store)
    wipeStore(store)
    vi.advanceTimersByTime(SAVE_DELAY * 2)
    expect(store.getItem(KEY)).toBeNull()
  })

  it('the locked placeholder is never written', () => {
    const store = memStore()
    const s = load(store)
    s._sealed = true
    expect(saveSoon(s, store)).toBe(false)
    expect(flushSave()).toBe(true)
    expect(store.getItem(KEY)).toBeNull()
  })

  it('a waiting change merged with a newer stored copy keeps both, deletions included', () => {
    // This page: added 'mine' (still waiting). Stored meanwhile: the inbox added 'tg', another device deleted 'gone'.
    const page = normalizeState(fin([rec('a'), rec('gone'), rec('mine', { createdAt: 9, updatedAt: 9 })]))
    const stored = normalizeState(fin([rec('a'), rec('tg', { updatedAt: 8 })], { gone: 50 }))
    const m = mergeLocal(page, stored)
    expect(m.tx.map((t: any) => t.id).sort()).toEqual(['a', 'mine', 'tg'])
    expect(m.deleted.gone).toBe(50)
  })
})

describe('6. the sync merge with debounced saves: two devices, deletions, offline edits', () => {
  function fakeTurso() {
    const remote = new SQL.Database()
    for (const m of MIGRATIONS) remote.exec(m)
    let offline = false
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      if (offline) throw new TypeError('offline')
      const json = handlePipeline(remote, JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    })
    return { remote, setOffline: (v: boolean) => (offline = v) }
  }
  async function device(store: Storage) {
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
    await mirror.ready
    return { mirror, app: createAppSync(mirror, FINANCE, store) }
  }

  it('records from both devices meet; a deletion stays deleted; an offline edit arrives later', async () => {
    const net = fakeTurso()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const phone = memStore()
    const pc = memStore()
    // The phone starts with a and b.
    const ps = normalizeState(fin([rec('a'), rec('b')]))
    saveSoon(ps, phone)
    flushSave()
    const p = await device(phone)
    await p.app.sync()
    const c = await device(pc)
    await c.app.sync()
    expect(ids(pc)).toEqual(['a', 'b'])

    // The PC deletes b and adds c, saved the debounced way.
    const cs = normalizeState(JSON.parse(pc.getItem(KEY)!))
    cs.tx = cs.tx.filter((t: any) => t.id !== 'b').concat(rec('c', { updatedAt: 20 }))
    cs.deleted = { b: 20 }
    saveSoon(cs, pc)
    // Not written yet: a sync now changes nothing.
    await c.app.sync()
    expect(ids(pc)).toEqual(['a', 'b'])
    vi.advanceTimersByTime(SAVE_DELAY + 1)
    c.app.soon()
    await c.app.sync()

    // The phone is offline and edits a, and adds d.
    net.setOffline(true)
    const ps2 = normalizeState(JSON.parse(phone.getItem(KEY)!))
    ps2.tx = ps2.tx.map((t: any) => (t.id === 'a' ? { ...t, amount: 999, base: 999, updatedAt: 30 } : t)).concat(rec('d', { updatedAt: 31 }))
    saveSoon(ps2, phone)
    flushSave()
    p.app.soon()
    await p.app.sync() // fails quietly (offline); the edit waits on the phone
    expect(ids(phone)).toEqual(['a', 'b', 'd'])

    // Back online: everything meets, b stays deleted.
    net.setOffline(false)
    await p.mirror.refresh()
    await p.app.sync()
    expect(ids(phone)).toEqual(['a', 'c', 'd'])
    expect(JSON.parse(phone.getItem(KEY)!).tx.find((t: any) => t.id === 'a').amount).toBe(999)
    await c.mirror.refresh()
    await c.app.sync()
    expect(ids(pc)).toEqual(['a', 'c', 'd'])
  })
})

// ---- 6. the Telegram inbox never drops an entry silently -------------------

describe('6. the Telegram inbox: kept until Finance Helper has it, warned about from day 50', () => {
  const DAY = 86400_000
  const now = Date.parse('2026-11-10T12:00:00Z')
  const e = (id: string, daysAgo: number, extra: Partial<InboxEntry> = {}): InboxEntry => ({ id, amount: 4500, category: 'food', note: id, date: '2026-09-01', at: now - daysAgo * DAY, ...extra })

  it('an old entry goes only once Finance Helper has it', () => {
    const finance = { tx: [{ id: 'old-applied' }], deleted: { 'old-deleted': 1 } }
    const kept = keepInbox([e('old-applied', 70), e('old-deleted', 70), e('old-waiting', 70), e('new', 3)], now, finance)
    expect(kept.map((x) => x.id)).toEqual(['old-waiting', 'new'])
    // Never synced: nothing is known to be applied, so nothing is dropped.
    expect(keepInbox([e('old-waiting', 70)], now, null)).toHaveLength(1)
  })

  it('queueing a new expense keeps a 70-day-old one that is not in Finance Helper yet', () => {
    const raw = new SQL.Database()
    raw.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const d = new BrowserDb(raw) as any
    d.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('finance_inbox_json', JSON.stringify([e('waiting', 70), e('applied', 70)]))
    d.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('app_sync_finance', JSON.stringify({ savedAt: 1, data: { tx: [{ id: 'applied' }], deleted: {} } }))
    queueFinanceExpense(d, e('today', 0))
    const list = JSON.parse(d.prepare('SELECT value FROM settings WHERE key = ?').get('finance_inbox_json').value)
    expect(list.map((x: any) => x.id)).toEqual(['waiting', 'today'])
  })

  it('warns on the Money page from day 50', () => {
    const state = { tx: [{ id: 'in' }], deleted: {} }
    expect(inboxWarning([e('w', 49)], state, now)).toBeNull()
    expect(inboxWarning([e('in', 55)], state, now)).toBeNull()
    expect(inboxWarning([e('w1', 50), e('w2', 51), e('w3', 52)], state, now)).toMatchObject({ count: 3, daysLeft: 8, line: '3 entries waiting from Telegram will expire in 8 days: apply now' })
    expect(inboxWarning([e('w', 50)], state, now)!.line).toBe('1 entry waiting from Telegram will expire in 10 days: apply now')
    expect(inboxWarning([e('w', 65)], state, now)!.line).toMatch(/over 60 days old: apply now \(kept until you do\)/)
  })
})
