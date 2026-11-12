// Backup before risk and one-click undo (2026-11-12): a big change to an app's
// data saves a "before" backup first; undoing puts it back, and no device
// merges its old copy back in afterwards (the restore mark).
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { markRestoredApps, restorePlan, runRestorePlan, type Snapshot } from '@core/backupPlan'
import { changeSize, isBigChange } from '@core/riskChange'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { WAKY, createAppSync, setBigChangeGuard, type AppSyncSpec } from './appSync'
import { putBackApps } from './restoreApps'
import { snapshotOf } from './restoreDrill'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => {
  vi.unstubAllGlobals()
  setBigChangeGuard(null)
})

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
const memory = () => {
  const mem = new Map<string, string>()
  return { mem, store: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), key: () => null, length: 0, clear: () => mem.clear() } as unknown as Storage }
}
/** A made-up Waky copy with `n` mornings. */
const waky = (n: number, extra: Record<string, unknown> = {}) => ({ days: Object.fromEntries(Array.from({ length: n }, (_, i) => [`2026-10-${String(i + 1).padStart(2, '0')}`, { wake: '06:40', updatedAt: 1000 + i }])), nights: {}, opened: {}, spent: [], shielded: [], ...extra })
const remoteCopy = (remote: SqlJsDatabase) => JSON.parse(String(remote.exec("SELECT value FROM settings WHERE key = 'app_sync_waky'")[0].values[0][0]))

describe('which changes are big', () => {
  it('a bulk delete, an import, a re-price are big; a normal day is not', () => {
    const tx = (n: number, amount = 10) => ({ tx: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, amount })) })
    expect(isBigChange(tx(40), tx(41))).toBe(false) // one new record
    expect(isBigChange(tx(40), { tx: tx(40).tx.slice(0, 34) })).toBe(true) // 6 deleted
    expect(isBigChange(tx(40), tx(70))).toBe(true) // an import of 30
    expect(isBigChange(tx(40), tx(40, 11))).toBe(true) // every amount re-priced
    expect(isBigChange(tx(4), tx(4, 11))).toBe(false) // few records: a normal edit
    expect(changeSize(waky(10), waky(12))).toMatchObject({ added: 2, removed: 0, changed: 0, before: 10 })
  })
})

describe('backup before risk, then undo', () => {
  it('a big delete in an app saves a backup of the copy from before; undo brings it back on every device', async () => {
    const remote = fakeTurso()
    vi.stubGlobal('window', { addEventListener: () => {}, dispatchEvent: () => true })
    const pc = await device()
    const phone = await device()
    const a = memory()
    const b = memory()
    const spec: AppSyncSpec = { ...WAKY }
    const pcSync = createAppSync(pc, spec, a.store)
    const phoneSync = createAppSync(phone, spec, b.store)

    // Both devices agree on 20 mornings.
    a.mem.set(spec.localKey, JSON.stringify(waky(20)))
    await pcSync.sync()
    await phone.refresh()
    await phoneSync.sync()
    expect(Object.keys(JSON.parse(b.mem.get(spec.localKey)!).days)).toHaveLength(20)

    // The risky step: 12 mornings deleted on the PC. Before it reaches the database, a backup is saved.
    const points: Snapshot[] = []
    setBigChangeGuard(async (sp, before, after) => {
      if (!isBigChange(before, after)) return
      // The bridge saves the full backup without this device's (already changed) copy: the database still has the old one.
      points.push(await pc.read((db) => snapshotOf(db as any, `before a big change in ${sp.setting}`)))
    })
    a.mem.set(spec.localKey, JSON.stringify(waky(8)))
    pcSync.soon()
    await pcSync.sync()
    expect(points).toHaveLength(1)
    expect(Object.keys(remoteCopy(remote).data.days)).toHaveLength(8)
    // A small change afterwards saves no new backup.
    a.mem.set(spec.localKey, JSON.stringify(waky(9)))
    pcSync.soon()
    await pcSync.sync()
    expect(points).toHaveLength(1)

    // Undo: put the "before" backup back (the restore path: staging, one transaction, apps marked).
    const now = Date.now()
    const marked = markRestoredApps(points[0], 'restore-test', now)
    const columns = await pc.read((db) => {
      const out: Record<string, string[]> = {}
      for (const r of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as any[]) out[String(r.name)] = db.prepare(`PRAGMA table_info("${String(r.name)}")`).all().map((c: any) => String(c.name))
      return out
    })
    const t = new TursoHttp('https://fake.turso.io', 't')
    await runRestorePlan(restorePlan(marked.snap, columns, 'restore-test'), (st) => t.writeAtomic(st as any))
    putBackApps(a.store, points[0], marked.apps, 'restore-test', now)
    expect(remoteCopy(remote).restore).toBe('restore-test')
    expect(Object.keys(JSON.parse(a.mem.get(spec.localKey)!).days)).toHaveLength(20)
    // The staging tables are gone.
    expect(remote.exec("SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'restore_stage_%'")[0].values[0][0]).toBe(0)

    // The PC syncs: nothing changes back.
    await pc.refresh()
    await pcSync.sync()
    expect(Object.keys(remoteCopy(remote).data.days)).toHaveLength(20)

    // The phone still holds 9 mornings plus one it added offline: it takes the restored copy as it is
    // (no merge that would keep the deletion), and its own copy from before is kept next to it.
    const old = JSON.parse(b.mem.get(spec.localKey)!)
    expect(Object.keys(old.days)).toHaveLength(20) // it never synced the delete
    b.mem.set(spec.localKey, JSON.stringify(waky(9, { note: 'made-up phone edit' })))
    await phone.refresh()
    await phoneSync.sync()
    const phoneNow = JSON.parse(b.mem.get(spec.localKey)!)
    expect(Object.keys(phoneNow.days)).toHaveLength(20)
    expect(JSON.parse(b.mem.get('life_sync_app_sync_waky_before_restore')!).raw).toContain('made-up phone edit')
    expect(b.mem.get('life_sync_app_sync_waky_restore')).toBe('restore-test')

    // Later edits sync normally and keep the restore mark, so a device that was away still takes it first.
    a.mem.set(spec.localKey, JSON.stringify(waky(21)))
    pcSync.soon()
    await pcSync.sync()
    expect(Object.keys(remoteCopy(remote).data.days)).toHaveLength(21)
    expect(remoteCopy(remote).restore).toBe('restore-test')
    await phone.refresh()
    await phoneSync.sync()
    expect(Object.keys(JSON.parse(b.mem.get(spec.localKey)!).days)).toHaveLength(21)
  })
})
