// Backups: what goes in one, how one is put back, and which backup files to
// keep. Pure and tested; the desktop writes the files, the bridge runs the SQL.

/** Tables that are only plumbing (or backups themselves): never in a backup, never restored. */
export const NOT_BACKED_UP = /^(sqlite_|libsql_|_litestream|_cf_|desktop_|sys_|restore_stage_|cloud_snapshots$|cloud_snapshot_parts$|bot_seen_updates$|applied_sync_events$)/

/** Append-only history: a restore only adds rows that are missing. */
export const APPEND_ONLY = new Set(['ledger', 'discipline_events'])
/** Settings a restore never overwrites (your current PIN and bot setup). */
export const KEEP_SETTINGS = new Set(['pin_hash', 'bot_bridge_config', 'data_version'])

/**
 * Settings that never go into a backup (or a data export): the PIN hash, the
 * sign-out counter, the login guard, the sealed Google sign-in, the bot setup
 * and anything that looks like a key or token. A restore keeps the current ones.
 */
export const SECRET_SETTING = /^(pin_hash|session_epoch|web_login_guard|bot_bridge_config|google_oauth)$|token|secret|password|api_?key|oauth/i

/** A table's rows, minus secret settings. */
export function redactRows<T extends Record<string, unknown>>(table: string, rows: T[]): T[] {
  return table === 'settings' ? rows.filter((r) => !SECRET_SETTING.test(String(r.key ?? ''))) : rows
}

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
 * The apps' own data (kept in each device's localStorage) that a backup also
 * holds, and the synced setting each one travels in. A backup made by the
 * server has no localStorage: then the setting's copy is the app's data.
 */
export interface AppBlob {
  /** Field of the backup JSON. */
  field: string
  /** localStorage key the app saves to. */
  localKey: string
  /** The synced settings key ({savedAt, editedAt, data}), if the app syncs. */
  setting?: string
  label: string
}
export const APP_BLOBS: readonly AppBlob[] = [
  { field: 'financeState', localKey: 'finance-helper.state', setting: 'app_sync_finance', label: 'Finance' },
  { field: 'financeEnc', localKey: 'finance-helper.enc', label: 'Finance (locked copy)' },
  { field: 'sportState', localKey: 'life_sport_tracker_v1', setting: 'sport_tracker_json', label: 'Sport Track' },
  { field: 'wakyState', localKey: 'waky_web_data_v2', setting: 'app_sync_waky', label: 'Waky' },
  { field: 'manState', localKey: 'MAN_SPARTAN_DATA', setting: 'app_sync_man', label: 'MAN' }
]
export const BLOB_FIELDS: readonly string[] = APP_BLOBS.map((b) => b.field)

export interface Stmt {
  sql: string
  args: unknown[]
}

/** Staging tables of a restore: plumbing, never backed up, dropped by the restore itself. */
export const STAGE_PREFIX = 'restore_stage_'
const q = (name: string) => `"${name.replace(/"/g, '""')}"`

/**
 * Tables in foreign-key order: a table comes after every table it points at
 * (rows go in parents first; deletes run in the reverse order, children first).
 * Self-references are ignored (rows keep their original order); a cycle falls
 * back to name order. `refs` = table → tables it references.
 */
export function fkOrder(tables: string[], refs: Record<string, string[]> = {}): string[] {
  const set = new Set(tables)
  const need = new Map(tables.map((t) => [t, new Set((refs[t] ?? []).filter((r) => r !== t && set.has(r)))]))
  const out: string[] = []
  const left = new Set([...tables].sort())
  while (left.size) {
    const ready = [...left].find((t) => [...need.get(t)!].every((r) => !left.has(r)))
    const next = ready ?? [...left][0]
    out.push(next)
    left.delete(next)
  }
  return out
}

export interface RestorePlan {
  /** Fill the staging tables: any number of requests, each small enough for one call (nothing real changes yet). */
  stage: Stmt[][]
  /** One transaction: replace each table from its staging copy, in key order, then drop the staging tables. All or nothing. */
  swap: Stmt[]
  /** Drops the staging tables after a failed restore (nothing real was changed). */
  cleanup: Stmt[]
  /** The tables put back, in order. */
  tables: string[]
}

export interface RestoreOptions {
  /** Table → tables it references (foreign keys). */
  refs?: Record<string, string[]>
  /** Most characters of SQL and arguments in one staging request. */
  batchChars?: number
  /** Most statements in one staging request. */
  batchStmts?: number
  /** A longer text value is sent in pieces of this many characters. */
  pieceChars?: number
}

const argChars = (a: unknown) => (a == null ? 4 : a instanceof Uint8Array ? a.length * 1.4 : typeof a === 'string' ? a.length * 1.1 + 24 : 24)

/**
 * How a backup is put back, with no size limit and all or nothing:
 *   1. its rows go into staging tables (restore_stage_<table>), in as many
 *      small requests as needed; a long text goes in pieces;
 *   2. one transaction replaces every table from its staging copy, in
 *      foreign-key order, and drops the staging tables.
 * Append-only history (ledger, discipline events) only gets its missing rows
 * back; settings are upserted, except the kept ones (your PIN and bot setup);
 * the data marker moves so every device reloads. `columns` = the current
 * columns of each existing table (a column the database no longer has is left out).
 */
export function restorePlan(snap: Snapshot, columns: Record<string, string[]>, version: string, opts: RestoreOptions = {}): RestorePlan {
  if (!snap || typeof snap !== 'object' || !snap.tables || typeof snap.tables !== 'object') throw new Error('This file is not a Life System backup')
  const batchChars = opts.batchChars ?? 1_200_000
  const batchStmts = opts.batchStmts ?? 400
  const piece = opts.pieceChars ?? 700_000
  const names = Object.keys(snap.tables).filter((t) => Array.isArray(snap.tables[t]) && columns[t] && !NOT_BACKED_UP.test(t))
  const order = fkOrder(names, opts.refs)
  const stage: Stmt[][] = []
  let cur: Stmt[] = []
  let chars = 0
  const push = (s: Stmt) => {
    const n = s.sql.length + s.args.reduce<number>((m, a) => m + argChars(a), 0)
    if (cur.length && (chars + n > batchChars || cur.length >= batchStmts)) {
      stage.push(cur)
      cur = []
      chars = 0
    }
    cur.push(s)
    chars += n
  }
  const swapInserts: Stmt[] = []
  for (const t of order) {
    const s = q(STAGE_PREFIX + t)
    const have = new Set(columns[t])
    push({ sql: `DROP TABLE IF EXISTS ${s}`, args: [] })
    push({ sql: `CREATE TABLE ${s} AS SELECT * FROM ${q(t)} WHERE 0`, args: [] })
    let rows = snap.tables[t].filter((r) => r && typeof r === 'object')
    if (t === 'settings') rows = rows.filter((r) => typeof r.key === 'string' && !KEEP_SETTINGS.has(r.key) && typeof r.value === 'string')
    // Rows grouped by the columns they carry (a column a row lacks keeps the table's default).
    const groups = new Map<string, { keys: string[]; rows: Record<string, unknown>[] }>()
    for (const r of rows) {
      const keys = Object.keys(r).filter((k) => have.has(k))
      if (!keys.length) continue
      const sig = keys.join('\u0000')
      if (!groups.has(sig)) groups.set(sig, { keys, rows: [] })
      groups.get(sig)!.rows.push(r)
    }
    let rowid = 0
    for (const { keys, rows: list } of groups.values()) {
      const from = rowid + 1
      for (const r of list) {
        rowid++
        const args = keys.map((k) => (r[k] === undefined ? null : r[k]))
        const long = args.map((a, i) => (typeof a === 'string' && a.length > piece ? i : -1)).filter((i) => i >= 0)
        push({ sql: `INSERT INTO ${s} (rowid, ${keys.map(q).join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`, args: [rowid, ...args.map((a, i) => (long.includes(i) ? (a as string).slice(0, piece) : a))] })
        for (const i of long) {
          const text = args[i] as string
          for (let at = piece; at < text.length; at += piece) push({ sql: `UPDATE ${s} SET ${q(keys[i])} = ${q(keys[i])} || ? WHERE rowid = ?`, args: [text.slice(at, at + piece), rowid] })
        }
      }
      const cols = keys.map(q).join(', ')
      const range = `rowid BETWEEN ${from} AND ${rowid}`
      if (t === 'settings') {
        const set = keys.filter((k) => k !== 'key').map((k) => `${q(k)} = excluded.${q(k)}`)
        swapInserts.push({ sql: `INSERT INTO "settings" (${cols}) SELECT ${cols} FROM ${s} WHERE ${range} ORDER BY rowid ${set.length ? `ON CONFLICT("key") DO UPDATE SET ${set.join(', ')}` : 'ON CONFLICT("key") DO NOTHING'}`, args: [] })
      } else swapInserts.push({ sql: `INSERT ${APPEND_ONLY.has(t) ? 'OR IGNORE ' : ''}INTO ${q(t)} (${cols}) SELECT ${cols} FROM ${s} WHERE ${range} ORDER BY rowid`, args: [] })
    }
  }
  if (cur.length) stage.push(cur)
  const deletes = [...order].reverse().filter((t) => t !== 'settings' && !APPEND_ONLY.has(t)).map((t) => ({ sql: `DELETE FROM ${q(t)}`, args: [] }))
  const drops = order.map((t) => ({ sql: `DROP TABLE IF EXISTS ${q(STAGE_PREFIX + t)}`, args: [] }))
  const swap = [...deletes, ...swapInserts, { sql: "INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [version] }, ...drops]
  return { stage, swap, cleanup: drops, tables: order }
}

/** The whole restore as one list (run it in one transaction when it is small, e.g. tests and the drill). */
export function restoreStatements(snap: Snapshot, columns: Record<string, string[]>, version: string, opts: RestoreOptions = {}): Stmt[] {
  const p = restorePlan(snap, columns, version, opts)
  return [...p.stage.flat(), ...p.swap]
}

/** Runs a restore plan: the staging requests, then the one swap transaction. On failure the staging tables are dropped and the error is thrown (nothing real changed). */
export async function runRestorePlan(plan: RestorePlan, writeAtomic: (stmts: Stmt[]) => Promise<unknown>): Promise<void> {
  try {
    for (const batch of plan.stage) await writeAtomic(batch)
    await writeAtomic(plan.swap)
  } catch (e) {
    await writeAtomic(plan.cleanup).catch(() => {})
    throw e
  }
}

/** The synced copy of an app in a backup's settings (its `data`), or null. */
export function settingCopy(snap: Snapshot, setting: string): unknown {
  const row = (snap.tables?.settings ?? []).find((r) => r?.key === setting)
  if (!row || typeof row.value !== 'string') return null
  try {
    const v = JSON.parse(row.value)
    return v?.data ?? null
  } catch {
    return null
  }
}

/**
 * Marks the apps' synced copies in a backup as restored: each becomes
 * `{savedAt, editedAt: now, restore: id, data}`. A device whose last-seen
 * restore id differs takes that copy as it is (app sync), instead of merging
 * its own older copy back in. The data is the backup's localStorage copy when
 * it has one (in shared form), else the backup's synced copy. Returns the
 * backup to restore and each app's restored shared data.
 */
export function markRestoredApps(snap: Snapshot, restoreId: string, now: number, share: Record<string, (x: any) => any> = {}): { snap: Snapshot; apps: Record<string, unknown> } {
  const apps: Record<string, unknown> = {}
  const settings = [...(snap.tables?.settings ?? [])]
  for (const b of APP_BLOBS) {
    if (!b.setting) continue
    const data = snap[b.field] != null ? (share[b.field] ?? ((x: any) => x))(snap[b.field]) : settingCopy(snap, b.setting)
    if (data == null) continue
    apps[b.field] = data
    const value = JSON.stringify({ savedAt: now, editedAt: now, restore: restoreId, data })
    const i = settings.findIndex((r) => r?.key === b.setting)
    if (i >= 0) settings[i] = { ...settings[i], value }
    else settings.push({ key: b.setting, value })
  }
  return { snap: { ...snap, tables: { ...snap.tables, settings } }, apps }
}

// ---- Old daily JSON files (the folder "Life System Backups") ---------------

const FILE = /^life-system-(\d{4}-\d{2}-\d{2})\.json$/
export const backupName = (day: string) => `life-system-${day}.json`
export const backupDay = (name: string) => FILE.exec(name)?.[1] ?? null

/**
 * Which old daily JSON files to delete: keep the last 30 days, plus the first
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

// ---- Local backup files (desktop, 2026-11-12) ------------------------------

/** Daily: life-system-2026-11-12.zip. Before a risky step: life-system-2026-11-12-093015-before-import.zip. */
const LOCAL = /^life-system-(\d{4}-\d{2}-\d{2})(?:-(\d{6})-before-([a-z0-9-]{1,40}))?\.(zip|json)$/
export const KEEP_DAILY = 14
export const KEEP_WEEKLY = 8
export const KEEP_MONTHLY = 12
/** Backups made before a risky step: the newest this many are kept. */
export const KEEP_RISK = 30

export interface LocalBackupName {
  name: string
  day: string
  kind: 'daily' | 'risk'
  /** HHMMSS of a "before" backup. */
  time: string | null
  /** What it was made before (slug), for a "before" backup. */
  before: string | null
}

export const slugOf = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'change'

export const dailyBackupName = (day: string) => `life-system-${day}.zip`
export const riskBackupName = (day: string, hhmmss: string, label: string) => `life-system-${day}-${hhmmss}-before-${slugOf(label)}.zip`

export function parseLocalBackup(name: string): LocalBackupName | null {
  const m = LOCAL.exec(name)
  if (!m) return null
  return { name, day: m[1], kind: m[2] ? 'risk' : 'daily', time: m[2] ?? null, before: m[3] ?? null }
}

/** Monday of the week of a day (weeks for the weekly copies). */
function weekOf(day: string): string {
  const d = new Date(day + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/**
 * Which local backup files to delete (14 daily, 8 weekly, 12 monthly, and the
 * newest 30 "before" backups). The daily copies of the 14 newest days with a
 * backup are kept, then the newest copy of each of the 8 newest weeks and of
 * each of the 12 newest months, so a PC that was off for a while still keeps
 * its older copies. Files that aren't ours are never touched, and the newest
 * file is never deleted.
 */
export function localBackupsToDelete(names: string[], _today?: string): string[] {
  const all = names.map(parseLocalBackup).filter((x): x is LocalBackupName => !!x)
  const daily = all.filter((x) => x.kind === 'daily').sort((a, b) => b.day.localeCompare(a.day) || (a.name.endsWith('.zip') ? -1 : 1))
  const keep = new Set<string>()
  const take = (key: (d: string) => string, n: number) => {
    const seen = new Set<string>()
    for (const x of daily) {
      const k = key(x.day)
      if (seen.has(k)) continue
      if (seen.size >= n) break
      seen.add(k)
      keep.add(x.name)
    }
  }
  take((d) => d, KEEP_DAILY)
  take(weekOf, KEEP_WEEKLY)
  take((d) => d.slice(0, 7), KEEP_MONTHLY)
  // Two files of one day (an old .json and the new .zip): both count as that day's copy.
  const keptDays = new Set(daily.filter((x) => keep.has(x.name)).map((x) => x.day))
  for (const x of daily) if (keptDays.has(x.day)) keep.add(x.name)
  const risk = all.filter((x) => x.kind === 'risk').sort((a, b) => `${b.day}${b.time}`.localeCompare(`${a.day}${a.time}`))
  for (const x of risk.slice(0, KEEP_RISK)) keep.add(x.name)
  return all.filter((x) => !keep.has(x.name)).map((x) => x.name)
}
