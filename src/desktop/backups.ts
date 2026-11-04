// Daily backup files on this computer: Documents\Life System Backups and, when
// found (or chosen), a "Life System Backups" folder in Google Drive. One JSON
// file a day (the same format as Export and the cloud snapshots, so Restore
// takes any of them); the last 30 days plus the first of each month for a year.
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { backupDay, backupName, backupsToDelete } from '../core/backupPlan'

export type BackupWhere = 'local' | 'drive'
export interface BackupFile { name: string; day: string; size: number }
export interface BackupStatus {
  local: { dir: string; files: BackupFile[] }
  drive: { dir: string | null; chosen: boolean; files: BackupFile[] }
  lastDay: string | null
  lastAt: string | null
  lastError: string | null
}

const FOLDER = 'Life System Backups'

function driveCandidates(): string[] {
  const home = homedir()
  const out = [join(home, 'Google Drive', 'My Drive'), join(home, 'Google Drive'), join(home, 'My Drive')]
  if (process.platform === 'win32') for (const l of 'GHIJKLMNOPQRSTUVWXYZDEF') out.push(`${l}:\\My Drive`)
  if (process.platform === 'darwin') {
    const cloud = join(home, 'Library', 'CloudStorage')
    try {
      for (const d of readdirSync(cloud)) if (d.startsWith('GoogleDrive')) out.push(join(cloud, d, 'My Drive'))
    } catch { /* no Google Drive */ }
  }
  return out
}

function list(dir: string | null): BackupFile[] {
  if (!dir || !existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .map((name) => ({ name, day: backupDay(name) }))
      .filter((x): x is { name: string; day: string } => !!x.day)
      .map((x) => ({ ...x, size: statSync(join(dir, x.name)).size }))
      .sort((a, b) => b.day.localeCompare(a.day))
  } catch {
    return []
  }
}

export function createBackups(userData: string) {
  const prefFile = join(userData, 'backups.json')
  let pref: { driveDir?: string | null; lastDay?: string; lastAt?: string; lastError?: string | null } = {}
  const load = async () => {
    try { pref = JSON.parse(await readFile(prefFile, 'utf8')) } catch { pref = {} }
  }
  const savePref = () => writeFile(prefFile, JSON.stringify(pref)).catch(() => {})
  const ready = load()

  const localDir = () => join(app.getPath('documents'), FOLDER)
  const driveDir = (): string | null => {
    if (pref.driveDir) return existsSync(pref.driveDir) ? join(pref.driveDir, FOLDER) : null
    const base = driveCandidates().find((d) => existsSync(d))
    return base ? join(base, FOLDER) : null
  }

  async function writeTo(dir: string, name: string, text: string, today: string) {
    await mkdir(dir, { recursive: true })
    const file = join(dir, name)
    await writeFile(file + '.tmp', text)
    await rename(file + '.tmp', file)
    for (const old of backupsToDelete(list(dir).map((f) => f.name), today)) await unlink(join(dir, old)).catch(() => {})
  }

  return {
    async status(): Promise<BackupStatus> {
      await ready
      const d = driveDir()
      return { local: { dir: localDir(), files: list(localDir()) }, drive: { dir: d, chosen: !!pref.driveDir, files: list(d) }, lastDay: pref.lastDay ?? null, lastAt: pref.lastAt ?? null, lastError: pref.lastError ?? null }
    },
    /** Writes today's backup (both places); the app window sends the JSON. */
    async write(text: string, day: string): Promise<BackupStatus> {
      await ready
      if (typeof text !== 'string' || text.length > 300 * 1024 * 1024 || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid backup')
      const parsed = JSON.parse(text)
      if (!parsed || typeof parsed.tables !== 'object') throw new Error('Invalid backup')
      const errors: string[] = []
      await writeTo(localDir(), backupName(day), text, day).catch((e) => errors.push(`PC folder: ${(e as Error).message}`))
      const d = driveDir()
      if (d) await writeTo(d, backupName(day), text, day).catch((e) => errors.push(`Google Drive: ${(e as Error).message}`))
      pref.lastDay = day
      pref.lastAt = new Date().toISOString()
      pref.lastError = errors.length ? errors.join(' · ') : null
      await savePref()
      return this.status()
    },
    async read(where: BackupWhere, name: string): Promise<string> {
      await ready
      const dir = where === 'drive' ? driveDir() : localDir()
      if (!dir || !backupDay(String(name))) throw new Error('No such backup')
      return readFile(join(dir, name), 'utf8')
    },
    async choose(win: BrowserWindow): Promise<BackupStatus> {
      await ready
      const r = await dialog.showOpenDialog(win, { title: 'Choose your Google Drive folder (e.g. G:\\My Drive)', properties: ['openDirectory'] })
      if (!r.canceled && r.filePaths[0]) {
        pref.driveDir = r.filePaths[0]
        await savePref()
      }
      return this.status()
    },
    async open(where: BackupWhere): Promise<void> {
      await ready
      const dir = where === 'drive' ? driveDir() : localDir()
      if (!dir) return
      await mkdir(dir, { recursive: true }).catch(() => {})
      await shell.openPath(dir)
    }
  }
}
