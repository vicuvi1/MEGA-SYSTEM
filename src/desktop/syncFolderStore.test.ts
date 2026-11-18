// The sync folder's files, in a temp folder with made-up data: written whole
// (temp name → checked → renamed), thinned to the kept versions, checked
// against their SHA-256, restorable, and safe when the folder is missing.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYNC_ROOT, copyName, isTempName, parseCopyName } from '../core/syncFolder'
import { listZip, looksLikeZip, readZipEntry } from '../core/zip'

// A fault switch: the copy read back for its check comes back damaged (a bad USB stick, a half upload).
const fault = vi.hoisted(() => ({ damageReadBack: false }))
vi.mock('node:fs/promises', async (orig) => {
  const real = await orig<typeof import('node:fs/promises')>()
  return {
    ...real,
    readFile: async (...a: Parameters<typeof real.readFile>) => {
      const out = await real.readFile(...a)
      if (fault.damageReadBack && String(a[0]).endsWith('.tmp') && typeof out !== 'string') {
        const b = Buffer.from(out)
        b[Math.floor(b.length / 2)] ^= 0xff
        return b
      }
      return out
    }
  }
})
import { FolderMissingError, cloudFolderCandidates, createSyncFolderStore, isEncryptedCopy, type SecretBox } from './syncFolderStore'

const snap = (tasks = 3, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 2,
    exportedAt: '2026-11-18T10:00:00.000Z',
    tables: { tasks: Array.from({ length: tasks }, (_, i) => ({ id: i + 1, title: `Made-up task ${i + 1}` })), settings: [{ key: 'theme', value: '"dark"' }] },
    financeState: { tx: [{ id: 't1', amount: 5 }] },
    sportState: { exercises: [{ id: 'e1', name: 'Push-ups' }] },
    ...extra
  })
const sqlite = (n = 1) => new Uint8Array(Buffer.from(`SQLite format 3\0 made-up database ${n} `.repeat(40)))
const memorySecret = (): SecretBox & { value: string | null; broken: boolean } => {
  const box = {
    value: null as string | null,
    broken: false,
    available: () => true,
    load: async () => {
      if (box.broken) throw new Error('cannot read')
      return box.value
    },
    save: async (p: string) => void (box.value = p),
    clear: async () => void (box.value = null)
  }
  return box
}

let base: string
let userData: string
let folder: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'ls-sync-'))
  userData = join(base, 'userData')
  folder = join(base, 'OneDrive')
  mkdirSync(userData)
  mkdirSync(folder)
  fault.damageReadBack = false
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

const make = (o: { name?: string; secret?: SecretBox; data?: string } = {}) => createSyncFolderStore({ userData: o.data ?? userData, version: '1.4.9999', deviceName: o.name ?? 'Test PC', secret: o.secret })
const NOW = new Date('2026-11-18T10:00:00Z')
const plus = (min: number) => new Date(NOW.getTime() + min * 60_000)

describe('sync folder files', () => {
  it('is off until a folder is chosen, and refuses a folder that does not exist', async () => {
    const s = make()
    expect(await s.status()).toMatchObject({ enabled: false, folder: null, versions: 0, error: null })
    await expect(s.write({ json: snap(), sqlite: sqlite() })).rejects.toThrow(/No sync folder/)
    await expect(s.setFolder(join(base, 'nowhere'))).rejects.toThrow(/not found/)
    expect((await s.setFolder(folder)).enabled).toBe(true)
  })

  it('writes one complete copy under its real name only after it was checked, and leaves no temp file', async () => {
    const s = make()
    await s.setFolder(folder)
    const st = await s.write({ json: snap(), sqlite: sqlite() }, NOW)
    const dir = join(folder, SYNC_ROOT, st.device)
    expect(readdirSync(dir)).toEqual([copyName(NOW)])
    expect(readdirSync(dir).some(isTempName)).toBe(false)
    expect(existsSync(join(folder, SYNC_ROOT, 'README.txt'))).toBe(true)
    expect(st).toMatchObject({ lastWrite: NOW.toISOString(), lastVerifiedOk: true, versions: 1, error: null, missing: false })
    expect(st.sizeBytes).toBeGreaterThan(0)

    // The zip opens with any zip reader, and the manifest's SHA-256 of each file is the file's real SHA-256.
    const bytes = new Uint8Array(readFileSync(join(dir, copyName(NOW))))
    expect(looksLikeZip(bytes)).toBe(true)
    const files = new Map<string, Uint8Array>()
    for (const i of listZip(bytes)) files.set(i.name, await readZipEntry(i, (u8) => new Uint8Array(inflateRawSync(u8))))
    expect([...files.keys()].sort()).toEqual(['README.txt', 'backup.json', 'life-system.sqlite', 'manifest.json'])
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')!))
    expect(manifest).toMatchObject({ kind: 'sync-folder', appVersion: '1.4.9999', madeAt: NOW.toISOString(), rows: 4, tables: { tasks: 3, settings: 1 }, device: { name: 'Test PC' } })
    expect(manifest.apps.map((a: { field: string }) => a.field)).toEqual(['financeState', 'sportState'])
    for (const f of manifest.files) {
      expect(f.sha256).toBe(createHash('sha256').update(files.get(f.name)!).digest('hex'))
      expect(f.bytes).toBe(files.get(f.name)!.length)
    }
    expect(new TextDecoder().decode(files.get('backup.json')!)).toBe(snap())
  })

  it('a copy that fails its check never gets a real name, and the last good copy stays', async () => {
    const s = make()
    await s.setFolder(folder)
    const st = await s.write({ json: snap(1), sqlite: sqlite(1) }, NOW)
    const dir = join(folder, SYNC_ROOT, st.device)
    fault.damageReadBack = true
    await expect(s.write({ json: snap(2), sqlite: sqlite(2) }, plus(1))).rejects.toThrow(/did not pass its check/)
    fault.damageReadBack = false
    expect(readdirSync(dir)).toEqual([copyName(NOW)])
    const after = await s.status()
    expect(after.lastVerifiedOk).toBe(false)
    expect(after.error).toMatch(/did not pass its check/)
    expect(after.lastWrite).toBe(NOW.toISOString())
    // The next good copy clears the error.
    expect(await s.write({ json: snap(2), sqlite: sqlite(2) }, plus(61))).toMatchObject({ lastVerifiedOk: true, error: null, versions: 2 })
  })

  it('a missing folder (USB removed, cloud drive paused) is said clearly, never made up again, and works when it is back', async () => {
    const s = make()
    await s.setFolder(folder)
    await s.write({ json: snap(), sqlite: sqlite() }, NOW)
    const away = join(base, 'unplugged')
    renameSync(folder, away)
    await expect(s.write({ json: snap(5), sqlite: sqlite(2) }, plus(1))).rejects.toBeInstanceOf(FolderMissingError)
    expect(existsSync(folder)).toBe(false)
    const st = await s.status()
    expect(st).toMatchObject({ enabled: true, missing: true, lastWrite: NOW.toISOString(), versions: 0 })
    expect(await s.reachable()).toBe(false)
    expect(await s.list()).toEqual([])
    await expect(s.preview(`${st.device}/${copyName(NOW)}`)).rejects.toBeInstanceOf(FolderMissingError)
    renameSync(away, folder)
    expect(await s.write({ json: snap(5), sqlite: sqlite(2) }, plus(62))).toMatchObject({ missing: false, versions: 2, lastVerifiedOk: true, lastWrite: plus(62).toISOString() })
  })

  it('thins old versions by the rule, and never touches other files or another PC', async () => {
    const s = make()
    await s.setFolder(folder)
    const dev = (await s.status()).device
    const dir = join(folder, SYNC_ROOT, dev)
    const other = join(folder, SYNC_ROOT, 'Laptop-ffffff')
    mkdirSync(other, { recursive: true })
    writeFileSync(join(other, copyName(new Date('2025-01-01T00:00:00Z'))), 'another PC')
    // A copy every 30 minutes for 30 hours.
    for (let i = 0; i < 60; i++) await s.write({ json: snap(i + 1), sqlite: sqlite(i) }, plus(i * 30))
    writeFileSync(join(dir, 'my-notes.txt'), 'mine')
    writeFileSync(join(dir, '.~life-sync-20200101T000000Z.zip.tmp'), 'left by a crash')
    utimesSync(join(dir, '.~life-sync-20200101T000000Z.zip.tmp'), new Date('2020-01-01'), new Date('2020-01-01'))
    await s.write({ json: snap(999), sqlite: sqlite(999) }, plus(60 * 30))
    const names = readdirSync(dir)
    const copies = names.filter((n) => parseCopyName(n))
    // 24 hourly (both days are among them); the newest is there.
    expect(copies.length).toBe(24)
    expect(copies).toContain(copyName(plus(60 * 30)))
    expect(names).toContain('my-notes.txt')
    expect(names.some(isTempName)).toBe(false)
    expect(readdirSync(other).length).toBe(1)
    const st = await s.status()
    expect(st.versions).toBe(24)
    expect(st.others).toEqual([{ device: 'Laptop-ffffff', lastWrite: '2025-01-01T00:00:00.000Z', versions: 1 }])
  }, 60_000)

  it('shows a version before a restore (date, counts, apps) and hands the restore the exact backup JSON', async () => {
    const s = make()
    await s.setFolder(folder)
    await s.write({ json: snap(3), sqlite: sqlite(1) }, NOW)
    await s.write({ json: snap(7), sqlite: sqlite(2), meta: { schemaVersion: 71, tables: { tasks: 7, settings: 1 }, apps: [] } }, plus(90))
    const list = await s.list()
    expect(list.map((v) => v.at)).toEqual([plus(90).toISOString(), NOW.toISOString()])
    expect(list.every((v) => v.mine && !v.encrypted && v.sizeBytes > 0)).toBe(true)
    const p = await s.preview(list[1].id)
    expect(p).toMatchObject({ at: NOW.toISOString(), device: 'Test PC', appVersion: '1.4.9999', rows: 4, tables: { tasks: 3, settings: 1 }, encrypted: false })
    expect((await s.preview(list[0].id)).schemaVersion).toBe(71)
    expect(await s.read(list[1].id)).toBe(snap(3))
    await expect(s.read('../../etc/passwd')).rejects.toThrow(/No such copy/)
    await expect(s.read(`${list[0].device}/life-sync-20000101T000000Z.zip`)).rejects.toThrow(/No such copy/)
  })

  it('refuses a copy whose bytes changed in the folder (a damaged or half-synced file)', async () => {
    const s = make()
    await s.setFolder(folder)
    const st = await s.write({ json: snap(), sqlite: sqlite() }, NOW)
    const file = join(folder, SYNC_ROOT, st.device, copyName(NOW))
    const b = readFileSync(file)
    b[60] ^= 0xff
    writeFileSync(file, b)
    const id = `${st.device}/${copyName(NOW)}`
    await expect(s.preview(id)).rejects.toThrow()
    await expect(s.read(id)).rejects.toThrow()
    writeFileSync(file, b.subarray(0, Math.floor(b.length / 2)))
    await expect(s.read(id)).rejects.toThrow()
  })

  it('knows when nothing changed since the last copy', async () => {
    const s = make()
    await s.setFolder(folder)
    const meta = { schemaVersion: 1, tables: { tasks: 3 }, apps: [{ field: 'financeState', label: 'Finance', size: 10, sum: 'abc' }] }
    expect(await s.unchanged(sqlite(1), meta.apps)).toBe(false)
    await s.write({ json: snap(), sqlite: sqlite(1), meta }, NOW)
    expect(await s.unchanged(sqlite(1), meta.apps)).toBe(true)
    expect(await s.unchanged(sqlite(1), null)).toBe(true)
    expect(await s.unchanged(sqlite(2), meta.apps)).toBe(false)
    expect(await s.unchanged(sqlite(1), [{ ...meta.apps[0], sum: 'changed' }])).toBe(false)
    // Another folder starts with a first copy.
    const second = join(base, 'USB')
    mkdirSync(second)
    await s.setFolder(second)
    expect(await s.unchanged(sqlite(1), meta.apps)).toBe(false)
  })

  it('remembers the folder and this PC across restarts; another PC gets its own folder', async () => {
    const a = make()
    await a.setFolder(folder)
    const st = await a.write({ json: snap(), sqlite: sqlite() }, NOW)
    const again = make()
    expect(await again.status()).toMatchObject({ enabled: true, folder, device: st.device, lastWrite: NOW.toISOString(), versions: 1 })
    const otherData = join(base, 'otherUserData')
    mkdirSync(otherData)
    const b = make({ name: 'Laptop', data: otherData })
    await b.setFolder(folder)
    const sb = await b.write({ json: snap(9), sqlite: sqlite(9) }, plus(5))
    expect(sb.device).not.toBe(st.device)
    expect(sb.others.map((o) => o.device)).toEqual([st.device])
    const all = await b.list()
    expect(all.map((v) => v.mine)).toEqual([true, false])
    // The other PC's copy can be previewed (and restored), never changed.
    expect((await b.preview(all[1].id)).device).toBe('Test PC')
    expect(readdirSync(join(folder, SYNC_ROOT, st.device))).toEqual([copyName(NOW)])
  })
})

describe('sync folder encryption', () => {
  it('is off by default; on, the file is not readable without the passphrase and opens with it', async () => {
    const secret = memorySecret()
    const s = make({ secret })
    await s.setFolder(folder)
    expect((await s.status()).encrypt).toBe(false)
    await expect(s.setEncryption(true)).rejects.toThrow(/passphrase first/)
    await expect(s.setEncryption(true, 'short')).rejects.toThrow(/8 characters/)
    expect((await s.setEncryption(true, 'correct horse battery')).encrypt).toBe(true)
    const st = await s.write({ json: snap(), sqlite: sqlite() }, NOW)
    const name = copyName(NOW, true)
    const bytes = new Uint8Array(readFileSync(join(folder, SYNC_ROOT, st.device, name)))
    expect(isEncryptedCopy(bytes)).toBe(true)
    expect(looksLikeZip(bytes)).toBe(false)
    expect(Buffer.from(bytes).includes(Buffer.from('Made-up task'))).toBe(false)
    expect(Buffer.from(bytes).includes(Buffer.from('correct horse'))).toBe(false)
    const id = `${st.device}/${name}`
    expect((await s.preview(id)).encrypted).toBe(true)
    expect(await s.read(id)).toBe(snap())
    // The passphrase is not in the settings file.
    expect(readFileSync(join(userData, 'sync-folder.json'), 'utf8')).not.toContain('correct horse')

    // A new PC without the passphrase can list it but not open it; a wrong passphrase is refused.
    const otherData = join(base, 'newPc')
    mkdirSync(otherData)
    const fresh = memorySecret()
    const n = make({ name: 'New PC', data: otherData, secret: fresh })
    await n.setFolder(folder)
    expect((await n.list()).length).toBe(1)
    await expect(n.read(id)).rejects.toThrow(/passphrase/)
    await expect(n.setEncryption(false, 'wrong passphrase!')).rejects.toThrow(/does not open/)
    expect(fresh.value).toBeNull()
    await n.setEncryption(false, 'correct horse battery')
    expect(await n.read(id)).toBe(snap())
  }, 30_000)

  it('never writes a plain copy when the passphrase cannot be read', async () => {
    const secret = memorySecret()
    const s = make({ secret })
    await s.setFolder(folder)
    await s.setEncryption(true, 'correct horse battery')
    secret.broken = true
    await expect(s.write({ json: snap(), sqlite: sqlite() }, NOW)).rejects.toThrow(/passphrase/)
    const dev = (await s.status()).device
    expect(existsSync(join(folder, SYNC_ROOT, dev)) ? readdirSync(join(folder, SYNC_ROOT, dev)) : []).toEqual([])
    // Turned off: plain copies again; the old encrypted ones stay readable with the saved passphrase.
    secret.broken = false
    await s.write({ json: snap(), sqlite: sqlite() }, NOW)
    await s.setEncryption(false)
    await s.write({ json: snap(2), sqlite: sqlite(2) }, plus(61))
    const list = await s.list()
    expect(list.map((v) => v.encrypted)).toEqual([false, true])
    expect(await s.read(list[1].id)).toBe(snap())
  }, 30_000)
})

describe('sync folder suggestions', () => {
  it('lists the usual OneDrive, Google Drive, Dropbox and iCloud folders once each', () => {
    const c = cloudFolderCandidates({ OneDrive: 'C:\\Users\\made-up\\OneDrive', OneDriveConsumer: 'C:\\Users\\made-up\\OneDrive' }, 'C:\\Users\\made-up', 'win32', JSON.stringify({ personal: { path: 'D:\\Dropbox' } }))
    expect(c[0]).toEqual({ label: 'OneDrive', path: 'C:\\Users\\made-up\\OneDrive' })
    expect(c.filter((x) => x.path === 'C:\\Users\\made-up\\OneDrive').length).toBe(1)
    expect(c.some((x) => x.label === 'Dropbox' && x.path === 'D:\\Dropbox')).toBe(true)
    expect(c.some((x) => x.label === 'Google Drive' && x.path === 'G:\\My Drive')).toBe(true)
    expect(cloudFolderCandidates({}, '/home/made-up', 'linux', 'not json').some((x) => x.label === 'Dropbox')).toBe(true)
  })
})
