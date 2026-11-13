// Backups that are proven to work. Ben's server makes the daily cloud
// snapshot itself (no device has to be open), and once a week it puts the
// newest one back into a throwaway database and checks every table and app
// copy came back with the same rows and checksums. The desktop app runs the
// same drill on its newest local backup file.
import type { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { APP_BLOBS, BLOB_FIELDS, KEEP_SETTINGS, backupTables, markRestoredApps, redactRows, restorePlan, type Snapshot } from '@core/backupPlan'
import { backupDigest, digestDiff, tableDigest, type BackupDigest } from '@core/backupCheck'
import { putBackApps } from './restoreApps'

interface RowsDb {
  prepare(sql: string): { all(...args: unknown[]): unknown[] }
}

/** Every data table of a database, as a backup (same shape as the apps' export). */
export function snapshotOf(db: RowsDb, source: string, now = new Date()): Snapshot {
  const tables: Record<string, Record<string, unknown>[]> = {}
  const all = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r: any) => String(r.name))
  for (const t of backupTables(all)) tables[t] = redactRows(t, db.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[])
  return { version: 2, exportedAt: now.toISOString(), source, tables }
}

/** A sql.js database as the RowsDb snapshotOf reads. */
export const rowsDbOf = (raw: SqlJsDatabase): RowsDb => ({
  prepare: (sql: string) => ({
    all: () => {
      const r = raw.exec(sql)[0]
      return r ? r.values.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, v[i]]))) : []
    }
  })
})

/** Current columns and foreign keys of every table of a sql.js database. */
export function shapeOf(db: SqlJsDatabase): { columns: Record<string, string[]>; refs: Record<string, string[]> } {
  const columns: Record<string, string[]> = {}
  const refs: Record<string, string[]> = {}
  for (const [name] of db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values ?? []) {
    const t = String(name)
    columns[t] = (db.exec(`PRAGMA table_info("${t}")`)[0]?.values ?? []).map((c) => String(c[1]))
    refs[t] = [...new Set((db.exec(`PRAGMA foreign_key_list("${t}")`)[0]?.values ?? []).map((f) => String(f[2])))]
  }
  return { columns, refs }
}

/**
 * Puts a backup back into a sql.js database the way the app does on Turso
 * (staging tables, then one swap in foreign-key order), all in one
 * transaction: on any error everything is rolled back and the error thrown.
 */
export function applyRestore(db: SqlJsDatabase, snap: Snapshot, version = 'restore', fail?: (sql: string) => boolean): string[] {
  const { columns, refs } = shapeOf(db)
  const plan = restorePlan(snap, columns, version, { refs })
  db.exec('BEGIN')
  try {
    for (const s of [...plan.stage.flat(), ...plan.swap]) {
      if (fail?.(s.sql)) throw new Error(`Test failure at: ${s.sql.slice(0, 60)}`)
      db.run(s.sql, s.args as any)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return plan.tables
}

export interface DrillResult {
  ok: boolean
  /** One line for you. */
  msg: string
  tables: number
  rows: number
  /** App copies (Finance, Sport Track, Waky, MAN) checked. */
  blobs?: number
}

const APP_SETTINGS = new Set(APP_BLOBS.flatMap((b) => (b.setting ? [b.setting] : [])))
const settingsRows = (rows: Record<string, unknown>[]) => rows.filter((r) => typeof r?.key === 'string' && typeof r?.value === 'string' && !KEEP_SETTINGS.has(r.key as string) && !APP_SETTINGS.has(r.key as string))

class MemoryStore {
  private m = new Map<string, string>()
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v))
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
}

/**
 * Puts a backup back into a fresh, empty database (built from the app's own
 * migrations, like a new install) and an empty app storage, then checks the
 * row count and checksum of every table and the checksum of every app copy.
 */
export function restoreDrill(SQL: SqlJsStatic, text: string): DrillResult {
  let snap: Snapshot
  try {
    snap = JSON.parse(text)
  } catch {
    return { ok: false, msg: 'The backup is not readable (broken JSON)', tables: 0, rows: 0 }
  }
  if (!snap?.tables || typeof snap.tables !== 'object' || !Object.keys(snap.tables).length) return { ok: false, msg: 'The backup has no tables', tables: 0, rows: 0 }
  const db = new SQL.Database()
  try {
    for (const m of MIGRATIONS) db.exec(m)
    const { columns } = shapeOf(db)
    const marked = markRestoredApps(snap, 'drill', 0)
    applyRestore(db, marked.snap, 'drill')
    const store = new MemoryStore()
    putBackApps(store, snap, marked.apps, 'drill', 0)
    // What the backup holds, limited to what a restore can put back (tables the database has, their columns).
    const want: BackupDigest = { tables: {}, blobs: backupDigest(snap, BLOB_FIELDS).blobs }
    const got: BackupDigest = { tables: {}, blobs: {} }
    let tables = 0
    let rows = 0
    for (const [t, list] of Object.entries(snap.tables)) {
      if (!Array.isArray(list) || !columns[t] || !backupTables([t]).length) continue
      const have = new Set(columns[t])
      const cols = [...new Set(list.flatMap((r) => Object.keys(r ?? {})))].filter((k) => have.has(k))
      const restored = rowsDbOf(db).prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[]
      // Every row counts: one the database can't take back (no known column) is a lost row.
      const source = list.filter((r) => r && typeof r === 'object')
      want.tables[t] = t === 'settings' ? tableDigest(settingsRows(source), cols) : tableDigest(source, cols)
      got.tables[t] = t === 'settings' ? tableDigest(settingsRows(restored), cols) : tableDigest(restored, cols)
      tables++
      rows += list.length
    }
    for (const b of APP_BLOBS) {
      if (want.blobs[b.field] == null) continue
      const raw = store.getItem(b.localKey)
      if (raw == null) continue
      got.blobs[b.field] = backupDigest({ [b.field]: b.setting ? JSON.parse(raw) : raw } as any, [b.field]).blobs[b.field]
    }
    // App copies held only in settings (a backup made by the server): their data must come back too.
    const blobs = Object.keys(want.blobs).length + Object.keys(marked.apps).filter((f) => want.blobs[f] == null).length
    const bad = digestDiff(want, got)
    for (const [f, data] of Object.entries(marked.apps)) {
      if (want.blobs[f] != null) continue
      const b = APP_BLOBS.find((x) => x.field === f)!
      const back = store.getItem(b.localKey)
      if (back == null || JSON.stringify(JSON.parse(back)) !== JSON.stringify(data)) bad.push(`${f}: missing`)
    }
    if (bad.length) return { ok: false, msg: `Not the same after a test restore: ${bad.slice(0, 5).join(', ')}`, tables, rows, blobs }
    return { ok: true, msg: `${tables} tables, ${rows} rows${blobs ? ` and ${blobs} app copies` : ''} put back; every checksum matches`, tables, rows, blobs }
  } catch (e) {
    return { ok: false, msg: `A test restore failed: ${(e as Error).message}`.slice(0, 200), tables: 0, rows: 0 }
  } finally {
    db.close()
  }
}
