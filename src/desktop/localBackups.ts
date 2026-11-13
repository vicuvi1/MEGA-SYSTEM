// Local backup files on this computer (2026-11-12): automatic, offline, in a
// folder you choose (default Documents/LifeSystem/Backups). One .zip a day and
// one before each risky step, each holding:
//   backup.json         everything (all tables and the apps' own data), the same
//                       format as Export and the cloud backups, so Restore takes it
//   life-system.sqlite  this PC's copy of the database (opens in any SQLite viewer)
//   manifest.json       what is inside, with row counts and checksums
//   README.txt          how to open it without the app
// Kept: 14 daily, 8 weekly, 12 monthly, and the newest 30 "before" backups
// (core/backupPlan.ts). No Electron here (tested in a temp folder); backups.ts wires it.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { deflateRaw, inflateRawSync } from 'node:zlib'
import { BLOB_FIELDS, backupDay, dailyBackupName, localBackupsToDelete, parseLocalBackup, riskBackupName } from '../core/backupPlan'
import { backupDigest } from '../core/backupCheck'
import { listZip, makeZip, readZipEntry, utf8 } from '../core/zip'

const deflate = promisify(deflateRaw)

export type BackupWhere = 'local' | 'drive' | 'old'
export interface BackupFile {
  name: string
  day: string
  size: number
  kind: 'daily' | 'risk'
  /** What a "before" backup was made before (words), or null. */
  before: string | null
  /** When a "before" backup was made (HH:MM), or null. */
  time: string | null
}
export interface BackupStatus {
  local: { dir: string; defaultDir: string; chosen: boolean; files: BackupFile[] }
  drive: { dir: string | null; chosen: boolean; files: BackupFile[] }
  /** The old folder (Documents/Life System Backups): read only, kept as it is. */
  old: { dir: string; files: BackupFile[] }
  lastDay: string | null
  lastAt: string | null
  lastFile: string | null
  lastSize: number | null
  lastError: string | null
}

interface Prefs {
  localDir?: string | null
  driveDir?: string | null
  lastDay?: string
  lastAt?: string
  lastFile?: string | null
  lastSize?: number | null
  lastError?: string | null
  lastVersion?: string
}

export const FOLDER = join('LifeSystem', 'Backups')
export const OLD_FOLDER = 'Life System Backups'
export const DRIVE_FOLDER = 'Life System Backups'

const README = `Life System backup
==================
This zip is a full backup of your Life System data. You can open it without the app.

backup.json         Everything: every table and the apps' own data (Finance, Sport Track,
                    Waky, MAN). Plain JSON: open it in any text editor or browser.
life-system.sqlite  The database copy on the PC that made this backup. Open it with any
                    SQLite viewer (for example "DB Browser for SQLite", free).
manifest.json       What is inside: row counts and checksums of every table.

To put a backup back: Life System -> Settings -> Data safety -> Restore from file, and pick
this zip (or the backup.json inside it). Your current data is backed up first.
More: docs/RECOVERY.md in the Life System repository.
`

const hm = (hhmmss: string | null) => (hhmmss ? `${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}` : null)
const words = (slug: string | null) => (slug ? slug.replace(/-/g, ' ') : null)

export function listBackups(dir: string | null): BackupFile[] {
  if (!dir || !existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .map((name) => {
        const p = parseLocalBackup(name)
        if (p) return { name, day: p.day, kind: p.kind, before: words(p.before), time: hm(p.time) }
        const d = backupDay(name)
        return d ? { name, day: d, kind: 'daily' as const, before: null, time: null } : null
      })
      .filter((x): x is Omit<BackupFile, 'size'> => !!x)
      .map((x) => ({ ...x, size: statSync(join(dir, x.name)).size }))
      .sort((a, b) => `${b.day}${b.time ?? '99'}`.localeCompare(`${a.day}${a.time ?? '99'}`))
  } catch {
    return []
  }
}

export interface BackupContent {
  /** backup.json text (everything). */
  json?: string | null
  /** This PC's database file. */
  sqlite?: Uint8Array | null
  day: string
  /** Made before a risky step (words), or null for the daily one. */
  reason?: string | null
}

/** The zip of one backup (async compression), and its file name. */
export async function buildBackupZip(c: BackupContent, now = new Date(), version = ''): Promise<{ name: string; bytes: Uint8Array }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.day)) throw new Error('Invalid backup day')
  if (!c.json && !c.sqlite) throw new Error('Nothing to back up')
  let digest = null
  if (c.json) {
    const parsed = JSON.parse(c.json)
    if (!parsed || typeof parsed.tables !== 'object') throw new Error('Invalid backup')
    digest = backupDigest(parsed, BLOB_FIELDS)
  }
  const files: { name: string; data: Uint8Array }[] = []
  if (c.json) files.push({ name: 'backup.json', data: utf8(c.json) })
  if (c.sqlite?.length) files.push({ name: 'life-system.sqlite', data: c.sqlite })
  const manifest = {
    app: 'Life System',
    kind: c.reason ? 'before' : 'daily',
    before: c.reason ?? null,
    day: c.day,
    madeAt: now.toISOString(),
    version,
    files: files.map((f) => ({ name: f.name, bytes: f.data.length })),
    digest
  }
  files.push({ name: 'manifest.json', data: utf8(JSON.stringify(manifest, null, 2)) }, { name: 'README.txt', data: utf8(README) })
  const packed = new Map<Uint8Array, Uint8Array>()
  for (const f of files) packed.set(f.data, new Uint8Array(await deflate(f.data, { level: 6 })))
  const bytes = makeZip(files, (u8) => packed.get(u8) ?? u8, now)
  const hhmmss = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  return { name: c.reason ? riskBackupName(c.day, hhmmss, c.reason) : dailyBackupName(c.day), bytes }
}

/** Every entry of a backup zip opens and matches its checksum; backup.json is valid JSON. Throws when not. */
export async function verifyBackupZip(bytes: Uint8Array): Promise<void> {
  const items = listZip(bytes)
  if (!items.some((i) => i.name === 'backup.json' || i.name === 'life-system.sqlite')) throw new Error('The backup file has no data in it')
  for (const i of items) {
    const data = await readZipEntry(i, (u8) => new Uint8Array(inflateRawSync(u8)))
    if (i.name === 'backup.json') JSON.parse(new TextDecoder().decode(data))
  }
}

export interface LocalBackupsOptions {
  userData: string
  documents: string
  /** Possible Google Drive folders (the first that exists is used, unless one was chosen). */
  driveCandidates?: () => string[]
  version?: string
}

export function createLocalBackups(o: LocalBackupsOptions) {
  const prefFile = join(o.userData, 'backups.json')
  let pref: Prefs = {}
  const ready = readFile(prefFile, 'utf8')
    .then((t) => {
      pref = JSON.parse(t)
    })
    .catch(() => {
      pref = {}
    })
  const savePref = () => writeFile(prefFile, JSON.stringify(pref)).catch(() => {})
  const defaultDir = join(o.documents, FOLDER)
  const localDir = () => pref.localDir || defaultDir
  const oldDir = join(o.documents, OLD_FOLDER)
  const driveDir = (): string | null => {
    if (pref.driveDir) return existsSync(pref.driveDir) ? join(pref.driveDir, DRIVE_FOLDER) : null
    const base = (o.driveCandidates?.() ?? []).find((d) => existsSync(d))
    return base ? join(base, DRIVE_FOLDER) : null
  }
  const dirOf = (where: BackupWhere) => (where === 'drive' ? driveDir() : where === 'old' ? oldDir : localDir())

  async function put(dir: string, name: string, bytes: Uint8Array) {
    await mkdir(dir, { recursive: true })
    const file = join(dir, name)
    await writeFile(file + '.tmp', bytes)
    // Read back and checked before it takes the real name.
    await verifyBackupZip(new Uint8Array(await readFile(file + '.tmp')))
    await rename(file + '.tmp', file)
    for (const old of localBackupsToDelete(readdirSync(dir))) if (old !== name) await unlink(join(dir, old)).catch(() => {})
  }

  const api = {
    ready,
    async status(): Promise<BackupStatus> {
      await ready
      const d = driveDir()
      return {
        local: { dir: localDir(), defaultDir, chosen: !!pref.localDir, files: listBackups(localDir()) },
        drive: { dir: d, chosen: !!pref.driveDir, files: listBackups(d) },
        old: { dir: oldDir, files: listBackups(oldDir) },
        lastDay: pref.lastDay ?? null,
        lastAt: pref.lastAt ?? null,
        lastFile: pref.lastFile ?? null,
        lastSize: pref.lastSize ?? null,
        lastError: pref.lastError ?? null
      }
    },
    /**
     * Writes one backup zip to the chosen folder (and the daily one to Google
     * Drive too, when found). Checked after writing. A failure is kept as
     * `lastError` (shown red in Settings → Data safety) and thrown.
     */
    async write(c: BackupContent, now = new Date()): Promise<BackupStatus> {
      await ready
      const { name, bytes } = await buildBackupZip(c, now, o.version ?? '')
      const errors: string[] = []
      await put(localDir(), name, bytes).catch((e) => errors.push(`Backup folder: ${(e as Error).message}`))
      const d = !c.reason ? driveDir() : null
      if (d) await put(d, name, bytes).catch((e) => errors.push(`Google Drive: ${(e as Error).message}`))
      const localOk = !errors.some((e) => e.startsWith('Backup folder'))
      if (localOk) {
        if (!c.reason) pref.lastDay = c.day
        pref.lastAt = now.toISOString()
        pref.lastFile = name
        pref.lastSize = bytes.length
      }
      pref.lastError = errors.length ? errors.join(' · ') : null
      await savePref()
      if (!localOk) throw new Error(errors.join(' · '))
      return api.status()
    },
    /** A backup file's bytes (a zip, or an old daily .json). */
    async read(where: BackupWhere, name: string): Promise<Uint8Array> {
      await ready
      const dir = dirOf(where)
      if (!dir || !(parseLocalBackup(String(name)) || backupDay(String(name)))) throw new Error('No such backup')
      return new Uint8Array(await readFile(join(dir, name)))
    },
    async setLocalDir(dir: string | null): Promise<BackupStatus> {
      await ready
      pref.localDir = dir || null
      await savePref()
      return api.status()
    },
    async setDriveDir(dir: string | null): Promise<BackupStatus> {
      await ready
      pref.driveDir = dir || null
      await savePref()
      return api.status()
    },
    dir: dirOf,
    /** The app version the last start ran (a new one means database changes may come: a "before" backup first). */
    async versionChanged(version: string): Promise<boolean> {
      await ready
      const changed = !!pref.lastVersion && pref.lastVersion !== version
      if (pref.lastVersion !== version) {
        pref.lastVersion = version
        await savePref()
      }
      return changed
    }
  }
  return api
}
