// Money's own data in IndexedDB (web/bigStore.ts, apps/finance/js/bigstore.js):
// the one-time move out of localStorage (only after the new Money has started,
// checked before the old copy goes, safe when interrupted), the fallback with
// an honest status, merging instead of replacing when two windows or an older
// tab wrote, the `storage` events between Life's page and the Money frame, a
// save on its way when the page closes, and everything that reads Money
// (the bots' reader, backups and restore, Finance Helper's own load and save,
// the website's waiting changes). Made-up data only.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { APP_BLOBS, type Snapshot } from '@core/backupPlan'
import { createBigStore, isAppKey, moneyMerge, MONEY_ENC, MONEY_KEY, MONEY_MARK, OUTBOX_KEY, type BigStore, type BigStoreOptions } from './bigStore'
import { channelPair, fakeIdb, fakeWindow, memLocal } from './fakeIdb'
import { financeStateFrom } from './botBrain'
import { createFinanceInbox } from './financeInbox'
import { appBlobsOf, putBackApps } from './restoreApps'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { createAppSync } from './appSync'
import { FINANCE } from './financeSync'
import { moneyMeter, moneyWhere } from '@core/dataCenter'
import { checkCheckup } from '../money/checkupRunner'
// @ts-ignore plain JS module from the embedded app
import { normalizeState } from '../../public/apps/finance/js/model.js'
// @ts-ignore plain JS module from the embedded app
import { load, save, saveSoon, flushSave, wipeStore, storageInfo } from '../../public/apps/finance/js/store.js'
// @ts-ignore plain JS module from the embedded app
import { textMark } from '../../public/apps/finance/js/bigstore.js'

const rec = (id: string, extra: any = {}) => ({ id, type: 'expense', amount: 1000, currency: 'MDL', rate: 1, base: 1000, date: '2026-11-01', category: 'food', account: 'wallet', note: id, createdAt: 1, updatedAt: 1, ...extra })
const fin = (tx: any[], extra: any = {}) =>
  normalizeState({ version: 9, settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', updatedAt: 1 }], categories: [{ id: 'food', type: 'expense', name: 'Food', updatedAt: 1 }] }, tx, people: [], deleted: {}, meta: {}, ...extra })
const text = (tx: any[], extra: any = {}) => JSON.stringify(fin(tx, extra))
const ids = (raw: string | null | undefined) => (raw ? (JSON.parse(raw).tx as any[]).map((t) => t.id).sort() : null)
const tick = (n = 20) => new Promise((r) => setTimeout(r, n))

/** A store as the app makes it: Money's own merge, no window unless given. */
const make = (o: Partial<BigStoreOptions> & { local: Storage }): BigStore => createBigStore({ win: null, merge: moneyMerge, ...o })

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the move out of localStorage', () => {
  it('nothing moves until the new Money has started on this device; then it is written, read back, and only then removed', async () => {
    const local = memLocal()
    const old = text([rec('a'), rec('b')])
    local.setItem(MONEY_KEY, old)
    const idb = fakeIdb()
    const s = make({ local, idb: idb.factory })
    await s.ready
    // An older Money still in a cache must find its data: it stays exactly where it was.
    expect(local.getItem(MONEY_KEY)).toBe(old)
    expect(idb.data.has(MONEY_KEY)).toBe(false)
    expect(s.getItem(MONEY_KEY)).toBe(old)
    expect(s.status()).toMatchObject({ mode: 'indexeddb', moneyMoved: false })
    // A write before the move goes to localStorage, as it always did.
    const next = text([rec('a'), rec('b'), rec('c')])
    s.setItem(MONEY_KEY, next)
    expect(local.getItem(MONEY_KEY)).toBe(next)
    // The new Money starts.
    await s.moveIn()
    expect(local.getItem(MONEY_MARK)).toBe('idb')
    expect(idb.data.get(MONEY_KEY)).toBe(next)
    expect(local.getItem(MONEY_KEY)).toBeNull()
    expect(s.getItem(MONEY_KEY)).toBe(next)
    expect(s.status()).toMatchObject({ moneyMoved: true, error: null })
    expect(s.status().keys.find((k) => k.key === MONEY_KEY)).toMatchObject({ where: 'indexeddb', chars: next.length })
    // The next start reads it from IndexedDB; the count and every record are the same.
    const again = make({ local, idb: idb.factory })
    await again.ready
    expect(again.getItem(MONEY_KEY)).toBe(next)
    expect(ids(again.getItem(MONEY_KEY))).toEqual(['a', 'b', 'c'])
  })

  it('a copy that does not read back the same is not removed: Money stays in localStorage and says why', async () => {
    const local = memLocal()
    const old = text([rec('a')])
    local.setItem(MONEY_KEY, old)
    const idb = fakeIdb({ corrupt: (k, v) => (k === MONEY_KEY ? v.slice(0, -2) : v) })
    const errors: string[] = []
    const s = make({ local, idb: idb.factory, onError: (m) => errors.push(m) })
    await s.moveIn()
    expect(local.getItem(MONEY_KEY)).toBe(old)
    expect(s.getItem(MONEY_KEY)).toBe(old)
    expect(errors.join(' ')).toMatch(/could not be moved/)
    expect(s.status().keys.find((k) => k.key === MONEY_KEY)?.where).toBe('localStorage')
    // Saving keeps working where the data is.
    const next = text([rec('a'), rec('b')])
    s.setItem(MONEY_KEY, next)
    await s.flush()
    expect(local.getItem(MONEY_KEY)).toBe(next)
    expect(s.getItem(MONEY_KEY)).toBe(next)
    // The Data center says it plainly.
    expect(moneyWhere(s.status())).toBe('localStorage')
    expect(moneyMeter(s.status())?.note).toMatch(/could not be moved to IndexedDB.*about 20,000 records/)
  })

  it('interrupted before the write: nothing changed. Interrupted after the write, before the removal: the next start finishes it', async () => {
    const local = memLocal()
    const old = text([rec('a'), rec('b')])
    local.setItem(MONEY_KEY, old)
    local.setItem(MONEY_MARK, 'idb')
    // 1. The write to IndexedDB fails (the page closed, the disk was full).
    let fail = true
    const idb = fakeIdb({ failPut: (k) => fail && k === MONEY_KEY })
    const s1 = make({ local, idb: idb.factory })
    await s1.ready
    expect(local.getItem(MONEY_KEY)).toBe(old)
    expect(idb.data.has(MONEY_KEY)).toBe(false)
    expect(s1.getItem(MONEY_KEY)).toBe(old)
    // 2. The write lands but the page closes before the old copy is removed: both hold the same text.
    idb.data.set(MONEY_KEY, old)
    fail = false
    const s2 = make({ local, idb: idb.factory })
    await s2.ready
    expect(local.getItem(MONEY_KEY)).toBeNull()
    expect(idb.data.get(MONEY_KEY)).toBe(old)
    expect(ids(s2.getItem(MONEY_KEY))).toEqual(['a', 'b'])
  })

  it('a read just before the move is done still finds the data, and one made in another window while it moves does too', async () => {
    const local = memLocal()
    const old = text([rec('a')])
    local.setItem(MONEY_KEY, old)
    local.setItem(MONEY_MARK, 'idb')
    const idb = fakeIdb()
    const [ca, cb] = channelPair()
    const a = make({ local, idb: idb.factory, channel: ca })
    const b = make({ local, idb: idb.factory, channel: cb })
    expect(a.getItem(MONEY_KEY)).toBe(old)
    expect(b.getItem(MONEY_KEY)).toBe(old)
    await Promise.all([a.ready, b.ready])
    await tick()
    expect(local.getItem(MONEY_KEY)).toBeNull()
    expect(a.getItem(MONEY_KEY)).toBe(old)
    expect(b.getItem(MONEY_KEY)).toBe(old)
  })

  it('the locked copy moves the same way, and the sync copies of a locked Money too', async () => {
    const local = memLocal()
    local.setItem(MONEY_ENC, '{"salt":"s","iv":"i","data":"sealed"}')
    local.setItem('life_sync_app_sync_finance_sealed_mine', 'm'.repeat(1000))
    local.setItem('finance-helper.head', '{"v":1,"enc":{"salt":"s","iter":1}}')
    const idb = fakeIdb()
    const s = make({ local, idb: idb.factory })
    await s.moveIn()
    expect(idb.data.get(MONEY_ENC)).toBe('{"salt":"s","iv":"i","data":"sealed"}')
    expect(local.getItem(MONEY_ENC)).toBeNull()
    expect(idb.data.get('life_sync_app_sync_finance_sealed_mine')).toHaveLength(1000)
    // What the lock screen needs before any of that is loaded stays in localStorage.
    expect(local.getItem('finance-helper.head')).not.toBeNull()
    expect(isAppKey('finance-helper.head')).toBe(false)
  })
})

describe('no IndexedDB', () => {
  it('missing, blocked, or never answering: Money stays in localStorage, works, and the status says so', async () => {
    for (const idb of [null, fakeIdb({ failOpen: true }).factory, fakeIdb({ hangOpen: true }).factory]) {
      const local = memLocal()
      const old = text([rec('a')])
      local.setItem(MONEY_KEY, old)
      const s = make({ local, idb, openWait: 30 })
      await s.moveIn()
      expect(s.status().mode).toBe('localStorage')
      expect(s.status().error).toMatch(/IndexedDB is not available/)
      expect(s.getItem(MONEY_KEY)).toBe(old)
      const next = text([rec('a'), rec('b')])
      s.setItem(MONEY_KEY, next)
      await s.flush()
      expect(local.getItem(MONEY_KEY)).toBe(next)
      expect(moneyMeter(s.status())).toMatchObject({ id: 'money', where: expect.stringMatching(/localStorage/) })
      expect(moneyMeter(s.status())?.note).toMatch(/IndexedDB is not available in this window.*about 20,000 records/)
    }
  })

  it('a save IndexedDB refuses later goes to localStorage; when that is full too, flush() throws', async () => {
    let fail = false
    const small = text([rec('a'), rec('b')])
    const local = memLocal(small.length + 400)
    local.setItem(MONEY_MARK, 'idb')
    const idb = fakeIdb({ failPut: () => fail })
    const s = make({ local, idb: idb.factory })
    await s.ready
    s.setItem(MONEY_KEY, text([rec('a')]))
    await s.flush()
    fail = true
    s.setItem(MONEY_KEY, small)
    await s.flush()
    expect(local.getItem(MONEY_KEY)).toBe(small)
    expect(s.getItem(MONEY_KEY)).toBe(small)
    expect(s.status().error).toMatch(/kept in the small one/)
    // Removing it (Reset this device) removes the older copy in IndexedDB too, so it can't come back.
    fail = false
    s.removeItem(MONEY_KEY)
    await s.flush()
    expect(local.getItem(MONEY_KEY)).toBeNull()
    expect(idb.data.has(MONEY_KEY)).toBe(false)
    // Too big for both: said out loud, and still answered from memory in this window.
    fail = true
    const big = text(Array.from({ length: 40 }, (_, i) => rec(`r${i}`)))
    s.setItem(MONEY_KEY, big)
    await expect(s.flush()).rejects.toThrow(/storage is full/)
    expect(s.getItem(MONEY_KEY)).toBe(big)
  })
})

describe('never replaced by a copy the window did not know', () => {
  it('a copy an older tab writes to localStorage later is merged in: both sides\' records stay, a deletion sticks', async () => {
    const local = memLocal()
    local.setItem(MONEY_MARK, 'idb')
    const idb = fakeIdb()
    idb.data.set(MONEY_KEY, text([rec('a'), rec('new', { updatedAt: 9 })], { deleted: { gone: 50 } }))
    local.setItem(MONEY_KEY, text([rec('a'), rec('gone', { updatedAt: 2 }), rec('old-tab', { updatedAt: 7 })]))
    const s = make({ local, idb: idb.factory })
    await s.ready
    expect(ids(s.getItem(MONEY_KEY))).toEqual(['a', 'new', 'old-tab'])
    expect(ids(idb.data.get(MONEY_KEY))).toEqual(['a', 'new', 'old-tab'])
    expect(local.getItem(MONEY_KEY)).toBeNull()
    expect(s.status().error).toBeNull()
  })

  it('it also arrives while the app is open (a `storage` event from the older tab)', async () => {
    const local = memLocal()
    local.setItem(MONEY_MARK, 'idb')
    const idb = fakeIdb()
    const host = fakeWindow(local)
    const s = createBigStore({ local, idb: idb.factory, win: host.win, merge: moneyMerge }).forWindow(host.win)
    await s.ready
    s.setItem(MONEY_KEY, text([rec('a')]))
    await s.flush()
    const theirs = text([rec('a'), rec('old-tab', { updatedAt: 7 })])
    local.setItem(MONEY_KEY, theirs)
    host.fire('storage', { key: MONEY_KEY, newValue: theirs, storageArea: local })
    await s.flush()
    expect(ids(s.getItem(MONEY_KEY))).toEqual(['a', 'old-tab'])
    // The page is told, so the Money frame and the sync pick it up.
    await tick()
    expect(host.heard.some((e) => e.key === MONEY_KEY && ids(e.newValue)?.includes('old-tab'))).toBe(true)
  })

  it('an older tab that keeps writing: its copy is merged every time and left where it expects it (no tug of war); the next start removes it', async () => {
    const local = memLocal()
    local.setItem(MONEY_MARK, 'idb')
    const idb = fakeIdb()
    const host = fakeWindow(local)
    const s = createBigStore({ local, idb: idb.factory, win: host.win, merge: moneyMerge }).forWindow(host.win)
    await s.ready
    s.setItem(MONEY_KEY, text([rec('a'), rec('mine', { updatedAt: 9 })]))
    await s.flush()
    const theirs = text([rec('a'), rec('old-tab', { updatedAt: 7 })])
    local.setItem(MONEY_KEY, theirs)
    host.fire('storage', { key: MONEY_KEY, newValue: theirs, storageArea: local })
    await s.flush()
    expect(ids(idb.data.get(MONEY_KEY))).toEqual(['a', 'mine', 'old-tab'])
    // Left in place: removing it would make the older tab write it again, for ever.
    expect(local.getItem(MONEY_KEY)).toBe(theirs)
    expect(s.getItem(MONEY_KEY)).toBe(idb.data.get(MONEY_KEY))
    // The same copy is not merged a second time.
    const puts = idb.puts.length
    host.fire('storage', { key: MONEY_KEY, newValue: theirs, storageArea: local })
    await s.flush()
    expect(idb.puts.length).toBe(puts)
    // The next start takes it in once more and removes it.
    const next = make({ local, idb: idb.factory })
    await next.ready
    expect(local.getItem(MONEY_KEY)).toBeNull()
    expect(ids(next.getItem(MONEY_KEY))).toEqual(['a', 'mine', 'old-tab'])
  })

  it('two windows: a save from one that had not yet seen the other\'s save loses neither record', async () => {
    const idb = fakeIdb()
    const la = memLocal()
    const lb = memLocal()
    la.setItem(MONEY_MARK, 'idb')
    lb.setItem(MONEY_MARK, 'idb')
    idb.data.set(MONEY_KEY, text([rec('a')]))
    // No channel: neither window hears about the other's write.
    const a = make({ local: la, idb: idb.factory })
    const b = make({ local: lb, idb: idb.factory })
    await Promise.all([a.ready, b.ready])
    a.setItem(MONEY_KEY, text([rec('a'), rec('from-a', { updatedAt: 5 })]))
    await a.flush()
    b.setItem(MONEY_KEY, text([rec('a'), rec('from-b', { updatedAt: 6 })]))
    await b.flush()
    expect(ids(idb.data.get(MONEY_KEY))).toEqual(['a', 'from-a', 'from-b'])
    // The window that merged shows the other's record too.
    expect(ids(b.getItem(MONEY_KEY))).toEqual(['a', 'from-a', 'from-b'])
    // A's next save (it still has not heard of B) merges as well.
    a.setItem(MONEY_KEY, text([rec('a'), rec('from-a', { updatedAt: 5 }), rec('a2', { updatedAt: 8 })]))
    await a.flush()
    expect(ids(idb.data.get(MONEY_KEY))).toEqual(['a', 'a2', 'from-a', 'from-b'])
  })

  it('with the channel, the other window simply has the new data (no merge needed), and a plain save still replaces', async () => {
    const idb = fakeIdb()
    const la = memLocal()
    const lb = memLocal()
    la.setItem(MONEY_MARK, 'idb')
    lb.setItem(MONEY_MARK, 'idb')
    const [ca, cb] = channelPair()
    const a = make({ local: la, idb: idb.factory, channel: ca })
    const b = make({ local: lb, idb: idb.factory, channel: cb })
    await Promise.all([a.ready, b.ready])
    a.setItem(MONEY_KEY, text([rec('a'), rec('b')]))
    await a.flush()
    await tick()
    expect(ids(b.getItem(MONEY_KEY))).toEqual(['a', 'b'])
    // B removes a record without a deletion mark (a restore does): it is a replace, not a merge.
    b.setItem(MONEY_KEY, text([rec('a')]))
    await b.flush()
    await tick()
    expect(ids(idb.data.get(MONEY_KEY))).toEqual(['a'])
    expect(ids(a.getItem(MONEY_KEY))).toEqual(['a'])
  })

  it('sealed copies cannot be merged: the later one is used, the other is kept, and the status says so', async () => {
    const local = memLocal()
    local.setItem(MONEY_MARK, 'idb')
    const idb = fakeIdb()
    idb.data.set(MONEY_ENC, 'sealed-in-indexeddb')
    local.setItem(MONEY_ENC, 'sealed-by-an-older-tab')
    const s = make({ local, idb: idb.factory })
    await s.ready
    expect(s.getItem(MONEY_ENC)).toBe('sealed-by-an-older-tab')
    expect(idb.data.get(`${MONEY_ENC}.kept`)).toBe('sealed-in-indexeddb')
    expect(s.status().error).toMatch(/Two copies.*kept as "finance-helper.enc.kept"/)
  })
})

describe('Life\'s page and the Money frame share one store', () => {
  it('each hears the other\'s change as a `storage` event, never its own; both read the same at once', async () => {
    const local = memLocal()
    local.setItem(MONEY_MARK, 'idb')
    const idb = fakeIdb()
    const host = fakeWindow(local)
    const frame = fakeWindow(local)
    const root = createBigStore({ local, idb: idb.factory, win: host.win, merge: moneyMerge })
    const page = root.forWindow(host.win)
    const money = page.forWindow(frame.win)
    expect(page.forWindow(frame.win)).toBe(money)
    await page.ready
    const one = text([rec('a')])
    money.setItem(MONEY_KEY, one)
    expect(page.getItem(MONEY_KEY)).toBe(one)
    await tick()
    expect(host.heard).toEqual([{ key: MONEY_KEY, newValue: one }])
    expect(frame.heard).toEqual([])
    const two = text([rec('a'), rec('b')])
    page.setItem(MONEY_KEY, two)
    expect(money.getItem(MONEY_KEY)).toBe(two)
    await tick()
    expect(frame.heard).toEqual([{ key: MONEY_KEY, newValue: two }])
    expect(host.heard).toHaveLength(1)
    // The sync's own copies are nobody's business: no events for them.
    page.setItem('life_sync_app_sync_finance', one)
    await tick()
    expect(frame.heard).toHaveLength(1)
    // A frame that went away is not sent anything more.
    frame.fire('pagehide')
    page.setItem(MONEY_KEY, one)
    await tick()
    expect(frame.heard).toHaveLength(1)
    await page.flush()
    expect(idb.data.get(MONEY_KEY)).toBe(one)
    // The frame is reloaded: the same window, a new page. It asks for the store again and hears again.
    ;(frame.win as any).document = {}
    expect(page.forWindow(frame.win)).toBe(money)
    page.setItem(MONEY_KEY, two)
    await tick()
    expect(frame.heard).toHaveLength(2)
    expect(host.heard).toHaveLength(1)
  })
})

describe('a save on its way when the page closes', () => {
  it('is kept in localStorage and lands on the next start exactly as written', async () => {
    const local = memLocal()
    local.setItem(MONEY_MARK, 'idb')
    const idb = fakeIdb()
    idb.data.set(MONEY_KEY, text([rec('a'), rec('b')]))
    const host = fakeWindow(local)
    const s = createBigStore({ local, idb: idb.factory, win: host.win, merge: moneyMerge })
    await s.ready
    // A record removed without a mark (a restore, a seed): a merge would bring it back.
    const last = text([rec('a')])
    s.setItem(MONEY_KEY, last)
    host.fire('pagehide')
    expect(local.getItem(`life_big_pending:${MONEY_KEY}`)).toBe(last)
    // The page is gone before IndexedDB has it.
    idb.data.set(MONEY_KEY, text([rec('a'), rec('b')]))
    const next = make({ local, idb: idb.factory })
    await next.ready
    expect(ids(next.getItem(MONEY_KEY))).toEqual(['a'])
    expect(idb.data.get(MONEY_KEY)).toBe(last)
    expect(local.getItem(`life_big_pending:${MONEY_KEY}`)).toBeNull()
    expect(local.getItem(`life_big_pending_base:${MONEY_KEY}`)).toBeNull()
  })

  it('if another window saved in between, the two are merged', async () => {
    const local = memLocal()
    local.setItem(MONEY_MARK, 'idb')
    const idb = fakeIdb()
    const base = text([rec('a')])
    idb.data.set(MONEY_KEY, text([rec('a'), rec('other-window', { updatedAt: 9 })]))
    local.setItem(`life_big_pending:${MONEY_KEY}`, text([rec('a'), rec('closing', { updatedAt: 8 })]))
    local.setItem(`life_big_pending_base:${MONEY_KEY}`, textMark(base))
    const s = make({ local, idb: idb.factory })
    await s.ready
    expect(ids(s.getItem(MONEY_KEY))).toEqual(['a', 'closing', 'other-window'])
    expect(ids(idb.data.get(MONEY_KEY))).toEqual(['a', 'closing', 'other-window'])
  })

  it('too big for localStorage: it is handed to IndexedDB once more with the commit asked for at once', async () => {
    const local = memLocal(2_000)
    local.setItem(MONEY_MARK, 'idb')
    const idb = fakeIdb()
    const host = fakeWindow(local)
    const s = createBigStore({ local, idb: idb.factory, win: host.win, merge: moneyMerge })
    await s.ready
    const big = text(Array.from({ length: 60 }, (_, i) => rec(`r${i}`)))
    s.setItem(MONEY_KEY, big)
    const before = idb.puts.length
    host.fire('pagehide')
    await s.flush()
    expect(local.getItem(`life_big_pending:${MONEY_KEY}`)).toBeNull()
    expect(idb.data.get(MONEY_KEY)).toBe(big)
    expect(idb.puts.length - before).toBe(2)
  })
})

describe('everything that reads Money reads the new place', () => {
  const require = createRequire(import.meta.url)
  let SQL: SqlJsStatic
  beforeAll(async () => {
    SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
  })
  /** `room`: how much more than Money itself the small storage can hold (default: no limit). */
  const moved = async (tx: any[], room = Infinity) => {
    const local = memLocal(text(tx).length + room)
    const idb = fakeIdb()
    local.setItem(MONEY_KEY, text(tx))
    const s = make({ local, idb: idb.factory })
    await s.moveIn()
    expect(local.getItem(MONEY_KEY)).toBeNull()
    return { local, idb, s }
  }
  const fakeServer = () => {
    const remote = new SQL.Database()
    for (const m of MIGRATIONS) remote.exec(m)
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const json = handlePipeline(remote, JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    })
    return remote
  }

  it('the bots and the Money hub (financeStateFrom), and the monthly check-up reminder', async () => {
    const { s, local } = await moved([rec('a'), rec('b')])
    const db = new SQL.Database()
    for (const m of MIGRATIONS) db.exec(m)
    expect(financeStateFrom(db, s).tx.map((t: any) => t.id)).toEqual(['a', 'b'])
    // The same call on plain localStorage finds nothing any more: every reader must use the store.
    expect(financeStateFrom(db, local)).toBeNull()
    let read = false
    const store = { getItem: (k: string) => ((read ||= k === MONEY_KEY), s.getItem(k)), setItem: (k: string, v: string) => s.setItem(k, v) }
    await checkCheckup({ store, add: async () => {}, bellIds: async () => [], now: new Date('2026-11-18T08:30:00Z') })
    expect(read).toBe(true)
  })

  it('Finance Helper itself: load, save, a debounced save, Reset this device, and "Check everything"', async () => {
    const { s, idb, local } = await moved([rec('a'), rec('b')])
    const state = load(s)
    expect(state.tx.map((t: any) => t.id)).toEqual(['a', 'b'])
    // The theme is kept where the page can read it before anything has loaded.
    expect(JSON.parse(local.getItem('finance-helper.paint')!)).toEqual({ theme: state.settings.theme || '', themeInLife: state.settings.themeInLife || '' })
    state.tx.push(rec('c'))
    expect(save(state, s)).toBe(true)
    await s.flush()
    expect(ids(idb.data.get(MONEY_KEY))).toEqual(['a', 'b', 'c'])
    expect(local.getItem(MONEY_KEY)).toBeNull()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    state.tx.push(rec('d'))
    saveSoon(state, s)
    expect(flushSave()).toBe(true)
    vi.useRealTimers()
    await s.flush()
    expect(ids(idb.data.get(MONEY_KEY))).toEqual(['a', 'b', 'c', 'd'])
    expect(storageInfo(s)).toEqual({ where: 'indexeddb', error: null })
    wipeStore(s)
    await s.flush()
    expect(idb.data.has(MONEY_KEY)).toBe(false)
    expect(load(s).tx).toEqual([])
  })

  it('a save that can be stored nowhere is said out loud (fh-save-failed), not called saved', async () => {
    let fail = false
    const local = memLocal(1_500)
    local.setItem(MONEY_MARK, 'idb')
    const idb = fakeIdb({ failPut: () => fail })
    const s = make({ local, idb: idb.factory })
    await s.ready
    expect(text([rec('r0')]).length).toBeGreaterThan(1_500)
    const heard: string[] = []
    vi.stubGlobal('dispatchEvent', (e: Event) => (heard.push(e.type), true))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fail = true
    expect(save(fin(Array.from({ length: 30 }, (_, i) => rec(`r${i}`))), s)).toBe(true)
    await s.flush().catch(() => {})
    await tick()
    expect(heard).toContain('fh-save-failed')
  })

  it('a backup holds it, and a restore puts it back: the round trip gives the same records', async () => {
    const { s, idb, local } = await moved([rec('a'), rec('b', { amount: 2500 })])
    const blobs = appBlobsOf(s)
    expect((blobs.financeState as any).tx.map((t: any) => t.id)).toEqual(['a', 'b'])
    const snap = { version: 2, tables: {}, ...blobs } as unknown as Snapshot
    // Things change after the backup, then it is restored.
    s.setItem(MONEY_KEY, text([rec('a'), rec('b', { amount: 2500 }), rec('after', { updatedAt: 9 })]))
    await s.flush()
    const done = putBackApps(s, snap, { financeState: FINANCE.share!(blobs.financeState) }, 'r1', 1000, { financeState: { share: FINANCE.share, fromShared: FINANCE.fromShared, adopt: FINANCE.adopt } })
    await s.flush()
    expect(done).toContain('financeState')
    const back = JSON.parse(idb.data.get(MONEY_KEY)!)
    expect(back.tx.map((t: any) => [t.id, t.amount])).toEqual([['a', 1000], ['b', 2500]])
    expect(local.getItem(MONEY_KEY)).toBeNull()
    // The copy from before the restore is kept too (IndexedDB), with the record made after the backup.
    expect(ids(JSON.parse(idb.data.get('life_sync_app_sync_finance_before_restore')!).raw)).toEqual(['a', 'after', 'b'])
    // The locked copy is a backup field of its own.
    s.setItem(MONEY_ENC, 'sealed')
    expect(appBlobsOf(s).financeEnc).toBe('sealed')
    expect(APP_BLOBS.map((b) => b.localKey)).toEqual(expect.arrayContaining([MONEY_KEY, MONEY_ENC]))
  })

  it('the sync runs on it: this device\'s records reach the cloud and another device\'s arrive, all in IndexedDB', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const remote = fakeServer()
    const { s, idb, local } = await moved([rec('a'), rec('b')], 1_500)
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
    await mirror.ready
    const app = createAppSync(mirror, FINANCE, s)
    expect(await app.sync({ check: true })).toMatchObject({ ok: true, confirmed: true })
    const cloud = () => JSON.parse(String(remote.exec("SELECT value FROM settings WHERE key = 'app_sync_finance'")[0].values[0][0]))
    expect(cloud().data.tx.map((t: any) => t.id)).toEqual(['a', 'b'])
    // Another device adds records: far more than this device's localStorage could hold.
    const many = Array.from({ length: 40 }, (_, i) => rec(`far${i}`, { updatedAt: 20 + i }))
    const other = make({ local: memLocal(), idb: fakeIdb().factory })
    await other.moveIn()
    other.setItem(MONEY_KEY, text([rec('a'), rec('b'), ...many]))
    const mirror2 = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
    await mirror2.ready
    expect(await createAppSync(mirror2, FINANCE, other).sync({ check: true })).toMatchObject({ ok: true, confirmed: true })
    expect(cloud().data.tx).toHaveLength(42)
    await mirror.refresh()
    expect(await app.sync({ check: true })).toMatchObject({ ok: true })
    expect(JSON.parse(idb.data.get(MONEY_KEY)!).tx).toHaveLength(42)
    expect(local.getItem(MONEY_KEY)).toBeNull()
    expect(s.status().error).toBeNull()
  })

  it('expenses from Telegram are added through the store, and "added" waits until they are stored', async () => {
    fakeServer()
    const { s, idb } = await moved([rec('a')])
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
    await mirror.ready
    await mirror.write((db) => db.prepare("INSERT INTO settings (key, value) VALUES ('finance_inbox_json', ?)").run(JSON.stringify([{ id: 'tg1', amount: 12, category: 'food', note: 'lunch', at: Date.parse('2026-11-18T08:00:00Z') }])))
    const added = await createFinanceInbox(mirror, s).apply()
    expect(added).toBe(1)
    // Already on disk when apply() returns.
    expect(JSON.parse(idb.data.get(MONEY_KEY)!).tx).toHaveLength(2)
  })

  it('the website\'s waiting changes are kept in IndexedDB too: a Money change bigger than localStorage still waits safely', async () => {
    fakeServer()
    const local = memLocal(20_000)
    const idb = fakeIdb()
    vi.stubGlobal('localStorage', local)
    vi.stubGlobal('indexedDB', idb.factory)
    const heard: string[] = []
    vi.stubGlobal('window', { addEventListener: () => {}, dispatchEvent: (e: Event) => (heard.push(e.type), true) })
    vi.stubGlobal('navigator', { onLine: true })
    const m = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await m.ready
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    const big = JSON.stringify({ savedAt: 1, data: fin(Array.from({ length: 400 }, (_, i) => rec(`r${i}`))) })
    expect(big.length).toBeGreaterThan(60_000)
    await m.write((db) => db.prepare("INSERT INTO settings (key, value) VALUES ('app_sync_finance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(big))
    expect(m.pendingOffline).toBe(1)
    expect(heard).not.toContain('life-not-stored')
    expect(idb.data.get(OUTBOX_KEY)!.length).toBeGreaterThan(60_000)
    expect(local.getItem(OUTBOX_KEY)).toBeNull()
    expect(m.health().error ?? '').not.toMatch(/can't store/)
    // A new page on this device finds the waiting change.
    const again = make({ local, idb: idb.factory })
    await again.ready
    expect(JSON.parse(again.getItem(OUTBOX_KEY)!)).toHaveLength(1)
  })

  it('…and when neither storage can take them, the page is told before the write returns ("Not saved yet")', async () => {
    fakeServer()
    const local = memLocal(20_000)
    const idb = fakeIdb({ failPut: (k) => k === OUTBOX_KEY })
    vi.stubGlobal('localStorage', local)
    vi.stubGlobal('indexedDB', idb.factory)
    const heard: string[] = []
    vi.stubGlobal('window', { addEventListener: () => {}, dispatchEvent: (e: Event) => (heard.push(e.type), true) })
    vi.stubGlobal('navigator', { onLine: true })
    const m = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await m.ready
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    const big = JSON.stringify({ savedAt: 1, data: fin(Array.from({ length: 400 }, (_, i) => rec(`r${i}`))) })
    await m.write((db) => db.prepare("INSERT INTO settings (key, value) VALUES ('app_sync_finance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(big))
    expect(heard).toContain('life-not-stored')
    expect(m.pendingOffline).toBe(1)
    expect(m.health().error).toMatch(/can't store/)
  })
})

describe('the Data center line', () => {
  it('says where Money is, and that it has no limit of its own in IndexedDB', async () => {
    const local = memLocal()
    const old = text([rec('a')])
    local.setItem(MONEY_KEY, old)
    const idb = fakeIdb()
    const s = make({ local, idb: idb.factory })
    await s.ready
    expect(moneyWhere(s.status())).toBe('localStorage')
    expect(moneyMeter(s.status())).toMatchObject({ id: 'money', used: old.length, limit: null, level: 'ok' })
    expect(moneyMeter(s.status())?.note).toMatch(/moves to IndexedDB.*first time Money is opened/)
    await s.moveIn()
    expect(moneyWhere(s.status())).toBe('indexeddb')
    expect(moneyMeter(s.status())).toMatchObject({ id: 'money', used: old.length, limit: null, where: expect.stringMatching(/IndexedDB/) })
    expect(moneyMeter(s.status())?.note).toMatch(/No 5 million character limit/)
    // No Money on this device: no line.
    expect(moneyMeter(make({ local: memLocal(), idb: null }).status())).toBeNull()
  })
})
