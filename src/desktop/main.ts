import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, protocol, shell, Tray } from 'electron'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { Updater } from '../main/updater'
import { createIsland } from './island'
import { createBackups } from './backups'

const origin = 'life-system://app'
const server = 'https://mega-system-ten.vercel.app'
protocol.registerSchemesAsPrivileged([{ scheme: 'life-system', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
// A separate folder preserves all data from the older Electron app.
app.setPath('userData', app.commandLine.getSwitchValue('user-data-dir') || join(app.getPath('appData'), 'LifeSystem-CloudDesktop'))
if (!app.requestSingleInstanceLock()) app.quit()
else void app.whenReady().then(async () => {
  const dir = app.getPath('userData')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'life-local.sqlite')
  const ui = resolve(__dirname, '../renderer')
  const updater = new Updater(() => {}, () => {})
  protocol.handle('life-system', async (request) => {
    const url = new URL(request.url)
    if (url.host !== 'app') return new Response('Not found', { status: 404 })
    if (url.pathname.startsWith('/api/')) {
      try {
        return await net.fetch(server + url.pathname + url.search, {
          method: request.method, headers: request.headers,
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
          redirect: 'manual'
        })
      } catch { return new Response('Server unavailable', { status: 502 }) }
    }
    const target = resolve(ui, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname))
    if (!target.startsWith(ui + sep)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(target).toString())
  })
  // Started by Windows at login: stay in the tray, the island is enough.
  const hidden = process.argv.includes('--hidden')
  // No white Windows title bar and no File/Edit menu: the app draws its own slim
  // dark bar; Windows keeps its minimize/maximize/close on it (same colors).
  const win = new BrowserWindow({ width: 1440, height: 950, minWidth: 850, minHeight: 600, show: !hidden,
    title: 'Life System', backgroundColor: '#07090e', autoHideMenuBar: true,
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#07090e', symbolColor: '#c9ced6', height: 36 },
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  // Only this bundled window can use the fixed, narrow IPC methods.
  const handle = (name: string, fn: (...args: any[]) => unknown) => ipcMain.handle(name, (event, ...args) => {
    if (event.sender !== win.webContents || event.senderFrame?.url.split('/').slice(0, 3).join('/') !== origin) throw new Error('Untrusted window')
    return fn(...args)
  })
  handle('desktop:load', async () => existsSync(file) ? new Uint8Array(await readFile(file)) : null)
  let saves = Promise.resolve()
  handle('desktop:save', (bytes: Uint8Array) => {
    if (!(bytes instanceof Uint8Array) || bytes.length > 256 * 1024 * 1024) throw new Error('Invalid local database')
    const save = saves.then(async () => {
      await writeFile(file + '.tmp', bytes)
      await rename(file + '.tmp', file)
    })
    saves = save.catch(() => {})
    return save
  })
  handle('desktop:backup', async () => {
    await saves
    const result = await dialog.showSaveDialog(win, { defaultPath: 'Life-System-backup.sqlite', filters: [{ name: 'SQLite database', extensions: ['sqlite'] }] })
    if (result.canceled || !result.filePath) return null
    await copyFile(file, result.filePath)
    return result.filePath
  })
  // Daily backup files (PC folder + Google Drive), written from the app window's export.
  const backups = createBackups(dir)
  handle('backups:status', () => backups.status())
  handle('backups:write', (text: string, day: string) => backups.write(text, day))
  handle('backups:read', (where: 'local' | 'drive', name: string) => backups.read(where, name))
  handle('backups:choose', () => backups.choose(win))
  handle('backups:open', (where: 'local' | 'drive') => backups.open(where))
  handle('desktop:updateStatus', () => updater.get())
  handle('desktop:checkUpdates', () => updater.check())
  handle('desktop:installUpdate', async () => { await saves; return updater.update() })
  handle('desktop:loginGithub', () => new Promise<void>((resolveLogin, reject) => {
    const command = join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'mingw64', 'bin', 'git-credential-manager.exe')
    execFile(command, ['github', 'login', '--browser', '--force'], { windowsHide: true, timeout: 180_000 }, (error) => error ? reject(new Error('GitHub sign-in did not finish. Install Git for Windows and try again.')) : resolveLogin())
  }))
  const external = (url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    else if (url.startsWith(origin + '/api/')) void shell.openExternal(server + url.slice(origin.length))
  }
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(origin + '/')) { event.preventDefault(); external(url) } })
  win.setMenu(null)
  ipcMain.on('desktop:titlebar', (event, color: unknown, symbol: unknown) => {
    const ok = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)
    if (event.sender !== win.webContents || !ok(color) || !ok(symbol)) return
    try { win.setTitleBarOverlay({ color, symbolColor: symbol, height: 36 }) } catch { /* not on this OS */ }
  })
  const showApp = (page?: string) => {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (page) win.webContents.send('app:navigate', page)
  }
  app.on('second-instance', () => showApp())

  // Closing the window keeps Life System running in the tray (the island and
  // reminders keep working); Quit in the tray menu really quits.
  let quitting = false
  app.on('before-quit', () => { quitting = true })
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })

  const island = createIsland({ origin, preload: join(__dirname, '../preload/index.cjs'), appWindow: win, showApp, dir })

  // Tray: open, island on/off, start with Windows, quit.
  const icon = nativeImage.createFromPath(join(ui, 'icon.png')).resize({ width: 16, height: 16 })
  const tray = new Tray(icon)
  tray.setToolTip('Life System')
  const startsWithWindows = () => app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open Life System', click: () => showApp() },
    { label: 'Show the island', type: 'checkbox', checked: island.enabled(), click: (item) => { island.setEnabled(item.checked); tray.setContextMenu(menu()) } },
    { label: 'Reset island position', click: () => island.resetPosition() },
    { label: 'Start with Windows', type: 'checkbox', checked: startsWithWindows(), enabled: app.isPackaged, click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }); tray.setContextMenu(menu()) } },
    { type: 'separator' },
    { label: 'Quit Life System', click: () => { quitting = true; app.quit() } }
  ])
  tray.setContextMenu(menu())
  tray.on('click', () => showApp())
  // First run of an installed copy: start with Windows (you can turn it off in the tray).
  if (app.isPackaged && !existsSync(join(dir, 'login-item.json'))) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })
    await writeFile(join(dir, 'login-item.json'), JSON.stringify({ setAt: new Date().toISOString() }))
    tray.setContextMenu(menu())
  }

  await win.loadURL(origin + '/')
  // Look for a new version shortly after start and every 4 hours; the top bar
  // then shows "Update to …" (one tap installs it). Quiet when offline.
  const look = () => { if (!['downloading', 'ready', 'installing'].includes(updater.get().state)) void updater.check().catch(() => {}) }
  setTimeout(look, 20_000)
  setInterval(look, 4 * 3600_000)
})
// The tray keeps the app alive with no windows open.
app.on('window-all-closed', () => {})
