// The web app's copy of the Turso database. Reads come from an in-browser
// SQLite (sql.js) loaded from Turso; every change runs locally first and is
// then sent to Turso in one transaction. If Turso refuses it, the copy is
// reloaded from Turso, so it never shows something that isn't saved.
//
// Startup is instant on a phone: the last copy is kept in IndexedDB and
// shown at once, then refreshed from Turso in the background.
import { UnauthorizedError } from './tursoHttp'
import type { SqlJsStatic, Database as SqlJsDatabase } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { DEFAULT_RULES } from '@core/rules'
import { DEFAULT_EXERCISES } from '@core/body'
import { BrowserDb, type Change, type Param } from './browserDb'
import type { TursoHttp } from './tursoHttp'
import { decodePending, diffRows, encodePending, schemaInfo, sendPending, touchedTables, type Remap } from './desktopSync'
import { READ_VERSIONS, catchUpPlan, parseVersions, repairStatements, trackStatements, versionsBefore, type TableVersions } from './tableVersions'

// cloud_snapshots: 30 full backups, read straight from Turso when needed, never copied to every device.
const SKIP = /^(sqlite_|libsql_|_litestream|_cf_|desktop_|sys_|cloud_snapshots$)/

export interface MirrorStore {
  load(): Promise<Uint8Array | null>
  save(bytes: Uint8Array): Promise<void>
}

/** The last copy, in IndexedDB (falls back to nothing when unavailable). */
export function indexedDbStore(name = 'life-system-mirror'): MirrorStore {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1)
      req.onupgradeneeded = () => req.result.createObjectStore('kv')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  return {
    async load() {
      try {
        const db = await open()
        return await new Promise((resolve) => {
          const r = db.transaction('kv').objectStore('kv').get('db')
          r.onsuccess = () => resolve((r.result as Uint8Array) ?? null)
          r.onerror = () => resolve(null)
        })
      } catch {
        return null
      }
    },
    async save(bytes) {
      try {
        const db = await open()
        await new Promise<void>((resolve) => {
          const tx = db.transaction('kv', 'readwrite')
          tx.objectStore('kv').put(bytes, 'db')
          tx.oncomplete = () => resolve()
          tx.onerror = () => resolve()
        })
      } catch {
        /* a private window: no cache, still works */
      }
    }
  }
}

export class MirrorError extends Error {}

export class Mirror {
  private db: BrowserDb | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private listeners = new Set<() => void>()
  private refreshing: Promise<boolean> | null = null
  /**
   * A marker every change sets in Turso (settings.data_version): a refresh
   * reads it first and downloads everything only when it moved, instead of
   * the whole database every minute.
   */
  private version: string | null = null
  /** Which version of each table this copy has (see tableVersions.ts). */
  private tv: TableVersions | null = null
  private rebuiltAt = 0
  /** When the copy last matched Turso (null: only the cached copy so far). */
  syncedAt: string | null = null
  lastError: string | null = null
  readonly ready: Promise<void>

  constructor(private SQL: SqlJsStatic, private turso: TursoHttp, private store: MirrorStore | null = null, private desktop = false) {
    this.ready = this.start()
    if (typeof window !== 'undefined' && !this.desktop) window.addEventListener('online', () => void this.refresh().catch(() => {}))
    if (desktop && typeof window !== 'undefined') {
      window.addEventListener('life-desktop-retry', () => { void this.refresh().catch(() => {}) })
      window.addEventListener('life-desktop-use-server', () => {
        void this.ready.then(() => this.lock(async () => {
          // The UI has already saved an explicit backup and confirmed this choice.
          // Rebuild downloads fully before replacing the current local database.
          await this.rebuild()
          await this.store!.save(this.current.raw.export())
          this.lastError = null
          this.emit()
          this.desktopStatus()
        })).catch((error) => { this.lastError = error.message; this.desktopStatus() })
      })
    }
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    this.listeners.forEach((cb) => {
      try {
        cb()
      } catch {
        /* a listener's problem stays there */
      }
    })
  }

  /** One thing at a time: a refresh never swaps the copy under a write. */
  private lock<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => {})
    return run
  }

  private async start(): Promise<void> {
    const cached = this.store ? await this.store.load() : null
    if (cached) {
      try {
        this.db = new BrowserDb(new this.SQL.Database(cached))
        this.version = String(this.db.prepare("SELECT value FROM settings WHERE key = 'data_version'").get()?.value ?? '')
        this.tv = this.loadTv()
        // Cached copy: compare table by table on the first refresh.
        this.rebuiltAt = Date.now()
        // Fresh data arrives in the background; the cached copy shows now.
        this.refresh().catch(() => {})
        return
      } catch {
        this.db = null
      }
    }
    await this.lock(() => this.rebuild())
  }

  get current(): BrowserDb {
    if (!this.db) throw new MirrorError('Your data is still loading')
    return this.db
  }

  /** A read on the current copy. */
  async read<T>(fn: (db: BrowserDb) => T): Promise<T> {
    await this.ready
    return this.lock(() => fn(this.current))
  }

  /**
   * A change: runs on the copy, then goes to Turso in one transaction. Only
   * when Turso has it does the caller get the result.
   */
  async write<T>(fn: (db: BrowserDb) => T): Promise<T> {
    await this.ready
    if (this.desktop) return this.writeDesktop(fn)
    return this.lock(async () => {
     // A setting changed elsewhere since our copy (another device, the server's tick):
     // Turso refuses the write, we reload and run the change again on fresh data.
     for (let attempt = 0; ; attempt++) {
      const db = this.current
      db.dropChanges()
      const result = db.transaction(() => fn(db))()
      const changes = db.takeChanges()
      const expected = db.takeExpected()
      // Records edited or deleted by id must still be as we read them (after 2
      // conflicts in a row, the change goes through anyway: newest wins).
      const rowChecks = attempt < 2 ? db.takeRowChecks() : (db.takeRowChecks(), [])
      if (!changes.length) return result
      const version = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const mark = { sql: "INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [version] }
      const touched = touchedTables(changes)
      const checks = [...casStatements(expected), ...rowCasStatements(rowChecks, expected.size > 0)]
      try {
        const before = versionsBefore(touched)
        const batch = [...writeOnce(version), ...before, ...checks, ...changes, ...trackStatements(touched, version), mark, ...(checks.length ? [{ sql: 'DELETE FROM sys_cas', args: [] }] : [])]
        let out: Param[][][]
        try {
          out = await this.turso.writeAtomic(batch)
        } catch (e) {
          // Timed out: it may have been saved anyway. Send the very same batch once
          // more; "already saved" (its write id exists) counts as saved (Y5).
          if (!isRetryable(e) || e instanceof UnauthorizedError) throw e
          out = await this.turso.writeAtomic(batch).catch((e2) => {
            if (isAlreadySaved(e2)) return []
            throw e2
          })
        }
        const shift = 3 // writeOnce's three statements come first
        // A table we wrote is marked current only if nobody else changed it since
        // we last read it (Y2); otherwise the next refresh re-reads it and gets both.
        if (this.tv) {
          const remote = new Map((out[shift + 1] ?? []).map((r) => [String(r[0]), String(r[1])]))
          for (const t of touched) if ((remote.get(t) ?? '') === (this.tv[t] ?? '')) this.tv[t] = version
          this.saveTv()
        }
        this.lastError = null
      } catch (e) {
        // Offline (the phone in a tunnel), or a server hiccup / timeout / locked
        // session: keep the change here and send it later (S3). Re-downloading
        // everything on a hiccup threw the change away.
        if (isOffline(e) || (typeof window !== 'undefined' && isRetryable(e))) {
          // With its checks (Y3): sent later, it must still find the rows as they were read
          // here; if another device changed them meanwhile, it goes to "couldn't sync" (Y1)
          // instead of overwriting their newer edit.
          this.queueOffline([...writeOnce(version), ...checks, ...changes, ...trackStatements(touched, version), mark, ...(checks.length ? [{ sql: 'DELETE FROM sys_cas', args: [] }] : [])])
          this.persist()
          this.emit()
          return result
        }
        this.lastError = (e as Error).message
        // Put the copy back the way Turso has it.
        await this.rebuild().catch(() => {})
        this.emit()
        // Changed elsewhere, or the same new id taken on another device: fresh copy, run again (Y5).
        if ((isCasConflict(e) || isUniqueClash(e)) && attempt < 3) continue
        throw new MirrorError(
          navigator.onLine === false
            ? 'You are offline, so this was not saved. Try again when you are back online.'
            : `Not saved: ${(e as Error).message}`
        )
      }
      this.persist()
      this.emit()
      return result
     }
    })
  }

  /**
   * Reloads the copy from Turso (e.g. after the phone or a bot changed
   * something). Cheap when nothing changed: one tiny query. True when the
   * copy was reloaded (listeners hear it only then).
   */
  refresh(): Promise<boolean> {
    if (this.refreshing) return this.refreshing
    this.refreshing = this.lock(async () => {
      // A failed upload no longer breaks syncing with an error on every run (Y7):
      // it is shown in the sync status and tried again next time. Downloading
      // waits while this PC still has unsent changes (it would overwrite them).
      if (this.desktop && this.db) {
        try {
          await this.flushDesktop()
        } catch (e) {
          this.lastError = `Couldn't send this PC's changes yet: ${(e as Error).message}`.slice(0, 240)
          if (this.pending().length) return false
        }
      }
      // Changes made offline go first, so the fresh copy has them.
      if (!this.desktop) await this.flushOffline()
      return this.catchUp()
    })
      .then((changed) => {
        if (changed) this.emit()
        return changed
      })
      .finally(() => {
        this.refreshing = null
        if (this.desktop) this.desktopStatus()
      })
    return this.refreshing
  }

  // ---- Offline queue (web): changes made without a connection --------------
  private static OUTBOX = 'life_offline_writes'
  // The waiting changes live in memory too (S3): if the browser can't store
  // them (storage full, private window) they still go out from this tab, and
  // you're told plainly instead of losing them on the next reload.
  private offline: Change[][] | null = null
  private outboxUnsaved = false
  private outbox(): Change[][] {
    if (this.offline) return this.offline
    try {
      const v = typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem(Mirror.OUTBOX) || '[]') : []
      this.offline = Array.isArray(v) ? v : []
    } catch {
      this.offline = []
    }
    return this.offline
  }
  private saveOutbox(list: Change[][]): void {
    this.offline = list
    try {
      if (typeof localStorage === 'undefined') return
      if (list.length) localStorage.setItem(Mirror.OUTBOX, JSON.stringify(list))
      else localStorage.removeItem(Mirror.OUTBOX)
      this.outboxUnsaved = false
    } catch {
      this.outboxUnsaved = list.length > 0
    }
  }
  private queueOffline(batch: Change[]): void {
    // Never trimmed: an old change is never dropped to make room (S3).
    const list = [...this.outbox(), batch]
    this.saveOutbox(list)
    this.lastError = this.outboxUnsaved
      ? `⚠ ${list.length} change${list.length === 1 ? '' : 's'} not synced yet and this browser can't store them: keep this tab open until you're back online`
      : `Offline: ${list.length} change${list.length === 1 ? '' : 's'} waiting to sync`
  }
  /** Changes made offline and not yet in Turso. */
  get pendingOffline(): number {
    return this.outbox().length
  }
  /** Sends the offline changes, oldest first; stops at the first that fails. */
  private async flushOffline(): Promise<void> {
    const list = this.outbox()
    if (!list.length) return
    let sent = 0
    for (const batch of list) {
      try {
        await this.turso.writeAtomic(batch)
        sent++
      } catch (e) {
        // No connection, locked (PIN), a server hiccup or a timeout: keep it and
        // try again later, never drop it (Y1).
        // Sent before but the answer got lost: it's in Turso already (Y5).
        if (isAlreadySaved(e)) {
          sent++
          continue
        }
        if (isOffline(e) || isRetryable(e)) break
        // Refused by the database for good (e.g. a row deleted elsewhere): kept
        // in "couldn't sync" (Settings shows it) instead of vanishing.
        this.saveFailed([...this.failedSync, { at: new Date().toISOString(), error: String((e as Error)?.message ?? e).slice(0, 200), batch }])
        sent++
      }
    }
    this.saveOutbox(list.slice(sent))
    if (sent) this.lastError = list.length - sent ? `Offline: ${list.length - sent} changes waiting to sync` : null
  }

  private static FAILED = 'life_sync_failed'
  /** Offline changes the database refused (newest last, up to 50), for the sync panel. */
  get failedSync(): { at: string; error: string; batch: Change[] }[] {
    try {
      const v = typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem(Mirror.FAILED) || '[]') : []
      return Array.isArray(v) ? v : []
    } catch {
      return []
    }
  }
  private saveFailed(list: { at: string; error: string; batch: Change[] }[]): void {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(Mirror.FAILED, JSON.stringify(list.slice(-50)))
    } catch {
      /* storage full */
    }
  }
  /** Forget the "couldn't sync" list (after you've looked at it). */
  clearFailed(): void {
    this.saveFailed([])
  }

  /**
   * Brings the copy up to Turso: nothing when nothing changed (one tiny
   * query), only the changed tables when every change since was tracked,
   * else (or every 6 hours, as a safety net) everything. True when it changed.
   */
  private async catchUp(): Promise<boolean> {
    if (this.db && Date.now() - this.rebuiltAt < 6 * 3600_000) {
      const [r, t] = await this.turso.readMany(READ_VERSIONS)
      if (!(r instanceof Error)) {
        const dv = String(r.rows[0]?.[0] ?? '')
        const remote = t instanceof Error ? null : parseVersions(t.rows)
        const plan = catchUpPlan(dv, remote, this.version, this.tv, new Set(this.localTables()))
        if (plan.kind === 'same') {
          this.syncedAt = new Date().toISOString()
          return false
        }
        if (plan.kind === 'tables') {
          try {
            await this.reloadTables(plan.tables, dv, remote!)
            return plan.tables.length > 0
          } catch {
            /* a column or table this copy doesn't have: download everything */
          }
        }
      }
    }
    await this.rebuild()
    return true
  }

  private localTables(): string[] {
    return (this.current.raw.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")[0]?.values ?? []).map((r) => String(r[0])).filter((t) => !SKIP.test(t))
  }

  /** Replaces just these tables with Turso's rows, in one local transaction. */
  private async reloadTables(tables: string[], version: string, remote: TableVersions): Promise<void> {
    const data = tables.length ? await this.turso.readMany(tables.map((t) => ({ sql: `SELECT * FROM "${t}"`, args: [] }))) : []
    const raw = this.current.raw
    raw.run('BEGIN')
    try {
      tables.forEach((t, i) => {
        const res = data[i]
        if (res instanceof Error) throw res
        raw.run(`DELETE FROM "${t}"`)
        if (!res.rows.length) return
        const stmt = raw.prepare(`INSERT INTO "${t}" (${res.cols.map((c) => `"${c}"`).join(', ')}) VALUES (${res.cols.map(() => '?').join(', ')})`)
        try {
          for (const row of res.rows) stmt.run(row as Param[] as any)
        } finally {
          stmt.free()
        }
      })
      raw.run("INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [version])
      raw.run('COMMIT')
    } catch (e) {
      raw.run('ROLLBACK')
      throw e
    }
    this.version = version
    this.tv = { ...remote }
    this.saveTv()
    this.syncedAt = new Date().toISOString()
    this.persist()
  }

  private loadTv(): TableVersions | null {
    try {
      const v = this.current.raw.exec('SELECT v FROM desktop_table_versions WHERE k = 1')[0]?.values[0]?.[0]
      return v == null ? null : JSON.parse(String(v))
    } catch {
      return null
    }
  }

  private saveTv(): void {
    try {
      const raw = this.current.raw
      raw.run('CREATE TABLE IF NOT EXISTS desktop_table_versions (k INTEGER PRIMARY KEY, v TEXT)')
      raw.run('INSERT OR REPLACE INTO desktop_table_versions (k, v) VALUES (1, ?)', [JSON.stringify(this.tv)])
    } catch {
      /* the next full download writes it */
    }
  }

  private persist(): void {
    if (!this.store || !this.db) return
    try {
      this.store.save(this.db.raw.export()).catch(() => {})
    } catch {
      /* best effort */
    }
  }

  private pending() {
    this.current.raw.run('CREATE TABLE IF NOT EXISTS desktop_outbox (id INTEGER PRIMARY KEY, data TEXT NOT NULL)')
    return this.current.prepare('SELECT id, data FROM desktop_outbox ORDER BY id').all() as { id: number; data: string }[]
  }

  /** The sync panel's numbers (Y9). */
  health(): { syncedAt: string | null; waiting: number; desktopPending: number; error: string | null; failed: { at: string; error: string }[] } {
    return {
      syncedAt: this.syncedAt,
      waiting: this.pendingOffline,
      desktopPending: this.desktop && this.db ? this.pending().length : 0,
      error: this.lastError,
      failed: this.failedSync.map((f) => ({ at: f.at, error: f.error }))
    }
  }

  private desktopStatus(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('life-desktop-sync', { detail: {
      pending: this.db ? this.pending().length : 0, error: this.lastError, syncedAt: this.syncedAt
    } }))
  }

  private async flushDesktop(): Promise<void> {
    let merged = false
    try {
      const rows = this.pending()
      const info = rows.length ? schemaInfo(this.current.raw) : undefined
      for (const { id } of rows) {
        // Read it again: an earlier merge may have marked it.
        const row = this.pending().find((x) => x.id === id)
        if (!row) continue
        const write = decodePending(row.data)
        const r = await sendPending(this.turso, write, info)
        // Persist acknowledgement before another operation can start. After a
        // merge, the later changes saw the old copy: they get merged too, with
        // any ids the server renumbered.
        this.current.raw.run('BEGIN')
        this.current.raw.run('DELETE FROM desktop_outbox WHERE id = ?', [row.id])
        if (!r.merged && this.tv) {
          for (const t of touchedTables(write.changes)) this.tv[t] = write.version
          this.saveTv()
        }
        if (r.merged || write.rebase) {
          merged = true
          const remap: Remap = { ...(write.remap ?? {}) }
          for (const [t, ids] of Object.entries(r.remap)) remap[t] = { ...(remap[t] ?? {}), ...ids }
          for (const next of this.pending()) {
            this.current.raw.run('UPDATE desktop_outbox SET data = ? WHERE id = ?', [encodePending({ ...decodePending(next.data), rebase: true, remap }), next.id])
          }
        }
        this.current.raw.run('COMMIT')
        await this.store!.save(this.current.raw.export())
      }
      // The server's copy now holds both sides: take it.
      if (merged) {
        await this.rebuild()
        this.pending()
        await this.store!.save(this.current.raw.export())
        this.emit()
      }
      this.lastError = null
      this.syncedAt = new Date().toISOString()
    } catch (error) {
      this.lastError = (error as Error).message
      throw error
    } finally { this.desktopStatus() }
  }

  private writeDesktop<T>(fn: (db: BrowserDb) => T): Promise<T> {
    return this.lock(async () => {
      if (!this.store) throw new MirrorError('Local storage is unavailable')
      // Online edits start from the newest copy, reducing avoidable conflicts.
      if (!this.pending().length) {
        try {
          await this.catchUp()
        } catch { /* cached data is still usable offline */ }
      }
      const before = this.current.raw.export()
      const base = this.version ?? ''
      this.current.dropChanges()
      let result: T
      try {
        result = this.current.transaction(() => fn(this.current))()
        const changes = this.current.takeChanges()
        if (!changes.length) return result
        // Which rows changed (before → after), so the change can be merged later.
        const old = new this.SQL.Database(before)
        let rows
        try {
          rows = diffRows(old, this.current.raw, touchedTables(changes), schemaInfo(this.current.raw))
        } finally {
          old.close()
        }
        if (!rows.length && !changes.some((c) => /^\s*(CREATE|ALTER)\s/i.test(c.sql))) return result
        const version = crypto.randomUUID()
        this.pending()
        this.current.raw.run('INSERT INTO desktop_outbox (data) VALUES (?)', [encodePending({ id: version, base, version, changes, rows })])
        this.current.raw.run("INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [version])
        await this.store.save(this.current.raw.export())
        this.version = version
      } catch (error) {
        this.current.raw.close()
        this.db = new BrowserDb(new this.SQL.Database(before))
        throw error
      }
      this.emit()
      this.desktopStatus()
      // A successful local save is usable offline. Remote failures retain the outbox.
      await this.flushDesktop().catch(() => {})
      return result!
    })
  }

  /** Reference schema: what the desktop app's migrations produce. */
  private referenceDb(): SqlJsDatabase {
    const ref = new this.SQL.Database()
    for (const m of MIGRATIONS) ref.exec(m)
    return ref
  }

  private async rebuild(): Promise<void> {
    // The versions first: the data read after them is at least this new.
    // The versions and the schema in one round trip (S2).
    const [preDv, preTv, schema] = await this.turso.readMany([
      ...READ_VERSIONS,
      { sql: "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid", args: [] }
    ])
    if (schema instanceof Error) throw schema
    const objects = schema.rows
      .map(([type, name, tbl, sql]) => ({ type: String(type), name: String(name), tbl: String(tbl), sql: String(sql) }))
      .filter((o) => !SKIP.test(o.name) && !SKIP.test(o.tbl))

    const raw = new this.SQL.Database()
    const local = new BrowserDb(raw)
    for (const o of objects.filter((x) => x.type === 'table')) raw.exec(o.sql)

    // Bring Turso up to the schema this app expects: missing tables and
    // columns are added (never removed), on Turso and here.
    const ddl: Change[] = []
    const ref = this.referenceDb()
    const refTables = ref.exec("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")[0]?.values ?? []
    const have = new Set(objects.filter((x) => x.type === 'table').map((x) => x.name))
    for (const [name, sql] of refTables as [string, string][]) {
      if (!have.has(name)) {
        const create = sql.replace(/^CREATE TABLE\s+(IF NOT EXISTS\s+)?/i, 'CREATE TABLE IF NOT EXISTS ')
        raw.exec(create)
        ddl.push({ sql: create, args: [] })
        const idx = ref.exec(`SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${name}' AND sql IS NOT NULL`)[0]?.values ?? []
        for (const [isql] of idx as [string][]) {
          const c = isql.replace(/^CREATE (UNIQUE )?INDEX\s+(IF NOT EXISTS\s+)?/i, (_m, u) => `CREATE ${u ?? ''}INDEX IF NOT EXISTS `)
          raw.exec(c)
          ddl.push({ sql: c, args: [] })
        }
        continue
      }
      const localCols = new Set((raw.exec(`PRAGMA table_info("${name}")`)[0]?.values ?? []).map((r) => String(r[1]).toLowerCase()))
      for (const col of ref.exec(`PRAGMA table_info("${name}")`)[0]?.values ?? []) {
        const [, cname, ctype, notnull, dflt] = col as [number, string, string, number, string | null]
        if (localCols.has(cname.toLowerCase())) continue
        const def = `ALTER TABLE ${name} ADD COLUMN ${cname} ${ctype}${notnull && dflt != null ? ' NOT NULL' : ''}${dflt != null ? ` DEFAULT ${dflt}` : ''}`
        raw.exec(def)
        ddl.push({ sql: def, args: [] })
      }
    }
    ref.close()
    if (ddl.length) await this.turso.writeAtomic(ddl)

    // The data, in pages (a request stays far below the server's 4.5 MB limit
    // however big the history grows), and all or nothing: if any part can't be
    // read, this copy is thrown away and the old one stays (never a half-empty copy).
    const tables = (raw.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")[0]?.values ?? []).map((r) => String(r[0]))
    const PAGE = 1500
    const page = (t: string, offset: number) => ({ sql: `SELECT * FROM "${t}" ORDER BY rowid LIMIT ${PAGE} OFFSET ${offset}`, args: [] })
    const loaded = new Map<string, { cols: string[]; rows: unknown[][] }>()
    // Groups of 8 tables, fetched side by side (S2): the same request sizes as
    // before, without waiting for one group before asking for the next.
    const groups: string[][] = []
    for (let i = 0; i < tables.length; i += 8) groups.push(tables.slice(i, i + 8))
    await Promise.all(groups.map(async (group) => {
      const first = await this.turso.readMany(group.map((t) => page(t, 0)))
      for (let k = 0; k < group.length; k++) {
        const t = group[k]
        let res = first[k]
        if (res instanceof Error) throw new MirrorError(`Could not read ${t}: ${res.message}`)
        const all = { cols: res.cols, rows: [...res.rows] }
        while (res.rows.length === PAGE) {
          const [next] = await this.turso.readMany([page(t, all.rows.length)])
          if (next instanceof Error) throw new MirrorError(`Could not read ${t}: ${next.message}`)
          res = next
          all.rows.push(...res.rows)
        }
        loaded.set(t, all)
      }
    }))
    raw.run('BEGIN')
    for (const t of tables) {
      const res = loaded.get(t)
      if (!res || !res.rows.length) continue
      const stmt = raw.prepare(`INSERT INTO "${t}" (${res.cols.map((c) => `"${c}"`).join(', ')}) VALUES (${res.cols.map(() => '?').join(', ')})`)
      for (const row of res.rows) stmt.run(row as Param[] as any)
      stmt.free()
    }
    raw.run('COMMIT')
    for (const o of objects.filter((x) => x.type !== 'table')) {
      try {
        raw.exec(o.sql)
      } catch {
        /* an index or trigger the local SQLite doesn't support: not needed here */
      }
    }

    const old = this.db
    this.db = local
    this.syncedAt = new Date().toISOString()
    this.rebuiltAt = Date.now()
    try {
      const row = this.db?.raw.exec("SELECT value FROM settings WHERE key = 'data_version'")[0]?.values[0]?.[0]
      this.version = row == null ? null : String(row)
    } catch {
      this.version = null
    }
    // Remember the version read before the data (never newer than the data),
    // so a change that landed during the download is picked up next time.
    const before = preDv instanceof Error ? undefined : preDv.rows[0]?.[0]
    if (before != null && this.version != null && String(before) !== this.version) {
      this.version = String(before)
      local.raw.run("UPDATE settings SET value = ? WHERE key = 'data_version'", [this.version])
    }
    const remoteTv = preTv instanceof Error ? null : parseVersions(preTv.rows)
    this.tv = remoteTv
    old?.raw.close()

    // Defaults the services expect (point rules, exercises), like the desktop seeds them.
    await this.seedDefaults()
    if (!this.version) {
      // First copy of a database without the marker yet: set it.
      const version = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const mark = { sql: "INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [version] }
      try {
        await this.turso.writeAtomic([mark])
        local.raw.run(mark.sql, mark.args)
        this.version = version
      } catch {
        /* next refresh downloads again */
      }
    }
    // The chain of tracked changes is broken (first time, an older app, a
    // restore): join it again so the next refreshes download only changes.
    if (this.version && (!this.tv || this.tv['*'] !== this.version)) {
      const tables = this.localTables()
      const marker = `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      try {
        await this.turso.writeAtomic(repairStatements(tables, this.version, marker))
        this.tv = { ...Object.fromEntries(tables.map((t) => [t, marker])), '*': this.version }
      } catch {
        this.tv = null
      }
    }
    this.saveTv()
    this.persist()
  }

  private async seedDefaults(): Promise<void> {
    const db = this.current
    const haveRules = new Set(db.prepare('SELECT id FROM rules').all().map((r) => String(r.id)))
    const haveEx = new Set(db.prepare('SELECT id FROM exercises').all().map((r) => String(r.id)))
    const rules = DEFAULT_RULES.map((r, i) => ({ ...r, enabled: r.enabled ? 1 : 0, sort: i })).filter((r) => !haveRules.has(r.id))
    const exercises = DEFAULT_EXERCISES.filter((e) => !haveEx.has(e.id))
    if (!rules.length && !exercises.length) return
    db.dropChanges()
    db.transaction(() => {
      const rule = db.prepare(
        `INSERT OR IGNORE INTO rules (id, module, title, coins, xp, daily_cap, cooldown_min, enabled, sort)
         VALUES (@id, @module, @title, @coins, @xp, @dailyCap, @cooldownMin, @enabled, @sort)`
      )
      rules.forEach((r) => rule.run(r))
      const ex = db.prepare(
        `INSERT OR IGNORE INTO exercises (id, name, unit, target, category, sort, archived)
         VALUES (@id, @name, @unit, @target, @category, @sort, 0)`
      )
      exercises.forEach((e) => ex.run(e))
    })()
    await this.turso.writeAtomic(db.takeChanges()).catch(() => {})
  }
}

/** The checks that go first in a write: each overwritten setting must still hold what we read. */
export function casStatements(expected: Map<string, string | null>): Change[] {
  if (!expected.size) return []
  return [
    { sql: 'CREATE TABLE IF NOT EXISTS sys_cas (ok INTEGER NOT NULL CHECK (ok = 1))', args: [] },
    ...[...expected].map(([key, value]) => ({ sql: 'INSERT INTO sys_cas (ok) VALUES ((SELECT value FROM settings WHERE key = ?) IS ?)', args: [key, value] as Param[] }))
  ]
}
const isCasConflict = (e: unknown) => /sys_cas|CHECK constraint failed: ok = 1|ok = 1/i.test(String((e as Error)?.message ?? e))

/** The same check for records edited or deleted by id (their columns, quoted by SQLite). */
export function rowCasStatements(rows: { table: string; id: unknown; cols: string[]; value: string | null }[], haveTable: boolean): Change[] {
  if (!rows.length) return []
  return [
    ...(haveTable ? [] : [{ sql: 'CREATE TABLE IF NOT EXISTS sys_cas (ok INTEGER NOT NULL CHECK (ok = 1))', args: [] as Param[] }]),
    ...rows.map((r) => ({ sql: `INSERT INTO sys_cas (ok) VALUES ((SELECT ${r.cols.map((c) => `quote("${c}")`).join(" || '|' || ")} FROM "${r.table}" WHERE id = ?) IS ?)`, args: [r.id, r.value] as Param[] }))
  ]
}

/**
 * Each write carries its own id (Y5): sent twice (a timeout, then a retry),
 * the second copy fails on that id instead of saving everything again.
 */
const writeOnce = (id: string): Change[] => [
  { sql: 'CREATE TABLE IF NOT EXISTS sys_writes (id TEXT PRIMARY KEY, at INTEGER NOT NULL)', args: [] },
  { sql: 'INSERT INTO sys_writes (id, at) VALUES (?, ?)', args: [id, Date.now()] },
  // Ids older than a week can't come back; keep the table tiny.
  { sql: 'DELETE FROM sys_writes WHERE at < ?', args: [Date.now() - 7 * 86400_000] }
]
const isAlreadySaved = (e: unknown) => /UNIQUE constraint failed: sys_writes\.id/i.test(String((e as Error)?.message ?? e))
const isUniqueClash = (e: unknown) => /UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e)) && !isAlreadySaved(e)

/** A failure worth retrying: locked (PIN), a 5xx, a timeout, too many requests (Y1). */
const isRetryable = (e: unknown) => e instanceof UnauthorizedError || /Turso HTTP (5\d\d|408|429)|timed? ?out|abort/i.test(String((e as Error)?.message ?? '')) || (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError'

/** A failure because there's no connection (not a refusal by the database). */
const isOffline = (e: unknown) =>
  typeof window !== 'undefined' && (navigator.onLine === false || e instanceof TypeError || /failed to fetch|network|load failed/i.test(String((e as Error)?.message ?? '')))
