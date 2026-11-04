// Backups: what goes in one, how one is put back, and which daily files to
// keep. Pure and tested; the desktop writes the files, the bridge runs the SQL.

/** Tables that are only plumbing (or backups themselves): never in a backup, never restored. */
export const NOT_BACKED_UP = /^(sqlite_|libsql_|_litestream|_cf_|desktop_|sys_|cloud_snapshots$|bot_seen_updates$|applied_sync_events$)/

/** Append-only history: a restore only adds rows that are missing. */
export const APPEND_ONLY = new Set(['ledger', 'discipline_events'])
/** Settings a restore never overwrites (your current PIN and bot setup). */
export const KEEP_SETTINGS = new Set(['pin_hash', 'bot_bridge_config', 'data_version'])

export function backupTables(all: string[]): string[] {
  return all.filter((t) => !NOT_BACKED_UP.test(t)).sort()
}

export interface Snapshot {
  version: number
  exportedAt: string
  source?: string
  tables: Record<string, Record<string, unknown>[]>
  [k: string]: unknown
}

/**
 * The statements that put a snapshot back, in one transaction: each table is
 * replaced (append-only history only gets its missing rows back), settings
 * are upserted except the kept ones, and the data marker moves so every
 * device reloads. `columns` = the current columns of each existing table.
 */
export function restoreStatements(snap: Snapshot, columns: Record<string, string[]>, version: string): { sql: string; args: unknown[] }[] {
  if (!snap || typeof snap !== 'object' || !snap.tables || typeof snap.tables !== 'object') throw new Error('This file is not a Life System backup')
  const out: { sql: string; args: unknown[] }[] = []
  for (const t of Object.keys(snap.tables).sort()) {
    const rows = snap.tables[t]
    const cols = columns[t]
    if (!Array.isArray(rows) || !cols || NOT_BACKED_UP.test(t)) continue
    const have = new Set(cols)
    if (t === 'settings') {
      for (const r of rows) {
        if (!r || typeof r.key !== 'string' || KEEP_SETTINGS.has(r.key) || typeof r.value !== 'string') continue
        out.push({ sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: [r.key, r.value] })
      }
      continue
    }
    if (!APPEND_ONLY.has(t)) out.push({ sql: `DELETE FROM "${t}"`, args: [] })
    for (const r of rows) {
      const keys = Object.keys(r ?? {}).filter((k) => have.has(k))
      if (!keys.length) continue
      out.push({
        sql: `INSERT ${APPEND_ONLY.has(t) ? 'OR IGNORE ' : ''}INTO "${t}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        args: keys.map((k) => (r[k] === undefined ? null : r[k]))
      })
    }
  }
  out.push({ sql: "INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [version] })
  return out
}

const FILE = /^life-system-(\d{4}-\d{2}-\d{2})\.json$/
export const backupName = (day: string) => `life-system-${day}.json`
export const backupDay = (name: string) => FILE.exec(name)?.[1] ?? null

/**
 * Which daily backup files to delete: keep the last 30 days, plus the first
 * backup of each month for a year. Files that aren't ours are never touched.
 */
export function backupsToDelete(names: string[], today: string): string[] {
  const days = names.map((n) => ({ n, d: backupDay(n) })).filter((x): x is { n: string; d: string } => !!x.d).sort((a, b) => a.d.localeCompare(b.d))
  const t = Date.parse(today + 'T00:00:00Z')
  const age = (d: string) => (t - Date.parse(d + 'T00:00:00Z')) / 864e5
  const firstOfMonth = new Set<string>()
  const seen = new Set<string>()
  for (const x of days) {
    const m = x.d.slice(0, 7)
    if (!seen.has(m)) {
      seen.add(m)
      firstOfMonth.add(x.n)
    }
  }
  return days.filter((x) => age(x.d) >= 30 && !(firstOfMonth.has(x.n) && age(x.d) < 366)).map((x) => x.n)
}
