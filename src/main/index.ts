import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, powerMonitor, screen, session, shell, Tray } from 'electron'
import { dueReminders } from '@core/plan'
import { isFlowRule } from '@core/rules'
import type { AppPrefs, BlockInput, Category, ConnectionKind, IpcReply, RewardInput, Rule, TaskInput } from '@shared/api'
import { getSetting, openDb, setSetting, type DB } from './db'
import { Wallet } from './wallet'
import { Auth } from './auth'
import { Backups } from './backup'
import { SecretStore } from './secrets'
import { Shop } from './shop'
import { Schedule, Tasks } from './planner'
import { Discipline } from './discipline'
import { Connections, defaultCandidates } from './connections'
import { FINANCE_PARTITION, FINANCE_URL, setupFinance, type FinanceHost } from './apps/finance'
import {
  appsDir, embeddedManLevelDb, ensureWaky, MAN_PARTITION, manUrl, migrateStandaloneData, registerEmbeddedSchemes, WAKY_PARTITION, WAKY_URL,
  wakyRoot, type MigrationResult
} from './apps/embedded'
import { appIconPng } from './icon'
import { Updater } from './updater'
import { RESET_THEME_SCRIPT, themeFor } from './apps/themes'

const isDev = !app.isPackaged
registerEmbeddedSchemes()
// Set before the lock: the lock belongs to the data folder, so a dev copy can
// run next to the installed app.
app.setPath('userData', join(app.getPath('appData'), isDev ? 'LifeSystem-dev' : 'LifeSystem'))
// One copy at a time; a second launch just brings the window back.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const DRIVE_ROOT = 'G:\\My Drive'
const BACKUP_DIR = join(DRIVE_ROOT, 'Life System', isDev ? 'backups-dev' : 'backups')
const BACKUP_EVERY_MS = 30 * 60_000

const dataDir = app.getPath('userData')
mkdirSync(dataDir, { recursive: true })
const dbFile = join(dataDir, 'life.db')

let db: DB
let wallet: Wallet
let auth: Auth
let shop: Shop
let tasks: Tasks
let schedule: Schedule
let discipline: Discipline
let connections: Connections
let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

function open(): void {
  db = openDb(dbFile)
  wallet = new Wallet(db)
  auth = new Auth(db)
  shop = new Shop(db, wallet)
  tasks = new Tasks(db, wallet)
  schedule = new Schedule(db, wallet)
  discipline = new Discipline(db, wallet)
  const candidates = defaultCandidates(homedir(), DRIVE_ROOT)
  // The MAN copy inside Life System is checked first.
  candidates.man.unshift(embeddedManLevelDb())
  connections = new Connections(db, wallet, candidates)
}
open()

const secrets = new SecretStore(join(dataDir, 'backup-key.bin'))
const backups = new Backups({
  db: () => db,
  driveRoot: DRIVE_ROOT,
  dir: BACKUP_DIR,
  pendingDir: join(dataDir, 'backups-pending'),
  passphrase: () => secrets.get()
})

/** Registers a handler that returns {ok, data} so errors keep their message. */
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R, opts = { locked: false }): void {
  ipcMain.handle(channel, async (_e, ...args: unknown[]): Promise<IpcReply<Awaited<R>>> => {
    try {
      if (!opts.locked && auth.isLocked()) throw new Error('Locked')
      return { ok: true, data: await fn(...(args as A)) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}

const free = { locked: true } // allowed while locked

handle('auth:status', () => auth.status(), free)
handle('auth:unlock', (pin: string) => auth.unlock(pin), free)
handle('auth:lock', () => auth.lock(), free)
handle('auth:setPin', (pin: string, current?: string) => auth.setPin(pin, current), free)

handle('wallet:summary', () => wallet.summary())
handle('wallet:history', (limit?: number) => wallet.history(limit))
handle('wallet:award', (ruleId: string, note?: string) => {
  if (isFlowRule(ruleId)) throw new Error('This one is logged from its own section')
  wallet.award(ruleId, note)
  return wallet.summary()
})
handle('wallet:undo', (id: number, note: string) => {
  wallet.undo(id, note)
  return wallet.summary()
})

handle('rules:list', () => wallet.rules())
handle('rules:save', (rule: Rule) => {
  wallet.saveRule(rule)
  return wallet.rules()
})

handle('shop:state', () => shop.state())
handle('shop:save', (r: RewardInput) => {
  shop.save(r)
  return shop.state()
})
handle('shop:archive', (id: number) => {
  shop.archive(id)
  return shop.state()
})
handle('shop:redeem', (id: number) => {
  shop.redeem(id)
  return shop.state()
})
handle('shop:openChest', (level: number) => ({ coins: shop.openChest(level), state: shop.state() }))
handle('shop:setBudget', (amount: number) => {
  shop.setBudget(amount)
  return shop.state()
})

handle('tasks:state', () => tasks.state())
handle('tasks:save', (t: TaskInput) => {
  tasks.save(t)
  return tasks.state()
})
handle('tasks:archive', (id: number) => {
  tasks.archive(id)
  return tasks.state()
})
handle('tasks:complete', (id: number) => {
  tasks.complete(id)
  return tasks.state()
})
handle('tasks:uncomplete', (id: number) => {
  tasks.uncomplete(id)
  return tasks.state()
})
handle('tasks:saveCategory', (c: Category) => {
  tasks.saveCategory(c)
  return tasks.state()
})

handle('schedule:state', (day?: string) => schedule.state(day))
handle('schedule:save', (b: BlockInput) => {
  schedule.save(b)
  return schedule.state()
})
handle('schedule:archive', (id: number) => {
  schedule.archive(id)
  return schedule.state()
})
for (const action of ['start', 'finish', 'skip'] as const) {
  handle(`schedule:${action}`, (id: number) => {
    schedule[action](id)
    return schedule.state()
  })
}

handle('discipline:state', () => discipline.state())
handle('discipline:setStart', (day: string) => {
  discipline.setStart(day)
  return discipline.state()
})
for (const action of ['checkIn', 'oath', 'reset', 'startUrge', 'finishUrge', 'cancelUrge'] as const) {
  handle(`discipline:${action}`, () => {
    discipline[action]()
    return discipline.state()
  })
}
handle('discipline:claim', (days: number) => ({ coins: discipline.claim(days), state: discipline.state() }))
handle('discipline:setStealth', (on: boolean) => {
  discipline.setStealth(on)
  return discipline.state()
})

handle('connections:state', () => connections.state())
handle('connections:connect', async (kind: 'waky' | 'finance') => {
  if (kind === 'finance' && financeHost) connections.setEmbeddedFinance(await financeHost.readState().catch(() => null))
  connections.connect(kind)
  connections.sync()
  return connections.state()
})
handle('connections:disconnect', (kind: 'waky' | 'finance') => {
  connections.disconnect(kind)
  return connections.state()
})
handle('connections:sync', async () => {
  if (financeHost) connections.setEmbeddedFinance(await financeHost.readState().catch(() => null))
  return { awarded: connections.sync(), state: connections.state() }
})
handle('connections:setDailyBudget', (amount: number) => {
  connections.setDailyBudget(amount)
  return connections.state()
})
handle('connections:choosePath', async (kind: ConnectionKind) => {
  const res = await dialog.showOpenDialog(win!, kind === 'man'
    ? { title: 'Choose the MAN profile folder (Local Storage, leveldb)', properties: ['openDirectory'] }
    : { title: kind === 'waky' ? 'Choose waky.json' : 'Choose finance-helper-sync.json', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] })
  if (!res.canceled && res.filePaths[0]) connections.setPath(kind, res.filePaths[0])
  return connections.state()
})

// ---------- Updates from GitHub ----------
const updater = new Updater(
  (s) => win?.webContents.send('update:event', s),
  () => {
    quitting = true
  }
)
handle('update:status', () => updater.get(), free)
handle('update:check', () => updater.check())
handle('update:run', () => updater.update())

// ---------- Apps inside Life System ----------
let financeHost: FinanceHost | null = null
let migration: MigrationResult | null = null
handle('apps:info', () => ({
  finance: { url: FINANCE_URL, partition: FINANCE_PARTITION, preloadReady: !!financeHost },
  man: { url: manUrl(), partition: MAN_PARTITION },
  waky: { url: WAKY_URL, partition: WAKY_PARTITION },
  migration
}))
handle('apps:startWaky', () => ensureWaky(wakyRoot(connections.path('waky'))))

function navigate(page: string): void {
  showWindow()
  const send = () => win?.webContents.send('nav:page', page)
  if (win?.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
}

const embedded = new Set<Electron.WebContents>()

// Only the three known apps may be embedded, each in its own partition.
const EMBEDS: Record<string, (src: string) => boolean> = {
  [FINANCE_PARTITION]: (src) => src.startsWith('app://finance/'),
  [MAN_PARTITION]: (src) => src === manUrl(),
  [WAKY_PARTITION]: (src) => src.startsWith(WAKY_URL)
}
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (event, prefs, params) => {
    const ok = EMBEDS[params.partition]?.(params.src)
    if (!ok) return event.preventDefault()
    delete (prefs as { preloadURL?: string }).preloadURL
    prefs.preload = params.partition === FINANCE_PARTITION && financeHost ? financeHost.preload : undefined
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
    prefs.sandbox = true
  })
  if (wc.getType() === 'webview') {
    // Life System's colors and fonts on top of the app's own styles.
    embedded.add(wc)
    wc.on('destroyed', () => embedded.delete(wc))
    wc.on('dom-ready', () => {
      wc.setZoomFactor(savedZoom())
      const partition = Object.keys(EMBEDS).find((p) => session.fromPartition(p) === wc.session)
      const theme = partition && prefs().matchAppThemes ? themeFor(partition) : null
      if (theme) {
        wc.insertCSS(theme.css).catch(() => {})
        wc.executeJavaScript(theme.script).catch(() => {})
      }
    })
    // Life System's shortcuts keep working while an app inside has focus.
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const z = zoomKey(input)
      if (z !== null) {
        event.preventDefault()
        changeZoom(z)
        return
      }
      const key = input.key.toLowerCase()
      let action: string | null = null
      const inFinance = wc.session === session.fromPartition(FINANCE_PARTITION)
      if (input.control && !input.alt && !input.shift && key === 'b') action = 'toggle-sidebar'
      // Finance Helper has its own Ctrl+K search; Ctrl+Shift+K opens ours everywhere.
      else if (input.control && !input.alt && key === 'k' && (input.shift || !inFinance)) action = 'palette'
      else if (key === 'f11') action = 'fullscreen'
      else if (input.alt && !input.control && /^[1-9]$/.test(key)) action = `go:${key}`
      else if (input.control && key === 'tab') action = 'switch-view'
      if (action) {
        event.preventDefault()
        win?.webContents.send('ui:key', action)
      }
    })
    // Links from inside the apps open in the real browser.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https:/.test(url)) shell.openExternal(url)
      return { action: 'deny' }
    })
  }
})

// Connected apps pay out shortly after they record something.
async function syncConnections(): Promise<void> {
  try {
    if (financeHost) connections.setEmbeddedFinance(await financeHost.readState().catch(() => null))
    if (connections.sync() > 0) win?.webContents.send('wallet:changed')
  } catch (e) {
    console.error('connection sync failed', e)
  }
}

function prefs(): AppPrefs {
  return {
    openAtLogin: app.isPackaged && app.getLoginItemSettings().openAtLogin,
    canAutoStart: app.isPackaged,
    keepInTray: getSetting(db, 'keep_in_tray') !== '0',
    matchAppThemes: getSetting(db, 'apps_theme') !== '0'
  }
}
handle('app:prefs', () => prefs())
handle('app:toggleFullScreen', () => {
  win?.setFullScreen(!win.isFullScreen())
  return win?.isFullScreen() ?? false
})
handle('app:setPrefs', (p: Partial<AppPrefs>) => {
  if (p.openAtLogin !== undefined) {
    if (!app.isPackaged) throw new Error('Start with Windows works in the installed app')
    app.setLoginItemSettings({ openAtLogin: p.openAtLogin })
  }
  if (p.keepInTray !== undefined) setSetting(db, 'keep_in_tray', p.keepInTray ? '1' : '0')
  if (p.matchAppThemes !== undefined) {
    setSetting(db, 'apps_theme', p.matchAppThemes ? '1' : '0')
    // Turning it on again also forgets theme picks made inside the apps.
    for (const wc of embedded) {
      const reset = p.matchAppThemes ? wc.executeJavaScript(RESET_THEME_SCRIPT).catch(() => {}) : Promise.resolve()
      reset.then(() => wc.reload())
    }
  }
  return prefs()
})

handle('backup:status', () => backups.status())
handle('backup:setPassphrase', (p: string) => {
  if (typeof p !== 'string' || p.length < 8) throw new Error('Use at least 8 characters')
  secrets.set(p)
  return backups.run(true)
})
handle('backup:runNow', () => backups.run(true))
handle('backup:list', () => backups.names())
handle('backup:verifyLatest', () => backups.verifyLatest())
handle('backup:restore', (name: string, passphrase: string) => {
  const ready = backups.prepareRestore(name, passphrase)
  backups.run(true) // snapshot the current state first, just in case
  db.close()
  const aside = `${dbFile}.before-restore-${Date.now()}`
  renameSync(dbFile, aside)
  for (const ext of ['-wal', '-shm']) rmSync(dbFile + ext, { force: true })
  renameSync(ready, dbFile)
  open()
})

const icon = nativeImage.createFromBuffer(appIconPng(64))

function showWindow(): void {
  if (!win) createWindow()
  else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

// ---------- Size of the interface ----------
// Big screens get a larger default; Ctrl + / - / 0 change it and it is kept.
const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.45, 1.6]
function defaultZoom(): number {
  const w = screen.getPrimaryDisplay().workAreaSize.width
  return w >= 2400 ? 1.2 : w >= 1900 ? 1.1 : 1
}
function savedZoom(): number {
  const z = Number(getSetting(db, 'ui_zoom'))
  return ZOOM_STEPS.includes(z) ? z : defaultZoom()
}
function applyZoom(z: number): void {
  win?.webContents.setZoomFactor(z)
  // The apps inside follow the same size.
  for (const wc of embedded) wc.setZoomFactor(z)
}
function changeZoom(dir: -1 | 0 | 1): void {
  const cur = savedZoom()
  let next = defaultZoom()
  if (dir !== 0) {
    const i = ZOOM_STEPS.findIndex((s) => s >= cur)
    next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, (i === -1 ? ZOOM_STEPS.length - 1 : i) + dir))]
  }
  setSetting(db, 'ui_zoom', String(next))
  applyZoom(next)
}
function zoomKey(input: Electron.Input): -1 | 0 | 1 | null {
  if (input.type !== 'keyDown' || !input.control || input.alt) return null
  if (input.key === '=' || input.key === '+') return 1
  if (input.key === '-' || input.key === '_') return -1
  if (input.key === '0') return 0
  return null
}

// The window opens where it was last, or at 85% of the screen the first time.
function windowBounds(): { width: number; height: number; x?: number; y?: number; maximized?: boolean } {
  try {
    const b = JSON.parse(getSetting(db, 'win_bounds') ?? '')
    const area = screen.getDisplayMatching(b).workArea
    // Only reuse it if it is still on a connected screen.
    if (b.width >= 900 && b.height >= 600 && b.x >= area.x - 50 && b.y >= area.y - 50) return b
  } catch {
    // first start
  }
  const a = screen.getPrimaryDisplay().workAreaSize
  return { width: Math.max(1100, Math.round(a.width * 0.85)), height: Math.max(700, Math.round(a.height * 0.85)) }
}

function createWindow(): void {
  const bounds = windowBounds()
  win = new BrowserWindow({
    icon,
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0B0D12',
    title: 'Life System',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true
    }
  })
  win.once('ready-to-show', () => {
    if (bounds.maximized) win?.maximize()
    win?.show()
  })
  const saveBounds = () => {
    if (!win || win.isMinimized()) return
    setSetting(db, 'win_bounds', JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }))
  }
  win.on('enter-full-screen', () => win?.webContents.send('ui:fullscreen', true))
  win.on('leave-full-screen', () => win?.webContents.send('ui:fullscreen', false))
  win.on('resized', saveBounds)
  win.on('moved', saveBounds)
  win.on('maximize', saveBounds)
  win.on('unmaximize', saveBounds)
  win.webContents.on('did-finish-load', () => win?.webContents.setZoomFactor(savedZoom()))
  win.webContents.on('before-input-event', (event, input) => {
    const z = zoomKey(input)
    if (z !== null) {
      event.preventDefault()
      changeZoom(z)
    }
  })
  // Closing hides to the tray so reminders keep coming; Quit is in the tray menu.
  win.on('close', (e) => {
    if (!quitting && tray && prefs().keepInTray) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => {
    win = null
    // Hidden helper windows (the Finance reader) shouldn't keep the app alive.
    if (!tray || !prefs().keepInTray) app.quit()
  })
  // Links open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (isDev && process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function createTray(): void {
  tray = new Tray(nativeImage.createFromBuffer(appIconPng(32)))
  tray.setToolTip('Life System')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Life System', click: showWindow },
      { label: 'Urge crusher', click: openUrgeCrusher },
      { label: 'Lock now', click: () => lockNow() },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit() } }
    ])
  )
  tray.on('click', showWindow)
}

// Panic button: one shortcut from anywhere opens the urge crusher.
const PANIC_KEY = 'CommandOrControl+Alt+U'
function openUrgeCrusher(): void {
  showWindow()
  const send = () => win?.webContents.send('nav:urge')
  if (win?.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
}

function lockNow(): void {
  auth.lock()
  win?.webContents.send('auth:locked')
}

// Block reminders as Windows notifications, checked every 30 seconds.
const sentReminders = new Set<string>()
function checkReminders(): void {
  if (!Notification.isSupported()) return
  try {
    for (const r of dueReminders(schedule.state().blocks, new Date(), sentReminders)) {
      sentReminders.add(r.key)
      const n = new Notification({ title: r.title, body: r.body, icon })
      n.on('click', showWindow)
      n.show()
    }
  } catch (e) {
    console.error('reminder check failed', e)
  }
}

app.on('second-instance', showWindow)

app.whenReady().then(() => {
  app.setAppUserModelId('Life System')
  // Before any embedded app opens its storage.
  try {
    migration = migrateStandaloneData()
  } catch (e) {
    console.error('moving app data failed', e)
  }
  try {
    financeHost = setupFinance(appsDir(), () => navigate('money'))
    if (!globalShortcut.register('CommandOrControl+Alt+N', () => financeHost?.quickAdd())) console.warn('could not register Ctrl+Alt+N')
  } catch (e) {
    console.error('Finance Helper could not start', e)
  }
  createWindow()
  createTray()
  if (!globalShortcut.register(PANIC_KEY, openUrgeCrusher)) console.warn(`could not register ${PANIC_KEY}`)
  checkReminders()
  setInterval(checkReminders, 30_000)
  syncConnections()
  setInterval(syncConnections, 5 * 60_000)
  // Look for a new version shortly after start and every 4 hours.
  setTimeout(() => updater.check(), 15_000)
  setInterval(() => updater.check(), 4 * 3600_000)
  backups.run()
  setInterval(() => backups.run(), BACKUP_EVERY_MS)
  // Lock when Windows locks or sleeps.
  powerMonitor.on('lock-screen', lockNow)
  powerMonitor.on('suspend', lockNow)
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('before-quit', () => {
  quitting = true
  backups.run()
  if (db.open) db.close()
})

app.on('window-all-closed', () => {
  if (!tray || !prefs().keepInTray) app.quit()
})
