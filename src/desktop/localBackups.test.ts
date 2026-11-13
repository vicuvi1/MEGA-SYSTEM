// Local backups on the desktop (2026-11-12): written to a temp folder here (no
// Electron, no real Documents folder), so the test runs the same on Windows and Linux.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { listZip, readZipEntry } from '../core/zip'
import { DRIVE_FOLDER, FOLDER, OLD_FOLDER, buildBackupZip, createLocalBackups, verifyBackupZip } from './localBackups'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'life-backups-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const backup = (n = 3) => JSON.stringify({ version: 2, exportedAt: '2026-11-12T08:00:00Z', tables: { tasks: Array.from({ length: n }, (_, i) => ({ id: i + 1, title: `made-up ${i}` })) }, financeState: { tx: [{ id: 't1', amount: 1250 }] } })
const sqlite = new Uint8Array([83, 81, 76, 105, 116, 101, 32, 102, 111, 114, 109, 97, 116, 32, 51, 0, 1, 2, 3])
const at = (day: string, hh = 9) => new Date(`${day}T${String(hh).padStart(2, '0')}:30:00`)
const inflate = (u8: Uint8Array) => new Uint8Array(inflateRawSync(u8))

describe('local backup files', () => {
  it('a zip anyone can open: backup.json, the database file, a manifest with checksums and a README', async () => {
    const { name, bytes } = await buildBackupZip({ json: backup(), sqlite, day: '2026-11-12' }, at('2026-11-12'), '1.4.1460')
    expect(name).toBe('life-system-2026-11-12.zip')
    await verifyBackupZip(bytes)
    const items = listZip(bytes)
    expect(items.map((i) => i.name)).toEqual(['backup.json', 'life-system.sqlite', 'manifest.json', 'README.txt'])
    expect(JSON.parse(new TextDecoder().decode(await readZipEntry(items[0], inflate)))).toEqual(JSON.parse(backup()))
    expect([...(await readZipEntry(items[1], inflate))]).toEqual([...sqlite])
    const manifest = JSON.parse(new TextDecoder().decode(await readZipEntry(items[2], inflate)))
    expect(manifest).toMatchObject({ app: 'Life System', kind: 'daily', day: '2026-11-12', version: '1.4.1460' })
    expect(manifest.digest.tables.tasks.rows).toBe(3)
    expect(manifest.digest.blobs.financeState.sum).toBeTruthy()
    // A damaged file is caught.
    const broken = bytes.slice()
    broken[60] ^= 0xff
    await expect(verifyBackupZip(broken)).rejects.toThrow()
  })

  it('writes to Documents/LifeSystem/Backups by default, offline, with a copy in Google Drive', async () => {
    const drive = join(root, 'GoogleDrive')
    writeFileSync(join(root, 'marker'), '')
    const docs = join(root, 'Documents')
    const b = createLocalBackups({ userData: root, documents: docs, driveCandidates: () => [join(root, 'nope'), drive] })
    // No Drive folder yet: only the PC folder.
    let s = await b.write({ json: backup(), sqlite, day: '2026-11-12' }, at('2026-11-12'))
    expect(s.local.dir).toBe(join(docs, FOLDER))
    expect(s.local.files.map((f) => f.name)).toEqual(['life-system-2026-11-12.zip'])
    expect(s).toMatchObject({ lastDay: '2026-11-12', lastFile: 'life-system-2026-11-12.zip', lastError: null })
    expect(s.drive.dir).toBeNull()
    // Drive for desktop appears: the next daily goes there too.
    rmSync(join(root, 'marker'))
    const { mkdirSync } = await import('node:fs')
    mkdirSync(drive)
    s = await b.write({ json: backup(4), day: '2026-11-13' }, at('2026-11-13'))
    expect(s.drive.files.map((f) => f.name)).toEqual(['life-system-2026-11-13.zip'])
    expect(existsSync(join(drive, DRIVE_FOLDER, 'life-system-2026-11-13.zip'))).toBe(true)
    // Read back for a restore.
    const bytes = await b.read('local', 'life-system-2026-11-12.zip')
    await verifyBackupZip(bytes)
    await expect(b.read('local', '../secret.txt')).rejects.toThrow('No such backup')
  })

  it('a chosen folder is used and remembered; the old folder is listed, never touched', async () => {
    const docs = join(root, 'Documents')
    const mine = join(root, 'D-drive', 'My backups')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(docs, OLD_FOLDER), { recursive: true })
    writeFileSync(join(docs, OLD_FOLDER, 'life-system-2025-01-01.json'), backup())
    const b = createLocalBackups({ userData: root, documents: docs })
    await b.setLocalDir(mine)
    await b.write({ json: backup(), day: '2026-11-12' }, at('2026-11-12'))
    const again = createLocalBackups({ userData: root, documents: docs })
    const s = await again.status()
    expect(s.local).toMatchObject({ dir: mine, chosen: true })
    expect(s.local.files).toHaveLength(1)
    expect(s.old.files.map((f) => f.name)).toEqual(['life-system-2025-01-01.json'])
    expect(new TextDecoder().decode(await again.read('old', 'life-system-2025-01-01.json'))).toBe(backup())
  })

  it('rotation: after 400 days of daily backups 14 daily, 8 weekly and 12 monthly are left; "before" backups stay too', async () => {
    const docs = join(root, 'Documents')
    const b = createLocalBackups({ userData: root, documents: docs })
    const start = Date.parse('2025-10-08T09:00:00')
    const json = backup(1)
    // Old days are dropped into the folder as files (fast), then real writes run the rotation.
    const dir = join(docs, FOLDER)
    const { mkdirSync } = await import('node:fs')
    mkdirSync(dir, { recursive: true })
    const { bytes } = await buildBackupZip({ json, day: '2025-10-08' }, new Date(start))
    for (let i = 0; i < 398; i++) writeFileSync(join(dir, `life-system-${new Date(start + i * 864e5).toISOString().slice(0, 10)}.zip`), bytes)
    await b.write({ json, day: '2026-11-10', reason: 'Finance re-price' }, at('2026-11-10', 14))
    writeFileSync(join(dir, 'holiday-photos.zip'), 'not ours')
    const s = await b.write({ json, day: '2026-11-12' }, at('2026-11-12'))
    const names = readdirSync(dir)
    expect(names).toContain('holiday-photos.zip')
    expect(names).toContain('life-system-2026-11-10-143000-before-finance-re-price.zip')
    const daily = s.local.files.filter((f) => f.kind === 'daily')
    expect(daily.length).toBeLessThanOrEqual(14 + 8 + 12)
    expect(daily.length).toBeGreaterThanOrEqual(26)
    expect(daily[0].day).toBe('2026-11-12')
    expect(new Set(daily.map((f) => f.day.slice(0, 7))).size).toBeGreaterThanOrEqual(12)
    const risk = s.local.files.find((f) => f.kind === 'risk')!
    expect(risk).toMatchObject({ before: 'finance re price', time: '14:30', day: '2026-11-10' })
    // The temp file never stays behind.
    expect(names.some((n) => n.endsWith('.tmp'))).toBe(false)
  }, 60_000) // 400 files: 13.7 s on the Windows release runner (antivirus scans each write)

  it('a failed write is kept as a visible error and thrown, never silent', async () => {
    const docs = join(root, 'Documents')
    // The backup folder is a file: it can't be written.
    writeFileSync(join(root, 'blocked'), 'x')
    const b = createLocalBackups({ userData: root, documents: docs })
    await b.setLocalDir(join(root, 'blocked'))
    await expect(b.write({ json: backup(), day: '2026-11-12' }, at('2026-11-12'))).rejects.toThrow(/Backup folder/)
    const s = await b.status()
    expect(s.lastError).toMatch(/Backup folder/)
    expect(s.lastDay).toBeNull()
    expect(JSON.parse(await readFile(join(root, 'backups.json'), 'utf8')).lastError).toMatch(/Backup folder/)
  })

  it('a new app version is noticed once (a "before update" backup is made then)', async () => {
    const b = createLocalBackups({ userData: root, documents: join(root, 'Documents') })
    expect(await b.versionChanged('1.0.0')).toBe(false)
    expect(await b.versionChanged('1.0.0')).toBe(false)
    expect(await b.versionChanged('1.0.1')).toBe(true)
    expect(await b.versionChanged('1.0.1')).toBe(false)
    const { name } = await buildBackupZip({ sqlite, day: '2026-11-12', reason: 'update to 1.0.1' }, at('2026-11-12'))
    expect(name).toBe('life-system-2026-11-12-093000-before-update-to-1-0-1.zip')
  })
})
