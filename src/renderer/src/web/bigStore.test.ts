// The sync's big copies in IndexedDB (web/bigStore.ts): the one-time move out
// of localStorage (checked before the old copy goes), the fallback when there
// is no IndexedDB or a write fails, and an app sync running on it. The
// IndexedDB here is a small stand-in that can be told to fail. Made-up data only.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { createBigStore, isBigKey } from './bigStore'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { createAppSync } from './appSync'
import { FINANCE } from './financeSync'
// @ts-ignore plain JS module from the embedded app
import { normalizeState } from '../../public/apps/finance/js/model.js'

function memLocal(quota = Infinity) {
  const m = new Map<string, string>()
  const used = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0)
  const s = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (used() - (m.has(k) ? k.length + m.get(k)!.length : 0) + k.length + String(v).length > quota) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' })
      m.set(k, String(v))
    },
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    }
  }
  return s as unknown as Storage
}

/** A tiny IndexedDB: one database, one object store, requests answered on a later tick. */
function fakeIdb(o: { failOpen?: boolean; corrupt?: (key: string, value: string) => string; failPut?: () => boolean } = {}) {
  const data = new Map<string, string>()
  const later = (fn: () => void) => void Promise.resolve().then(fn)
  const request = <T,>(get: () => T) => {
    const r: any = { result: undefined, error: null, onsuccess: null, onerror: null }
    later(() => {
      try {
        r.result = get()
        r.onsuccess?.()
      } catch (e) {
        r.error = e
        r.onerror?.()
      }
    })
    return r
  }
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => ({}),
    transaction: (_name: string, mode = 'readonly') => {
      const tx: any = { oncomplete: null, onerror: null, onabort: null, error: null }
      let bad: Error | null = null
      tx.objectStore = () => ({
        get: (k: string) => request(() => data.get(k)),
        getAll: () => request(() => [...data.values()]),
        getAllKeys: () => request(() => [...data.keys()]),
        put: (v: string, k: string) => {
          if (o.failPut?.()) bad = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' })
          else data.set(k, o.corrupt ? o.corrupt(k, v) : v)
        },
        delete: (k: string) => void data.delete(k)
      })
      if (mode === 'readwrite')
        later(() =>
          later(() => {
            if (bad) {
              tx.error = bad
              tx.onerror?.()
            } else tx.oncomplete?.()
          })
        )
      return tx
    }
  }
  const factory = {
    open: () => {
      const r: any = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null }
      later(() => {
        if (o.failOpen) {
          r.error = new Error('IndexedDB is blocked')
          r.onerror?.()
        } else {
          r.onupgradeneeded?.()
          r.onsuccess?.()
        }
      })
      return r
    }
  }
  return { factory: factory as unknown as IDBFactory, data }
}

const AGREED = 'life_sync_app_sync_finance'
const BEFORE = 'life_sync_app_sync_finance_before_restore'

describe('which keys move', () => {
  it("an app's agreed copy and its copy from before a restore; nothing else", () => {
    expect(isBigKey(AGREED)).toBe(true)
    expect(isBigKey(BEFORE)).toBe(true)
    expect(isBigKey('life_sync_app_sync_waky')).toBe(true)
    expect(isBigKey('life_sync_app_sync_finance_status')).toBe(false)
    expect(isBigKey('life_sync_app_sync_finance_sealed_mine')).toBe(false)
    expect(isBigKey('finance-helper.state')).toBe(false)
  })
})

describe('the one-time move out of localStorage', () => {
  it('moves the old copies, checks them, and only then removes them from localStorage', async () => {
    const local = memLocal()
    local.setItem(AGREED, 'a'.repeat(50_000))
    local.setItem(BEFORE, 'b'.repeat(40_000))
    local.setItem('finance-helper.state', 'the app data stays')
    local.setItem('life_sync_app_sync_finance_status', '{"state":"ok"}')
    const idb = fakeIdb()
    const s = createBigStore({ local, idb: idb.factory })
    // Before the move is done, a read still finds the old copy.
    expect(s.getItem(AGREED)).toHaveLength(50_000)
    await s.ready
    expect(s.getItem(AGREED)).toBe('a'.repeat(50_000))
    expect(s.getItem(BEFORE)).toBe('b'.repeat(40_000))
    expect(idb.data.get(AGREED)).toBe('a'.repeat(50_000))
    expect(local.getItem(AGREED)).toBeNull()
    expect(local.getItem(BEFORE)).toBeNull()
    expect(local.getItem('finance-helper.state')).toBe('the app data stays')
    expect(s.getItem('life_sync_app_sync_finance_status')).toBe('{"state":"ok"}')
    expect(s.status()).toMatchObject({ mode: 'indexeddb', error: null })
    // The next start reads them from IndexedDB.
    const again = createBigStore({ local, idb: idb.factory })
    await again.ready
    expect(again.getItem(AGREED)).toBe('a'.repeat(50_000))
  })

  it('a copy that does not read back the same stays in localStorage and is used from there', async () => {
    const local = memLocal()
    local.setItem(AGREED, 'the agreed copy')
    const idb = fakeIdb({ corrupt: (_k, v) => `${v.slice(0, -1)}?` })
    const s = createBigStore({ local, idb: idb.factory })
    await s.ready
    expect(local.getItem(AGREED)).toBe('the agreed copy')
    expect(s.getItem(AGREED)).toBe('the agreed copy')
    expect(s.status().error).toMatch(/could not be moved/)
    // Later writes of that key go where the copy is.
    s.setItem(AGREED, 'a newer agreed copy')
    await s.flush()
    expect(local.getItem(AGREED)).toBe('a newer agreed copy')
    expect(s.getItem(AGREED)).toBe('a newer agreed copy')
  })

  it('no IndexedDB (or it is blocked): everything stays in localStorage, as before', async () => {
    for (const idb of [null, fakeIdb({ failOpen: true }).factory]) {
      const local = memLocal()
      local.setItem(AGREED, 'old')
      const s = createBigStore({ local, idb })
      s.setItem(BEFORE, 'written before the store was ready')
      await s.ready
      await s.flush()
      expect(s.status().mode).toBe('localStorage')
      expect(s.getItem(AGREED)).toBe('old')
      expect(local.getItem(BEFORE)).toBe('written before the store was ready')
      s.setItem(AGREED, 'new')
      expect(local.getItem(AGREED)).toBe('new')
      s.removeItem(AGREED)
      expect(local.getItem(AGREED)).toBeNull()
      expect(s.getItem(AGREED)).toBeNull()
    }
  })

  it('a copy an older app version wrote to localStorage later is the newer one', async () => {
    const local = memLocal()
    const idb = fakeIdb()
    idb.data.set(AGREED, 'moved earlier')
    local.setItem(AGREED, 'written later by an older version')
    const s = createBigStore({ local, idb: idb.factory })
    await s.ready
    expect(s.getItem(AGREED)).toBe('written later by an older version')
    expect(idb.data.get(AGREED)).toBe('written later by an older version')
    expect(local.getItem(AGREED)).toBeNull()
  })
})

describe('writes', () => {
  it('are read back at once, stored a moment later, and bigger than localStorage could ever hold', async () => {
    const local = memLocal(5_000_000)
    const idb = fakeIdb()
    const s = createBigStore({ local, idb: idb.factory })
    await s.ready
    const big = 'm'.repeat(9_000_000)
    s.setItem(AGREED, big)
    expect(s.getItem(AGREED)).toBe(big)
    await s.flush()
    expect(idb.data.get(AGREED)).toBe(big)
    expect(local.getItem(AGREED)).toBeNull()
    s.removeItem(AGREED)
    expect(s.getItem(AGREED)).toBeNull()
    await s.flush()
    expect(idb.data.has(AGREED)).toBe(false)
  })

  it('a write IndexedDB refuses goes to localStorage instead; when that is full too, flush() says so', async () => {
    let fail = false
    const local = memLocal(1_000)
    const idb = fakeIdb({ failPut: () => fail })
    const errors: string[] = []
    const s = createBigStore({ local, idb: idb.factory, onError: (m) => errors.push(m) })
    await s.ready
    fail = true
    s.setItem(AGREED, 'small enough for the small storage')
    await s.flush()
    expect(local.getItem(AGREED)).toBe('small enough for the small storage')
    expect(s.getItem(AGREED)).toBe('small enough for the small storage')
    expect(errors[0]).toMatch(/kept in the small one/)
    s.setItem(BEFORE, 'x'.repeat(5_000))
    await expect(s.flush()).rejects.toThrow(/storage is full/)
    // Still answered from memory in this window, and the next good write clears the error.
    expect(s.getItem(BEFORE)).toHaveLength(5_000)
    fail = false
    s.setItem(BEFORE, 'y'.repeat(5_000))
    await s.flush()
    expect(idb.data.get(BEFORE)).toBe('y'.repeat(5_000))
  })

  it('a write made before the store is ready is kept, not overwritten by the load', async () => {
    const local = memLocal()
    const idb = fakeIdb()
    idb.data.set(AGREED, 'from last time')
    const s = createBigStore({ local, idb: idb.factory })
    s.setItem(AGREED, 'written first thing')
    await s.flush()
    expect(s.getItem(AGREED)).toBe('written first thing')
    expect(idb.data.get(AGREED)).toBe('written first thing')
  })

  it("another tab's write arrives over the channel", async () => {
    const idb = fakeIdb()
    const chA: any = { postMessage: (m: unknown) => chB.onmessage?.({ data: m }), onmessage: null }
    const chB: any = { postMessage: (m: unknown) => chA.onmessage?.({ data: m }), onmessage: null }
    const a = createBigStore({ local: memLocal(), idb: idb.factory, channel: chA })
    const b = createBigStore({ local: memLocal(), idb: idb.factory, channel: chB })
    await Promise.all([a.ready, b.ready])
    a.setItem(AGREED, 'from tab a')
    await a.flush()
    await new Promise((r) => setTimeout(r, 5))
    expect(b.getItem(AGREED)).toBe('from tab a')
  })
})

describe("an app's sync on it", () => {
  const require = createRequire(import.meta.url)
  let SQL: SqlJsStatic
  beforeAll(async () => {
    SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  const KEY = 'finance-helper.state'
  const rec = (id: string, extra: any = {}) => ({ id, type: 'expense', amount: 1000, currency: 'MDL', rate: 1, base: 1000, date: '2026-11-01', category: 'food', account: 'wallet', note: id, createdAt: 1, updatedAt: 1, ...extra })
  const fin = (tx: any[]) => normalizeState({ version: 9, settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', updatedAt: 1 }], categories: [{ id: 'food', type: 'expense', name: 'Food', updatedAt: 1 }] }, tx, people: [], deleted: {}, meta: {} })

  it('Money syncs as before; the agreed copy is in IndexedDB, and a store that is full is said out loud', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const remote = new SQL.Database()
    for (const m of MIGRATIONS) remote.exec(m)
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const json = handlePipeline(remote, JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    })
    let fail = false
    const local = memLocal(4_000)
    const idb = fakeIdb({ failPut: () => fail })
    local.setItem(KEY, JSON.stringify(fin([rec('a'), rec('b')])))
    const store = createBigStore({ local, idb: idb.factory })
    await store.ready
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
    await mirror.ready
    const app = createAppSync(mirror, FINANCE, store)
    const r = await app.sync({ check: true })
    expect(r).toMatchObject({ ok: true, confirmed: true })
    expect(idb.data.has(AGREED)).toBe(true)
    expect(local.getItem(AGREED)).toBeNull()
    expect(JSON.parse(idb.data.get(AGREED)!).tx.map((t: any) => t.id)).toEqual(['a', 'b'])
    // A new record, and neither storage can take the new agreed copy.
    fail = true
    local.setItem(KEY, JSON.stringify(fin([rec('a'), rec('b'), rec('c', { updatedAt: 5 })])))
    const r2 = await app.sync()
    expect(r2.ok).toBe(false)
    expect(app.status().error).toMatch(/storage is full/)
    // The record itself reached the cloud; nothing was lost.
    expect(JSON.parse(String(remote.exec("SELECT value FROM settings WHERE key = 'app_sync_finance'")[0].values[0][0])).data.tx.map((t: any) => t.id)).toEqual(['a', 'b', 'c'])
    fail = false
    const r3 = await app.sync({ check: true })
    expect(r3).toMatchObject({ ok: true, confirmed: true })
    expect(JSON.parse(idb.data.get(AGREED)!).tx).toHaveLength(3)
  })
})
