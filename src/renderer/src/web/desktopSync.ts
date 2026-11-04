import type { Database as SqlJsDatabase } from 'sql.js'
import type { Change, Param } from './browserDb'
import type { TursoHttp } from './tursoHttp'

export type Row = Record<string, Param>
/** One row a desktop change touched: how it looked before and after (null = absent). */
export interface RowChange { t: string; key: Row; before: Row | null; after: Row | null }
/** old local id → new id, per table (only when two devices made the same new id). */
export type Remap = Record<string, Record<string, number>>

export interface PendingWrite {
  id: string
  base: string
  version: string
  changes: Change[]
  /** Row images, so the change can be merged when the server moved on. */
  rows?: RowChange[]
  /** An earlier change was merged: this one must be merged too (its SQL saw the old copy). */
  rebase?: boolean
  /** Ids earlier merged changes renumbered. */
  remap?: Remap
}

export interface SchemaInfo {
  /** Key columns per table ([] = the hidden rowid). */
  keys: Record<string, string[]>
  /** The INTEGER PRIMARY KEY column (renumberable), if any. */
  intPk: Record<string, string | null>
  /** Columns that point at another table's row. */
  fks: Record<string, { from: string; table: string; to: string }[]>
}

const SKIP = /^(sqlite_|libsql_|_litestream|_cf_|desktop_)/

export const encodePending = (write: PendingWrite) => JSON.stringify(write, (_key, value) => value instanceof Uint8Array ? { blob: Array.from(value) } : value)
export const decodePending = (text: string): PendingWrite => JSON.parse(text, (_key, value) => value && Array.isArray(value.blob) ? new Uint8Array(value.blob) : value)

const stable = (v: unknown): string => (v === undefined ? 'undefined' : JSON.stringify(v, (_k, x) => (x instanceof Uint8Array ? { blob: Array.from(x) } : x)))
const same = (a: unknown, b: unknown) => stable(a) === stable(b)
const q = (name: string) => `"${name.replace(/"/g, '""')}"`

// ---- What a change touched -------------------------------------------------

const TABLE_RE = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+["`]?(\w+)["`]?/i

export function touchedTables(changes: Change[]): string[] {
  const out: string[] = []
  for (const c of changes) {
    const t = TABLE_RE.exec(c.sql)?.[1]
    if (t && !SKIP.test(t) && !out.includes(t)) out.push(t)
  }
  return out
}

export function schemaInfo(db: SqlJsDatabase): SchemaInfo {
  const info: SchemaInfo = { keys: {}, intPk: {}, fks: {} }
  const tables = (db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values ?? []).map((r) => String(r[0])).filter((t) => !SKIP.test(t))
  for (const t of tables) {
    const cols = db.exec(`PRAGMA table_info(${q(t)})`)[0]?.values ?? []
    const pk = cols.filter((c) => Number(c[5]) > 0).sort((a, b) => Number(a[5]) - Number(b[5]))
    info.keys[t] = pk.map((c) => String(c[1]))
    info.intPk[t] = pk.length === 1 && String(pk[0][2]).toUpperCase() === 'INTEGER' ? String(pk[0][1]) : null
    info.fks[t] = (db.exec(`PRAGMA foreign_key_list(${q(t)})`)[0]?.values ?? []).map((r) => ({ table: String(r[2]), from: String(r[3]), to: String(r[4] ?? '') }))
  }
  return info
}

function tableRows(db: SqlJsDatabase, t: string, keys: string[]): Map<string, { key: Row; row: Row }> {
  const out = new Map<string, { key: Row; row: Row }>()
  const exists = db.exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '${t.replace(/'/g, "''")}'`).length > 0
  if (!exists) return out
  const stmt = db.prepare(keys.length ? `SELECT * FROM ${q(t)}` : `SELECT rowid AS __rowid, * FROM ${q(t)}`)
  try {
    while (stmt.step()) {
      const row = stmt.getAsObject() as Row
      let key: Row
      if (keys.length) key = Object.fromEntries(keys.map((k) => [k, row[k]]))
      else {
        key = { rowid: row.__rowid }
        delete row.__rowid
      }
      out.set(stable(key), { key, row })
    }
  } finally {
    stmt.free()
  }
  return out
}

/** The rows that differ between two copies, in the given tables. */
export function diffRows(before: SqlJsDatabase, after: SqlJsDatabase, tables: string[], info: SchemaInfo): RowChange[] {
  const out: RowChange[] = []
  for (const t of tables) {
    const keys = info.keys[t] ?? []
    const a = tableRows(before, t, keys)
    const b = tableRows(after, t, keys)
    for (const [k, { key, row }] of b) {
      if (t === 'settings' && row.key === 'data_version') continue
      const old = a.get(k)
      if (!old) out.push({ t, key, before: null, after: row })
      else if (!same(old.row, row)) out.push({ t, key, before: old.row, after: row })
    }
    for (const [k, { key, row }] of a) if (!b.has(k)) out.push({ t, key, before: row, after: null })
  }
  return out
}

// ---- Merging ---------------------------------------------------------------

const isTimeKey = (k: string) => /(^|_)(at|ts|time|date)$|[a-z]At$|^savedAt$|updated|stamp/i.test(k)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const ID_FIELDS = ['id', 'key', 'at', 'day', 'date', 'name']

function idField(...lists: unknown[][]): string | null {
  const all = lists.flat()
  if (!all.length || !all.every(isObj)) return null
  return ID_FIELDS.find((f) => all.every((x) => (x as Record<string, unknown>)[f] != null) && new Set(lists[1].map((x) => stable((x as Record<string, unknown>)[f]))).size === lists[1].length) ?? null
}

/**
 * Three-way merge of one value: `b` the common start, `a` mine (this desktop),
 * `s` the server's. Only one side changed → that side. Both changed: objects
 * and lists merge field by field, counters add both changes, times take the
 * later one, anything else keeps mine.
 */
export function merge3(key: string, b: unknown, a: unknown, s: unknown): unknown {
  if (same(a, b)) return s
  if (same(s, b) || same(a, s)) return a
  if (typeof a === 'number' && typeof s === 'number') {
    if (isTimeKey(key)) return Math.max(a, s)
    if (typeof b === 'number') return s + (a - b)
    return a
  }
  if (isObj(a) && isObj(s)) {
    const base = isObj(b) ? b : {}
    const out: Record<string, unknown> = {}
    for (const k of new Set([...Object.keys(s), ...Object.keys(a)])) {
      const v = merge3(k, base[k], a[k], s[k])
      if (v !== undefined) out[k] = v
    }
    return out
  }
  if (Array.isArray(a) && Array.isArray(s)) {
    const base = Array.isArray(b) ? b : []
    const f = idField(base, a, s)
    if (f) {
      const id = (x: unknown) => stable((x as Record<string, unknown>)[f])
      const bm = new Map(base.map((x) => [id(x), x]))
      const am = new Map(a.map((x) => [id(x), x]))
      const sm = new Map(s.map((x) => [id(x), x]))
      const order = [...s.map(id), ...a.map(id).filter((k) => !sm.has(k))]
      const out: unknown[] = []
      for (const k of order) {
        const v = merge3(key, bm.get(k), am.get(k), sm.get(k))
        if (v !== undefined) out.push(v)
      }
      return out
    }
    const inB = (x: unknown) => base.some((y) => same(x, y))
    const inA = (x: unknown) => a.some((y) => same(x, y))
    const inS = (x: unknown) => s.some((y) => same(x, y))
    return [...s.filter((x) => !(inB(x) && !inA(x))), ...a.filter((x) => !inS(x) && !inB(x))]
  }
  if (typeof a === 'string' && typeof s === 'string') {
    const parse = (v: unknown) => {
      if (typeof v !== 'string' || !/^\s*[[{]/.test(v)) return undefined
      try {
        return JSON.parse(v)
      } catch {
        return undefined
      }
    }
    const [pa, ps] = [parse(a), parse(s)]
    if (pa !== undefined && ps !== undefined) return JSON.stringify(merge3(key, parse(b), pa, ps))
  }
  return a
}

/** Merges one row; `b` null when this desktop created it. */
export function mergeRow(b: Row | null, a: Row, s: Row): Row {
  const out: Row = {}
  for (const k of new Set([...Object.keys(s), ...Object.keys(a)])) out[k] = merge3(k, b ? b[k] : undefined, a[k], s[k]) as Param
  return out
}

function applyRemap(row: Row | null, t: string, map: Remap, info: SchemaInfo): Row | null {
  if (!row) return row
  const out = { ...row }
  const pk = info.intPk[t]
  if (pk && out[pk] != null && map[t]?.[String(out[pk])] != null) out[pk] = map[t][String(out[pk])]
  for (const fk of info.fks[t] ?? []) {
    const v = out[fk.from]
    if (v != null && map[fk.table]?.[String(v)] != null) out[fk.from] = map[fk.table][String(v)]
  }
  return out
}

const mergeMaps = (...maps: (Remap | undefined)[]): Remap => {
  const out: Remap = {}
  for (const m of maps) for (const [t, ids] of Object.entries(m ?? {})) out[t] = { ...(out[t] ?? {}), ...ids }
  return out
}

const where = (key: Row) => {
  const cols = Object.keys(key)
  return { sql: cols.map((c) => `${c === 'rowid' ? 'rowid' : q(c)} = ?`).join(' AND '), args: cols.map((c) => key[c]) }
}

/**
 * Turns a change the server can no longer take as-is (it moved on while this
 * desktop was offline) into statements against the server's newest rows.
 */
export async function rebaseWrite(turso: TursoHttp, write: PendingWrite, info: SchemaInfo): Promise<{ base: string; changes: Change[]; remap: Remap }> {
  if (!write.rows) throw new Error('Sync conflict: this change was saved by an older version and cannot be merged. Your local changes are kept. Save a backup before resolving this.')
  const earlier = write.remap ?? {}
  const rows = write.rows.map((r) => {
    const isInsert = !r.before
    // A row this change created keeps its own id here; renumbering comes below.
    return isInsert ? r : { ...r, key: applyRemap(r.key, r.t, earlier, info)!, before: applyRemap(r.before, r.t, earlier, info), after: applyRemap(r.after, r.t, earlier, info) }
  })
  const reads: Change[] = [{ sql: "SELECT value FROM settings WHERE key = 'data_version'", args: [] }]
  for (const r of rows) {
    const w = where(r.key)
    reads.push({ sql: `SELECT * FROM ${q(r.t)} WHERE ${w.sql}`, args: w.args })
  }
  const insertTables = [...new Set(rows.filter((r) => !r.before && info.intPk[r.t]).map((r) => r.t))]
  for (const t of insertTables) reads.push({ sql: `SELECT MAX(${q(info.intPk[t]!)}) FROM ${q(t)}`, args: [] })
  const res = await turso.readMany(reads)
  const bad = res.find((r) => r instanceof Error)
  if (bad) throw bad
  const ok = res as { cols: string[]; rows: Param[][] }[]
  const base = String(ok[0].rows[0]?.[0] ?? '')
  const server = rows.map((_, i) => {
    const r = ok[i + 1]
    return r.rows[0] ? (Object.fromEntries(r.cols.map((c, j) => [c, r.rows[0][j]])) as Row) : null
  })

  // Same new id made on both sides: this desktop's row gets the next free one.
  const own: Remap = {}
  insertTables.forEach((t, i) => {
    const pk = info.intPk[t]!
    let next = Math.max(Number(ok[rows.length + 1 + i].rows[0]?.[0] ?? 0), ...rows.filter((r) => r.t === t && r.after).map((r) => Number(r.after![pk]) || 0))
    rows.forEach((r, j) => {
      if (r.t !== t || r.before || !r.after || !server[j] || same(server[j], r.after)) return
      own[t] = { ...(own[t] ?? {}), [String(r.after[pk])]: ++next }
      server[j] = null
    })
  })
  const map = mergeMaps(earlier, own)

  const ddl = write.changes.filter((c) => /^\s*(CREATE|ALTER)\s/i.test(c.sql))
  const out: Change[] = [...ddl]
  rows.forEach((r, i) => {
    const s = server[i]
    const key = r.before ? r.key : applyRemap(r.key, r.t, own, info)!
    const after = r.before ? applyRemap(r.after, r.t, own, info) : applyRemap(r.after, r.t, map, info)
    const w = where(key)
    if (!after) {
      // Deleted here: only if the server still has it as it was.
      if (s && same(s, r.before)) out.push({ sql: `DELETE FROM ${q(r.t)} WHERE ${w.sql}`, args: w.args })
      return
    }
    if (!s) {
      const cols = Object.keys(after)
      const withRowid = 'rowid' in key && !(info.keys[r.t] ?? []).length
      const names = [...(withRowid ? ['rowid'] : []), ...cols.map(q)]
      out.push({ sql: `INSERT INTO ${q(r.t)} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`, args: [...(withRowid ? [key.rowid] : []), ...cols.map((c) => after[c])] })
      return
    }
    const merged = mergeRow(r.before, after, s)
    const changed = Object.keys(merged).filter((c) => !same(merged[c], s[c]))
    if (!changed.length) return
    out.push({ sql: `UPDATE ${q(r.t)} SET ${changed.map((c) => `${q(c)} = ?`).join(', ')} WHERE ${w.sql}`, args: [...changed.map((c) => merged[c]), ...w.args] })
  })
  return { base, changes: out, remap: own }
}

// ---- Sending ---------------------------------------------------------------

async function receipt(turso: TursoHttp, id: string): Promise<{ remap: Remap } | null> {
  const [done, old] = await turso.readMany([
    { sql: 'SELECT remap FROM desktop_sync_done WHERE id = ?', args: [id] },
    { sql: 'SELECT id FROM desktop_sync_receipts WHERE id = ?', args: [id] }
  ])
  if (!(done instanceof Error) && done.rows.length) return { remap: JSON.parse(String(done.rows[0][0] || '{}')) }
  if (!(old instanceof Error) && old.rows.length) return { remap: {} }
  return null
}

async function commit(turso: TursoHttp, write: PendingWrite, base: string, changes: Change[], remap: Remap): Promise<void> {
  await turso.writeAtomic([
    { sql: 'CREATE TABLE IF NOT EXISTS desktop_sync_done (id TEXT PRIMARY KEY, saved_at TEXT NOT NULL, remap TEXT)', args: [] },
    { sql: 'INSERT INTO desktop_sync_done (id, saved_at, remap) VALUES (?, ?, ?)', args: [write.id, new Date().toISOString(), JSON.stringify(remap)] },
    { sql: 'CREATE TABLE IF NOT EXISTS desktop_sync_guard (ok INTEGER CHECK (ok = 1))', args: [] },
    { sql: "INSERT INTO desktop_sync_guard (ok) SELECT CASE WHEN COALESCE((SELECT value FROM settings WHERE key = 'data_version'), '') = ? THEN 1 ELSE 0 END", args: [base] },
    ...changes,
    { sql: "INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [write.version] },
    { sql: 'DELETE FROM desktop_sync_guard', args: [] }
  ])
}

const isGuard = (e: unknown) => String(e).includes('CHECK constraint')

/**
 * Sends one saved change. A durable operation id makes retries safe after a
 * response is lost. When the server changed meanwhile (another device, Ben,
 * Sporty), the change is merged into the server's newest rows instead.
 * Returns whether it was merged and the ids it renumbered.
 */
export async function sendPending(turso: TursoHttp, write: PendingWrite, info?: SchemaInfo): Promise<{ merged: boolean; remap: Remap }> {
  const done = await receipt(turso, write.id)
  if (done) return { merged: !!write.rebase || Object.keys(done.remap).length > 0, remap: done.remap }
  if (!write.rebase) {
    try {
      await commit(turso, write, write.base, write.changes, {})
      return { merged: false, remap: {} }
    } catch (error) {
      // The server may have committed before the network connection broke.
      const late = await receipt(turso, write.id)
      if (late) return { merged: false, remap: late.remap }
      if (!isGuard(error)) throw error
      if (!info) throw new Error('Sync conflict: the server changed while you were offline. Your local changes are kept. Save a backup before resolving this.')
    }
  }
  if (!info) throw new Error('Sync conflict: cannot merge without the table layout')
  let last: unknown = null
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await rebaseWrite(turso, write, info)
    try {
      await commit(turso, write, r.base, r.changes, r.remap)
      return { merged: true, remap: r.remap }
    } catch (error) {
      const late = await receipt(turso, write.id)
      if (late) return { merged: true, remap: late.remap }
      last = error
      if (!isGuard(error)) break // a real clash (e.g. a rule the data breaks): stop and keep both copies
    }
  }
  throw new Error(`Sync conflict: could not merge a change made offline (${String((last as Error)?.message ?? last).slice(0, 160)}). Your local changes are kept. Save a backup before resolving this.`)
}
