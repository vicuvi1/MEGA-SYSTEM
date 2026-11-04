// Updates from GitHub Releases of the private MEGA-SYSTEM repo. The token is
// read from Git Credential Manager (or the GitHub CLI) on this PC when needed.
// Credentials never go to the renderer or into the bundled app.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/api'

const OWNER = 'vicuvi1'
const REPO = 'MEGA-SYSTEM'

function ghPath(): string {
  const installed = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'GitHub CLI', 'gh.exe')
  return existsSync(installed) ? installed : 'gh'
}

function ghToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const git = existsSync(join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'cmd', 'git.exe'))
      ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'cmd', 'git.exe') : 'git'
    const child = execFile(git, ['-c', 'credential.helper=', '-c', 'credential.helper=manager', '-c', 'credential.interactive=false', 'credential', 'fill'],
      { windowsHide: true, timeout: 15_000 }, (error, output) => {
        const password = output?.split(/\r?\n/).find((line) => line.startsWith('password='))?.slice(9)
        if (!error && password) { resolve(password); return }
        legacyToken().then(resolve, reject)
      })
    child.stdin?.end('protocol=https\nhost=github.com\nusername=vicuvi1\n\n')
  })
}

function legacyToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(ghPath(), ['auth', 'token'], { windowsHide: true, timeout: 10_000 }, (err, stdout) => {
      const token = stdout?.trim()
      if (err || !token) reject(new Error('Sign in to GitHub using the desktop app’s Sign in to GitHub button.'))
      else resolve(token)
    })
  })
}

/** The release's notes as one short plain line ("What's new"). */
function notesOf(raw: unknown): string | null {
  const text = (Array.isArray(raw) ? raw.map((x: any) => x?.note ?? '').join('\n') : String(raw ?? ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
  const line = text.split('\n').map((l) => l.trim()).find(Boolean)
  return line ? line.slice(0, 160) : null
}

export class Updater {
  private status: UpdateStatus = { current: app.getVersion(), state: app.isPackaged ? 'idle' : 'dev', latest: null, progress: 0, error: null, checkedAt: null }

  /** `beforeQuit` lets the app close for real (not hide to the tray) during an update. */
  constructor(private onChange: (s: UpdateStatus) => void, private beforeQuit: () => void) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', progress: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', () => this.set({ state: 'ready', progress: 100 }))
    autoUpdater.disableWebInstaller = true
    autoUpdater.on('error', (e) => this.set({ state: 'error', error: (e as Error).message.split('\n')[0] }))
  }

  private set(p: Partial<UpdateStatus>): UpdateStatus {
    this.status = { ...this.status, ...p }
    this.onChange(this.status)
    return this.status
  }

  get(): UpdateStatus {
    return this.status
  }

  private async feed(): Promise<void> {
    autoUpdater.setFeedURL({ provider: 'github', owner: OWNER, repo: REPO, private: true, token: await ghToken() })
  }

  /**
   * Looks for a newer version and, when there is one, downloads it quietly
   * in the background (with `download`), so updating is just a restart.
   */
  async check(download = true): Promise<UpdateStatus> {
    if (!app.isPackaged) return this.set({ state: 'dev', error: 'Updates work in the installed app' })
    if (this.status.state === 'downloading' || this.status.state === 'ready' || this.status.state === 'installing') return this.status
    this.set({ state: 'checking', error: null })
    try {
      await this.feed()
      const r = await autoUpdater.checkForUpdates()
      const latest = r?.updateInfo.version ?? null
      const newer = !!r?.isUpdateAvailable
      const s = this.set({ state: newer ? 'available' : 'up-to-date', latest, notes: newer ? notesOf(r?.updateInfo.releaseNotes) : null, checkedAt: new Date().toISOString() })
      if (newer && download) void this.download()
      return s
    } catch (e) {
      return this.set({ state: 'error', error: (e as Error).message.split('\n')[0], checkedAt: new Date().toISOString() })
    }
  }

  private downloading: Promise<boolean> | null = null
  /** Downloads in the background; installs by itself when the app quits (or on Restart to update). */
  private download(): Promise<boolean> {
    this.downloading ??= (async () => {
      this.set({ state: 'downloading', progress: 0 })
      try {
        await autoUpdater.downloadUpdate()
        this.set({ state: 'ready', progress: 100 })
        return true
      } catch (e) {
        this.set({ state: 'error', error: (e as Error).message.split('\n')[0] })
        return false
      } finally {
        this.downloading = null
      }
    })()
    return this.downloading
  }

  /** Downloads the newer version; when it's in, installs it and restarts. */
  async update(): Promise<UpdateStatus> {
    if (this.status.state === 'ready') return this.install()
    if (this.status.state === 'downloading') return (await this.download()) ? this.install() : this.status
    const s = this.status.state === 'available' ? this.status : await this.check(false)
    if (s.state !== 'available') return s
    return (await this.download()) ? this.install() : this.status
  }

  install(): UpdateStatus {
    // The window shows "Updating…" first, then a silent install starts the new version.
    const s = this.set({ state: 'installing' })
    this.beforeQuit()
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 900)
    return s
  }
}
