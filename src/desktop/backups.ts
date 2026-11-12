// Local backups on this computer (2026-11-12): a full backup .zip every day and
// before each risky step, in a folder you choose (default
// Documents/LifeSystem/Backups), plus a daily copy in Google Drive when found.
// The file logic is localBackups.ts (no Electron, tested); this wires it to
// Electron: the folders, the dialogs, and this PC's database file.
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { calendarDay } from '../core/dates'
import { createLocalBackups, type BackupStatus, type BackupWhere } from './localBackups'

export type { BackupFile, BackupStatus, BackupWhere } from './localBackups'

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

/**
 * `dbFile` = this PC's database copy (life-local.sqlite); `beforeRead` waits
 * for a save in progress so the copy in the zip is whole.
 */
export function createBackups(userData: string, dbFile: string, beforeRead: () => Promise<unknown> = async () => {}) {
  const local = createLocalBackups({ userData, documents: app.getPath('documents'), driveCandidates, version: app.getVersion() })
  const dbBytes = async (): Promise<Uint8Array | null> => {
    await beforeRead()
    return existsSync(dbFile) ? new Uint8Array(await readFile(dbFile)) : null
  }

  // A new app version may change the database (migrations add tables and columns):
  // this PC's database copy is kept first, as a "before" backup.
  void local.versionChanged(app.getVersion()).then(async (changed) => {
    if (!changed) return
    const sqlite = await dbBytes()
    if (sqlite) await local.write({ sqlite, day: calendarDay(new Date()), reason: `update to ${app.getVersion()}` }).catch(() => {})
  })

  return {
    status: (): Promise<BackupStatus> => local.status(),
    /** Writes a backup: the app window sends the JSON (everything); this PC's database file goes in too. */
    async write(text: string, day: string, reason?: string | null): Promise<BackupStatus> {
      if (typeof text !== 'string' || text.length > 400 * 1024 * 1024) throw new Error('Invalid backup')
      return local.write({ json: text, sqlite: await dbBytes(), day, reason: typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 60) : null })
    },
    read: (where: BackupWhere, name: string): Promise<Uint8Array> => local.read(where, name),
    /** Choose the backup folder (where === 'local') or the Google Drive folder. */
    async choose(win: BrowserWindow, where: 'local' | 'drive' = 'drive'): Promise<BackupStatus> {
      const r = await dialog.showOpenDialog(win, {
        title: where === 'local' ? 'Choose the folder for your backups' : 'Choose your Google Drive folder (e.g. G:\\My Drive)',
        properties: ['openDirectory', 'createDirectory']
      })
      if (r.canceled || !r.filePaths[0]) return local.status()
      return where === 'local' ? local.setLocalDir(r.filePaths[0]) : local.setDriveDir(r.filePaths[0])
    },
    /** Back to the default folder (Documents/LifeSystem/Backups). */
    resetLocal: (): Promise<BackupStatus> => local.setLocalDir(null),
    async open(where: BackupWhere): Promise<void> {
      const dir = local.dir(where)
      if (!dir) return
      await mkdir(dir, { recursive: true }).catch(() => {})
      await shell.openPath(dir)
    }
  }
}
