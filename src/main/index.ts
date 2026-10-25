import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, powerMonitor, shell, Tray } from 'electron'
import { dueReminders } from '@core/plan'
import type { AppPrefs, BlockInput, Category, IpcReply, RewardInput, Rule, TaskInput } from '@shared/api'
import { getSetting, openDb, setSetting, type DB } from './db'
import { Wallet } from './wallet'
import { Auth } from './auth'
import { Backups } from './backup'
import { SecretStore } from './secrets'
import { Shop } from './shop'
import { Schedule, Tasks } from './planner'
import { appIconPng } from './icon'

const isDev = !app.isPackaged
// One copy at a time; a second launch just brings the window back.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}
app.setPath('userData', join(app.getPath('appData'), isDev ? 'LifeSystem-dev' : 'LifeSystem'))

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

function prefs(): AppPrefs {
  return {
    openAtLogin: app.isPackaged && app.getLoginItemSettings().openAtLogin,
    canAutoStart: app.isPackaged,
    keepInTray: getSetting(db, 'keep_in_tray') !== '0'
  }
}
handle('app:prefs', () => prefs())
handle('app:setPrefs', (p: Partial<AppPrefs>) => {
  if (p.openAtLogin !== undefined) {
    if (!app.isPackaged) throw new Error('Start with Windows works in the installed app')
    app.setLoginItemSettings({ openAtLogin: p.openAtLogin })
  }
  if (p.keepInTray !== undefined) setSetting(db, 'keep_in_tray', p.keepInTray ? '1' : '0')
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

function createWindow(): void {
  win = new BrowserWindow({
    icon,
    width: 1280,
    height: 820,
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
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  // Closing hides to the tray so reminders keep coming; Quit is in the tray menu.
  win.on('close', (e) => {
    if (!quitting && tray && prefs().keepInTray) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => (win = null))
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
      { label: 'Lock now', click: () => lockNow() },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit() } }
    ])
  )
  tray.on('click', showWindow)
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
  createWindow()
  createTray()
  checkReminders()
  setInterval(checkReminders, 30_000)
  backups.run()
  setInterval(() => backups.run(), BACKUP_EVERY_MS)
  // Lock when Windows locks or sleeps.
  powerMonitor.on('lock-screen', lockNow)
  powerMonitor.on('suspend', lockNow)
})

app.on('before-quit', () => {
  quitting = true
  backups.run()
  if (db.open) db.close()
})

app.on('window-all-closed', () => {
  if (!tray || !prefs().keepInTray) app.quit()
})
