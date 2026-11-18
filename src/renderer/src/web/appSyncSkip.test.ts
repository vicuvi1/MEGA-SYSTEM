// The routine check of an app's copy (every 10 minutes and on focus) used to
// merge and compare everything again even when nothing had changed: most of a
// second on the page's own thread with tens of thousands of Money records.
// Now a run whose three texts (this device's data, the agreed copy, this
// device's copy of the database) are the same as the last run that changed
// nothing and was confirmed skips the merge; a check still asks the server.
// Any change on either side is merged as before. Made-up data only.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { createAppSync, type AppSyncSpec } from './appSync'
import { FINANCE } from './financeSync'
// @ts-ignore plain JS module from the embedded app
import { normalizeState } from '../../public/apps/finance/js/model.js'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const KEY = 'finance-helper.state'
const rec = (id: string, extra: any = {}) => ({ id, type: 'expense', amount: 1000, currency: 'MDL', rate: 1, base: 1000, date: '2026-11-01', category: 'food', account: 'wallet', note: id, createdAt: 1, updatedAt: 1, ...extra })
const fin = (tx: any[]) => normalizeState({ version: 9, settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', updatedAt: 1 }], categories: [{ id: 'food', type: 'expense', name: 'Food', updatedAt: 1 }] }, tx, people: [], deleted: {}, meta: {} })

function memStore(): Storage {
  const m = new Map<string, string>()
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as unknown as Storage
}

function cloud() {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const json = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  let n = 0
  const read = (): any => JSON.parse(String(remote.exec("SELECT value FROM settings WHERE key = 'app_sync_finance'")[0]?.values[0]?.[0] ?? 'null'))
  const write = (v: any) => {
    remote.run("INSERT INTO settings (key, value) VALUES ('app_sync_finance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(v)])
    remote.run("INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [`other-${++n}`])
  }
  return { remote, read, write, ids: () => (read()?.data?.tx ?? []).map((t: any) => t.id).sort() }
}

/** Finance's spec with its merge counted. */
function counted(): { spec: AppSyncSpec; merges: () => number } {
  let merges = 0
  return { spec: { ...FINANCE, custom: undefined, merge: (a, b, n) => (merges++, FINANCE.merge(a, b, n)) }, merges: () => merges }
}

it('a check with nothing changed skips the merge, and still asks the server', async () => {
  const c = cloud()
  const store = memStore()
  store.setItem(KEY, JSON.stringify(fin([rec('a'), rec('b')])))
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
  await mirror.ready
  const { spec, merges } = counted()
  const app = createAppSync(mirror, spec, store)
  expect((await app.sync({ check: true })).confirmed).toBe(true)
  expect(c.ids()).toEqual(['a', 'b'])
  // The run after a write is a full compare (it finds nothing to do, and is remembered).
  expect((await app.sync({ check: true })).confirmed).toBe(true)
  const before = merges()
  const asked = vi.spyOn(mirror, 'serverSetting')
  for (let i = 0; i < 5; i++) {
    const r = await app.sync({ check: true })
    expect(r).toMatchObject({ ok: true, confirmed: true, sent: 0, changes: 0 })
  }
  expect(merges()).toBe(before)
  expect(app.skipped()).toBe(5)
  expect(asked).toHaveBeenCalledTimes(5)
  expect(app.status().state).toBe('ok')
})

it('a record added here after a skipped check is merged and sent as before', async () => {
  const c = cloud()
  const store = memStore()
  store.setItem(KEY, JSON.stringify(fin([rec('a')])))
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
  await mirror.ready
  const { spec } = counted()
  const app = createAppSync(mirror, spec, store)
  await app.sync({ check: true })
  await app.sync({ check: true })
  await app.sync({ check: true })
  expect(app.skipped()).toBe(1)
  store.setItem(KEY, JSON.stringify(fin([rec('a'), rec('new', { updatedAt: 5 })])))
  const r = await app.sync()
  expect(r.sent).toBe(1)
  expect(c.ids()).toEqual(['a', 'new'])
  expect(app.skipped()).toBe(1)
})

it('a record another device added after a skipped check is taken as before', async () => {
  const c = cloud()
  const store = memStore()
  store.setItem(KEY, JSON.stringify(fin([rec('a')])))
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
  await mirror.ready
  const { spec, merges } = counted()
  const app = createAppSync(mirror, spec, store)
  await app.sync({ check: true })
  await app.sync({ check: true })
  await app.sync({ check: true })
  expect(app.skipped()).toBe(1)
  const theirs = c.read()
  c.write({ ...theirs, savedAt: theirs.savedAt + 10, editedAt: theirs.editedAt + 10, data: { ...theirs.data, tx: [...theirs.data.tx, rec('phone', { updatedAt: 9 })] } })
  const before = merges()
  const r = await app.sync({ check: true })
  expect(merges()).toBeGreaterThan(before)
  expect(r.got).toBe(1)
  expect(JSON.parse(store.getItem(KEY)!).tx.map((t: any) => t.id).sort()).toEqual(['a', 'phone'])
})

it('the server holding something else than this device thinks is never skipped over', async () => {
  const c = cloud()
  const store = memStore()
  store.setItem(KEY, JSON.stringify(fin([rec('a')])))
  let bytes: Uint8Array | null = null
  // The desktop: its copy is saved on the PC first, so the server can differ from it.
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), { load: async () => bytes, save: async (b) => void (bytes = b.slice()) }, true)
  await mirror.ready
  const { spec } = counted()
  const app = createAppSync(mirror, spec, store)
  await app.sync({ check: true })
  await app.sync({ check: true })
  await app.sync({ check: true })
  expect(app.skipped()).toBe(1)
  // The cloud copy is replaced behind this PC's back, without the version mark moving (a lost upload, a restore elsewhere).
  c.remote.run("UPDATE settings SET value = ? WHERE key = 'app_sync_finance'", [JSON.stringify({ savedAt: 1, editedAt: 1, data: { ...c.read().data, tx: [] } })])
  const r = await app.sync({ check: true })
  // Not "confirmed" from the fingerprints alone: the full compare ran and saw the gap.
  expect(r.confirmed).toBe(false)
  expect(app.status().state).not.toBe('ok')
})

it('"Sync now" always compares in full', async () => {
  cloud()
  const store = memStore()
  store.setItem(KEY, JSON.stringify(fin([rec('a')])))
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
  await mirror.ready
  const { spec, merges } = counted()
  const app = createAppSync(mirror, spec, store)
  await app.sync({ check: true })
  await app.sync({ check: true })
  const before = merges()
  await app.sync({ check: true, full: true })
  expect(merges()).toBeGreaterThan(before)
})
