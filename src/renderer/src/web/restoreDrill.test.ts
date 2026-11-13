import { describe, expect, it } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import { gunzipSync, gzipSync } from 'node:zlib'
import { MIGRATIONS } from '@core/schema'
import { APP_BLOBS, BLOB_FIELDS, markRestoredApps, type Snapshot } from '@core/backupPlan'
import { backupDigest, digestDiff, tableDigest } from '@core/backupCheck'
import { joinParts, packParts } from '@core/backupPack'
import { applyRestore, restoreDrill, rowsDbOf, snapshotOf } from './restoreDrill'
import { putBackApps } from './restoreApps'

/** A made-up life: points, rewards bought, tasks done, settings and the apps' own copies. */
function seed(SQL: SqlJsStatic): SqlJsDatabase {
  const db = new SQL.Database()
  for (const m of MIGRATIONS) db.exec(m)
  db.run("INSERT INTO settings (key, value) VALUES ('theme', '\"dark\"'), ('pin_hash', 'x'), ('coach_style', '{\"tone\":3}')")
  db.run("INSERT INTO settings (key, value) VALUES ('app_sync_waky', ?)", [JSON.stringify({ savedAt: 1, editedAt: 1, data: { days: { '2026-11-01': { wake: '06:40' } } } })])
  for (let i = 1; i <= 40; i++) db.run("INSERT INTO ledger (ts, day, module, kind, coins, note) VALUES (?, '2026-11-01', 'test', 'earn', ?, ?)", [`2026-11-01T0${i % 10}:00:00Z`, i, `made-up ${i}`])
  db.run("INSERT INTO redemptions (ledger_id, reward_id, title, real_cost, day) VALUES (3, 1, 'Face cream', 30, '2026-11-01')")
  db.run("INSERT INTO tasks (title, category, created_day) VALUES ('Read 10 pages', 'university', '2026-11-01'), ('Gym', 'body', '2026-11-01')")
  db.run("INSERT INTO task_done (task_id, day, ledger_id) VALUES (1, '2026-11-01', 5), (2, '2026-11-01', 6)")
  return db
}

const apps = {
  financeState: { tx: [{ id: 't1', amount: 1250, cur: 'MDL' }, { id: 't2', amount: 99, cur: 'EUR' }], settings: { theme: 'dark' } },
  sportState: { exercises: [{ id: 'e1', name: 'Push-ups' }], history: [] },
  manState: { diary: [{ id: 'd1', text: 'made up' }], longestStreak: 4 },
  financeEnc: 'sealed-made-up-text'
}

describe('restore drill', () => {
  it('backs up, restores into an empty database and every table and app copy has the same count and checksum', async () => {
    const SQL = await initSqlJs()
    const db = seed(SQL)
    const snap: Snapshot = { ...snapshotOf(rowsDbOf(db), 'test', new Date('2026-11-04T12:00:00Z')), ...apps }
    expect(snap.tables.settings.some((r) => r.key === 'pin_hash')).toBe(false)

    // Through the cloud packing too: gzip, cut into parts, joined back.
    const json = JSON.stringify(snap)
    const { manifest, parts } = await packParts(gzipSync(Buffer.from(json)), json.length, 300)
    expect(manifest.parts).toBeGreaterThan(1)
    const back = gunzipSync(await joinParts(manifest, parts)).toString('utf8')
    expect(back).toBe(json)

    const good = restoreDrill(SQL, back)
    expect(good).toMatchObject({ ok: true })
    expect(good.tables).toBe(Object.keys(snap.tables).length)
    expect(good.rows).toBeGreaterThan(40)
    expect(good.blobs).toBe(5) // Finance, its locked copy, Sport Track, MAN, and Waky from its synced copy
    expect(good.msg).toMatch(/every checksum matches/)

    // Checked by hand too: an empty database gets every table back with the same checksum.
    const fresh = new SQL.Database()
    for (const m of MIGRATIONS) fresh.exec(m)
    // A new install has seeded rows (rewards, categories): the restore replaces them.
    const marked = markRestoredApps(snap, 'r1', 1000)
    applyRestore(fresh, marked.snap, 'r1')
    for (const [t, rows] of Object.entries(snap.tables)) {
      if (t === 'settings') continue
      const now = rowsDbOf(fresh).prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[]
      expect(tableDigest(now), t).toEqual(tableDigest(rows))
    }
    const store = new Map<string, string>()
    const st = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    putBackApps(st, snap, marked.apps, 'r1', 1000)
    const got: Record<string, unknown> = {}
    for (const b of APP_BLOBS) if (store.has(b.localKey)) got[b.field] = b.setting ? JSON.parse(store.get(b.localKey)!) : store.get(b.localKey)
    expect(digestDiff({ tables: {}, blobs: backupDigest(snap, BLOB_FIELDS).blobs }, { tables: {}, blobs: backupDigest(got as any, BLOB_FIELDS).blobs })).toEqual([])
    expect(got.wakyState).toEqual({ days: { '2026-11-01': { wake: '06:40' } } })
  })

  it('catches a row that would not come back, a changed app copy, and broken files', async () => {
    const SQL = await initSqlJs()
    const snap: Snapshot = { ...snapshotOf(rowsDbOf(seed(SQL)), 'test'), ...apps }
    const broken = JSON.parse(JSON.stringify(snap))
    broken.tables.tasks.push({ nope: 1 })
    const r = restoreDrill(SQL, JSON.stringify(broken))
    expect(r.ok).toBe(false)
    expect(r.msg).toMatch(/tasks/)
    expect(restoreDrill(SQL, '{oops').ok).toBe(false)
    expect(restoreDrill(SQL, '{"tables":{}}').ok).toBe(false)
  })

  it('a restore that fails half-way changes nothing (all or nothing)', async () => {
    const SQL = await initSqlJs()
    const db = seed(SQL)
    const before = snapshotOf(rowsDbOf(db), 'before')
    const old = JSON.parse(JSON.stringify(before))
    old.tables.tasks = [{ id: 9, title: 'Old task', category: 'life', created_day: '2026-10-01' }]
    old.tables.task_done = []
    expect(() => applyRestore(db, old, 'x', (sql) => sql.startsWith('INSERT INTO "tasks"'))).toThrow('Test failure')
    const after = snapshotOf(rowsDbOf(db), 'after')
    expect(digestDiff(backupDigest(before, []), backupDigest(after, []))).toEqual([])
    expect(db.exec("SELECT COUNT(*) FROM sqlite_master WHERE name LIKE 'restore_stage_%'")[0].values[0][0]).toBe(0)
  })

  it('restores with foreign keys enforced: children out first, parents in first', async () => {
    const SQL = await initSqlJs()
    const db = seed(SQL)
    db.exec('PRAGMA foreign_keys = ON')
    const snap = snapshotOf(rowsDbOf(db), 'fk')
    snap.tables.tasks.push({ id: 3, title: 'Walk', category: 'life', repeat: 'none', weekdays: 0, coins: 5, xp: 10, priority: 2, due: null, notes: null, created_day: '2026-11-02', archived: 0 })
    snap.tables.task_done.push({ task_id: 3, day: '2026-11-02', ledger_id: 7 })
    expect(() => applyRestore(db, snap, 'fk')).not.toThrow()
    expect(db.exec('SELECT COUNT(*) FROM task_done')[0].values[0][0]).toBe(3)
    expect(db.exec('PRAGMA foreign_key_check').length).toBe(0)
  })
})
