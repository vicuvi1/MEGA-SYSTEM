// Speed and size check for Money after 10+ years: 40,000 made-up records.
// Not part of the normal test run. Run it with:
//   PERF=1 npx vitest run src/renderer/src/web/moneyScale.perf.test.ts
// It prints "before" (how it worked until 2026-11-18, measured the old way
// here) next to "after" for: sizes against the limits, saving and loading,
// the request sizes of a sync, the desktop's waiting changes, and the routine
// merge check. PERF_RECORDS=<n> changes the number of records.
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from './fakeTurso'
import { Mirror, type MirrorStore } from './mirror'
import { TursoHttp } from './tursoHttp'
import { createAppSync } from './appSync'
import { FINANCE } from './financeSync'
import { diffRows, encodePending, schemaInfo } from './desktopSync'
import { getSetting, setSetting } from '../../../main/settings'
// @ts-ignore plain JS module from the embedded app
import { normalizeState } from '../../public/apps/finance/js/model.js'

const N = Number(process.env.PERF_RECORDS) || 40_000
const KEY = 'finance-helper.state'
const SHOPS = ['Linella', 'Nr1', 'Kaufland', 'Farmacia Familiei', 'Moldtelecom', 'Premier Energy', 'Bolt', 'Andys Pizza', 'Tucano Coffee', 'Bomba']
const CATS = ['food', 'home', 'transport', 'health', 'fun', 'bills']

/** N made-up records spread over 11 years (2016 to 2026), about 10 a day. */
function records(n: number) {
  const start = Date.UTC(2016, 0, 1)
  const span = Date.UTC(2026, 10, 18) - start
  return Array.from({ length: n }, (_, i) => {
    const at = start + Math.floor((i / n) * span)
    const amount = 500 + ((i * 7919) % 48_000)
    return { id: `tx_${at.toString(36)}_${i.toString(36)}`, type: i % 23 === 0 ? 'income' : 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: new Date(at).toISOString().slice(0, 10), category: CATS[i % CATS.length], account: i % 3 ? 'card' : 'wallet', note: `${SHOPS[i % SHOPS.length]} ${i % 97}`, createdAt: at, updatedAt: at, editedOn: 'desktop' }
  })
}
const state = (tx: any[]) =>
  normalizeState({ version: 9, settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', updatedAt: 1 }, { id: 'card', name: 'Card', updatedAt: 1 }], categories: CATS.map((id) => ({ id, type: 'expense', name: id, updatedAt: 1 })) }, tx, people: [], deleted: {}, meta: {} })

const ms = (n: number) => `${n.toFixed(0)} ms`
const mb = (n: number) => `${(n / 1_000_000).toFixed(2)} MB`
const time = async <T,>(fn: () => T | Promise<T>): Promise<[number, T]> => {
  const t = performance.now()
  const r = await fn()
  return [performance.now() - t, r]
}
function memStore(): Storage {
  const m = new Map<string, string>()
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size } } as unknown as Storage
}

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})

describe.skipIf(!process.env.PERF)(`Money at ${N.toLocaleString('en-US')} records`, () => {
  it('sizes, save and load, sync requests, the desktop line, the merge check', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const out: string[] = []
    const row = (what: string, before: string, after: string) => out.push(`| ${what} | ${before} | ${after} |`)

    const tx = records(N)
    const s0 = state(tx)
    const [tSave, raw] = await time(() => JSON.stringify(s0))
    const [tLoad] = await time(() => normalizeState(JSON.parse(raw)))
    const shared = JSON.stringify(FINANCE.share!(s0))
    row('Money on this device (characters)', `${(raw.length / 1e6).toFixed(1)} M, kept 2 to 3 times in localStorage (limit about 5 M)`, `${(raw.length / 1e6).toFixed(1)} M once in localStorage; the sync's copies (${(shared.length / 1e6).toFixed(1)} M each) in IndexedDB`)
    row('Save (JSON text of all records)', ms(tSave), ms(tSave))
    row('Load (parse + check every record)', ms(tLoad), ms(tLoad))

    // ---- The website: first upload, then one edited record -----------------
    const remote = new SQL.Database()
    for (const m of MIGRATIONS) remote.exec(m)
    const sizes: number[] = []
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      sizes.push(init.body.length)
      const json = handlePipeline(remote, JSON.parse(init.body))
      const text = JSON.stringify(json)
      sizes.push(text.length)
      return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text }
    })
    const store = memStore()
    store.setItem(KEY, raw)
    const web = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
    await web.ready
    const app = createAppSync(web, FINANCE, store)
    sizes.length = 0
    const [tFirst, r1] = await time(() => app.sync({ check: true }))
    expect(r1.confirmed).toBe(true)
    const whole = JSON.stringify({ savedAt: 1, editedAt: 1, data: JSON.parse(shared) }).length
    row('First sync of everything: biggest request', `${mb(whole)} in one request (the server refuses over 4.5 MB)`, `${mb(Math.max(...sizes))} (${sizes.length / 2} requests, ${ms(tFirst)})`)

    const s1 = state([...tx.slice(0, N - 1), { ...tx[N - 1], note: 'edited at the shop', updatedAt: Date.now() }, { ...tx[5], id: 'tx_new_made_up', updatedAt: Date.now() }])
    store.setItem(KEY, JSON.stringify(s1))
    sizes.length = 0
    const up0 = web.transport.bytesUp
    const [tEdit, r2] = await time(() => app.sync())
    expect(r2.sent).toBeGreaterThan(0)
    row('Sync after one edit and one new record: sent', `${mb(whole * 2)} (the new copy and the old one for the check), refused`, `${mb(web.transport.bytesUp - up0)} of pieces, biggest request ${mb(Math.max(...sizes))} (${ms(tEdit)})`)

    // Another device takes that change.
    const other = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
    sizes.length = 0
    const [tCold] = await time(() => other.ready)
    row('A new device downloads everything: biggest answer', `${mb(whole)} + every other setting in one answer, refused`, `${mb(Math.max(...sizes))} (${ms(tCold)})`)
    const s2 = state([...s1.tx, { ...tx[9], id: 'tx_from_phone', updatedAt: Date.now() }])
    await other.write((db) => setSetting(db as any, 'app_sync_finance', JSON.stringify({ savedAt: Date.now(), editedAt: Date.now(), data: FINANCE.share!(s2) })))
    const down0 = web.transport.charsDown
    sizes.length = 0
    const [tPull] = await time(() => web.refresh())
    row('This device takes one record from another device: downloaded', `${mb(whole)}`, `${mb(web.transport.charsDown - down0)} of pieces (${ms(tPull)})`)

    // ---- The routine check with nothing changed -----------------------------
    await app.sync({ check: true })
    await app.sync({ check: true })
    const [tFull] = await time(() => app.sync({ check: true, full: true }))
    const [tSkip] = await time(() => app.sync({ check: true }))
    expect(app.skipped()).toBeGreaterThan(0)
    row('Check every 10 min and on focus, nothing changed (page thread)', `${ms(tFull)} (merge and compare every record)`, `${ms(tSkip)} (same fingerprints: skipped, the server is still asked)`)

    // ---- The desktop: one save, and days offline -----------------------------
    let bytes: Uint8Array | null = null
    let online = true
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      if (!online) throw new TypeError('Failed to fetch')
      const json = handlePipeline(remote, JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    })
    const disk: MirrorStore = { load: async () => bytes, save: async (b) => void (bytes = b.slice()) }
    const pc = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), disk, true)
    await pc.ready
    await pc.read(() => 0)
    online = false
    const value = (n: number) => JSON.stringify({ savedAt: n, editedAt: n, data: FINANCE.share!(state([...tx, { ...tx[1], id: `tx_offline_${n}`, updatedAt: n }])) })
    const v = [1, 2, 3, 4, 5, 6].map((n) => value(Date.now() + n))
    // Before: a copy of the whole database is exported and opened again to compare, then exported again to save.
    const [tOld] = await time(() => {
      const before = pc.current.raw.export()
      const old = new SQL.Database(before)
      pc.current.raw.run('UPDATE settings SET value = ? WHERE key = ?', [v[0], 'app_sync_finance'])
      const rows = diffRows(old, pc.current.raw, ['settings'], schemaInfo(pc.current.raw))
      old.close()
      // ... and the waiting row held the new value once and the row images (before and after) too.
      pc.current.raw.run('CREATE TABLE IF NOT EXISTS perf_old_outbox (id INTEGER PRIMARY KEY, data TEXT NOT NULL)')
      pc.current.raw.run('INSERT INTO perf_old_outbox (data) VALUES (?)', [encodePending({ id: 'x', base: '', version: 'x', changes: [{ sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: ['app_sync_finance', v[0]] }], rows })])
      pc.current.raw.export()
      pc.current.raw.run('DROP TABLE perf_old_outbox')
    })
    const times: number[] = []
    for (const x of v.slice(1)) times.push((await time(() => pc.write((db) => setSetting(db as any, 'app_sync_finance', x))))[0])
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    row('Desktop: one Money save to this PC', `${ms(tOld)} (the database written out twice)`, `${ms(avg)} (written out once; average of ${times.length} saves offline)`)
    const waiting = pc.health().desktopPending
    const rowBytes = Number(pc.current.raw.exec('SELECT SUM(LENGTH(data)) FROM desktop_outbox')[0].values[0][0])
    row(`Desktop: ${v.length - 1} Money saves while offline`, `${v.length - 1} waiting changes, ${mb(rowBytes * (v.length - 1))} in the database file (30 saves: ${mb(rowBytes * 30)}; the file may be 256 MB)`, `${waiting} waiting change, ${mb(rowBytes)}`)
    online = true
    sizes.length = 0
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      sizes.push(init.body.length)
      const json = handlePipeline(remote, JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    })
    const [tFlush] = await time(() => pc.refresh())
    expect(pc.health().desktopPending).toBe(0)
    expect(await pc.read((db) => getSetting(db as any, 'app_sync_finance'))).toBe(v[v.length - 1])
    row('Desktop: back online, the waiting change goes up', `one request of ${mb(whole)}: refused, and every later change waited behind it`, `biggest request ${mb(Math.max(...sizes))} (${ms(tFlush)})`)

    console.log(`\nMoney at ${N.toLocaleString('en-US')} made-up records (11 years)\n| What | Before | After |\n|---|---|---|\n${out.join('\n')}\n`)
  }, 600_000)
})
