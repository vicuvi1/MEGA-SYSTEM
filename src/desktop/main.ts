import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, net, Notification, powerMonitor, protocol, session, shell, Tray } from 'electron'
import { clipWorthSaving } from '../core/islandActions'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { Updater } from '../main/updater'
import { autoUpdater } from 'electron-updater'
import { createIsland } from './island'
import { PLACEMENT_LABEL, PLACEMENTS } from './islandWin'
import { createBackups } from './backups'
import { createVault } from './vault'
import { createPc } from './pc'

const origin = 'life-system://app'
const server = 'https://mega-system-ten.vercel.app'
protocol.registerSchemesAsPrivileged([{ scheme: 'life-system', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
// A separate folder preserves all data from the older Electron app.
app.setPath('userData', app.commandLine.getSwitchValue('user-data-dir') || join(app.getPath('appData'), 'LifeSystem-CloudDesktop'))
// Release check (LIFE_SMOKE=1): start, show the page, report, quit. The release
// workflow runs this on Windows, so a version that doesn't open never ships.
const smoke = process.env.LIFE_SMOKE === '1'
if (smoke) setTimeout(() => app.exit(3), 90_000)
// Only one copy runs; a second start just brings the first one forward.
const firstCopy = app.requestSingleInstanceLock()
if (!firstCopy) app.quit()
// Windows shows notifications only for an app with this id (the installer's appId).
if (process.platform === 'win32') app.setAppUserModelId('com.vicuvi1.lifesystem')
// Keep this on its own line (never behind an if/else): it starts the whole app.
if (firstCopy) void app.whenReady().then(async () => {
  // Camera, microphone, location…: only the app itself may ask for the
  // microphone (voice notes) and notifications; everything else is refused,
  // and the embedded apps get nothing.
  const own = (url: string) => url.startsWith('life-system://app/') && !url.startsWith('life-system://app/apps/')
  session.defaultSession.setPermissionRequestHandler((wc, permission, done, details) => {
    const url = details.requestingUrl || wc.getURL()
    const media = permission === 'media' && (details as any).mediaTypes?.every((m: string) => m === 'audio')
    done(own(url) && (media || permission === 'notifications' || permission === 'clipboard-sanitized-write'))
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => (permission === 'media' || permission === 'notifications' || permission === 'clipboard-sanitized-write') && origin.startsWith('life-system://app'))
  // Ben on this PC (P1–P20): set up once the window exists.
  const pcRef: { current: Awaited<ReturnType<typeof createPc>> | null } = { current: null }
  const dir = app.getPath('userData')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'life-local.sqlite')
  const ui = resolve(__dirname, '../renderer')
  // Update status goes to the window as it changes (set once the window exists).
  let pushUpdate: (s: ReturnType<Updater['get']>) => void = () => {}
  let markQuitting = () => {}
  const updater = new Updater((s) => pushUpdate(s), () => markQuitting())
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
    // IS17: not slowed down while it sits in the tray, so the island keeps fresh data.
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
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
  // Your Obsidian vault (read-only): titles, headings and first lines.
  const vault = createVault(dir)
  handle('vault:choose', () => vault.choose(win))
  handle('vault:scan', () => vault.scan())
  handle('vault:forget', () => vault.forget())
  handle('desktop:updateStatus', () => updater.get())
  handle('desktop:checkUpdates', () => updater.check())
  handle('desktop:installUpdate', async () => { await saves; return updater.update() })
  handle('desktop:rollback', async () => { await saves; return updater.rollback() })
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
  // A button on a Windows notification (N9) opens a lifesystem:// link, which
  // Windows hands to this copy as a second start.
  if (process.platform === 'win32') app.setAsDefaultProtocolClient('lifesystem')
  const fromLink = (argv: string[]) => {
    const link = argv.find((a) => a.startsWith('lifesystem://'))
    if (!link) return false
    try {
      const u = new URL(link)
      const id = u.searchParams.get('id') ?? ''
      const act = u.searchParams.get('a') ?? 'open'
      if (act !== 'snooze') showApp()
      win.webContents.send('desktop:notif-action', { id, action: act })
      return true
    } catch {
      return false
    }
  }
  // P17: taskbar shortcuts arrive as a second start with --action=…
  let pcAction: (a: string) => void = () => {}
  app.on('second-instance', (_e, argv) => {
    const a = argv.find((x) => x.startsWith('--action='))?.slice(9)
    if (a) return pcAction(a)
    if (!fromLink(argv)) showApp()
  })

  // Windows notifications: the page decides when (quiet hours, focus) and
  // plays its own chime; a click opens Life System and runs the action.
  const shown = new Map<string, Notification>()
  const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  handle('desktop:notify', (n: { id: string; title: string; body?: string | null; actions?: { id: string; label: string }[]; urgent?: boolean }) => {
    if (!Notification.isSupported() || typeof n?.id !== 'string') return false
    // P20: during focus, Life System's own notifications wait (unless urgent, or a focus block's own).
    if (pcRef.current?.prefs().holdNotifs && pcRef.current.focus().running && !n.urgent && !n.id.startsWith('block:')) return false
    const title = String(n.title).slice(0, 120)
    const body = String(n.body ?? '').slice(0, 240)
    const link = (a: string) => xml(`lifesystem://notif?id=${encodeURIComponent(n.id)}&a=${encodeURIComponent(a)}`)
    const acts = (Array.isArray(n.actions) ? n.actions : []).slice(0, 3)
    // Buttons (N9): Start focus, Join, Snooze… right on the Windows notification.
    const toastXml =
      process.platform === 'win32' && acts.length
        ? `<toast activationType="protocol" launch="${link('open')}"><visual><binding template="ToastGeneric"><text>${xml(title)}</text>${body ? `<text>${xml(body)}</text>` : ''}</binding></visual><audio silent="true"/><actions>${acts.map((a) => `<action content="${xml(String(a.label).slice(0, 30))}" activationType="protocol" arguments="${link(String(a.id))}"/>`).join('')}</actions></toast>`
        : undefined
    const note = new Notification({ title, body, icon: join(ui, 'icon.png'), silent: true, ...(toastXml ? { toastXml } : {}) })
    note.on('click', () => {
      showApp()
      win.webContents.send('desktop:notif-click', n.id)
    })
    note.on('close', () => shown.delete(n.id))
    shown.set(n.id, note)
    note.show()
    return true
  })

  // Closing the window keeps Life System running in the tray (the island and
  // reminders keep working); Quit in the tray menu really quits.
  let quitting = false
  app.on('before-quit', () => { quitting = true })
  markQuitting = () => { quitting = true }
  pushUpdate = (s) => { if (!win.isDestroyed()) win.webContents.send('desktop:update', s) }
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })

  let refreshTray = () => {}
  const island = createIsland({
    origin,
    preload: join(__dirname, '../preload/index.cjs'),
    appWindow: win,
    showApp,
    dir,
    onChange: () => refreshTray(),
    pc: () => ({ activeApp: !!pcRef.current?.prefs().activeApp, titles: !!pcRef.current?.prefs().titles }),
    onApp: (proc, title, seconds) => pcRef.current?.sample(proc, title, seconds)
  })
  const pc = await createPc({
    dir,
    win,
    onPrefs: (p) => {
      island.restartWatcher()
      pcPrefsNow = p
    },
    onAction: (a) => {
      if (a === 'talk') island.voice()
      else if (a === 'capture') island.capture()
      else if (a === 'focus25') win.webContents.send('desktop:jump', a)
    }
  })
  pcRef.current = pc
  let pcPrefsNow = pc.prefs()
  pcAction = (a) => {
    if (a === 'talk') island.voice()
    else if (a === 'capture') island.capture()
    else win.webContents.send('desktop:jump', a)
  }
  island.restartWatcher()

  // Tray: open, island on/off, start with Windows, quit.
  const icon = nativeImage.createFromPath(join(ui, 'icon.png')).resize({ width: 16, height: 16 })
  const tray = new Tray(icon)
  tray.setToolTip('Life System')
  const startsWithWindows = () => app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin
  const menu = () => Menu.buildFromTemplate([
    { label: 'Open Life System', click: () => showApp() },
    { label: `Show the island (${island.shortcut.replace('Control', 'Ctrl')})`, type: 'checkbox', checked: island.enabled(), click: (item) => { island.setEnabled(item.checked); tray.setContextMenu(menu()) } },
    // Quiet for a while (Q1): no reminders, only a small moon; back by itself.
    island.quietUntil()
      ? { label: `Island quiet until ${new Date(island.quietUntil()).toTimeString().slice(0, 5)} · Wake now`, click: () => { island.setQuiet(null); tray.setContextMenu(menu()) } }
      : { label: 'Quiet the island for…', submenu: ([[30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], ['tomorrow', 'Until tomorrow 06:00']] as const).map(([c, label]) => ({ label, click: () => { island.setQuiet(c); tray.setContextMenu(menu()) } })) },
    // IF1: top left / center / right, docked on a side, or floating.
    { label: 'Island position', submenu: PLACEMENTS.map((p) => ({ label: PLACEMENT_LABEL[p], type: 'radio' as const, checked: island.placement() === p, click: () => { island.setPlacement(p); tray.setContextMenu(menu()) } })) },
    // IF2: which screen: the main one, one you pick, or it follows the mouse / the window you work in.
    {
      label: 'Island screen',
      submenu: [
        { label: 'The main screen', type: 'radio' as const, checked: island.monitor() === 'main', click: () => { island.setMonitor('main'); tray.setContextMenu(menu()) } },
        { label: 'Follow the mouse', type: 'radio' as const, checked: island.monitor() === 'mouse', click: () => { island.setMonitor('mouse'); tray.setContextMenu(menu()) } },
        { label: 'Follow the window you work in', type: 'radio' as const, checked: island.monitor() === 'window', click: () => { island.setMonitor('window'); tray.setContextMenu(menu()) } },
        { type: 'separator' as const },
        ...island.displays().map((d) => ({ label: d.label, type: 'radio' as const, checked: island.monitor() === 'fixed' && d.current, click: () => { island.setMonitor('fixed', d.id); tray.setContextMenu(menu()) } }))
      ]
    },
    { label: 'Reset island position', click: () => { island.resetPosition(); tray.setContextMenu(menu()) } },
    { label: 'Start with Windows', type: 'checkbox', checked: startsWithWindows(), enabled: app.isPackaged, click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }); tray.setContextMenu(menu()) } },
    { type: 'separator' },
    { label: 'Quit Life System', click: () => { quitting = true; app.quit() } }
  ])
  tray.setContextMenu(menu())
  refreshTray = () => tray.setContextMenu(menu())
  tray.on('click', () => showApp())
  // First run of an installed copy: start with Windows (you can turn it off in the tray).
  if (app.isPackaged && !smoke && !existsSync(join(dir, 'login-item.json'))) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })
    await writeFile(join(dir, 'login-item.json'), JSON.stringify({ setAt: new Date().toISOString() }))
    tray.setContextMenu(menu())
  }

  // Safety net: the window crashes or fails to load twice within 3 minutes →
  // ask what to do (reload / save a backup / get the previous version), and
  // put it in the shared error log once the app is up again.
  const crashFile = join(dir, 'crashes.json')
  let crashes: { at: string; why: string }[] = []
  const remember = (why: string) => {
    crashes = [...crashes.filter((c) => Date.now() - Date.parse(c.at) < 3 * 60000), { at: new Date().toISOString(), why }]
    void writeFile(crashFile, JSON.stringify(crashes)).catch(() => {})
    if (crashes.length >= 2) {
      crashes = []
      void dialog
        .showMessageBox(win, {
          type: 'warning',
          title: 'Life System',
          message: 'Life System had trouble starting.',
          detail: `${why}\n\nYour data is safe (in the cloud and on this PC).`,
          buttons: ['Try again', 'Save a backup', 'Go back one version'],
          defaultId: 0
        })
        .then(async ({ response }) => {
          if (response === 1) {
            await saves
            const r = await dialog.showSaveDialog(win, { defaultPath: 'Life-System-backup.sqlite' })
            if (!r.canceled && r.filePath) await copyFile(file, r.filePath).catch(() => {})
          } else if (response === 2) {
            // Installs the previous release and restarts (the releases page if that fails).
            await saves
            const r = await updater.rollback()
            if (r.ok) return
            void shell.openExternal('https://github.com/vicuvi1/MEGA-SYSTEM/releases')
          }
          win.reload()
        })
    } else win.reload()
  }
  win.webContents.on('render-process-gone', (_e, d) => remember(`The window stopped (${d.reason}).`))
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => { if (isMain && code !== -3) remember(`It could not load (${desc}).`) })
  win.webContents.on('did-finish-load', async () => {
    if (smoke) {
      setTimeout(async () => {
        const seen = await win.webContents.executeJavaScript('document.body.innerText.trim().length').catch(() => 0)
        // The updater must be able to read its config (else every download fails).
        const updates = await (autoUpdater as unknown as { configOnDisk: { value: Promise<{ provider?: string }> } }).configOnDisk.value.then((c) => c?.provider ?? 'none', (e: Error) => `error ${e.message}`)
        const ok = win.isVisible() && Number(seen) > 0 && updates === 'github'
        await writeFile(join(dir, 'smoke.txt'), `visible=${win.isVisible()} text=${seen} updates=${updates}\n`).catch(() => {})
        app.exit(ok ? 0 : 1)
      }, 5000)
      return
    }
    try {
      const old = JSON.parse(await readFile(crashFile, 'utf8')) as { at: string; why: string }[]
      if (old.length) win.webContents.send('desktop:crashes', old)
      await writeFile(crashFile, '[]')
    } catch { /* none */ }
  })

  await win.loadURL(origin + '/')
  // When you go to bed, without watching the screen: the last moment you used
  // the PC (mouse/keys; before it locked, slept or shut down) is kept on disk.
  // Coming back hours later tells the app, which logs the bedtime in Waky.
  if (!smoke) {
    const activeFile = join(dir, 'last-active.json')
    let lastActive = Date.now()
    const save = () => void writeFile(activeFile, JSON.stringify({ at: lastActive })).catch(() => {})
    const away = (from: number, to: number) => win.webContents.send('desktop:away', { from: new Date(from).toISOString(), to: new Date(to).toISOString() })
    try {
      const before = Number(JSON.parse(await readFile(activeFile, 'utf8')).at)
      // The PC was off (or the app closed) since then.
      if (before && Date.now() - before >= 3 * 3600_000) setTimeout(() => away(before, Date.now()), 8000)
    } catch {
      /* first run */
    }
    const tick = () => {
      const idle = powerMonitor.getSystemIdleTime()
      const now = Date.now()
      if (idle < 90) {
        if (now - lastActive >= 3 * 3600_000) away(lastActive, now)
        lastActive = now
        save()
      }
    }
    setInterval(tick, 60_000)
    // Seconds since the last mouse/keys, for the island (drift, focus quality).
    setInterval(() => pcPrefsNow.idle && win.webContents.send('desktop:idle', powerMonitor.getSystemIdleTime()), 15_000)
    // Copied text, for the island's "save this?". The check happens HERE, in
    // the main process: only short dated text ("exam friday 10:00") ever
    // reaches a page; passwords, codes, keys, links and long text never do.
    // IS25: the clipboard is read only while that switch is on; what was
    // already there when you turned it on is never offered.
    let lastClip = ''
    let clipWatching = false
    const readClip = async (): Promise<string> => { try { return String(await clipboard.readText()) } catch { return '' } }
    setInterval(async () => {
      if (!pcPrefsNow.clipboard) { clipWatching = false; return }
      const t = await readClip()
      if (!clipWatching) { clipWatching = true; lastClip = t; return }
      if (!t || t === lastClip) return
      lastClip = t
      const safe = clipWorthSaving(t)
      if (safe) win.webContents.send('desktop:clip', safe)
    }, 1500)
    const leaving = () => {
      lastActive = Date.now() - powerMonitor.getSystemIdleTime() * 1000
      save()
    }
    powerMonitor.on('lock-screen', leaving)
    powerMonitor.on('suspend', leaving)
    powerMonitor.on('shutdown', leaving)
    powerMonitor.on('lock-screen', () => win.webContents.send('desktop:lock', { locked: true, at: Date.now() }))
    powerMonitor.on('unlock-screen', () => {
      setTimeout(tick, 1500)
      win.webContents.send('desktop:lock', { locked: false, at: Date.now() })
    })
    powerMonitor.on('resume', () => setTimeout(tick, 3000))
  }
  // Look for a new version shortly after start, every 30 minutes and when the
  // window comes back to the front; a failed look is tried again in 3 minutes.
  // A new version downloads quietly, then the top bar shows "Restart to update".
  let retry: NodeJS.Timeout | null = null
  const look = async () => {
    if (['checking', 'downloading', 'ready', 'installing'].includes(updater.get().state)) return
    const s = await updater.check().catch(() => updater.get())
    if (retry) clearTimeout(retry)
    retry = s.state === 'error' ? setTimeout(() => void look(), 3 * 60_000) : null
  }
  if (!smoke) setTimeout(() => void look(), 20_000)
  setInterval(() => void look(), 30 * 60_000)
  win.on('focus', () => {
    const at = updater.get().checkedAt
    if (!at || Date.now() - Date.parse(at) > 10 * 60_000) void look()
  })
})
// The tray keeps the app alive with no windows open.
app.on('window-all-closed', () => {})
