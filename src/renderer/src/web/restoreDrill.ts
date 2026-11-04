// Backups that are proven to work. Ben's server makes the daily cloud
// snapshot itself (no device has to be open), and once a week it puts the
// newest one back into a throwaway database and checks every row came back.
import type { SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { APPEND_ONLY, backupTables, KEEP_SETTINGS, NOT_BACKED_UP, restoreStatements, type Snapshot } from '@core/backupPlan'

interface RowsDb {
  prepare(sql: string): { all(...args: unknown[]): unknown[] }
}

/** Every data table of a database, as a backup (same shape as the apps' export). */
export function snapshotOf(db: RowsDb, source: string, now = new Date()): Snapshot {
  const tables: Record<string, Record<string, unknown>[]> = {}
  const all = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r: any) => String(r.name))
  for (const t of backupTables(all)) tables[t] = db.prepare(`SELECT * FROM "${t}"`).all() as Record<string, unknown>[]
  return { version: 2, exportedAt: now.toISOString(), source, tables }
}

export interface DrillResult {
  ok: boolean
  /** One line for you. */
  msg: string
  tables: number
  rows: number
}

/**
 * Puts a backup back into a fresh, empty database (built from the app's own
 * migrations, like a new install) and checks each table got exactly its rows.
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
    const columns: Record<string, string[]> = {}
    for (const [name] of db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values ?? []) {
      columns[String(name)] = (db.exec(`PRAGMA table_info("${String(name)}")`)[0]?.values ?? []).map((c) => String(c[1]))
    }
    const stmts = restoreStatements(snap, columns, 'drill')
    db.exec('BEGIN')
    for (const s of stmts) db.run(s.sql, s.args as any)
    db.exec('COMMIT')
    const bad: string[] = []
    let tables = 0
    let rows = 0
    for (const [t, list] of Object.entries(snap.tables)) {
      if (!Array.isArray(list) || !columns[t] || NOT_BACKED_UP.test(t)) continue
      let want = list.length
      let got: number
      if (t === 'settings') {
        // Settings are upserted: each one in the backup must be there with its value.
        const wanted = new Map(list.filter((r: any) => typeof r?.key === 'string' && typeof r?.value === 'string' && !KEEP_SETTINGS.has(r.key)).map((r: any) => [r.key, r.value]))
        const have = new Map((db.exec('SELECT key, value FROM settings')[0]?.values ?? []).map(([k, v]) => [String(k), String(v)]))
        want = wanted.size
        got = [...wanted].filter(([k, v]) => have.get(k) === v).length
      } else got = Number(db.exec(`SELECT COUNT(*) FROM "${t}"`)[0]?.values[0][0] ?? 0)
      // Append-only history skips exact duplicates; everything else must match.
      if (got !== want && !(APPEND_ONLY.has(t) && got < want && got > 0)) bad.push(`${t} ${got}/${want}`)
      tables++
      rows += want
    }
    if (bad.length) return { ok: false, msg: `Rows missing after a test restore: ${bad.slice(0, 5).join(', ')}`, tables, rows }
    return { ok: true, msg: `${tables} tables, ${rows} rows put back`, tables, rows }
  } catch (e) {
    return { ok: false, msg: `A test restore failed: ${(e as Error).message}`.slice(0, 200), tables: 0, rows: 0 }
  } finally {
    db.close()
  }
}
