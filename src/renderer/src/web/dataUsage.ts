// Data center: how big each table and each setting of this device's copy of
// the database is (2026-11-18). Reads only; sizes are the UTF-8 bytes of the
// values (SQLite's own page overhead is not counted, so the file is a bit bigger).
import type { DataUsage } from '@shared/api'

interface RowsDb {
  prepare(sql: string): { all(): unknown[] }
}

/** Tables never shown: the server's backups and a restore's staging tables are not on devices. */
const hidden = (t: string) => t.startsWith('sqlite_') || t.startsWith('restore_stage_') || t.startsWith('cloud_snapshot')

export function dbUsage(db: RowsDb): DataUsage {
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: unknown }[]).map((r) => String(r.name)).filter((t) => !hidden(t))
  const tables: DataUsage['tables'] = []
  for (const t of names) {
    try {
      const cols = (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: unknown }[]).map((c) => String(c.name))
      if (!cols.length) continue
      const sum = cols.map((c) => `COALESCE(LENGTH(CAST("${c}" AS BLOB)), 0)`).join(' + ')
      const [row] = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(${sum}), 0) AS b FROM "${t}"`).all() as { n: unknown; b: unknown }[]
      tables.push({ name: t, rows: Number(row?.n ?? 0), bytes: Number(row?.b ?? 0) })
    } catch {
      /* a table this copy can't read: left out, never a failure */
    }
  }
  tables.sort((a, b) => b.bytes - a.bytes)
  let settings: DataUsage['settings'] = []
  try {
    // q: how many quotes and backslashes the value has; each is one more byte when the value travels as a JSON string.
    settings = (db.prepare(`SELECT key, LENGTH(CAST(value AS BLOB)) AS b, LENGTH(value) - LENGTH(REPLACE(REPLACE(value, '"', ''), '\\', '')) AS q FROM settings`).all() as { key: unknown; b: unknown; q: unknown }[])
      .map((r) => ({ key: String(r.key), bytes: Number(r.b ?? 0), requestBytes: Number(r.b ?? 0) + Number(r.q ?? 0) + 2 }))
      .sort((a, b) => b.bytes - a.bytes)
  } catch {
    /* no settings table yet */
  }
  return { tables, settings }
}
