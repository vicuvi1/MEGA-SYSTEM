// Money data-safety bugs found by the audit of 2026-11-18. Every test failed
// before its fix (docs/DECISIONS.md "Money merge rules, 2026-11-18"). Made-up data only.
import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-ignore plain JS module
import { archiveBefore, archivedTx } from '../../public/apps/finance/js/archive.js'
// @ts-ignore plain JS module
import { normalizeState, accountBalances, changeAccountCurrency } from '../../public/apps/finance/js/model.js'
// @ts-ignore plain JS module
import { putBack, createTracker } from '../../public/apps/finance/js/changelog.js'

let n = 0
const rec = (over: any = {}) => ({ id: `t${++n}`, type: 'expense', amount: 5000, currency: 'MDL', rate: 1, base: 5000, date: '2025-03-01', category: 'food', account: 'wallet', createdAt: 1, updatedAt: 1, ...over })
const clone = (s: any) => JSON.parse(JSON.stringify(s))

function sample() {
  return normalizeState({
    version: 3,
    settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', kind: 'cash', start: 100000 }, { id: 'usd', name: 'Dollars', kind: 'card', currency: 'USD', start: 0 }] },
    tx: [
      rec({ id: 'old1', date: '2024-02-10', amount: 12345, base: 12345 }),
      rec({ id: 'old2', date: '2024-05-01', type: 'income', category: 'work', account: 'usd', currency: 'USD', amount: 100000, rate: 17.5, base: 1750000 }),
      rec({ id: 'new1', date: '2025-02-02', amount: 25000, base: 25000 })
    ],
    people: [], deleted: {}, meta: {}
  })
}

describe('archive + other features', () => {
  it('changing an account currency after archiving keeps its balance (converted)', () => {
    const s = sample()
    archiveBefore(s, 2025, 1000)
    expect(accountBalances(s).usd).toBe(100000) // 1000.00 USD
    changeAccountCurrency(s, 'usd', 'MDL', 1 / 17.5, 2000) // 1 MDL = 1/17.5 USD
    // 1000 USD at 17.5 = 17 500 MDL
    expect(accountBalances(s).usd).toBe(1750000)
  })

  it('Put back of an edit made before archiving does not count the record twice', () => {
    const s = sample()
    const tr = createTracker({ dev: 'web', now: () => 500 })
    tr.reset(s)
    s.tx.find((t: any) => t.id === 'old1').amount = 20000 // edit a 2024 record
    const entries = tr.observe(s, 'local')
    expect(entries).toHaveLength(1)
    archiveBefore(s, 2025, 1000)
    const bal = accountBalances(s).wallet
    putBack(s, entries, 2000)
    const copies = [...s.tx, ...archivedTx(s)].filter((t: any) => t.id === 'old1').length
    expect(copies).toBe(1)
    // the edit was 20000 -> 12345: balance goes UP by 7655, not down by 12345
    expect(accountBalances(s).wallet).toBe(bal + 7655)
  })

  it('a device that gets the archive by sync does not log it as deleted records that can be "brought back" twice', () => {
    const b = sample()
    const tr = createTracker({ dev: 'desktop', now: () => 500 })
    tr.reset(b)
    const before = accountBalances(b).wallet
    const after = clone(b)
    archiveBefore(after, 2025, 1000) // what arrives from the other device
    Object.assign(b, normalizeState(after))
    const entries = tr.observe(b, 'sync')
    const gone = entries.filter((e: any) => e.gone)
    // Bug if the archive shows as deleted records: Bring back adds a second copy.
    putBack(b, gone, 2000)
    expect(accountBalances(b).wallet).toBe(before)
  })
})

// @ts-ignore plain JS module
import { dueItems, makeTx, markDone, recId } from '../../public/apps/finance/js/recurring.js'
// @ts-ignore plain JS module
import { mergeStates, toCloud } from '../../public/apps/finance/js/sync.js'
// @ts-ignore plain JS module
import { removeTx } from '../../public/apps/finance/js/model.js'

import { FINANCE } from './financeSync'

describe('restore after archiving', () => {
  it('putting back a backup from before the archive does not count the archived years twice', () => {
    const s = sample()
    const want = accountBalances(s).wallet
    const backup = toCloud(clone(s), '', 500).data // backupBefore() saves this first
    archiveBefore(s, 2025, 1000)
    expect(accountBalances(s).wallet).toBe(want)
    // Settings → Data safety → restore that backup: this device adopts it (appSync / restoreApps)
    const after = FINANCE.adopt!(s, backup)
    // (info) the next Finance merge with any copy settles it again:
    const healed = mergeStates(clone(after), toCloud(clone(after), '', 2000)).state
    expect(accountBalances(after).wallet).toBe(want)
  })
})

describe('settings scalars across two devices', () => {
  it('a wishlist item added on one device survives a later unrelated settings change on another', () => {
    const base = normalizeState({ version: 3, settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', start: 0 }], wishlist: [] }, tx: [], people: [], deleted: {}, meta: {} })
    const A = clone(base)
    const B = clone(base)
    A.settings.wishlist.push({ id: 'w1', name: 'Bike', price: 500000, added: '2026-11-10', createdAt: 1000, updatedAt: 1000 })
    A.settings.limit = 800000
    A.settings.updatedAt = 1000
    // B (not synced yet) does the monthly check-up "Yes" / a cash count: bumps settings.updatedAt
    B.settings.cashCountLast = '2026-11-11'
    B.settings.updatedAt = 2000
    const merged = mergeStates(A, toCloud(B, 'b', 3000)).state
    expect(merged.settings.wishlist.map((w: any) => w.id)).toContain('w1')
    expect(merged.settings.limit).toBe(800000)
  })
})

// @ts-ignore plain JS module
import { budgetCrossings, newWarnings, thisMonthKeys } from '../../public/apps/finance/js/budgetwarn.js'

describe('week / year budget warnings', () => {
  it('a yearly budget at 85% warns once in the year, not again every month', () => {
    const s = normalizeState({ version: 3, settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', start: 0 }], budgets: [{ id: 'bud-year', name: 'Fun', period: 'year', limit: 100000, cats: [], tags: [] }] }, tx: [rec({ id: 'y1', date: '2026-03-10', amount: 85000, base: 85000 })], people: [], deleted: {}, meta: {} })
    const march = newWarnings(budgetCrossings(s, '2026-03-15'), [])
    expect(march.warn).toHaveLength(1)
    // the runner keeps only this month's keys (budgetWarnRunner.ts:39)
    const april = newWarnings(budgetCrossings(s, '2026-04-02'), thisMonthKeys(march.keys, '2026-04'))
    expect(april.warn).toHaveLength(0)
  })
})

import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { BrowserDb } from './browserDb'
import { monthSpend, logMoney } from './financeBot'
import { readFileSync } from 'node:fs'
import { Wallet } from '../../../main/wallet'
// @ts-ignore plain JS module
import { monthSummary } from '../../public/apps/finance/js/model.js'

describe('Ben / bot money readers agree with Finance', () => {
  it("Ben's 'spent this month' leaves out loans, points rewards and corrections, and takes refunds off", async () => {
    const require = createRequire(import.meta.url)
    const SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
    const raw = new SQL.Database()
    raw.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const d = new BrowserDb(raw) as any
    const data = {
      settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', updatedAt: 1 }] },
      tx: [
        rec({ id: 'f1', date: '2026-11-03', amount: 100000, base: 100000, category: 'food' }),
        rec({ id: 'loan1', date: '2026-11-04', amount: 200000, base: 200000, category: 'other', loan: true }),
        rec({ id: 'life-reward-1', date: '2026-11-05', amount: 50000, base: 50000, category: 'fun' }),
        rec({ id: 'rf1', type: 'income', refund: true, date: '2026-11-06', amount: 30000, base: 30000, category: 'food' })
      ],
      people: [], deleted: {}
    }
    d.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('app_sync_finance', JSON.stringify({ savedAt: 1, data }))
    const fin = monthSummary(normalizeState({ ...clone(data), version: 3 }), '2026-11')
    expect(monthSpend(d, '2026-11-18')!.spentMonth).toBe(70000)
  })

  it('a Telegram / quick-add record at 01:30 on 1 Dec is dated 1 Dec like in Finance (not 30 Nov)', async () => {
    const at = new Date('2026-11-30T23:30:00Z') // 01:30 on 1 Dec in Chisinau
    const wallet = new Wallet(null as any, 'Europe/Chisinau')
    expect(wallet.today(at)).toBe('2026-11-30') // the app day (turns at 04:00): points, habits
    expect(wallet.calendarToday(at)).toBe('2026-12-01') // the date a Money record gets
    const require = createRequire(import.meta.url)
    const SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
    const raw = new SQL.Database()
    raw.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const d = new BrowserDb(raw) as any
    d.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('app_sync_finance', JSON.stringify({ savedAt: 1, data: { settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', updatedAt: 1 }] }, tx: [], people: [], deleted: {} } }))
    const r = logMoney(d, 'taxi 45', 'k1', wallet.calendarToday(at), at.getTime())
    expect(r!.tx.date).toBe('2026-12-01')
    // Every writer of a Money record's date passes the calendar date, never the app day.
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
    for (const f of ['./webBots.ts', './moneyApi.ts']) expect(src(f)).not.toMatch(/logMoney\([^\n]*wallet\.today\(\)/)
    expect(src('./webBots.ts')).toMatch(/logMoney\(currentDb, text, key, s\.wallet\.calendarToday\(\)/)
    expect(src('./moneyApi.ts')).toMatch(/logMoney\(s\.db as any, t, key, s\.wallet\.calendarToday\(\)/)
    expect(src('../../../main/money.ts')).toMatch(/date: this\.wallet\.calendarToday\(now\)/)
  })
})

describe('repeating records across two devices', () => {
  it('an auto record taken back (Undo) on one device does not come back from a device that was offline', () => {
    const rule = { id: 'rent', type: 'expense', amount: 400000, currency: 'MDL', category: 'home', account: 'wallet', note: 'Rent', every: 'month', start: '2026-11-01', auto: true, updatedAt: 1 }
    const base = normalizeState({ version: 3, settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', start: 0 }] }, tx: [], recurring: [rule], people: [], deleted: {}, meta: {} })
    const A = clone(base)
    const B = clone(base)
    // A: runAuto on 1 Nov, then the owner presses Undo
    for (const { rule: r, date } of dueItems(A, '2026-11-01')) { A.tx.push(makeTx(r, date, { id: recId(r, date), now: 1000 })); markDone(r, date, 1000) }
    removeTx(A, 'rec-rent-2026-11-01', 2000)
    // B (laptop offline since October) opens later the same day and runs runAuto before its first sync
    for (const { rule: r, date } of dueItems(B, '2026-11-01')) { if (!B.deleted[recId(r, date)]) B.tx.push(makeTx(r, date, { id: recId(r, date), now: 3000 })); markDone(r, date, 3000) }
    const merged = mergeStates(A, toCloud(B, 'b', 4000)).state
    expect(merged.tx.map((t: any) => t.id)).not.toContain('rec-rent-2026-11-01')
  })
})

// ---- More cases around the same nine fixes ----------------------------------

// @ts-ignore plain JS module
import { unarchiveAll } from '../../public/apps/finance/js/archive.js'
// @ts-ignore plain JS module
import { apply as historyApply } from '../../public/apps/finance/js/history.js'
// @ts-ignore plain JS module
import { settingsBase, stampSettings } from '../../public/apps/finance/js/settingstamp.js'
// @ts-ignore plain JS module
import { applyCashCount, markCashSame } from '../../public/apps/finance/js/cashcount.js'
// @ts-ignore plain JS module
import { addView, removeView, viewsOf } from '../../public/apps/finance/js/savedviews.js'
import { alreadyInBell, budgetNotices } from '@core/budgetNotice'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { createAppSync, BEFORE_RESTORE_KEEP_MS, type AppSyncSpec } from './appSync'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('archive: currency change and undo', () => {
  it('unarchive after a currency change gives the converted records back', () => {
    const s = sample()
    archiveBefore(s, 2025, 1000)
    changeAccountCurrency(s, 'usd', 'MDL', 1 / 17.5, 2000)
    unarchiveAll(s, 3000)
    const old2 = s.tx.find((t: any) => t.id === 'old2')
    expect(old2.amount).toBe(1750000)
    expect(old2.currency).toBe('MDL')
    expect(old2.base).toBe(1750000) // its value in the main currency did not move
    expect(accountBalances(s).usd).toBe(1750000)
  })

  it('Ctrl+Z of a delete made before archiving puts the record back once, in its year', () => {
    const s = sample()
    const was = JSON.stringify(s.tx.find((t: any) => t.id === 'old1'))
    const want = accountBalances(s).wallet
    archiveBefore(s, 2025, 1000)
    // Taking back an ADD of an archived record removes it from the archive, with a deletion marker.
    historyApply(s, [{ list: 'tx', id: 'old1', before: null }], 2000)
    expect(archivedTx(s).some((t: any) => t.id === 'old1')).toBe(false)
    expect(s.deleted.old1).toBe(2000)
    expect(accountBalances(s).wallet).toBe(want + 12345)
    // And the redo puts it back in the everyday list (it is no longer archived), once.
    historyApply(s, [{ list: 'tx', id: 'old1', before: was }], 3000)
    expect([...s.tx, ...archivedTx(s)].filter((t: any) => t.id === 'old1')).toHaveLength(1)
    expect(accountBalances(s).wallet).toBe(want)
  })
})

describe('repeating records: a record put back on purpose stays', () => {
  it('a taken-back auto record that was put back wins over the old deletion and over a fresh rule copy', () => {
    const rule = { id: 'rent', type: 'expense', amount: 400000, currency: 'MDL', category: 'home', account: 'wallet', note: 'Rent', every: 'month', start: '2026-11-01', auto: true, updatedAt: 1 }
    const base = normalizeState({ version: 3, settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', start: 0 }] }, tx: [], recurring: [rule], people: [], deleted: {}, meta: {} })
    const A = clone(base)
    const id = 'rec-rent-2026-11-01'
    A.tx.push(makeTx(rule, '2026-11-01', { id, now: 1000 }))
    const made = JSON.stringify(A.tx[0])
    removeTx(A, id, 2000) // Undo
    const cloud = toCloud(clone(A), 'a', 2100) // the deletion reached the cloud
    historyApply(A, [{ list: 'tx', id, before: made }], 2500) // Redo: back on purpose
    // The cloud also got a fresh copy from a device that was offline (made at 3000, untouched).
    cloud.data.tx.push(makeTx(rule, '2026-11-01', { id, now: 3000 }))
    const merged = mergeStates(A, cloud).state
    const got = merged.tx.filter((t: any) => t.id === id)
    expect(got).toHaveLength(1)
    expect(got[0].updatedAt).toBe(2500)
  })
})

describe('settings: key by key', () => {
  const base = () => normalizeState({ version: 3, settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', start: 0 }], limit: { on: true, amount: 500000 }, pay: { on: false } }, tx: [], people: [], deleted: {}, meta: {} })

  it('each device keeps the setting it changed, whoever saved last', () => {
    const A = base()
    const B = clone(A)
    let was = settingsBase(A)
    A.settings.limit = { on: true, amount: 800000 }
    A.settings.updatedAt = 1000
    was = stampSettings(A, was, 1000)
    expect(A.settings.changedAt.limit).toBe(1000)
    let wasB = settingsBase(B)
    B.settings.pay = { on: true, amount: 1500000 }
    B.settings.updatedAt = 2000
    wasB = stampSettings(B, wasB, 2000)
    for (const [x, y] of [[A, B], [B, A]]) {
      const m = mergeStates(clone(x), toCloud(clone(y), 'y', 3000)).state
      expect(m.settings.limit).toEqual({ on: true, amount: 800000 })
      expect(m.settings.pay).toEqual({ on: true, amount: 1500000 })
      expect(m.settings.changedAt).toMatchObject({ limit: 1000, pay: 2000 })
    }
    // The same key changed on both: the later change wins on both devices.
    B.settings.limit = { on: false }
    stampSettings(B, wasB, 2500)
    for (const [x, y] of [[A, B], [B, A]]) expect(mergeStates(clone(x), toCloud(clone(y), 'y', 3000)).state.settings.limit).toEqual({ on: false })
  })

  it('data from an older app version (no change times) still merges as before: the newer settings win', () => {
    const A = base()
    const B = clone(A)
    A.settings.limit = { on: true, amount: 800000 }
    A.settings.updatedAt = 1000
    B.settings.limit = { on: true, amount: 900000 }
    B.settings.updatedAt = 2000
    for (const [x, y] of [[A, B], [B, A]]) expect(mergeStates(clone(x), toCloud(clone(y), 'y', 3000)).state.settings.limit.amount).toBe(900000)
  })

  it('a cash count and a check-up "Yes" do not touch the shared settings time, and the later day is kept', () => {
    const A = base()
    const B = clone(A)
    const t = A.settings.updatedAt
    markCashSame(A, '2026-11-11')
    applyCashCount(A, 'wallet', 0, '2026-11-12', { now: 5000 })
    expect(A.settings.updatedAt).toBe(t)
    B.settings.cashCountLast = '2026-11-15'
    for (const [x, y] of [[A, B], [B, A]]) expect(mergeStates(clone(x), toCloud(clone(y), 'y', 6000)).state.settings.cashCountLast).toBe('2026-11-15')
  })

  it('saved Log views merge view by view, and a removed one stays removed', () => {
    const start = base()
    addView(start, { id: 'sv-a', name: 'Food', q: 'food', filter: 'all', month: 'now', view: '', pinned: true })
    stampSettings(start, settingsBase(base()), 500)
    const A = clone(start)
    const B = clone(start)
    let wasA = settingsBase(A)
    addView(A, { id: 'sv-b', name: 'Taxi', q: 'taxi', filter: 'all', month: 'now', view: '', pinned: true })
    wasA = stampSettings(A, wasA, 1000)
    const wasB = settingsBase(B)
    addView(B, { id: 'sv-c', name: 'Rent', q: 'rent', filter: 'all', month: 'now', view: '', pinned: true })
    removeView(B, 'sv-a')
    stampSettings(B, wasB, 2000)
    expect(B.deleted['sv-a']).toBe(2000)
    for (const [x, y] of [[A, B], [B, A]]) {
      const m = mergeStates(clone(x), toCloud(clone(y), 'y', 3000)).state
      expect(viewsOf(m).map((v: any) => v.id).sort()).toEqual(['sv-b', 'sv-c'])
    }
  })
})

describe('budget warnings: once per period', () => {
  const state = (budgets: any[], tx: any[]) => normalizeState({ version: 3, settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', start: 0 }], budgets }, tx, people: [], deleted: {}, meta: {} })

  it('a weekly budget warns once in its week and again in the next week', () => {
    const s = state([{ id: 'bud-week', name: 'Food', period: 'week', limit: 100000, cats: [], tags: [] }], [rec({ id: 'w1', date: '2026-11-17', amount: 85000, base: 85000 }), rec({ id: 'w2', date: '2026-11-24', amount: 90000, base: 90000 })])
    const first = newWarnings(budgetCrossings(s, '2026-11-18'), [])
    expect(first.warn).toHaveLength(1)
    expect(newWarnings(budgetCrossings(s, '2026-11-20'), thisMonthKeys(first.keys, '2026-11')).warn).toHaveLength(0)
    expect(newWarnings(budgetCrossings(s, '2026-11-25'), thisMonthKeys(first.keys, '2026-11')).warn).toHaveLength(1)
  })

  it('old keys go once their period is over, and a monthly budget still warns each month', () => {
    expect(thisMonthKeys(['2026-11:food:80', '~2026-11-22:bud-a-w2026-11-16:80', '~2026-12-31:bud-b-y2026:80'], '2026-12')).toEqual(['~2026-12-31:bud-b-y2026:80'])
  })

  it("the bell's own check also looks at the whole period (another device's entry from March stops April's)", () => {
    const ids = ['budget:budgetwarn:2026-03-15:bud-year-y2026:80']
    expect(alreadyInBell(ids, '2026-04', 'bud-year-y2026', 80)).toBe(false) // a monthly budget: this month only
    expect(alreadyInBell(ids, '2026-04', 'bud-year-y2026', 80, '2026-01-01')).toBe(true)
    const c = { month: '2026-04', cat: 'bud-year-y2026', name: 'Fun', level: 80 as const, pct: 85, spent: 85000, budget: 100000, from: '2026-01-01', until: '2026-12-31' }
    expect(budgetNotices([c], { day: '2026-04-02', now: new Date('2026-04-02T10:00:00Z'), currency: 'MDL', hideAmounts: false, bellIds: ids })).toHaveLength(0)
  })
})

describe('taking a restore on another device: the copy from before it', () => {
  const SPEC: AppSyncSpec = { localKey: 'test_app', setting: 'app_sync_test', event: 'test-changed', merge: (m, t, mineNewer) => (mineNewer ? { ...t, ...m } : { ...m, ...t }) }
  const BEFORE = 'life_sync_app_sync_test_before_restore'
  async function setup(cloud: any) {
    const require = createRequire(import.meta.url)
    const SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
    const remote = new SQL.Database()
    for (const m of MIGRATIONS) remote.exec(m)
    remote.run("INSERT INTO settings (key, value) VALUES ('app_sync_test', ?)", [JSON.stringify(cloud)])
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const json = handlePipeline(remote, JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    })
    const m = new Map<string, string>()
    const block = { on: false }
    const store = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (block.on && k === BEFORE) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' })
        m.set(k, String(v))
      },
      removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0
    } as Storage
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
    await mirror.ready
    const sync = createAppSync(mirror, SPEC, store)
    return { store, block, run: async () => { await mirror.refresh(); return sync.sync({ check: true }) } }
  }
  const T = 1_800_000_000_000

  it('is written for real: when it cannot be kept, the restore is not applied here and the sync says why', async () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(T)
    const env = await setup({ savedAt: T, editedAt: T, restore: 'r1', data: { x: 'restored' } })
    env.store.setItem('test_app', JSON.stringify({ x: 'mine', y: 'only here' }))
    env.block.on = true
    const bad = await env.run()
    expect(bad.ok).toBe(false)
    expect(bad.error).toMatch(/safety copy/)
    expect(bad.error).toMatch(/not applied/)
    expect(JSON.parse(env.store.getItem('test_app')!)).toEqual({ x: 'mine', y: 'only here' }) // untouched
    // Room again: the restore is taken, with this device's data from before kept next to it.
    env.block.on = false
    const ok = await env.run()
    expect(ok.ok).toBe(true)
    expect(JSON.parse(env.store.getItem('test_app')!).x).toBe('restored')
    expect(JSON.parse(JSON.parse(env.store.getItem(BEFORE)!).raw)).toEqual({ x: 'mine', y: 'only here' })
  })

  it('is removed by a confirmed sync once it is more than a day old (it used to stay forever)', async () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(T)
    const env = await setup({ savedAt: T, editedAt: T, restore: 'r1', data: { x: 'restored' } })
    env.store.setItem('test_app', JSON.stringify({ x: 'mine' }))
    await env.run()
    expect(env.store.getItem(BEFORE)).not.toBeNull()
    // The same day: still there after another confirmed sync.
    now.mockReturnValue(T + 3600_000)
    env.store.setItem('test_app', JSON.stringify({ x: 'restored', z: 1 }))
    expect((await env.run()).confirmed).toBe(true)
    expect(env.store.getItem(BEFORE)).not.toBeNull()
    now.mockReturnValue(T + BEFORE_RESTORE_KEEP_MS + 7200_000)
    env.store.setItem('test_app', JSON.stringify({ x: 'restored', z: 2 }))
    expect((await env.run()).confirmed).toBe(true)
    expect(env.store.getItem(BEFORE)).toBeNull()
  })
})
