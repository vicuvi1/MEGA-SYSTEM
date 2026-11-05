// LT14: the ways data could get lost, each on a fake Turso with made-up data:
// two devices writing the same blob at the same moment, an offline change
// meeting a newer edit from another device, and a backup put back through the
// restore path. (Telegram taps that change points: bots/callbacks.test.ts.)
import { createRequire } from 'node:module'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic, type Database as SqlJsDatabase } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { restoreStatements } from '@core/backupPlan'
import { addWater, sportToday } from '@core/sportShared'
import { defaultSport } from '@core/sportCards'
import { readSetting, writeSetting } from '../../../main/settings'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { appendLog, loadLog, sportState } from './botBrain'
import { snapshotOf } from './restoreDrill'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.unstubAllGlobals())

function fakeTurso(): SqlJsDatabase {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const json = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  return remote
}
const device = async () => {
  const m = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
  await m.ready
  return m
}
const remoteSetting = (remote: SqlJsDatabase, key: string) => {
  const v = remote.exec(`SELECT value FROM settings WHERE key = '${key}'`)[0]?.values[0]?.[0]
  return v == null ? null : JSON.parse(String(v))
}
const sip = (m: Mirror, ml: number) =>
  m.write((db) => {
    const day = sportToday()
    writeSetting(db as any, 'sport_tracker_json', { savedAt: Date.now(), data: addWater(sportState(db) ?? defaultSport(day), ml, day) })
  })

describe('two devices at the same moment (LT14)', () => {
  it('water logged on the phone and the PC at once: both count (the blob is redone on fresh data)', async () => {
    const remote = fakeTurso()
    const phone = await device()
    const pc = await device()
    await Promise.all([sip(phone, 250), sip(pc, 500)])
    await sip(phone, 250)
    expect(remoteSetting(remote, 'sport_tracker_json').data.water.currentMl).toBe(1000)
  })

  it("Ben's chat written from two places at once keeps both messages", async () => {
    const remote = fakeTurso()
    const app = await device()
    const server = await device()
    const msg = (text: string) => ({ role: 'coach' as const, bot: 'mega' as const, via: 'test', text, at: new Date().toISOString() })
    await Promise.all([app.write((db) => appendLog(db, [msg('from the app')])), server.write((db) => appendLog(db, [msg('from the server')]))])
    expect(remoteSetting(remote, 'coach_log').map((e: any) => e.text).sort()).toEqual(['from the app', 'from the server'])
  })
})

describe('offline, then back (LT14)', () => {
  // Back online at once (the wait between tries is tested on its own: CL7).
  beforeEach(() => {
    Mirror.RETRY_BASE = 0
  })
  afterEach(() => {
    Mirror.RETRY_BASE = 5000
  })
  it('an offline change to a setting another device changed meanwhile is never silently lost', async () => {
    const remote = fakeTurso()
    const realFetch = globalThis.fetch
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), length: 0, key: () => null })
    vi.stubGlobal('window', { addEventListener: () => {}, dispatchEvent: () => true })
    vi.stubGlobal('navigator', { onLine: true })
    const phone = await device()
    const pc = await device()
    await sip(pc, 250)
    await phone.refresh()
    // The phone goes into a tunnel and logs a glass; the PC logs one online.
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await sip(phone, 300)
    expect(phone.pendingOffline).toBe(1)
    vi.stubGlobal('fetch', realFetch)
    await sip(pc, 500)
    // Back online: the phone's stale blob must not overwrite the PC's newer one…
    await phone.refresh()
    expect(phone.pendingOffline).toBe(0)
    expect(remoteSetting(remote, 'sport_tracker_json').data.water.currentMl).toBe(750)
    // …and the phone's glass is kept in "couldn't sync" (Settings shows it), not dropped.
    // (Today it is not merged by itself: a blob changed on both sides needs you to redo it.)
    expect(phone.failedSync).toHaveLength(1)
  })
})

describe('putting a backup back (LT14)', () => {
  it('a snapshot restored through the restore path brings data back and every device sees it', async () => {
    const remote = fakeTurso()
    const pc = await device()
    await pc.write((db) => {
      writeSetting(db as any, 'money_daily_budget', 150)
      db.prepare("INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note) VALUES ('2026-10-01T08:00:00Z', '2026-10-01', 'x', 'adjust', 40, 0, NULL, 'made-up start')").run()
    })
    const snap = await pc.read((db) => snapshotOf(db as any, 'test'))
    // Later: the setting changes and more points are earned.
    await pc.write((db) => {
      writeSetting(db as any, 'money_daily_budget', 999)
      db.prepare("INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note) VALUES ('2026-10-02T08:00:00Z', '2026-10-02', 'x', 'adjust', 5, 0, NULL, 'made-up later')").run()
    })
    const phone = await device()
    // The restore path (tursoWebBridge restoreSnapshot): the columns from the copy, one transaction.
    const columns = await pc.read((db) => {
      const out: Record<string, string[]> = {}
      for (const r of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as any[]) out[String(r.name)] = db.prepare(`PRAGMA table_info("${String(r.name)}")`).all().map((c: any) => String(c.name))
      return out
    })
    await new TursoHttp('https://fake.turso.io', 't').writeAtomic(restoreStatements(JSON.parse(JSON.stringify(snap)), columns, 'restore-test') as any)
    expect(remoteSetting(remote, 'money_daily_budget')).toBe(150)
    // The points history is append-only: what was earned after the backup stays.
    expect(Number(remote.exec('SELECT SUM(coins) FROM ledger')[0].values[0][0])).toBe(45)
    for (const m of [pc, phone]) {
      await m.refresh()
      expect(await m.read((db) => readSetting(db as any, 'money_daily_budget'))).toBe(150)
    }
    // And the chat log still loads after a restore.
    expect(await phone.read((db) => loadLog(db))).toEqual([])
  })
})
