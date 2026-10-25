// Updates from GitHub Releases of the private MEGA-SYSTEM repo. The token is
// read from the GitHub CLI login on this PC (`gh auth token`) when needed;
// nothing secret is stored in the app.
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
    execFile(ghPath(), ['auth', 'token'], { windowsHide: true, timeout: 10_000 }, (err, stdout) => {
      const token = stdout?.trim()
      if (err || !token) reject(new Error('Sign in to GitHub on this PC first: run "gh auth login" once.'))
      else resolve(token)
    })
  })
}

export class Updater {
  private status: UpdateStatus = { current: app.getVersion(), state: app.isPackaged ? 'idle' : 'dev', latest: null, progress: 0, error: null, checkedAt: null }

  /** `beforeQuit` lets the app close for real (not hide to the tray) during an update. */
  constructor(private onChange: (s: UpdateStatus) => void, private beforeQuit: () => void) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('download-progress', (p) => this.set({ state: 'downloading', progress: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', () => this.set({ state: 'ready', progress: 100 }))
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

  async check(): Promise<UpdateStatus> {
    if (!app.isPackaged) return this.set({ state: 'dev', error: 'Updates work in the installed app' })
    if (this.status.state === 'downloading' || this.status.state === 'ready') return this.status
    this.set({ state: 'checking', error: null })
    try {
      await this.feed()
      const r = await autoUpdater.checkForUpdates()
      const latest = r?.updateInfo.version ?? null
      const newer = !!r?.isUpdateAvailable
      return this.set({ state: newer ? 'available' : 'up-to-date', latest, checkedAt: new Date().toISOString() })
    } catch (e) {
      return this.set({ state: 'error', error: (e as Error).message.split('\n')[0], checkedAt: new Date().toISOString() })
    }
  }

  /** Downloads the newer version; when it's in, installs it and restarts. */
  async update(): Promise<UpdateStatus> {
    if (this.status.state === 'ready') return this.install()
    const s = this.status.state === 'available' ? this.status : await this.check()
    if (s.state !== 'available') return s
    this.set({ state: 'downloading', progress: 0 })
    try {
      await autoUpdater.downloadUpdate()
      return this.install()
    } catch (e) {
      return this.set({ state: 'error', error: (e as Error).message.split('\n')[0] })
    }
  }

  install(): UpdateStatus {
    // Silent install, then start the new version.
    this.beforeQuit()
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
    return this.set({ state: 'installing' })
  }
}
