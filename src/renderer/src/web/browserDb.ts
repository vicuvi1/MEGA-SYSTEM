// A small better-sqlite3–compatible wrapper around sql.js, so the desktop
// services (src/main/*.ts) run unchanged in the browser. Every statement that
// changes data is recorded, so the same change can be sent to Turso.
import type { Database as SqlJsDatabase, SqlValue } from 'sql.js'

export type Param = string | number | null | Uint8Array
export interface Change { sql: string; args: Param[] }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint8Array)

const toParam = (v: unknown): Param => {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'number' || typeof v === 'string' || v instanceof Uint8Array) return v
  return String(v)
}

/**
 * better-sqlite3 accepts `run(a, b)`, `run([a, b])` and `run({ name })` with
 * `@name`/`:name`/`$name` in the SQL. Both sql.js and Turso get the same plain
 * `?` form, so they always see exactly the same statement.
 */
export function normalize(sql: string, raw: unknown[]): Change {
  if (raw.length === 1 && isPlainObject(raw[0])) {
    const obj = raw[0]
    const args: Param[] = []
    let out = ''
    let quote: string | null = null
    for (let i = 0; i < sql.length; i++) {
      const c = sql[i]
      if (quote) {
        out += c
        if (c === quote) quote = null
        continue
      }
      if (c === "'" || c === '"') {
        quote = c
        out += c
        continue
      }
      if ((c === '@' || c === ':' || c === '$') && /[A-Za-z_]/.test(sql[i + 1] ?? '')) {
        let j = i + 1
        while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++
        const name = sql.slice(i + 1, j)
        if (!(name in obj)) throw new Error(`Missing named parameter "${name}"`)
        args.push(toParam(obj[name]))
        out += '?'
        i = j - 1
        continue
      }
      out += c
    }
    return { sql: out, args }
  }
  return { sql, args: raw.flat().map(toParam) }
}

const isWrite = (sql: string) => !/^\s*(SELECT|WITH\s[\s\S]*SELECT|PRAGMA\s+\w+\s*$|EXPLAIN)/i.test(sql)

/**
 * A statement touched data this copy has not downloaded yet (the server's
 * copy starts without the big app blobs and without most tables: Mirror
 * `lazy`). The mirror downloads what is named here and runs the whole read or
 * change again; nothing ever runs against a table that is only empty because
 * it was not loaded.
 */
export class NeedData extends Error {
  constructor(public tables: string[], public keys: string[], public allKeys: boolean) {
    super(`Data not loaded yet: ${[...tables, ...keys, ...(allKeys ? ['every setting'] : [])].join(', ')}`)
    this.name = 'NeedData'
  }
}

/** What a lazy copy has not loaded yet. */
export interface LazyState {
  /** Tables not downloaded yet (lower case). */
  tables: Set<string>
  /** Is this settings key one of the big ones left out at the start? */
  isBlob: (key: string) => boolean
  /** Left-out settings that were downloaded since (or looked up and not there). */
  keys: Set<string>
  /** Every left-out setting was downloaded. */
  allKeys: boolean
}

export class BrowserDb {
  /** Set by the mirror on the server's copy only. */
  lazy: LazyState | null = null
  private need: { tables: Set<string>; keys: Set<string>; allKeys: boolean } | null = null
  /** What statements needed since the last call (also when the caller swallowed the error). */
  takeNeed(): NeedData | null {
    const n = this.need
    this.need = null
    return n ? new NeedData([...n.tables], [...n.keys], n.allKeys) : null
  }
  private static WORDS = /[A-Za-z_][A-Za-z0-9_]*/g
  private static ONE_KEY = /\bkey\s*=\s*(\?|'[^']*')|\bkey\s+IN\s*\(|\(\s*key\s*,\s*value\s*\)\s*VALUES/i
  /** Refuses a statement that names data not loaded yet, and remembers what it needs. */
  private guard(sql: string, args: readonly unknown[]): void {
    const lazy = this.lazy
    if (!lazy) return
    const tables = new Set<string>()
    let settings = false
    for (const w of sql.match(BrowserDb.WORDS) ?? []) {
      const t = w.toLowerCase()
      if (t === 'settings') settings = true
      else if (lazy.tables.has(t)) tables.add(t)
    }
    const keys = new Set<string>()
    let allKeys = false
    if (settings && !lazy.allKeys) {
      if (BrowserDb.ONE_KEY.test(sql)) {
        const named = [...args.filter((a): a is string => typeof a === 'string'), ...[...sql.matchAll(/'([^']*)'/g)].map((m) => m[1])]
        for (const k of named) if (k.length <= 200 && lazy.isBlob(k) && !lazy.keys.has(k)) keys.add(k)
      } else allKeys = true
    }
    if (!tables.size && !keys.size && !allKeys) return
    this.need ??= { tables: new Set(), keys: new Set(), allKeys: false }
    for (const t of tables) this.need.tables.add(t)
    for (const k of keys) this.need.keys.add(k)
    this.need.allKeys ||= allKeys
    throw new NeedData([...tables], [...keys], allKeys)
  }

  private depth = 0
  private sp = 0
  /** Changes made since the last `takeChanges()`, in order. */
  private changes: Change[] = []
  private pkCache = new Map<string, string | null>()
  /**
   * Called with the table a statement is about to change, before it runs (the
   * desktop keeps that table's rows from before the change, to send only what
   * changed: no copy of the whole database is needed for that).
   */
  onTouch: ((table: string) => void) | null = null
  private static TOUCH = /^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+["`]?(\w+)["`]?/i
  private touch(sql: string): void {
    if (!this.onTouch) return
    const t = BrowserDb.TOUCH.exec(sql)?.[1]
    if (t) this.onTouch(t)
  }

  constructor(public readonly raw: SqlJsDatabase) {}

  /** Like better-sqlite3: true while a transaction (or savepoint) is open. */
  get inTransaction(): boolean {
    return this.depth > 0
  }

  takeChanges(): Change[] {
    const c = this.changes
    this.changes = []
    return c
  }

  dropChanges(): void {
    this.changes = []
    this.expected.clear()
    this.rowsBefore.clear()
  }

  /**
   * Settings this change overwrote, with the value they had before (null =
   * no row). The mirror sends them as a check: if another device or the server
   * changed one meanwhile, the write is refused and redone on fresh data.
   */
  private expected = new Map<string, string | null>()
  takeExpected(): Map<string, string | null> {
    const e = new Map(this.expected)
    this.expected.clear()
    return e
  }
  /** Rows this change edits or deletes by id: table → id → their columns as SQLite quotes them. */
  private rowsBefore = new Map<string, { table: string; id: unknown; cols: string[]; value: string | null }>()
  takeRowChecks(): { table: string; id: unknown; cols: string[]; value: string | null }[] {
    const r = [...this.rowsBefore.values()]
    this.rowsBefore.clear()
    return r
  }
  private static ROW_EDIT = /^\s*(?:UPDATE\s+["`]?(\w+)["`]?\s+SET[\s\S]+?|DELETE\s+FROM\s+["`]?(\w+)["`]?\s+)WHERE\s+id\s*=\s*\?\s*$/i
  private static SET_SETTING = /^\s*INSERT\s+INTO\s+settings\s*\(\s*key\s*,\s*value\s*\)\s*VALUES\s*\(\s*\?\s*,\s*\?\s*\)/i

  private rows(sql: string, args: Param[]): Record<string, unknown>[] {
    const stmt = this.raw.prepare(sql)
    try {
      stmt.bind(args as SqlValue[])
      const out: Record<string, unknown>[] = []
      // Like getAsObject, with the column names read once (not once per row).
      let cols: string[] | null = null
      while (stmt.step()) {
        cols ??= stmt.getColumnNames()
        const vals = stmt.get()
        const row: Record<string, unknown> = {}
        for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i]
        out.push(row)
      }
      return out
    } finally {
      stmt.free()
    }
  }

  private scalar(sql: string): number {
    const r = this.raw.exec(sql)
    return Number(r[0]?.values[0]?.[0] ?? 0)
  }

  /** Tables whose rows are upserted by a natural key (sleep_logs: one row per day); nothing points at their ids. */
  private static BY_NATURAL_KEY: ReadonlySet<string> = new Set(['sleep_logs'])

  /** The INTEGER PRIMARY KEY column of a table (its rowid), if it has one. */
  private rowidColumn(table: string): string | null {
    if (this.pkCache.has(table)) return this.pkCache.get(table)!
    const cols = this.rows(`PRAGMA table_info(${JSON.stringify(table)})`, [])
    const pk = cols.filter((c) => Number(c.pk) > 0)
    const col = pk.length === 1 && String(pk[0].type).toUpperCase() === 'INTEGER' ? String(pk[0].name) : null
    this.pkCache.set(table, col)
    return col
  }

  /**
   * A new row got its id here; Turso must store the same id, or records that
   * point at it (undo_of, ledger_id…) would point at the wrong row.
   */
  private withExplicitId(change: Change, id: number): Change {
    const m = /^\s*INSERT(\s+OR\s+\w+)?\s+INTO\s+["`]?(\w+)["`]?\s*\(([^)]*)\)\s*VALUES\s*\(/i.exec(change.sql)
    // A row every device finds by its day, never by its number: sent with a number,
    // the same number taken by another day on another device would refuse the night.
    if (m && BrowserDb.BY_NATURAL_KEY.has(m[2].toLowerCase())) return change
    if (!m || /\bSELECT\b/i.test(change.sql) || (change.sql.match(/\bVALUES\b/gi) || []).length !== 1) return change
    const col = this.rowidColumn(m[2])
    if (!col) return change
    const cols = m[3].split(',').map((c) => c.trim().replace(/["`]/g, '').toLowerCase())
    if (cols.includes(col.toLowerCase())) return change
    const head = `INSERT${m[1] ?? ''} INTO ${m[2]} (${col}, ${m[3].trim()}) VALUES (?, `
    return { sql: head + change.sql.slice(m[0].length), args: [id, ...change.args] }
  }

  private run(sql: string, raw: unknown[]): { changes: number; lastInsertRowid: number } {
    const change = normalize(sql, raw)
    this.guard(change.sql, change.args)
    const edit = BrowserDb.ROW_EDIT.exec(change.sql)
    if (edit) {
      const table = edit[1] ?? edit[2]
      const id = change.args[change.args.length - 1]
      const k = `${table}:${String(id)}`
      if (table !== 'settings' && !this.rowsBefore.has(k)) {
        const cols = this.rows(`PRAGMA table_info(${JSON.stringify(table)})`, []).map((c) => String(c.name))
        if (cols.length) {
          const expr = cols.map((c) => `quote("${c}")`).join(" || '|' || ")
          const row = this.rows(`SELECT ${expr} AS v FROM "${table}" WHERE id = ?`, [id as Param])[0]
          this.rowsBefore.set(k, { table, id, cols, value: row ? String(row.v) : null })
        }
      }
    }
    if (BrowserDb.SET_SETTING.test(change.sql)) {
      const key = String(change.args[0])
      if (key !== 'data_version' && !this.expected.has(key)) {
        const row = this.rows('SELECT value FROM settings WHERE key = ?', [key])[0]
        this.expected.set(key, row ? (row.value == null ? null : String(row.value)) : null)
      }
    }
    const before = this.scalar('SELECT last_insert_rowid()')
    if (isWrite(change.sql)) this.touch(change.sql)
    this.raw.run(change.sql, change.args as SqlValue[])
    const changes = this.raw.getRowsModified()
    const after = this.scalar('SELECT last_insert_rowid()')
    if (isWrite(change.sql)) {
      // SQLite sets last_insert_rowid on every successful INSERT, even when the
      // number equals the previous one (another table's row); only an upsert
      // that updated instead leaves it untouched.
      const inserted = changes > 0 && /^\s*INSERT/i.test(change.sql) && (after !== before || !/\bON\s+CONFLICT\b/i.test(change.sql))
      this.changes.push(inserted ? this.withExplicitId(change, after) : change)
    }
    return { changes, lastInsertRowid: after }
  }

  prepare(sql: string) {
    return {
      run: (...args: unknown[]) => this.run(sql, args),
      get: (...args: unknown[]) => {
        const c = normalize(sql, args)
        this.guard(c.sql, c.args)
        return this.rows(c.sql, c.args)[0]
      },
      all: (...args: unknown[]) => {
        const c = normalize(sql, args)
        this.guard(c.sql, c.args)
        return this.rows(c.sql, c.args)
      }
    }
  }

  exec(sql: string): void {
    this.guard(sql, [])
    if (isWrite(sql)) this.touch(sql)
    this.raw.exec(sql)
    if (isWrite(sql)) this.changes.push({ sql, args: [] })
  }

  pragma(source: string, opts?: { simple?: boolean }): unknown {
    this.guard(source, [])
    const r = this.rows(`PRAGMA ${source}`, [])
    if (opts?.simple) return r[0] ? Object.values(r[0])[0] : undefined
    return r
  }

  /** Like better-sqlite3: nested calls become savepoints; a throw rolls back. */
  transaction<A extends unknown[], R>(fn: (...args: A) => R) {
    const run = (...args: A): R => {
      const outer = this.depth === 0
      const name = `sp${++this.sp}`
      const mark = this.changes.length
      this.raw.run(outer ? 'BEGIN' : `SAVEPOINT ${name}`)
      this.depth++
      try {
        const res = fn(...args)
        this.depth--
        this.raw.run(outer ? 'COMMIT' : `RELEASE ${name}`)
        return res
      } catch (e) {
        this.depth--
        if (outer) this.raw.run('ROLLBACK')
        else {
          this.raw.run(`ROLLBACK TO ${name}`)
          this.raw.run(`RELEASE ${name}`)
        }
        this.changes.length = mark
        throw e
      }
    }
    // better-sqlite3's variants (locking modes don't matter in one tab).
    return Object.assign(run, { immediate: run, deferred: run, exclusive: run, default: run })
  }
}
