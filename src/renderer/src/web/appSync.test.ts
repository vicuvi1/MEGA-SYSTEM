import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic, type Database as SqlJsDatabase } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { MAN, WAKY, createAppSync, type AppSyncSpec } from './appSync'
import { FINANCE } from './financeSync'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.unstubAllGlobals())

function fakeTurso() {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const json = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  return remote
}
function storage(): Storage {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage
}
async function device(spec: AppSyncSpec, store: Storage) {
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
  await mirror.ready
  return { mirror, sync: createAppSync(mirror, spec, store) }
}
const read = (s: Storage, k: string) => JSON.parse(s.getItem(k) || 'null')

const fin = (tx: any[], deleted: Record<string, number> = {}) => ({
  version: 9,
  settings: { currency: 'MDL', updatedAt: 1, theme: 'dark', accounts: [{ id: 'wallet', name: 'Wallet', updatedAt: 1 }], categories: [{ id: 'food', type: 'expense', name: 'Food', updatedAt: 1 }] },
  tx,
  people: [],
  deleted,
  meta: { device: 'only here' }
})
const tx = (id: string, updatedAt: number, amount = 100) => ({ id, type: 'expense', amount, currency: 'MDL', rate: 1, base: amount, date: '2026-10-31', category: 'food', account: 'wallet', note: id, createdAt: updatedAt, updatedAt })

describe('apps synced through Turso', () => {
  it('Finance Helper: records from both devices, a deletion stays deleted, PIN/theme stay local', async () => {
    fakeTurso()
    const phone = storage()
    const pc = storage()
    phone.setItem('finance-helper.state', JSON.stringify(fin([tx('a', 10), tx('b', 10)])))
    const p = await device(FINANCE, phone)
    await p.sync.sync()

    const c = await device(FINANCE, pc)
    await c.sync.sync()
    expect(read(pc, 'finance-helper.state').tx.map((t: any) => t.id).sort()).toEqual(['a', 'b'])

    // The PC adds one and deletes 'b'; the phone edits 'a'.
    const pcState = read(pc, 'finance-helper.state')
    pcState.tx = pcState.tx.filter((t: any) => t.id !== 'b').concat(tx('c', 20))
    pcState.deleted = { b: 20 }
    pc.setItem('finance-helper.state', JSON.stringify(pcState))
    await c.sync.sync()
    const phoneState = read(phone, 'finance-helper.state')
    phoneState.tx = phoneState.tx.map((t: any) => (t.id === 'a' ? { ...t, amount: 999, base: 999, updatedAt: 30 } : t))
    phone.setItem('finance-helper.state', JSON.stringify(phoneState))
    await p.mirror.refresh()
    await p.sync.sync()

    const mine = read(phone, 'finance-helper.state')
    expect(mine.tx.map((t: any) => t.id).sort()).toEqual(['a', 'c'])
    expect(mine.tx.find((t: any) => t.id === 'a').amount).toBe(999)
    expect(mine.meta.device).toBe('only here')
    await c.mirror.refresh()
    await c.sync.sync()
    expect(read(pc, 'finance-helper.state').tx.map((t: any) => t.id).sort()).toEqual(['a', 'c'])
  })

  it('Finance Helper locked with a PIN on this device is left alone', async () => {
    const remote = fakeTurso()
    const s = storage()
    s.setItem('finance-helper.enc', 'sealed')
    s.setItem('finance-helper.state', JSON.stringify(fin([tx('a', 1)])))
    await (await device(FINANCE, s)).sync.sync()
    expect(remote.exec("SELECT COUNT(*) FROM settings WHERE key = 'app_sync_finance'")[0].values[0][0]).toBe(0)
  })

  it('a new device starts from the backup the app already kept in Turso', async () => {
    const remote = fakeTurso()
    remote.run("INSERT INTO settings (key, value) VALUES ('waky_backup_json', ?)", [JSON.stringify({ settings: { weekday: '06:30' }, days: { '2026-10-30': { time: '06:20' } }, nights: {} })])
    const s = storage()
    await (await device(WAKY, s)).sync.sync()
    expect(read(s, 'waky_web_data_v2').days['2026-10-30'].time).toBe('06:20')
  })

  it('Waky: mornings from both devices; MAN: diary from both, counters never go down', async () => {
    fakeTurso()
    const a = storage()
    const b = storage()
    a.setItem('waky_web_data_v2', JSON.stringify({ settings: { weekday: '06:30' }, days: { '2026-10-30': { time: '06:20' } }, nights: {} }))
    b.setItem('waky_web_data_v2', JSON.stringify({ settings: { weekday: '06:00' }, days: { '2026-10-31': { time: '06:05' } }, nights: {} }))
    const wa = await device(WAKY, a)
    await wa.sync.sync()
    const wb = await device(WAKY, b)
    await wb.sync.sync()
    expect(Object.keys(read(b, 'waky_web_data_v2').days).sort()).toEqual(['2026-10-30', '2026-10-31'])

    a.setItem('MAN_SPARTAN_DATA', JSON.stringify({ streakDays: 3, totalVictories: 9, diary: [{ id: 'd1', createdAt: '2026-10-30T08:00:00Z' }] }))
    b.setItem('MAN_SPARTAN_DATA', JSON.stringify({ streakDays: 3, totalVictories: 5, diary: [{ id: 'd2', createdAt: '2026-10-31T08:00:00Z' }] }))
    const ma = await device(MAN, a)
    await ma.sync.sync()
    const mb = await device(MAN, b)
    await mb.sync.sync()
    const man = read(b, 'MAN_SPARTAN_DATA')
    expect(man.diary.map((d: any) => d.id)).toEqual(['d2', 'd1'])
    expect(man.totalVictories).toBe(9)
  })
})
