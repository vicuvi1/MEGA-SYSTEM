// Hosts Finance Helper inside Life System. The page and its desktop helpers
// (folder sync, Drive, Binance, Telegram) are Finance Helper's own files in
// apps/finance; this replaces only its main.cjs, wiring the same IPC calls.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, net, powerMonitor, safeStorage, session, shell, type WebContents } from 'electron'

export const FINANCE_PARTITION = 'persist:finance'
export const FINANCE_URL = 'app://finance/index.html'
const SERVED = ['index.html', 'manifest.webmanifest', 'sw.js', 'css/', 'js/', 'icons/', 'fonts/']
const FETCH_HOSTS = new Set(['open.er-api.com', 'www.bnm.md', 'api.binance.com', 'api.coingecko.com', 'api.github.com'])

export interface FinanceHost {
  preload: string
  /** Finance Helper's saved state as JSON text, or null if it can't be read. */
  readState(): Promise<string | null>
  /** Sends the "new record" signal the page listens for (Ctrl+Alt+N). */
  quickAdd(): void
}

export function setupFinance(appsDir: string, onShow: () => void): FinanceHost {
  const root = join(appsDir, 'finance')
  const dataDir = join(app.getPath('userData'), 'apps', 'finance')
  mkdirSync(dataDir, { recursive: true })
  const req = createRequire(join(root, 'electron', 'preload.cjs'))
  const version: string = JSON.parse(readFileSync(join(root, 'version.json'), 'utf8')).version

  // Finance Helper's helpers only ask `app` for paths; give them their own data folder.
  const fakeApp = new Proxy(app, {
    get(target, prop) {
      if (prop === 'getPath') return (name: Parameters<typeof app.getPath>[0]) => (name === 'userData' ? dataDir : target.getPath(name))
      if (prop === 'getVersion') return () => version
      const v = Reflect.get(target, prop)
      return typeof v === 'function' ? v.bind(target) : v
    }
  })

  // The page: served from app://finance in its own storage partition.
  const ses = session.fromPartition(FINANCE_PARTITION)
  ses.protocol.handle('app', (request) => {
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html'
    // An empty page on the same origin, so Life System can read Finance's saved data.
    if (rel === '__life-system-reader') return new Response('<!doctype html><title>reader</title>', { headers: { 'content-type': 'text/html' } })
    const file = normalize(join(root, rel))
    const allowed = SERVED.some((p) => (p.endsWith('/') ? rel.startsWith(p) : rel === p))
    if (!allowed || !file.startsWith(root + sep)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

  // Messages from main go to the Finance page only.
  let page: WebContents | null = null
  app.on('web-contents-created', (_e, wc) => {
    if (wc.getType() === 'webview' && wc.session === ses) {
      page = wc
      wc.on('destroyed', () => {
        if (page === wc) page = null
      })
    }
  })
  const toPage = (channel: string, data?: unknown) => page?.send(channel, data)
  const fromPage = (e: Electron.IpcMainInvokeEvent) => e.sender.session === ses
  // Every Finance channel only answers its own page.
  const handle = (channel: string, fn: (...a: never[]) => unknown) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (!fromPage(e)) throw new Error('Not allowed')
      return (fn as (...a: unknown[]) => unknown)(...args)
    })

  handle('fetch-text', async (url: string) => {
    const u = new URL(url)
    if (u.protocol !== 'https:' || !FETCH_HOSTS.has(u.hostname)) throw new Error(`Not allowed: ${u.hostname}`)
    const r = await net.fetch(url, { headers: { 'User-Agent': `FinanceHelper/${version}` } })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.text()
  })
  handle('app-info', () => ({ version, platform: process.platform, packaged: app.isPackaged }))

  const binance = req('./binance.cjs').createBinance({ app: fakeApp, net, safeStorage })
  handle('binance-status', () => binance.status())
  handle('binance-connect', async (key: string, secret: string) => {
    const k = String(key || '').trim()
    const s = String(secret || '').trim()
    if (!/^[A-Za-z0-9]{20,128}$/.test(k) || !/^[A-Za-z0-9]{20,128}$/.test(s)) throw new Error("That doesn't look like a Binance API key and secret.")
    binance.saveKeys(k, s)
    try {
      return await binance.balances()
    } catch (err) {
      binance.forget()
      throw err
    }
  })
  handle('binance-balances', () => binance.balances())
  handle('binance-forget', () => {
    binance.forget()
    return true
  })

  // Same backup folder as the standalone app, so old backups show up.
  const backupDir = () => join(app.getPath('documents'), 'Finance Helper', 'Backups')
  const safeName = (n: string) => /^finance-helper-\d{4}-\d{2}-\d{2}\.json$/.test(n)
  handle('backup-write', (name: string, text: string) => {
    if (!safeName(name)) throw new Error('Bad backup name')
    mkdirSync(backupDir(), { recursive: true })
    writeFileSync(join(backupDir(), name), String(text))
    return backupDir()
  })
  handle('backup-list', () => {
    try {
      return readdirSync(backupDir()).filter(safeName).map((n) => ({ name: n, size: statSync(join(backupDir(), n)).size })).sort((a, b) => b.name.localeCompare(a.name))
    } catch {
      return []
    }
  })
  handle('backup-read', (name: string) => {
    if (!safeName(name)) throw new Error('Bad backup name')
    return readFileSync(join(backupDir(), name), 'utf8')
  })
  handle('backup-delete', (name: string) => {
    if (safeName(name)) rmSync(join(backupDir(), name), { force: true })
    return true
  })
  handle('backup-folder', () => {
    mkdirSync(backupDir(), { recursive: true })
    return shell.openPath(backupDir())
  })

  const drive = req('./gdrive.cjs').createDrive({ app: fakeApp, net, safeStorage, shell })
  handle('drive-status', () => drive.status())
  handle('drive-connect', (clientId: string, clientSecret: string) => {
    const id = String(clientId || '').trim()
    const secret = String(clientSecret || '').trim()
    if (!/\.apps\.googleusercontent\.com$/.test(id)) throw new Error('The Client ID should end with .apps.googleusercontent.com')
    if (secret.length < 10) throw new Error('Paste the Client secret too.')
    return drive.connect(id, secret)
  })
  handle('drive-pull', () => drive.pull())
  handle('drive-push', (text: string) => drive.push(String(text)))
  handle('drive-disconnect', () => drive.disconnect())
  handle('drive-snap-put', (name: string, text: string) => drive.putSnapshot(String(name), String(text)))
  handle('drive-snap-list', () => drive.listSnapshots())
  handle('drive-snap-read', (id: string) => drive.readSnapshot(String(id)))
  handle('drive-snap-delete', (id: string) => drive.deleteSnapshot(String(id)))

  // Preferences of the embedded copy (sync folder etc.).
  const prefsFile = join(dataDir, 'prefs.json')
  const prefs = (): Record<string, unknown> => {
    try {
      return JSON.parse(readFileSync(prefsFile, 'utf8'))
    } catch {
      return {}
    }
  }
  const savePrefs = (p: Record<string, unknown>) => writeFileSync(prefsFile, JSON.stringify({ ...prefs(), ...p }))

  // Ensure syncFolder is initialized if available
  if (!prefs().syncFolder) {
    const standalonePrefs = join(app.getPath('appData'), 'finance-helper-app', 'prefs.json')
    try {
      if (existsSync(standalonePrefs)) {
        const sp = JSON.parse(readFileSync(standalonePrefs, 'utf8'))
        if (sp.syncFolder) savePrefs(sp)
      }
    } catch {}
    if (!prefs().syncFolder && existsSync('G:\\My Drive\\Finance\\Backup')) {
      savePrefs({ background: true, atLogin: true, trayTold: true, syncFolder: 'G:\\My Drive\\Finance\\Backup' })
    }
  }

  const folder = req('./folder.cjs').createFolderSync({ getPref: (k: string) => prefs()[k], setPref: (k: string, v: unknown) => savePrefs({ [k]: v }), dialog, shell, win: () => null })
  handle('folder-status', () => folder.status())
  handle('folder-use', (p: string) => folder.use(String(p)))
  handle('folder-pick', () => folder.pick())
  handle('folder-off', () => folder.disconnect())
  handle('folder-open', () => folder.open())
  handle('folder-pull', () => folder.pull())
  handle('folder-push', (text: string) => folder.push(String(text)))
  handle('folder-snap-put', (name: string, text: string) => folder.putSnapshot(String(name), String(text)))
  handle('folder-snap-list', () => folder.listSnapshots())
  handle('folder-snap-read', (id: string) => folder.readSnapshot(String(id)))
  handle('folder-snap-delete', (id: string) => folder.deleteSnapshot(String(id)))

  // Life System handles updates, tray and start-up for the whole system.
  handle('update-check', () => ({ available: false, version, managed: 'Updates come with Life System' }))
  handle('update-download', () => false)
  handle('update-install', () => false)
  handle('bg-get', () => ({ background: true, atLogin: false, managedBy: 'Life System' }))
  handle('bg-set', () => ({ background: true, atLogin: false, managedBy: 'Life System' }))
  handle('hotkey-status', () => ({ key: 'Ctrl+Alt+N', ok: true }))

  const telegram = req('./telegram.cjs').createTelegram({
    app: fakeApp,
    net,
    safeStorage,
    onUpdates: (updates: unknown) => toPage('tg-updates', updates),
    onEvent: (ev: unknown) => toPage('tg-event', ev)
  })
  handle('tg-status', () => telegram.status())
  handle('tg-connect', (token: string) => telegram.connect(token))
  handle('tg-pair', () => telegram.pair())
  handle('tg-ack', (ids: unknown) => telegram.ack(ids))
  handle('tg-send', (text: string, extra: unknown) => telegram.send(String(text).slice(0, 4000), extra || {}))
  handle('tg-edit', (id: unknown, text: string, extra: unknown) => telegram.edit(id, String(text).slice(0, 4000), extra || {}))
  handle('tg-answer', (id: unknown, text: string) => telegram.answer(id, text))
  handle('tg-disconnect', () => telegram.disconnect())
  handle('tg-load-now', () => telegram.loadNow())
  handle('tg-relay-script', () => telegram.relayScript())
  handle('tg-relay-connect', (url: string) => telegram.relayConnect(url))
  handle('tg-relay-off', () => telegram.relayOff())
  handle('tg-server-connect', (url: string, key: string) => telegram.serverConnect(String(url || ''), String(key || '')))
  handle('tg-server-off', () => telegram.serverOff())
  handle('tg-snapshot', (snap: unknown) => telegram.snapshot(snap && typeof snap === 'object' ? snap : {}))
  handle('open-external', (url: string) => {
    if (/^https:\/\/(t\.me|script\.google\.com)\//.test(url)) shell.openExternal(url)
    return true
  })
  telegram.start()
  const wake = () => {
    telegram.wake?.()
    telegram.start()
  }
  powerMonitor.on('resume', wake)
  powerMonitor.on('unlock-screen', wake)

  // A hidden page on app://finance that reads the saved state (works even if
  // the Money tab was never opened). Null when it is PIN-encrypted or empty.
  let reader: BrowserWindow | null = null
  const readState = async (): Promise<string | null> => {
    if (!reader || reader.isDestroyed()) {
      reader = new BrowserWindow({ show: false, webPreferences: { partition: FINANCE_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false } })
      await reader.loadURL('app://finance/__life-system-reader')
    }
    let state = await reader.webContents.executeJavaScript("localStorage.getItem('finance-helper.state')")
    if (!state || state === 'null') {
      try {
        const pulled = folder.pull()
        if (pulled) {
          const parsed = JSON.parse(pulled)
          if (parsed && parsed.data && Array.isArray(parsed.data.tx)) {
            const serialized = JSON.stringify(parsed.data)
            await reader.webContents.executeJavaScript(`localStorage.setItem('finance-helper.state', ${JSON.stringify(serialized)})`)
            state = serialized
          }
        }
      } catch (e) {
        console.error('Failed to hydrate finance state from folder sync', e)
      }
    }
    return state
  }

  return {
    readState,
    preload: join(root, 'electron', 'preload.cjs'),
    quickAdd: () => {
      onShow()
      toPage('quick-add')
    }
  }
}
