// Sync folder (desktop, 2026-11-18): a live copy of all data in a folder you
// choose, so the data stays whole even when the server is down. The files are
// syncFolderStore.ts (no Electron, tested); the pacing is core/syncFolder.ts.
// This wires them to Electron: the folder picker, the passphrase (safeStorage),
// quit / sleep / lock, and the app window (it holds the apps' own data, so it
// makes the backup JSON; this side adds the database file and writes the copy).
import { app, dialog, powerMonitor, safeStorage, shell, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { createPacer, type PaceResult, type SyncCopyMeta, type SyncFolderStatus, type SyncSuggestion } from '../core/syncFolder'
import { cloudFolderCandidates, createSyncFolderStore, type SecretBox } from './syncFolderStore'

const MAX_JSON = 400 * 1024 * 1024

/** What the app window sent, kept only in the shape the manifest needs. */
function cleanMeta(m: unknown): SyncCopyMeta | null {
  const x = m as Partial<SyncCopyMeta> | null
  if (!x || typeof x !== 'object' || typeof x.tables !== 'object' || !Array.isArray(x.apps)) return null
  const tables: Record<string, number> = {}
  for (const [t, n] of Object.entries(x.tables ?? {}).slice(0, 2000)) if (Number.isFinite(Number(n))) tables[String(t).slice(0, 80)] = Number(n)
  const apps = x.apps.slice(0, 20).map((a) => ({ field: String(a?.field ?? '').slice(0, 40), label: String(a?.label ?? '').slice(0, 40), size: Number(a?.size) || 0, sum: String(a?.sum ?? '').slice(0, 40) }))
  return { schemaVersion: Number.isFinite(Number(x.schemaVersion)) && x.schemaVersion != null ? Number(x.schemaVersion) : null, tables, apps }
}

export interface SyncFolderWiring {
  userData: string
  /** This PC's database file (life-local.sqlite). */
  dbFile: string
  /** Waits for a save in progress, so the database file in the copy is whole. */
  beforeRead: () => Promise<unknown>
  win: BrowserWindow
  /** The app window's guarded IPC (main.ts `handle`). */
  handle: (name: string, fn: (...args: any[]) => unknown) => void
  /** The release check: nothing runs by itself. */
  smoke?: boolean
}

export function registerSyncFolder(o: SyncFolderWiring) {
  const keyFile = join(o.userData, 'sync-folder.key')
  // The passphrase never leaves this PC: Windows encrypts it for this user (safeStorage / DPAPI).
  const secret: SecretBox = {
    available: () => {
      try {
        return safeStorage.isEncryptionAvailable()
      } catch {
        return false
      }
    },
    load: async () => (existsSync(keyFile) ? safeStorage.decryptString(await readFile(keyFile)) : null),
    save: async (p) => writeFile(keyFile, safeStorage.encryptString(p)),
    clear: async () => void (await unlink(keyFile).catch(() => {}))
  }
  const store = createSyncFolderStore({ userData: o.userData, version: app.getVersion(), deviceName: hostname(), secret })
  const dbBytes = async (): Promise<Uint8Array | null> => {
    await o.beforeRead()
    return existsSync(o.dbFile) ? new Uint8Array(await readFile(o.dbFile)) : null
  }
  const changed = () => {
    if (!o.win.isDestroyed()) o.win.webContents.send('syncFolder:changed')
  }

  /** The app window answers a "want" by sending the backup JSON; this is that answer. */
  let answer: ((r: PaceResult) => void) | null = null
  /** An app's own data changed (it is not in the database file, so the file's checksum can't tell). */
  let appsTouched = true
  const pacer = createPacer({
    lastSize: () => store.lastSize,
    run: async () => {
      await store.ready
      if (!store.folder) return 'skipped'
      if (!(await store.reachable())) {
        changed()
        return 'failed'
      }
      if (o.win.isDestroyed()) return 'failed'
      if (!appsTouched && (await store.unchanged(await dbBytes(), null))) return 'skipped'
      return new Promise<PaceResult>((resolve) => {
        const t = setTimeout(() => done('failed'), 25_000)
        const done = (r: PaceResult) => {
          clearTimeout(t)
          if (answer === done) answer = null
          resolve(r)
        }
        answer = done
        o.win.webContents.send('syncFolder:want')
      })
    }
  })

  async function write(json: unknown, meta: unknown, force: boolean): Promise<SyncFolderStatus> {
    if (typeof json !== 'string' || json.length > MAX_JSON) throw new Error('Invalid copy')
    const m = cleanMeta(meta)
    const reply = answer
    try {
      const sqlite = await dbBytes()
      if (!force && m && (await store.unchanged(sqlite, m.apps))) {
        appsTouched = false
        reply?.('skipped')
        return await store.status()
      }
      const s = await store.write({ json, sqlite, meta: m })
      appsTouched = false
      reply?.('ok')
      return s
    } catch (e) {
      reply?.('failed')
      throw e
    } finally {
      changed()
    }
  }

  const suggestions = async (): Promise<SyncSuggestion[]> => {
    const local = process.env.LOCALAPPDATA ?? process.env.APPDATA
    const info = local ? await readFile(join(local, 'Dropbox', 'info.json'), 'utf8').catch(() => null) : null
    return cloudFolderCandidates(process.env, homedir(), process.platform, info).filter((c) => existsSync(c.path))
  }

  o.handle('syncFolder:status', () => store.status())
  o.handle('syncFolder:suggestions', () => suggestions())
  // A path is taken only when it is one of the suggestions found on this PC; anything else goes through the folder picker.
  o.handle('syncFolder:choose', async (path?: unknown) => {
    let folder: string | null = null
    const found = await suggestions()
    if (typeof path === 'string' && found.some((s) => s.path === path)) folder = path
    else {
      const r = await dialog.showOpenDialog(o.win, {
        title: 'Choose the sync folder (OneDrive, Google Drive, Dropbox, a USB drive…)',
        defaultPath: store.folder ?? found[0]?.path,
        properties: ['openDirectory', 'createDirectory']
      })
      folder = r.canceled ? null : r.filePaths[0] ?? null
    }
    if (!folder) return store.status()
    const s = await store.setFolder(folder)
    appsTouched = true
    void pacer.flush('chosen', true)
    return s
  })
  o.handle('syncFolder:off', async () => {
    pacer.stop()
    return store.setFolder(null)
  })
  o.handle('syncFolder:write', (json: unknown, meta: unknown, force?: unknown) => write(json, meta, force === true))
  o.handle('syncFolder:touch', () => {
    appsTouched = true
    if (store.folder) pacer.touch()
  })
  o.handle('syncFolder:list', () => store.list())
  o.handle('syncFolder:preview', (id: unknown) => store.preview(String(id)))
  o.handle('syncFolder:read', (id: unknown) => store.read(String(id)))
  o.handle('syncFolder:encrypt', async (on: unknown, pass?: unknown) => {
    const s = await store.setEncryption(on === true, typeof pass === 'string' ? pass : null)
    appsTouched = true
    void pacer.flush('encryption', true)
    return s
  })
  o.handle('syncFolder:open', async () => {
    const dir = store.dir()
    if (dir && existsSync(dir)) await shell.openPath(dir)
    else if (store.folder && existsSync(store.folder)) await shell.openPath(store.folder)
  })

  // Quit: one last copy first (a few seconds at most), then the app really quits.
  let quitFlushed = !!o.smoke
  app.on('before-quit', (event) => {
    if (quitFlushed || !store.folder || !pacer.dirty || o.win.isDestroyed()) return
    quitFlushed = true
    event.preventDefault()
    void Promise.race([pacer.flush('quit'), new Promise((r) => setTimeout(r, 8000))]).finally(() => app.quit())
  })
  if (!o.smoke) {
    // Sleep and lock: copy what waits now. Waking up: try again if the folder was missing.
    powerMonitor.on('suspend', () => void pacer.flush('sleep'))
    powerMonitor.on('lock-screen', () => void pacer.flush('lock'))
    powerMonitor.on('resume', () => void pacer.flush('wake'))
    powerMonitor.on('unlock-screen', () => void pacer.flush('unlock'))
    // On start: a copy if this PC's data is not the last one written.
    setTimeout(() => void pacer.flush('start', true), 30_000).unref?.()
  }

  return {
    /** The database file was just saved (every change ends here). */
    touch() {
      if (store.folder) pacer.touch()
    },
    /** An update is about to install and restart: don't hold the quit back. */
    skipQuitFlush() {
      quitFlushed = true
    }
  }
}
