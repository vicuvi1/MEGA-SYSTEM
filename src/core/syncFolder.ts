// Sync folder (desktop, 2026-11-18): a live, complete copy of all data in a
// folder you choose (OneDrive, Google Drive, Dropbox, a USB drive…), written
// after every change so the data stays whole even when the server is down.
// This file is the pure part: names, which versions are kept, the manifest,
// and the pacing of writes. No Node, no Electron (the files are written by
// src/desktop/syncFolderStore.ts; Electron is wired in src/desktop/syncFolder.ts).
import { APP_BLOBS } from './backupPlan'
import { blobDigest } from './backupCheck'

/** The folder made inside the folder you choose. */
export const SYNC_ROOT = 'Life System Sync'
export const KEEP_HOURLY = 24
export const KEEP_DAILY = 14
export const KEEP_MONTHLY = 12
export const KEEP_TEXT = `${KEEP_HOURLY} hourly, ${KEEP_DAILY} daily and ${KEEP_MONTHLY} monthly versions kept`
/** A change is copied this long after the last one… */
export const DEBOUNCE_MS = 15_000
/** …and never later than this after the first one, however busy the app is. */
export const MAX_WAIT_MS = 60_000

const NAME = /^life-sync-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.zip(\.enc)?$/
const two = (n: number) => String(n).padStart(2, '0')

/** A copy's file name: its UTC time, so two PCs in the same folder never disagree. */
export function copyName(at: Date, encrypted = false): string {
  return `life-sync-${at.getUTCFullYear()}${two(at.getUTCMonth() + 1)}${two(at.getUTCDate())}T${two(at.getUTCHours())}${two(at.getUTCMinutes())}${two(at.getUTCSeconds())}Z.zip${encrypted ? '.enc' : ''}`
}

export function parseCopyName(name: string): { at: number; encrypted: boolean; stamp: string } | null {
  const m = NAME.exec(name)
  if (!m) return null
  const at = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return Number.isFinite(at) ? { at, encrypted: !!m[7], stamp: `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}` } : null
}

/**
 * The name a copy has while it is being written. Cloud-drive apps skip it
 * (Dropbox skips names starting with ".~", OneDrive and Google Drive skip
 * ".tmp"), so a half-written file is never uploaded; the finished file takes
 * its real name in one step (rename).
 */
export const tempName = (name: string) => `.~${name}.tmp`
export const isTempName = (name: string) => /^\.~life-sync-.*\.tmp$/.test(name)

/** This PC's own folder inside the sync folder: its name plus a short id. */
export function deviceFolder(name: string, id: string): string {
  const clean = (name || 'PC').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'PC'
  return `${clean}-${id.replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase() || '000000'}`
}
export const isDeviceFolder = (name: string) => /^[A-Za-z0-9_-]{1,24}-[a-z0-9]{6}$/.test(name)

/** A version's id: "<device folder>/<file name>". Anything else is refused (no paths from outside). */
export function parseVersionId(id: string): { device: string; name: string; at: number; encrypted: boolean } | null {
  const [device, name, ...rest] = String(id).split('/')
  if (rest.length || !device || !name || !isDeviceFolder(device)) return null
  const p = parseCopyName(name)
  return p ? { device, name, at: p.at, encrypted: p.encrypted } : null
}

/**
 * Which copies to delete. Kept: the newest copy, the newest copy of each of the
 * 24 newest hours that have one, of each of the 14 newest days and of each of
 * the 12 newest months (so a PC that was off for a month keeps its old ones).
 * Names that are not sync copies are never returned.
 */
export function versionsToDelete(names: string[], keep = { hourly: KEEP_HOURLY, daily: KEEP_DAILY, monthly: KEEP_MONTHLY }): string[] {
  const all = names
    .map((name) => ({ name, p: parseCopyName(name) }))
    .filter((x): x is { name: string; p: NonNullable<ReturnType<typeof parseCopyName>> } => !!x.p)
    .sort((a, b) => b.p.at - a.p.at || b.name.localeCompare(a.name))
  const kept = new Set<string>()
  if (all[0]) kept.add(all[0].name)
  const bucket = (len: number, max: number) => {
    const seen = new Set<string>()
    for (const x of all) {
      const key = x.p.stamp.slice(0, len)
      if (seen.has(key)) continue
      if (seen.size >= max) break
      seen.add(key)
      kept.add(x.name)
    }
  }
  bucket(10, keep.hourly)
  bucket(8, keep.daily)
  bucket(6, keep.monthly)
  return all.filter((x) => !kept.has(x.name)).map((x) => x.name)
}

export interface SyncFileInfo {
  name: string
  bytes: number
  sha256: string
}
export interface SyncAppInfo {
  field: string
  label: string
  /** Characters of the app's data. */
  size: number
  /** A short checksum of the app's data (the same one the restore test uses). */
  sum: string
}
/** What the app window knows about a copy (counted from the backup JSON itself). */
export interface SyncCopyMeta {
  schemaVersion: number | null
  /** Rows per table. */
  tables: Record<string, number>
  apps: SyncAppInfo[]
}
export interface SyncManifest extends SyncCopyMeta {
  app: 'Life System'
  kind: 'sync-folder'
  format: 1
  madeAt: string
  appVersion: string
  device: { id: string; name: string }
  rows: number
  /** The files in this copy, each with its SHA-256. */
  files: SyncFileInfo[]
}

/** Row counts and each app's size and checksum, from a backup's JSON. */
export function copyMeta(snap: { tables?: Record<string, unknown>; [k: string]: unknown }, schemaVersion: number | null = null): SyncCopyMeta {
  const tables: Record<string, number> = {}
  for (const [t, rows] of Object.entries(snap?.tables ?? {})) if (Array.isArray(rows)) tables[t] = rows.length
  const apps: SyncAppInfo[] = []
  for (const b of APP_BLOBS) if (snap?.[b.field] != null) apps.push({ field: b.field, label: b.label, ...blobDigest(snap[b.field]) })
  return { schemaVersion, tables, apps }
}
export const rowsOf = (tables: Record<string, number>) => Object.values(tables).reduce((a, n) => a + (Number(n) || 0), 0)
/** Two copies hold the same app data (the database file is compared by its SHA-256). */
export const appsKey = (apps: SyncAppInfo[]) => apps.map((a) => `${a.field}:${a.size}:${a.sum}`).sort().join('|')

export interface SyncVersion {
  /** "<device folder>/<file name>": what restore() and preview() take. */
  id: string
  device: string
  /** This PC made it. */
  mine: boolean
  at: string
  sizeBytes: number
  encrypted: boolean
}
/** What a restore would put back, read from the copy's manifest after its files were checked. */
export interface SyncPreview {
  id: string
  at: string
  device: string
  appVersion: string
  schemaVersion: number | null
  rows: number
  tables: Record<string, number>
  apps: SyncAppInfo[]
  sizeBytes: number
  encrypted: boolean
}
export interface SyncFolderStatus {
  enabled: boolean
  folder: string | null
  /** This PC's folder inside it. */
  device: string
  lastWrite: string | null
  /** The last copy was read back and every file matched its SHA-256. */
  lastVerifiedOk: boolean | null
  /** How many versions this PC has in the folder, and their total size. */
  versions: number
  sizeBytes: number
  lastSizeBytes: number | null
  /** Why the last copy failed (folder missing, disk full…), or null. It is tried again by itself. */
  error: string | null
  /** The folder can't be found right now (USB removed, cloud drive paused). */
  missing: boolean
  encrypt: boolean
  /** A passphrase is saved on this PC (needed to open encrypted copies). */
  passphraseSaved: boolean
  /** Other PCs with copies in the same folder. */
  others: { device: string; lastWrite: string | null; versions: number }[]
}
export interface SyncSuggestion {
  label: string
  path: string
}

/** Never more often than this: a big copy is not uploaded again every few seconds. */
export function minGapMs(sizeBytes: number | null | undefined): number {
  const mb = (sizeBytes ?? 0) / (1024 * 1024)
  return mb > 64 ? 5 * 60_000 : mb > 16 ? 60_000 : DEBOUNCE_MS
}
/** After a failed copy: 30 s, 1 min, 2 min, then every 5 minutes. */
export const retryDelayMs = (failures: number) => Math.min(5 * 60_000, 30_000 * 2 ** Math.max(0, failures - 1))

export type PaceResult = 'ok' | 'skipped' | 'failed'
export interface PacerOptions {
  run: (why: string) => Promise<PaceResult>
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (t: unknown) => void
  /** The size of the last copy (sets the smallest gap between two copies). */
  lastSize?: () => number | null
}

/**
 * When to write: 15 s after the last change, at most 60 s after the first one,
 * never closer together than the size allows, and again by itself after a
 * failure (the folder is missing…). `flush` writes now when something waits.
 */
export function createPacer(o: PacerOptions) {
  const now = o.now ?? (() => Date.now())
  const setT = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearT = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>))
  let dirty = false
  let firstAt = 0
  let lastRunAt = -Infinity
  let failures = 0
  let timer: unknown = null
  let running: Promise<PaceResult> | null = null

  const arm = (ms: number) => {
    if (timer != null) clearT(timer)
    timer = setT(() => {
      timer = null
      void go('change')
    }, Math.max(0, ms))
  }
  const go = async (why: string): Promise<PaceResult> => {
    if (running) return running
    if (timer != null) {
      clearT(timer)
      timer = null
    }
    dirty = false
    running = o.run(why).catch(() => 'failed' as const)
    const r = await running
    running = null
    lastRunAt = now()
    if (r === 'failed') {
      failures++
      dirty = true
      firstAt = now()
      arm(retryDelayMs(failures))
    } else {
      failures = 0
      // A change that arrived while the copy was being written.
      if (dirty) arm(Math.max(DEBOUNCE_MS, minGapMs(o.lastSize?.())))
    }
    return r
  }
  return {
    /** Something changed. */
    touch() {
      const t = now()
      if (!dirty) firstAt = t
      dirty = true
      if (running || failures) return
      const wanted = Math.min(t + DEBOUNCE_MS, firstAt + MAX_WAIT_MS)
      arm(Math.max(wanted, lastRunAt + minGapMs(o.lastSize?.())) - t)
    },
    /** Write now if something waits (quit, sleep, lock, "Copy now"). */
    flush(why: string, force = false): Promise<PaceResult> {
      if (running) return running
      if (!dirty && !force) return Promise.resolve('skipped')
      return go(why)
    },
    get dirty() {
      return dirty
    },
    get failures() {
      return failures
    },
    stop() {
      if (timer != null) clearT(timer)
      timer = null
      dirty = false
      failures = 0
    }
  }
}

/** "3.2 MB" */
export function sizeLabel(bytes: number | null | undefined): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** The one line the settings panel shows. */
export function statusLine(s: SyncFolderStatus, now = Date.now()): { light: 'green' | 'amber' | 'red' | 'off'; text: string } {
  if (!s.enabled) return { light: 'off', text: 'Off. Choose a folder to keep a live copy of all your data in it.' }
  const ago = (iso: string) => {
    const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
    return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : min < 48 * 60 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} days ago`
  }
  if (s.missing) return { light: s.lastWrite && now - Date.parse(s.lastWrite) < 24 * 3600_000 ? 'amber' : 'red', text: `Folder not found (USB removed or cloud drive paused?). Trying again by itself.${s.lastWrite ? ` Last copy ${ago(s.lastWrite)}.` : ''}` }
  if (s.error) return { light: 'red', text: `${s.error} Trying again by itself.` }
  if (!s.lastWrite) return { light: 'amber', text: 'First copy is on its way…' }
  return { light: s.lastVerifiedOk === false ? 'red' : 'green', text: `Last copy ${ago(s.lastWrite)}, checked${s.encrypt ? ', encrypted' : ''} · ${s.versions} ${s.versions === 1 ? 'version' : 'versions'} · ${sizeLabel(s.sizeBytes)}` }
}
