import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, powerMonitor, shell } from 'electron'
import type { IpcReply, RewardInput, Rule } from '@shared/api'
import { openDb, type DB } from './db'
import { Wallet } from './wallet'
import { Auth } from './auth'
import { Backups } from './backup'
import { SecretStore } from './secrets'
import { Shop } from './shop'

const isDev = !app.isPackaged
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
let win: BrowserWindow | null = null

function open(): void {
  db = openDb(dbFile)
  wallet = new Wallet(db)
  auth = new Auth(db)
  shop = new Shop(db, wallet)
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

function createWindow(): void {
  win = new BrowserWindow({
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
  // Links open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (isDev && process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  createWindow()
  backups.run()
  setInterval(() => backups.run(), BACKUP_EVERY_MS)
  // Lock when Windows locks or sleeps.
  const lockNow = () => {
    auth.lock()
    win?.webContents.send('auth:locked')
  }
  powerMonitor.on('lock-screen', lockNow)
  powerMonitor.on('suspend', lockNow)
})

app.on('before-quit', () => {
  backups.run()
  if (db.open) db.close()
})

app.on('window-all-closed', () => app.quit())
