// Money (Finance Helper) sync between the desktop and the website, 2026-11-13:
// the web was missing records the desktop had while the desktop said "Synced".
// A copy now counts as synced only once the SERVER holds it, a merge sends
// back whatever the cloud copy lacks, and every failure is shown. Made-up data only.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { BrowserDb } from './browserDb'
import { handlePipeline } from './fakeTurso'
import { Mirror, type MirrorStore } from './mirror'
import { TursoHttp } from './tursoHttp'
import { appSyncAlert, appSyncLine, appSyncRunText, createAppSync, gapOf, STALE_MS } from './appSync'
import { FINANCE, financeGap } from './financeSync'
import { logMoney } from './financeBot'
// @ts-ignore plain JS module from the embedded app
import { normalizeState } from '../../public/apps/finance/js/model.js'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
beforeEach(() => {
  // The sync's own retry timers stay out of the way (each test drives the runs).
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const KEY = 'finance-helper.state'
const rec = (id: string, extra: any = {}) => ({ id, type: 'expense', amount: 1000, currency: 'MDL', rate: 1, base: 1000, date: '2026-11-01', category: 'food', account: 'wallet', note: id, createdAt: 1, updatedAt: 1, ...extra })
const fin = (tx: any[], deleted: Record<string, number> = {}) =>
  normalizeState({ version: 9, settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', updatedAt: 1 }], categories: [{ id: 'food', type: 'expense', name: 'Food', updatedAt: 1 }] }, tx, people: [], deleted, meta: {} })

function memStore(): Storage & { full: boolean } {
  const m = new Map<string, string>()
  const s = {
    full: false,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (s.full && k === KEY) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' })
      m.set(k, String(v))
    },
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0
  }
  return s as unknown as Storage & { full: boolean }
}

function cloud() {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  let offline = false
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    if (offline) throw new TypeError('Failed to fetch')
    const json = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  let n = 0
  const read = (): any => JSON.parse(String(remote.exec("SELECT value FROM settings WHERE key = 'app_sync_finance'")[0]?.values[0]?.[0] ?? 'null'))
  /** Another writer (a bot, another device) replaces the cloud copy. */
  const write = (v: any) => {
    remote.run("INSERT INTO settings (key, value) VALUES ('app_sync_finance', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(v)])
    remote.run("INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [`other-${++n}`])
  }
  const cloudIds = () => (read()?.data?.tx ?? []).map((t: any) => t.id).sort()
  return { remote, read, write, cloudIds, setOffline: (v: boolean) => (offline = v) }
}

/** The desktop app: its database copy is saved on the PC and uploaded next in line. */
async function desktop(store: Storage) {
  let bytes: Uint8Array | null = null
  const disk: MirrorStore = { load: async () => bytes, save: async (b) => void (bytes = b.slice()) }
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), disk, true)
  await mirror.ready
  return { mirror, app: createAppSync(mirror, FINANCE, store) }
}
/** The website. */
async function web(store: Storage) {
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
  await mirror.ready
  return { mirror, app: createAppSync(mirror, FINANCE, store) }
}
const ids = (s: Storage) => (JSON.parse(s.getItem(KEY) || 'null')?.tx ?? []).map((t: any) => t.id).sort()
const put = (s: Storage, state: any) => s.setItem(KEY, JSON.stringify(state))

describe('Money sync: the cloud always ends with every record', () => {
  it('desktop records the cloud lacks are sent although the "synced" marker says up to date', async () => {
    const net = cloud()
    // The cloud copy (the web added one through the bot); the desktop has 3 more and thinks it agreed.
    net.write({ savedAt: 10, editedAt: 10, data: FINANCE.share!(fin([rec('a'), rec('tg', { updatedAt: 5 })])) })
    const pc = memStore()
    const mine = fin([rec('a'), rec('b'), rec('c'), rec('d', { date: '2026-11-13' })])
    put(pc, mine)
    pc.setItem('life_sync_app_sync_finance', JSON.stringify(FINANCE.share!(mine)))
    const d = await desktop(pc)
    const r = await d.app.sync()
    expect(net.cloudIds()).toEqual(['a', 'b', 'c', 'd', 'tg'])
    expect(ids(pc)).toEqual(['a', 'b', 'c', 'd', 'tg'])
    expect(r).toMatchObject({ ok: true, sent: 3, confirmed: true })
    expect(d.app.status()).toMatchObject({ state: 'ok', label: 'Money' })
    expect(appSyncRunText(r)).toBe('Sent 3 records · cloud up to date')
    // The website gets them on its next run.
    const phone = memStore()
    const w = await web(phone)
    await w.app.sync()
    expect(ids(phone)).toEqual(['a', 'b', 'c', 'd', 'tg'])
  })

  it('a check finds what the cloud lacks even when this device and its copy of the database agree', async () => {
    const net = cloud()
    const pc = memStore()
    put(pc, fin([rec('a')]))
    const d = await desktop(pc)
    await d.app.sync()
    expect(net.cloudIds()).toEqual(['a'])
    // Records added here while the old version marked them synced without sending them:
    // this device's copy of the database and the marker both have them, the server not.
    const more = fin([rec('a'), rec('b'), rec('c')])
    put(pc, more)
    pc.setItem('life_sync_app_sync_finance', JSON.stringify(FINANCE.share!(more)))
    await d.mirror.write((db) => db.prepare("UPDATE settings SET value = ? WHERE key = 'app_sync_finance'").run(JSON.stringify({ savedAt: 20, editedAt: 20, data: FINANCE.share!(more) })))
    // ...and the upload was lost (the server copy was put back by another writer with the old text).
    net.write({ savedAt: 21, editedAt: 10, data: FINANCE.share!(fin([rec('a')])) })
    await d.mirror.useServerCopy()
    const r = await d.app.sync({ check: true })
    expect(net.cloudIds()).toEqual(['a', 'b', 'c'])
    expect(r.confirmed).toBe(true)
  })

  it('a change waiting on the desktop that "use server copy" dropped is still sent', async () => {
    const net = cloud()
    const pc = memStore()
    put(pc, fin([rec('a')]))
    const d = await desktop(pc)
    await d.app.sync()
    // Offline: you add b on the desktop. Saved on the PC, not on the server.
    net.setOffline(true)
    put(pc, fin([rec('a'), rec('b', { updatedAt: 9 })]))
    d.app.soon()
    const r1 = await d.app.sync()
    expect(r1.confirmed).toBe(false)
    expect(d.app.status().state).toBe('error')
    expect(net.cloudIds()).toEqual(['a'])
    // Back online, "Back up and use server copy": the waiting upload is gone.
    net.setOffline(false)
    await d.mirror.useServerCopy()
    expect(net.cloudIds()).toEqual(['a'])
    const r2 = await d.app.sync()
    expect(net.cloudIds()).toEqual(['a', 'b'])
    expect(r2.confirmed).toBe(true)
    expect(d.app.status().state).toBe('ok')
  })

  it('cloud-only and desktop-only changes in the same run: both sides end with the union', async () => {
    const net = cloud()
    const pc = memStore()
    put(pc, fin([rec('a')]))
    const d = await desktop(pc)
    await d.app.sync()
    const phone = memStore()
    const w = await web(phone)
    await w.app.sync()
    // The website adds w1 (and the bot keeps its copy's edit time); the desktop adds p1.
    put(phone, fin([rec('a'), rec('w1', { updatedAt: 7 })]))
    w.app.soon()
    await w.app.sync()
    put(pc, fin([rec('a'), rec('p1', { updatedAt: 8 })]))
    d.app.soon()
    await d.mirror.refresh()
    await d.app.sync()
    expect(ids(pc)).toEqual(['a', 'p1', 'w1'])
    expect(net.cloudIds()).toEqual(['a', 'p1', 'w1'])
    await w.mirror.refresh()
    await w.app.sync()
    expect(ids(phone)).toEqual(['a', 'p1', 'w1'])
  })

  it('a remote-only change with nothing new here does not send anything back', async () => {
    const net = cloud()
    const pc = memStore()
    put(pc, fin([rec('a')]))
    const d = await desktop(pc)
    await d.app.sync()
    net.write({ ...net.read(), savedAt: 50, editedAt: 50, data: FINANCE.share!(fin([rec('a'), rec('tg', { updatedAt: 6 })])) })
    await d.mirror.refresh()
    const r = await d.app.sync({ check: true })
    expect(ids(pc)).toEqual(['a', 'tg'])
    expect(net.read().savedAt).toBe(50)
    expect(r).toMatchObject({ sent: 0, changes: 0, confirmed: true })
    // Checks again and again: nothing is written, nothing here changes.
    const before = pc.getItem(KEY)
    await d.app.sync({ check: true })
    await d.app.sync({ check: true, full: true })
    expect(net.read().savedAt).toBe(50)
    expect(pc.getItem(KEY)).toBe(before)
  })
})

describe('Money sync: never silent', () => {
  it('locked Money says "skipped (Money locked)", never "Synced"', async () => {
    cloud()
    const pc = memStore()
    pc.setItem('finance-helper.enc', '{"sealed":true}')
    const d = await desktop(pc)
    const r = await d.app.sync({ check: true })
    expect(r.skipped).toBe('Money locked')
    expect(d.app.status()).toMatchObject({ state: 'skipped', note: 'Money locked' })
    expect(appSyncRunText(r)).toBe('Not synced: skipped (Money locked)')
    expect(appSyncAlert([d.app.status()], Date.now(), true)).toMatchObject({ level: 'warn', text: 'Money: skipped (Money locked)' })
    expect(appSyncLine(d.app.status())).toBe('skipped (Money locked)')
  })

  it('a network error shows its text, loses nothing and is sent on the next try', async () => {
    const net = cloud()
    const phone = memStore()
    put(phone, fin([rec('a')]))
    const w = await web(phone)
    await w.app.sync()
    net.setOffline(true)
    put(phone, fin([rec('a'), rec('n1', { updatedAt: 4 })]))
    w.app.soon()
    const r = await w.app.sync({ check: true })
    expect(r.ok).toBe(false)
    expect(w.app.status().state).toBe('error')
    expect(w.app.status().error).toMatch(/fetch|offline|waiting/i)
    expect(ids(phone)).toEqual(['a', 'n1'])
    net.setOffline(false)
    const r2 = await w.app.sync()
    expect(r2.confirmed).toBe(true)
    expect(net.cloudIds()).toEqual(['a', 'n1'])
    expect(w.app.status().state).toBe('ok')
  })

  it('storage full: the error is shown, the cloud keeps the union, this device catches up later', async () => {
    const net = cloud()
    const pc = memStore()
    put(pc, fin([rec('a'), rec('mine', { updatedAt: 3 })]))
    pc.setItem('life_sync_app_sync_finance', JSON.stringify(FINANCE.share!(fin([rec('a'), rec('mine', { updatedAt: 3 })]))))
    net.write({ savedAt: 10, editedAt: 10, data: FINANCE.share!(fin([rec('a'), rec('tg', { updatedAt: 5 })])) })
    const d = await desktop(pc)
    pc.full = true
    const r = await d.app.sync()
    expect(r.ok).toBe(false)
    expect(d.app.status()).toMatchObject({ state: 'error' })
    expect(d.app.status().error).toMatch(/storage is full/)
    expect(ids(pc)).toEqual(['a', 'mine'])
    expect(net.cloudIds()).toEqual(['a', 'mine', 'tg'])
    pc.full = false
    const r2 = await d.app.sync()
    expect(r2.confirmed).toBe(true)
    expect(ids(pc)).toEqual(['a', 'mine', 'tg'])
  })

  it('the dot: amber when Money has not synced for 15 minutes while online, red after an error that long', () => {
    const now = 1_800_000_000_000
    const base = { setting: 'app_sync_finance', label: 'Money', at: now, error: null, note: null, sent: 0 }
    expect(appSyncAlert([{ ...base, state: 'ok', okAt: now - 60_000 }], now, true)).toBeNull()
    expect(appSyncAlert([{ ...base, state: 'ok', okAt: now - STALE_MS - 60_000 }], now, true)?.level).toBe('warn')
    expect(appSyncAlert([{ ...base, state: 'ok', okAt: now - STALE_MS - 60_000 }], now, false)).toBeNull()
    expect(appSyncAlert([{ ...base, state: 'error', okAt: now - 60_000, error: 'Turso HTTP 503' }], now, true)).toMatchObject({ level: 'warn', text: 'Money not synced: Turso HTTP 503' })
    expect(appSyncAlert([{ ...base, state: 'error', okAt: now - STALE_MS - 1, error: 'Turso HTTP 503' }], now, true)?.level).toBe('bad')
  })
})

describe('Money sync: the bot and two devices', () => {
  it("a bot save keeps the copy's edit time (moved later) and its restore id", () => {
    const raw = new SQL.Database()
    raw.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    const db = new BrowserDb(raw) as any
    const data = FINANCE.share!(fin([rec('a')]))
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('app_sync_finance', JSON.stringify({ savedAt: 100, editedAt: 4_000_000_000_000, restore: 'restore-1', data }))
    const r = logMoney(db, 'coffee 35', 'b:1', '2026-11-13', 1_800_000_000_000)
    expect(r).not.toBeNull()
    const saved = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'app_sync_finance'").get().value)
    expect(saved.restore).toBe('restore-1')
    expect(saved.editedAt).toBe(4_000_000_000_001)
    expect(saved.data.tx.length).toBe(2)
  })

  it('two devices offline: different records both kept; the same record edited on both, the newer edit wins', async () => {
    const net = cloud()
    const pc = memStore()
    put(pc, fin([rec('a'), rec('b')]))
    const d = await desktop(pc)
    await d.app.sync()
    const phone = memStore()
    const w = await web(phone)
    await w.app.sync()
    net.setOffline(true)
    // Desktop: adds x, edits a at 50. Website: adds y, edits b, edits a later (60).
    put(pc, fin([rec('a', { amount: 5000, base: 5000, updatedAt: 50 }), rec('b'), rec('x', { updatedAt: 51 })]))
    d.app.soon()
    await d.app.sync()
    put(phone, fin([rec('a', { amount: 6000, base: 6000, updatedAt: 60 }), rec('b', { note: 'edited', updatedAt: 55 }), rec('y', { updatedAt: 56 })]))
    w.app.soon()
    await w.app.sync()
    net.setOffline(false)
    await d.mirror.refresh()
    await d.app.sync()
    await w.mirror.refresh()
    await w.app.sync()
    await d.mirror.refresh()
    await d.app.sync()
    for (const s of [pc, phone]) {
      expect(ids(s)).toEqual(['a', 'b', 'x', 'y'])
      const tx = JSON.parse(s.getItem(KEY)!).tx
      expect(tx.find((t: any) => t.id === 'a').amount).toBe(6000)
      expect(tx.find((t: any) => t.id === 'b').note).toBe('edited')
    }
    expect(net.cloudIds()).toEqual(['a', 'b', 'x', 'y'])
  })

  it('what the cloud lacks is judged record by record, not by order or same-day rates', () => {
    const mine = fin([rec('b'), rec('a')])
    const theirs = FINANCE.share!(fin([rec('a'), rec('b')]))
    expect(financeGap(mine, theirs)).toEqual({ records: 0, other: 0 })
    expect(financeGap(fin([rec('a'), rec('b'), rec('c')]), theirs).records).toBe(1)
    expect(financeGap(fin([rec('a', { updatedAt: 9, amount: 1 }), rec('b')]), theirs).records).toBe(1)
    // An older edit here is not "missing" there.
    expect(financeGap(fin([rec('a')]), FINANCE.share!(fin([rec('a', { updatedAt: 9, amount: 1 })])))).toEqual({ records: 0, other: 0 })
    // A deletion here (a tombstone) counts.
    expect(financeGap(fin([rec('a')], { b: 20 }), theirs).other).toBeGreaterThan(0)
    expect(gapOf({ l: [1, 2], s: { x: 1 } }, { l: [2], s: { x: 2 } })).toEqual({ records: 1, other: 1 })
  })
})
