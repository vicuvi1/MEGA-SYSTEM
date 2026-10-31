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

export class BrowserDb {
  private depth = 0
  private sp = 0
  /** Changes made since the last `takeChanges()`, in order. */
  private changes: Change[] = []
  private pkCache = new Map<string, string | null>()

  constructor(public readonly raw: SqlJsDatabase) {}

  takeChanges(): Change[] {
    const c = this.changes
    this.changes = []
    return c
  }

  dropChanges(): void {
    this.changes = []
  }

  private rows(sql: string, args: Param[]): Record<string, unknown>[] {
    const stmt = this.raw.prepare(sql)
    try {
      stmt.bind(args as SqlValue[])
      const out: Record<string, unknown>[] = []
      while (stmt.step()) out.push(stmt.getAsObject() as Record<string, unknown>)
      return out
    } finally {
      stmt.free()
    }
  }

  private scalar(sql: string): number {
    const r = this.raw.exec(sql)
    return Number(r[0]?.values[0]?.[0] ?? 0)
  }

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
    const before = this.scalar('SELECT last_insert_rowid()')
    this.raw.run(change.sql, change.args as SqlValue[])
    const changes = this.raw.getRowsModified()
    const after = this.scalar('SELECT last_insert_rowid()')
    if (isWrite(change.sql)) {
      const inserted = changes > 0 && after !== before && /^\s*INSERT/i.test(change.sql)
      this.changes.push(inserted ? this.withExplicitId(change, after) : change)
    }
    return { changes, lastInsertRowid: after }
  }

  prepare(sql: string) {
    return {
      run: (...args: unknown[]) => this.run(sql, args),
      get: (...args: unknown[]) => {
        const c = normalize(sql, args)
        return this.rows(c.sql, c.args)[0]
      },
      all: (...args: unknown[]) => {
        const c = normalize(sql, args)
        return this.rows(c.sql, c.args)
      }
    }
  }

  exec(sql: string): void {
    this.raw.exec(sql)
    if (isWrite(sql)) this.changes.push({ sql, args: [] })
  }

  pragma(source: string, opts?: { simple?: boolean }): unknown {
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
