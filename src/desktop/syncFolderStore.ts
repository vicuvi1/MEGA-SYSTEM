// Sync folder files (desktop, 2026-11-18). A complete copy of all data, written
// into a folder you choose after every change:
//   <your folder>/Life System Sync/<this PC>/life-sync-<UTC time>Z.zip
// Each copy is one .zip (so it appears in the folder whole, in one step) with:
//   backup.json         everything: all tables and every app's own data (Restore takes it)
//   life-system.sqlite  this PC's database file (opens in any SQLite viewer)
//   manifest.json       app version, schema version, device, time, row counts, SHA-256 of each file
//   README.txt          how to open it without the app
// Written to a temp name, read back and checked against the SHA-256s, then renamed.
// Kept: 24 hourly, 14 daily, 12 monthly versions (core/syncFolder.ts versionsToDelete).
// Never needs the server. No Electron here (tested in a temp folder); syncFolder.ts wires it.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { deflateRaw, inflateRaw } from 'node:zlib'
import { fromUtf8, listZip, makeZip, readZipEntry, utf8 } from '../core/zip'
import {
  SYNC_ROOT, appsKey, copyMeta, copyName, deviceFolder, isDeviceFolder, isTempName, parseCopyName, parseVersionId, rowsOf, tempName, versionsToDelete,
  type SyncCopyMeta, type SyncFolderStatus, type SyncManifest, type SyncPreview, type SyncVersion
} from '../core/syncFolder'

const deflate = promisify(deflateRaw)
const inflate = promisify(inflateRaw)
const scryptAsync = promisify(scrypt) as (pass: string, salt: Uint8Array, len: number, o: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>

const MAGIC = Buffer.from('LSSYNC01')
const sha256 = (u8: Uint8Array) => createHash('sha256').update(u8).digest('hex')
export const isEncryptedCopy = (u8: Uint8Array) => u8.length > MAGIC.length + 44 && MAGIC.equals(Buffer.from(u8.subarray(0, MAGIC.length)))

const README = `Life System sync folder
=======================
Life System (the desktop app) keeps a live copy of all your data here, so it stays
safe even when the server is down. Each PC has its own folder; inside it every
life-sync-<time>.zip is one complete copy (the time is UTC).

backup.json         Everything: every table and the apps' own data (Finance, Sport Track,
                    Waky, MAN). Plain JSON.
life-system.sqlite  The database file of the PC that made the copy. Opens in any SQLite
                    viewer (for example "DB Browser for SQLite", free).
manifest.json       App version, device, time, row counts and the SHA-256 of each file.

To put a copy back: Life System -> Settings -> Data safety -> Sync folder -> Restore.
On a new PC: install Life System, sign in, choose this folder there, then Restore.
Files ending in .zip.enc are encrypted: they open only in the app, with your passphrase.
Do not edit or rename the files. More: docs/RECOVERY.md in the Life System repository.
`

/** Where the passphrase is kept (Electron safeStorage on the PC; memory in tests). */
export interface SecretBox {
  available(): boolean
  load(): Promise<string | null>
  save(passphrase: string): Promise<void>
  clear(): Promise<void>
}

export interface SyncFolderOptions {
  userData: string
  version: string
  /** This PC's name (the folder gets it plus a short id). */
  deviceName: string
  secret?: SecretBox
}
export interface SyncContent {
  /** backup.json text (everything). */
  json: string
  /** This PC's database file. */
  sqlite?: Uint8Array | null
  /** Row counts and app checksums; counted from `json` when not given. */
  meta?: SyncCopyMeta | null
}

interface Prefs {
  folder?: string | null
  deviceId?: string
  encrypt?: boolean
  lastWrite?: string | null
  lastVerifiedOk?: boolean | null
  lastSize?: number | null
  lastError?: string | null
  /** SHA-256 of the database file + the apps' checksums of the last copy: the same again is not written twice. */
  lastKey?: string | null
}

/** rename, tried again for a moment when a virus scanner or the cloud-drive app holds the file (Windows). */
async function renameSteady(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await rename(from, to)
    } catch (e) {
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e
      await new Promise((r) => setTimeout(r, 150 * (i + 1)))
    }
  }
}

/** The chosen folder is not there right now (USB removed, cloud drive paused). */
export class FolderMissingError extends Error {
  missing = true
}

async function seal(zip: Uint8Array, passphrase: string, keyOf: (pass: string, salt: Uint8Array) => Promise<Buffer>): Promise<Uint8Array> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', await keyOf(passphrase, salt), iv)
  const body = Buffer.concat([c.update(zip), c.final()])
  return new Uint8Array(Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), body]))
}
async function unseal(bytes: Uint8Array, passphrase: string | null, keyOf: (pass: string, salt: Uint8Array) => Promise<Buffer>): Promise<Uint8Array> {
  if (!passphrase) throw new Error('This copy is encrypted: enter its passphrase first')
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const salt = b.subarray(8, 24)
  const d = createDecipheriv('aes-256-gcm', await keyOf(passphrase, salt), b.subarray(24, 36))
  d.setAuthTag(b.subarray(36, 52))
  try {
    return new Uint8Array(Buffer.concat([d.update(b.subarray(52)), d.final()]))
  } catch {
    throw new Error('Wrong passphrase, or the copy is damaged')
  }
}

/**
 * Opens a copy and checks it: every file the manifest lists is there with the
 * same size and SHA-256. Throws when not. `want` also compares with the
 * manifest that was just written.
 */
export async function openCopy(bytes: Uint8Array, passphrase: string | null, keyOf: (pass: string, salt: Uint8Array) => Promise<Buffer>): Promise<{ manifest: SyncManifest; file: (name: string) => Uint8Array | null }> {
  const zip = isEncryptedCopy(bytes) ? await unseal(bytes, passphrase, keyOf) : bytes
  const items = listZip(zip)
  const data = new Map<string, Uint8Array>()
  for (const i of items) data.set(i.name, await readZipEntry(i, (u8) => inflate(u8).then((b) => new Uint8Array(b))))
  const m = data.get('manifest.json')
  if (!m) throw new Error('This copy has no manifest')
  const manifest = JSON.parse(fromUtf8(m)) as SyncManifest
  if (manifest?.kind !== 'sync-folder' || !Array.isArray(manifest.files)) throw new Error('This is not a sync folder copy')
  if (!manifest.files.some((f) => f.name === 'backup.json')) throw new Error('This copy has no data in it')
  for (const f of manifest.files) {
    const got = data.get(f.name)
    if (!got) throw new Error(`${f.name} is missing from the copy`)
    if (got.length !== f.bytes || sha256(got) !== f.sha256) throw new Error(`${f.name} in the copy does not match its checksum`)
  }
  return { manifest, file: (name) => data.get(name) ?? null }
}

export function createSyncFolderStore(o: SyncFolderOptions) {
  const prefFile = join(o.userData, 'sync-folder.json')
  let pref: Prefs = {}
  const ready = readFile(prefFile, 'utf8')
    .then((t) => {
      pref = JSON.parse(t) ?? {}
    })
    .catch(() => {
      pref = {}
    })
    .then(async () => {
      if (!pref.deviceId) {
        pref.deviceId = randomBytes(3).toString('hex')
        await savePref()
      }
    })
  const savePref = async () => {
    try {
      await writeFile(prefFile + '.tmp', JSON.stringify(pref))
      await rename(prefFile + '.tmp', prefFile)
    } catch {
      /* the settings folder is not writable: the copy itself still counts */
    }
  }
  const device = () => deviceFolder(o.deviceName, pref.deviceId ?? '')
  const rootOf = (folder: string) => join(folder, SYNC_ROOT)
  const isDir = async (p: string) => (await stat(p).catch(() => null))?.isDirectory() ?? false

  // One key per (passphrase, salt): scrypt is slow on purpose.
  const keys = new Map<string, Promise<Buffer>>()
  const keyOf = (pass: string, salt: Uint8Array) => {
    const id = sha256(utf8(pass)) + Buffer.from(salt).toString('hex')
    let k = keys.get(id)
    if (!k) {
      if (keys.size > 64) keys.clear()
      k = scryptAsync(pass, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 })
      keys.set(id, k)
    }
    return k
  }
  const passphrase = async () => (o.secret?.available() ? o.secret.load().catch(() => null) : null)

  async function versionsIn(folder: string, dev: string): Promise<SyncVersion[]> {
    const dir = join(rootOf(folder), dev)
    const names = await readdir(dir).catch(() => [] as string[])
    const out: SyncVersion[] = []
    for (const name of names) {
      const p = parseCopyName(name)
      if (!p) continue
      const s = await stat(join(dir, name)).catch(() => null)
      if (s?.isFile()) out.push({ id: `${dev}/${name}`, device: dev, mine: dev === device(), at: new Date(p.at).toISOString(), sizeBytes: s.size, encrypted: p.encrypted })
    }
    return out.sort((a, b) => b.at.localeCompare(a.at))
  }
  async function devicesIn(folder: string): Promise<string[]> {
    const names = await readdir(rootOf(folder), { withFileTypes: true }).catch(() => [])
    return names.filter((e) => e.isDirectory() && isDeviceFolder(e.name)).map((e) => e.name)
  }

  async function fileOf(id: string): Promise<{ bytes: Uint8Array; v: NonNullable<ReturnType<typeof parseVersionId>> }> {
    await ready
    const v = parseVersionId(id)
    if (!v || !pref.folder) throw new Error('No such copy')
    if (!(await isDir(pref.folder))) throw new FolderMissingError('The sync folder was not found (USB removed or cloud drive paused?)')
    const bytes = await readFile(join(rootOf(pref.folder), v.device, v.name)).catch(() => null)
    if (!bytes) throw new Error('No such copy (a cloud drive may still be downloading it)')
    return { bytes: new Uint8Array(bytes), v }
  }

  let queue: Promise<unknown> = Promise.resolve()
  const inLine = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = queue.then(fn, fn)
    queue = p.catch(() => {})
    return p
  }

  const api = {
    ready,
    get folder() {
      return pref.folder ?? null
    },
    get lastSize() {
      return pref.lastSize ?? null
    },
    async status(): Promise<SyncFolderStatus> {
      await ready
      const folder = pref.folder ?? null
      const missing = !!folder && !(await isDir(folder))
      const mine = folder && !missing ? await versionsIn(folder, device()) : []
      const others: SyncFolderStatus['others'] = []
      if (folder && !missing)
        for (const d of await devicesIn(folder)) {
          if (d === device()) continue
          const v = await versionsIn(folder, d)
          if (v.length) others.push({ device: d, lastWrite: v[0].at, versions: v.length })
        }
      return {
        enabled: !!folder,
        folder,
        device: device(),
        lastWrite: pref.lastWrite ?? null,
        lastVerifiedOk: pref.lastVerifiedOk ?? null,
        versions: mine.length,
        sizeBytes: mine.reduce((a, v) => a + v.sizeBytes, 0),
        lastSizeBytes: pref.lastSize ?? null,
        error: missing ? null : pref.lastError ?? null,
        missing,
        encrypt: !!pref.encrypt,
        passphraseSaved: !!(await passphrase()),
        others
      }
    },
    /** The chosen folder is there right now. */
    async reachable(): Promise<boolean> {
      await ready
      return !!pref.folder && (await isDir(pref.folder))
    },
    /** Choose the folder (it must exist), or null to turn the sync folder off. Copies already written stay where they are. */
    async setFolder(folder: string | null): Promise<SyncFolderStatus> {
      await ready
      if (folder && !(await isDir(folder))) throw new Error('That folder was not found')
      pref = { ...pref, folder: folder || null, lastWrite: null, lastVerifiedOk: null, lastSize: null, lastError: null, lastKey: null }
      await savePref()
      return api.status()
    },
    /** True when a copy of exactly this data is already the last one written. */
    async unchanged(sqlite: Uint8Array | null, apps: SyncCopyMeta['apps'] | null): Promise<boolean> {
      await ready
      if (!pref.lastKey || !pref.lastWrite) return false
      const [db, ap] = pref.lastKey.split('#')
      return db === (sqlite ? sha256(sqlite) : '') && (apps == null || ap === appsKey(apps))
    },
    /**
     * Writes one complete copy: temp name → read back and checked → renamed →
     * old versions thinned. A failure is kept as the status error and thrown;
     * nothing half-written is ever left under a real name.
     */
    write(c: SyncContent, now = new Date()): Promise<SyncFolderStatus> {
      return inLine(async () => {
        await ready
        const folder = pref.folder
        if (!folder) throw new Error('No sync folder is chosen')
        try {
          if (typeof c.json !== 'string' || !c.json) throw new Error('Nothing to copy')
          if (!(await isDir(folder))) throw new FolderMissingError('The sync folder was not found (USB removed or cloud drive paused?)')
          let pass: string | null = null
          if (pref.encrypt) {
            pass = await passphrase()
            // Never a plain copy when you asked for an encrypted one.
            if (!pass) throw new Error('The passphrase for the encrypted copy could not be read on this PC: enter it again')
          }
          const meta = c.meta ?? copyMeta(JSON.parse(c.json))
          const files: { name: string; data: Uint8Array }[] = [{ name: 'backup.json', data: utf8(c.json) }]
          if (c.sqlite?.length) files.push({ name: 'life-system.sqlite', data: c.sqlite })
          const manifest: SyncManifest = {
            app: 'Life System',
            kind: 'sync-folder',
            format: 1,
            madeAt: now.toISOString(),
            appVersion: o.version,
            device: { id: pref.deviceId ?? '', name: o.deviceName },
            schemaVersion: meta.schemaVersion ?? null,
            rows: rowsOf(meta.tables),
            tables: meta.tables,
            apps: meta.apps,
            files: files.map((f) => ({ name: f.name, bytes: f.data.length, sha256: sha256(f.data) }))
          }
          const entries = [...files, { name: 'manifest.json', data: utf8(JSON.stringify(manifest, null, 2)) }, { name: 'README.txt', data: utf8(README) }]
          const packed = new Map<Uint8Array, Uint8Array>()
          for (const f of entries) packed.set(f.data, new Uint8Array(await deflate(f.data, { level: 6 })))
          const zip = makeZip(entries, (u8) => packed.get(u8) ?? u8, now)
          const bytes = pass ? await seal(zip, pass, keyOf) : zip
          const name = copyName(now, !!pass)
          const root = rootOf(folder)
          const dir = join(root, device())
          await mkdir(dir, { recursive: true })
          if (!existsSync(join(root, 'README.txt'))) await writeFile(join(root, 'README.txt'), README).catch(() => {})
          const tmp = join(dir, tempName(name))
          try {
            const fh = await open(tmp, 'w')
            try {
              await fh.writeFile(bytes)
              // On the disk for real (a USB drive pulled a second later still has it).
              await fh.sync().catch(() => {})
            } finally {
              await fh.close()
            }
            // Read back and checked before it takes its real name.
            let checked: SyncManifest
            try {
              const back = await readFile(tmp)
              // Byte for byte what was written, and every file inside matches its SHA-256.
              if (Buffer.compare(back, bytes) !== 0) throw new Error('The copy read back differs from what was written')
              checked = (await openCopy(new Uint8Array(back), pass, keyOf)).manifest
              if (JSON.stringify(checked.files) !== JSON.stringify(manifest.files)) throw new Error('The copy read back differs from what was written')
            } catch (e) {
              pref.lastVerifiedOk = false
              throw new Error(`The copy did not pass its check: ${(e as Error).message}`)
            }
            await renameSteady(tmp, join(dir, name))
          } catch (e) {
            await unlink(tmp).catch(() => {})
            throw e
          }
          const names = await readdir(dir).catch(() => [] as string[])
          for (const old of versionsToDelete(names)) if (old !== name) await unlink(join(dir, old)).catch(() => {})
          // Temp files a crash left behind (only our own, only old ones).
          for (const t of names.filter(isTempName)) {
            const s = await stat(join(dir, t)).catch(() => null)
            if (s && now.getTime() - s.mtimeMs > 10 * 60_000) await unlink(join(dir, t)).catch(() => {})
          }
          pref.lastWrite = now.toISOString()
          pref.lastVerifiedOk = true
          pref.lastSize = bytes.length
          pref.lastError = null
          pref.lastKey = `${c.sqlite?.length ? manifest.files[1].sha256 : ''}#${appsKey(meta.apps)}`
          await savePref()
          return api.status()
        } catch (e) {
          pref.lastError = e instanceof FolderMissingError ? null : String((e as Error)?.message ?? e).slice(0, 200)
          await savePref()
          throw e
        }
      })
    },
    /** Every version in the folder, newest first: this PC's and other PCs'. */
    async list(): Promise<SyncVersion[]> {
      await ready
      if (!pref.folder || !(await isDir(pref.folder))) return []
      const all: SyncVersion[] = []
      for (const d of await devicesIn(pref.folder)) all.push(...(await versionsIn(pref.folder, d)))
      return all.sort((a, b) => b.at.localeCompare(a.at))
    },
    /** A version's date and counts, after its files were checked against their SHA-256. */
    async preview(id: string): Promise<SyncPreview> {
      const { bytes, v } = await fileOf(id)
      const { manifest: m } = await openCopy(bytes, await passphrase(), keyOf)
      return { id, at: m.madeAt, device: m.device?.name || v.device, appVersion: m.appVersion, schemaVersion: m.schemaVersion ?? null, rows: m.rows, tables: m.tables ?? {}, apps: m.apps ?? [], sizeBytes: bytes.length, encrypted: v.encrypted }
    },
    /** A version's backup.json text (checked), for the app's restore. */
    async read(id: string): Promise<string> {
      const { bytes } = await fileOf(id)
      const copy = await openCopy(bytes, await passphrase(), keyOf)
      return fromUtf8(copy.file('backup.json')!)
    },
    /**
     * Encrypt new copies (AES-256-GCM, key from the passphrase by scrypt). The
     * passphrase is kept only on this PC. Off: new copies are plain again; the
     * passphrase stays saved so older encrypted versions still open.
     */
    async setEncryption(on: boolean, pass?: string | null): Promise<SyncFolderStatus> {
      await ready
      if (pass != null && pass !== '') {
        if (!o.secret?.available()) throw new Error('This PC cannot keep a passphrase safely, so encryption stays off')
        if (pass.length < 8) throw new Error('Use a passphrase of at least 8 characters')
        // A typo would lock you out of the copies already there: it must open the newest encrypted one.
        const newest = (await api.list()).find((v) => v.encrypted)
        if (newest) {
          const { bytes } = await fileOf(newest.id)
          await openCopy(bytes, pass, keyOf).catch(() => {
            throw new Error('This passphrase does not open the encrypted copies already in the folder')
          })
        }
        await o.secret.save(pass)
      }
      if (on && !(await passphrase())) throw new Error('Enter a passphrase first')
      pref.encrypt = !!on
      pref.lastKey = null
      await savePref()
      return api.status()
    },
    dir: () => (pref.folder ? join(rootOf(pref.folder), device()) : null)
  }
  return api
}

/**
 * Where cloud-drive apps usually keep their folder on this PC (OneDrive, Google
 * Drive, Dropbox, iCloud Drive). Only suggestions: the caller keeps the ones
 * that exist, and any other folder can be chosen.
 */
export function cloudFolderCandidates(env: Record<string, string | undefined>, home: string, platform: string, dropboxInfo?: string | null): { label: string; path: string }[] {
  const out: { label: string; path: string }[] = []
  const add = (label: string, path: string | undefined | null) => {
    if (path && !out.some((x) => x.path === path)) out.push({ label, path })
  }
  add('OneDrive', env.OneDrive)
  add('OneDrive', env.OneDriveConsumer)
  add('OneDrive (work)', env.OneDriveCommercial)
  add('OneDrive', join(home, 'OneDrive'))
  add('Google Drive', join(home, 'Google Drive', 'My Drive'))
  add('Google Drive', join(home, 'My Drive'))
  if (platform === 'win32') for (const l of 'GHIJKLMNOPQRSTUVWXYZDEF') add('Google Drive', `${l}:\\My Drive`)
  try {
    const info = dropboxInfo ? JSON.parse(dropboxInfo) : null
    add('Dropbox', info?.personal?.path)
    add('Dropbox (work)', info?.business?.path)
  } catch {
    /* no Dropbox */
  }
  add('Dropbox', join(home, 'Dropbox'))
  add('iCloud Drive', join(home, 'iCloudDrive'))
  return out
}
