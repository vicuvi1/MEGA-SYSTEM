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
import { retryDelay } from '@core/retry'
import { APPEND_ONLY } from '@core/backupPlan'

// cloud_snapshots (+ their parts): 30 full backups, read straight from Turso when needed, never copied to every device.
// restore_stage_*: a restore's staging tables (core/backupPlan.ts), gone when the restore ends.
const SKIP = /^(sqlite_|libsql_|_litestream|_cf_|desktop_|sys_|restore_stage_|cloud_snapshots$|cloud_snapshot_parts$)/

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
  /** Rows read from Turso by full downloads and table reloads (CL6: counted honestly, not only cold starts). */
  private rowsRead = 0
  /** This copy has made sure sys_writes (and its index) exist in Turso (CL6). */
  private writesReady = false
  /** CL7: offline changes wait this long after a failed send (5 s, 10 s … 10 min). */
  private flushFails = 0
  private nextFlushAt = 0
  /** CL7: the session ended (401): the waiting changes stay here until you enter your PIN. */
  private locked = false

  constructor(private SQL: SqlJsStatic, private turso: TursoHttp, private store: MirrorStore | null = null, private desktop = false) {
    this.ready = this.start()
    if (typeof window !== 'undefined' && !this.desktop)
      window.addEventListener('online', () => {
        this.nextFlushAt = 0
        void this.refresh().catch(() => {})
      })
    // CS4: the copy is saved a moment after changes (not after every one); leaving the page saves it now.
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && this.store) {
      const now = () => this.flushPersist()
      window.addEventListener('pagehide', now)
      window.addEventListener('beforeunload', now)
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && now())
    }
    if (desktop && typeof window !== 'undefined') {
      window.addEventListener('life-desktop-retry', () => { void this.refresh().catch(() => {}) })
      window.addEventListener('life-desktop-use-server', () => {
        void this.useServerCopy().catch(() => {})
      })
    }
  }

  /**
   * Desktop: replace this PC's copy with the server's (the "Back up and use
   * server copy" button; the UI has already saved a backup). Changes not sent
   * yet are dropped here; the apps' sync (appSync.ts) sends their data again.
   */
  useServerCopy(): Promise<void> {
    return this.ready.then(() => this.lock(async () => {
      // Rebuild downloads fully before replacing the current local database.
      await this.rebuild()
      await this.store!.save(this.current.raw.export())
      this.lastError = null
      this.emit()
      this.desktopStatus()
    })).catch((error) => { this.lastError = error.message; this.desktopStatus(); throw error })
  }

  /**
   * What the SERVER holds for one setting (not this device's copy): changes
   * still waiting here are sent first (a failure throws, so nothing counts as
   * synced while it waits). `expected`: the text the caller believes is there;
   * a cheap check (size + start) answers without downloading it again when it
   * matches. Null: the server has no such setting.
   */
  async serverSetting(key: string, expected?: string | null): Promise<string | null> {
    await this.ready
    await this.lock(async () => {
      if (this.desktop) {
        if (this.db) await this.flushDesktop()
        if (this.db && this.pending().length) throw new MirrorError(`${this.pending().length} change(s) on this PC are not sent yet`)
      } else {
        await this.flushOffline(true)
        if (this.outbox().length) throw new MirrorError(this.waitingNote(this.outbox().length))
      }
    })
    const HEAD = 48 // {"savedAt":<ms>,"editedAt":<ms>…: plain ASCII, and savedAt changes with every write
    if (expected != null) {
      const [probe] = await this.turso.readMany([{ sql: 'SELECT length(CAST(value AS BLOB)), substr(value, 1, ?) FROM settings WHERE key = ?', args: [HEAD, key] }])
      if (probe instanceof Error) throw probe
      const row = probe.rows[0]
      if (!row) return null
      if (Number(row[0]) === new TextEncoder().encode(expected).length && String(row[1] ?? '') === expected.slice(0, HEAD)) return expected
    }
    const [r] = await this.turso.readMany([{ sql: 'SELECT value FROM settings WHERE key = ?', args: [key] }])
    if (r instanceof Error) throw r
    const v = r.rows[0]?.[0]
    return v == null ? null : String(v)
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
     // BG2: changes still waiting from a hiccup go first. If they still can't
     // go, this one waits behind them (sent alone, it could clash with them
     // and wipe them from this copy).
     let behind = false
     if (this.outbox().length) {
       await this.flushOffline()
       behind = this.outbox().length > 0
     }
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
      // Queued changes always carry the table they need (they may be sent to a fresh database).
      const queued = () => [...writeOnce(version, { create: true }), ...checks, ...changes, ...trackStatements(touched, version), mark, ...(checks.length ? [{ sql: 'DELETE FROM sys_cas', args: [] }] : [])]
      if (behind) {
        this.queueOffline(queued())
        this.persist()
        this.emit()
        return result
      }
      // CL6: the table is made once per copy, old ids are cleared once a day (not on every change).
      const once = writeOnce(version, { create: !this.writesReady, prune: this.pruneDue() })
      try {
        const before = versionsBefore(touched)
        const batch = [...once, ...before, ...checks, ...changes, ...trackStatements(touched, version), mark, ...(checks.length ? [{ sql: 'DELETE FROM sys_cas', args: [] }] : [])]
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
        this.writesReady = true
        if (once.some((c) => c.sql.startsWith('DELETE FROM sys_writes'))) this.pruned()
        const shift = once.length // writeOnce's statements come first
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
          // CL7: the next try waits a little (longer each time); a 401 waits for your PIN.
          if (e instanceof UnauthorizedError) this.locked = true
          this.nextFlushAt = Date.now() + retryDelay(this.flushFails++, { base: Mirror.RETRY_BASE })
          // With its checks (Y3): sent later, it must still find the rows as they were read
          // here; if another device changed them meanwhile, it goes to "couldn't sync" (Y1)
          // instead of overwriting their newer edit.
          this.queueOffline(queued())
          this.persist()
          this.emit()
          return result
        }
        // The id table went missing (a restore, a new database): make it again and send once more.
        const noIds = /no such table: sys_writes/i.test(String((e as Error)?.message ?? ''))
        if (noIds) this.writesReady = false
        this.lastError = (e as Error).message
        // Put the copy back the way Turso has it.
        await this.rebuild().catch(() => {})
        this.emit()
        // Changed elsewhere, or the same new id taken on another device: fresh copy, run again (Y5).
        if ((isCasConflict(e) || isUniqueClash(e) || noIds) && attempt < 3) continue
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
      // Changes made offline go first, so the fresh copy has them. The refresh
      // loop already waits longer after failures (CL7), so it always tries.
      if (!this.desktop) await this.flushOffline(true)
      // BG8: while changes still wait, a fresh copy from Turso would hide them
      // on screen (and you'd type them again). Wait until they're sent.
      if (!this.desktop && this.outbox().length) return false
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

  /** CL6: old write ids are cleared at most once a day from this device. */
  private prunedAt = 0
  private pruneDue(): boolean {
    let at = this.prunedAt
    try {
      if (typeof localStorage !== 'undefined') at = Math.max(at, Number(localStorage.getItem('life_writes_pruned')) || 0)
    } catch {
      /* memory only */
    }
    return Date.now() - at > 86400_000
  }
  private pruned(): void {
    this.prunedAt = Date.now()
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('life_writes_pruned', String(this.prunedAt))
    } catch {
      /* memory only */
    }
  }

  // ---- Offline queue (web): changes made without a connection --------------
  private static OUTBOX = 'life_offline_writes'
  // The waiting changes live in memory too (S3): if the browser can't store
  // them (storage full, private window) they still go out from this tab, and
  // you're told plainly instead of losing them on the next reload.
  private offline: Change[][] | null = null
  private outboxUnsaved = false
  /**
   * The stored queue could not be read and no backup of it could be kept:
   * it is never overwritten (the waiting changes stay in this tab's memory).
   */
  private outboxLocked = false
  private outbox(): Change[][] {
    if (this.offline) return this.offline
    let raw: string | null = null
    try {
      raw = typeof localStorage !== 'undefined' ? localStorage.getItem(Mirror.OUTBOX) : null
    } catch {
      raw = null
    }
    if (raw == null) return (this.offline = [])
    let v: unknown
    try {
      v = JSON.parse(raw)
    } catch {
      v = undefined
    }
    if (Array.isArray(v)) return (this.offline = v as Change[][])
    // Unreadable (cut short, damaged): keep the raw text under its own key
    // before anything else is saved there, so it is never lost (repair by hand).
    try {
      localStorage.setItem(`${Mirror.OUTBOX}_unreadable_${Date.now()}`, raw)
      console.warn('[sync] the offline queue could not be read; its text is kept under', `${Mirror.OUTBOX}_unreadable_*`)
    } catch {
      this.outboxLocked = true
      console.warn('[sync] the offline queue could not be read or backed up; it is left as it is')
    }
    return (this.offline = [])
  }
  private static SINCE = 'life_offline_since'
  private sinceMem: number | null = null
  /** When the oldest waiting change was made (ms), or null (CL7). */
  get offlineSince(): number | null {
    if (!this.outbox().length) return null
    try {
      const v = typeof localStorage !== 'undefined' ? Number(localStorage.getItem(Mirror.SINCE)) : 0
      return v > 0 ? v : (this.sinceMem ??= Date.now())
    } catch {
      return (this.sinceMem ??= Date.now())
    }
  }
  private saveOutbox(list: Change[][]): void {
    this.offline = list
    if (!list.length) this.sinceMem = null
    else this.sinceMem ??= Date.now()
    if (this.outboxLocked) {
      // Never write over a queue we could not read nor back up.
      this.outboxUnsaved = list.length > 0
      return
    }
    try {
      if (typeof localStorage === 'undefined') return
      if (list.length) {
        localStorage.setItem(Mirror.OUTBOX, JSON.stringify(list))
        if (!localStorage.getItem(Mirror.SINCE)) localStorage.setItem(Mirror.SINCE, String(this.sinceMem))
      } else {
        localStorage.removeItem(Mirror.OUTBOX)
        localStorage.removeItem(Mirror.SINCE)
      }
      this.outboxUnsaved = false
    } catch {
      this.outboxUnsaved = list.length > 0
    }
  }
  private queueOffline(batch: Change[]): void {
    // Never trimmed: an old change is never dropped to make room (S3).
    const list = [...this.outbox(), batch]
    this.saveOutbox(list)
    this.lastError = this.waitingNote(list.length)
  }
  /** What the sync status says about changes still waiting (CL7). */
  private waitingNote(n: number): string {
    const s = n === 1 ? '' : 's'
    if (this.outboxUnsaved) return `⚠ ${n} change${s} not synced yet and this browser can't store them: keep this tab open until you're back online`
    if (this.locked) return `🔒 Your session ended: enter your PIN to send ${n} waiting change${s} (they are kept on this device).`
    const since = this.offlineSince
    if (since && Date.now() - since > 3600_000) return `⚠ ${n} change${s} waited over an hour to sync. They are kept on this device; check your connection.`
    return `Offline: ${n} change${s} waiting to sync`
  }
  /** You entered your PIN again (or came back online): send what waited now (CL7). */
  resume(): void {
    this.locked = false
    this.nextFlushAt = 0
    this.flushFails = 0
    void this.refresh().catch(() => {})
  }
  /** Changes made offline and not yet in Turso. */
  get pendingOffline(): number {
    return this.outbox().length
  }
  /**
   * Sends the offline changes, oldest first; stops at the first that fails.
   * After a failure it waits longer each time (CL7: 5 s … 10 min) instead of
   * trying again on every change and every refresh.
   */
  private async flushOffline(force = false): Promise<void> {
    const list = this.outbox()
    if (!list.length) return
    if (this.locked || (!force && Date.now() < this.nextFlushAt)) {
      this.lastError = this.waitingNote(list.length)
      return
    }
    let sent = 0
    let failed = false
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
        if (e instanceof UnauthorizedError) {
          // CL7: never dropped, never retried blindly: the lock screen asks for the PIN, then resume() sends them.
          this.locked = true
          failed = true
          if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new CustomEvent('life-session-ended', { detail: { waiting: list.length - sent } }))
          break
        }
        if (isOffline(e) || isRetryable(e)) {
          failed = true
          break
        }
        // Refused by the database for good (e.g. a row deleted elsewhere): kept
        // in "couldn't sync" (Settings shows it) instead of vanishing.
        this.saveFailed([...this.failedSync, { at: new Date().toISOString(), error: String((e as Error)?.message ?? e).slice(0, 200), batch }])
        sent++
      }
    }
    this.saveOutbox(list.slice(sent))
    if (failed) this.nextFlushAt = Date.now() + retryDelay(this.flushFails++, { base: Mirror.RETRY_BASE })
    else {
      this.flushFails = 0
      this.nextFlushAt = 0
    }
    const left = list.length - sent
    if (left) this.lastError = this.waitingNote(left)
    else if (sent) this.lastError = null
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

  /**
   * Replaces just these tables with Turso's rows, in one local transaction.
   * CL1: read in pages (an answer stays far below the server's 4.5 MB however
   * long the history grows), and the append-only history (ledger, discipline
   * events) only fetches rows newer than this copy's newest.
   */
  private async reloadTables(tables: string[], version: string, remote: TableVersions): Promise<void> {
    const raw = this.current.raw
    // Append-only: only when this copy's rows are still exactly Turso's first rows (same count up to our newest id).
    const tail = new Map<string, number>()
    const appendOnly = tables.filter((t) => APPEND_ONLY.has(t))
    if (appendOnly.length) {
      const local = appendOnly.map((t) => {
        const [n, max] = (raw.exec(`SELECT COUNT(*), COALESCE(MAX(id), 0) FROM "${t}"`)[0]?.values[0] ?? [0, 0]) as number[]
        return { t, n: Number(n), max: Number(max) }
      })
      const counts = await this.turso.readMany(local.map((l) => ({ sql: `SELECT COUNT(*) FROM "${l.t}" WHERE id <= ?`, args: [l.max] })))
      local.forEach((l, i) => {
        const r = counts[i]
        if (l.max > 0 && !(r instanceof Error) && Number(r.rows[0]?.[0]) === l.n) tail.set(l.t, l.max)
      })
    }
    const data = await this.readTables(tables, (t) => (tail.has(t) ? { where: 'id > ?', args: [tail.get(t)!] } : null))
    raw.run('BEGIN')
    try {
      for (const t of tables) {
        const res = data.get(t)!
        if (!tail.has(t)) raw.run(`DELETE FROM "${t}"`)
        if (!res.rows.length) continue
        const stmt = raw.prepare(`INSERT INTO "${t}" (${res.cols.map((c) => `"${c}"`).join(', ')}) VALUES (${res.cols.map(() => '?').join(', ')})`)
        try {
          for (const row of res.rows) stmt.run(row as Param[] as any)
        } finally {
          stmt.free()
        }
      }
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

  /** Rows read by downloads and reloads since the last call (CL6), for the monthly count. */
  takeReadRows(): number {
    const n = this.rowsRead
    this.rowsRead = 0
    return n
  }

  /** Rows per request: 1500 ledger rows are about 0.6 MB, far below the 4.5 MB a server answer may be. */
  static PAGE = 1500
  /**
   * Whole tables (or the part `filter` picks), in pages: groups of 8 tables
   * side by side (S2), then the next page of each table that had more. Throws
   * if any page can't be read (all or nothing).
   */
  private async readTables(tables: string[], filter: (t: string) => { where: string; args: Param[] } | null = () => null): Promise<Map<string, { cols: string[]; rows: unknown[][] }>> {
    const PAGE = Mirror.PAGE
    const page = (t: string, offset: number) => {
      const f = filter(t)
      return { sql: `SELECT * FROM "${t}"${f ? ` WHERE ${f.where}` : ''} ORDER BY rowid LIMIT ${PAGE} OFFSET ${offset}`, args: f ? f.args : [] }
    }
    const loaded = new Map<string, { cols: string[]; rows: unknown[][] }>()
    const groups: string[][] = []
    for (let i = 0; i < tables.length; i += 8) groups.push(tables.slice(i, i + 8))
    // A long table (two years of points) also says how many rows it has, so
    // its other pages are asked for side by side, one page per request as
    // before, a few at a time, instead of one after the other.
    const count = (t: string) => {
      const f = filter(t)
      return { sql: `SELECT COUNT(*) FROM "${t}"${f ? ` WHERE ${f.where}` : ''}`, args: f ? f.args : [] }
    }
    await Promise.all(groups.map(async (group) => {
      const first = await this.turso.readMany([...group.map((t) => page(t, 0)), ...group.map(count)])
      for (let k = 0; k < group.length; k++) {
        const t = group[k]
        let res = first[k]
        if (res instanceof Error) throw new MirrorError(`Could not read ${t}: ${res.message}`)
        const all = { cols: res.cols, rows: [...res.rows] }
        const n = first[group.length + k]
        const total = n instanceof Error ? 0 : Number(n.rows[0]?.[0] ?? 0)
        if (res.rows.length === PAGE && total > PAGE) {
          const offsets: number[] = []
          for (let o = PAGE; o < total; o += PAGE) offsets.push(o)
          const pages: (typeof res)[] = new Array(offsets.length)
          let next = 0
          await Promise.all(Array.from({ length: Math.min(6, offsets.length) }, async () => {
            while (next < offsets.length) {
              const i = next++
              const [r] = await this.turso.readMany([page(t, offsets[i])])
              if (r instanceof Error) throw new MirrorError(`Could not read ${t}: ${r.message}`)
              pages[i] = r
            }
          }))
          for (const r of pages) all.rows.push(...r.rows)
          res = pages[pages.length - 1]
        }
        // Rows added meanwhile (or no count): the rest, page by page.
        while (res.rows.length === PAGE) {
          const [next] = await this.turso.readMany([page(t, all.rows.length)])
          if (next instanceof Error) throw new MirrorError(`Could not read ${t}: ${next.message}`)
          res = next
          all.rows.push(...res.rows)
        }
        this.rowsRead += all.rows.length
        loaded.set(t, all)
      }
    }))
    return loaded
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

  /**
   * CS4: saving the copy (an export of the whole database) is slow with a long
   * history, so it runs once things are quiet: 2 s after the last change, when
   * the browser is idle. Leaving or hiding the page saves at once.
   */
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private persistWaiting = false
  static PERSIST_MS = 2000
  /** First wait after a failed send of offline changes (CL7; tests set 0). */
  static RETRY_BASE = 5000
  private persist(): void {
    if (!this.store || !this.db) return
    this.persistWaiting = true
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      const run = () => {
        this.persistTimer = null
        this.flushPersist()
      }
      const idle = (globalThis as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => number) | undefined
      if (typeof idle === 'function') idle(run, { timeout: 2000 })
      else run()
    }, Mirror.PERSIST_MS)
  }
  /** Saves the copy now, if a save is waiting. */
  flushPersist(): void {
    if (!this.persistWaiting || !this.store || !this.db) return
    this.persistWaiting = false
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
  health(): { syncedAt: string | null; waiting: number; waitingSince: string | null; locked: boolean; desktopPending: number; error: string | null; failed: { at: string; error: string }[] } {
    const since = this.offlineSince
    return {
      syncedAt: this.syncedAt,
      waiting: this.pendingOffline,
      waitingSince: since ? new Date(since).toISOString() : null,
      locked: this.locked,
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
      // Live sync keeps it fresh, so a copy checked in the last 15 s is used as
      // it is (a tap on the island doesn't wait for the internet twice).
      const fresh = this.syncedAt && Date.now() - Date.parse(this.syncedAt) < 15_000
      if (!this.pending().length && !fresh) {
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
      // It goes up right after this (next in line), so the caller isn't kept waiting.
      void this.lock(() => this.flushDesktop()).catch(() => {})
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
    const loaded = await this.readTables(tables)
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
export const WRITES_TABLE: Change[] = [
  { sql: 'CREATE TABLE IF NOT EXISTS sys_writes (id TEXT PRIMARY KEY, at INTEGER NOT NULL)', args: [] },
  // CL6: clearing old ids looks them up by time; without this every change scanned the whole table.
  { sql: 'CREATE INDEX IF NOT EXISTS sys_writes_at ON sys_writes (at)', args: [] }
]
export const writeOnce = (id: string, o: { create?: boolean; prune?: boolean } = { create: true, prune: true }): Change[] => [
  ...(o.create ? WRITES_TABLE : []),
  { sql: 'INSERT INTO sys_writes (id, at) VALUES (?, ?)', args: [id, Date.now()] },
  // Ids older than a week can't come back; keep the table tiny (once a day, not on every change).
  ...(o.prune ? [{ sql: 'DELETE FROM sys_writes WHERE at < ?', args: [Date.now() - 7 * 86400_000] as Param[] }] : [])
]
const isAlreadySaved = (e: unknown) => /UNIQUE constraint failed: sys_writes\.id/i.test(String((e as Error)?.message ?? e))
const isUniqueClash = (e: unknown) => /UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e)) && !isAlreadySaved(e)

/** A failure worth retrying: locked (PIN), a 5xx, a timeout, too many requests (Y1). */
const isRetryable = (e: unknown) => e instanceof UnauthorizedError || /Turso HTTP (5\d\d|408|429)|timed? ?out|abort/i.test(String((e as Error)?.message ?? '')) || (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError'

/** A failure because there's no connection (not a refusal by the database). */
const isOffline = (e: unknown) =>
  typeof window !== 'undefined' && (navigator.onLine === false || e instanceof TypeError || /failed to fetch|network|load failed/i.test(String((e as Error)?.message ?? '')))
