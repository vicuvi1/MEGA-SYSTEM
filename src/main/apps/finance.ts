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
  /** Logs an expense or income transaction directly into Finance Helper's localStorage & sync folder. */
  addTransaction(tx: {
    type: 'expense' | 'income'
    amount: number
    category?: string
    note?: string
    date?: string
  }): Promise<{ ok: boolean; txId?: string; balanceTotal?: number; accountName?: string; error?: string }>
  /** Calculates the current balance across all Finance Helper accounts. */
  getFinanceSummary(): Promise<{ totalMdl: number; currency: string; accounts: { id: string; name: string; balanceMdl: number }[] } | null>
  /** Syncs a Telegram bot token and chat ID to Finance Helper's telegram.bin */
  syncTelegram(token: string, chatId: string): Promise<boolean>
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

  const ensureReader = async (): Promise<BrowserWindow> => {
    if (!reader || reader.isDestroyed()) {
      reader = new BrowserWindow({
        show: false,
        webPreferences: {
          partition: FINANCE_PARTITION,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      })
      await reader.loadURL('app://finance/__life-system-reader')
    }
    return reader
  }

  const addTransaction = async (tx: {
    type: 'expense' | 'income'
    amount: number
    category?: string
    note?: string
    date?: string
  }): Promise<{ ok: boolean; txId?: string; balanceTotal?: number; accountName?: string; error?: string }> => {
    try {
      const r = await ensureReader()
      const stateStr = await readState()
      let state: any = null
      if (stateStr && stateStr !== 'null') {
        try {
          state = JSON.parse(stateStr)
        } catch {
          state = null
        }
      }

      if (!state || typeof state !== 'object') {
        state = {
          v: 1,
          meta: { createdAt: Date.now() },
          settings: {
            currency: 'MDL',
            accounts: [{ id: 'acc-cash', name: 'Cash Wallet', kind: 'cash', currency: 'MDL', start: 0, color: '#38bdf8' }],
            categories: [
              { id: 'food', name: 'Food & Dining', emoji: '🍔' },
              { id: 'transit', name: 'Transit & Taxi', emoji: '🚕' },
              { id: 'home', name: 'Home & Rent', emoji: '🏠' },
              { id: 'sport', name: 'Sport & Gym', emoji: '⚡' },
              { id: 'health', name: 'Health & Pharmacy', emoji: '💊' },
              { id: 'clothes', name: 'Clothes & Shopping', emoji: '👕' },
              { id: 'fun', name: 'Fun & Entertainment', emoji: '🎉' },
              { id: 'other', name: 'Other', emoji: '📦' },
              { id: 'other-in', name: 'Income', emoji: '💰' }
            ]
          },
          tx: []
        }
      }

      if (!Array.isArray(state.tx)) state.tx = []
      if (!state.settings) state.settings = {}
      if (!Array.isArray(state.settings.accounts) || state.settings.accounts.length === 0) {
        state.settings.accounts = [{ id: 'acc-default', name: 'Main Account', kind: 'card', currency: 'MDL', start: 0, color: '#38bdf8' }]
      }

      const activeAccount = state.settings.accounts.find((a: any) => !a.archived) || state.settings.accounts[0]
      const accId = activeAccount.id
      const accName = activeAccount.name || 'Main Account'

      // Match category
      let catId = (tx.category || 'other').toLowerCase()
      if (catId === 'transport') catId = 'transit'
      else if (catId === 'entertainment') catId = 'fun'
      else if (catId === 'bills') catId = 'home'
      else if (tx.type === 'income') catId = 'other-in'

      const now = Date.now()
      const dateStr = tx.date || new Date().toISOString().slice(0, 10)
      const txId = 'ls-' + now + '-' + Math.random().toString(36).slice(2, 7)

      const newRecord = {
        id: txId,
        createdAt: now,
        updatedAt: now,
        type: tx.type || 'expense',
        amount: Math.round(tx.amount),
        currency: activeAccount.currency || state.settings.currency || 'MDL',
        rate: 1,
        base: Math.round(tx.amount),
        date: dateStr,
        category: catId,
        account: accId,
        note: tx.note || '',
        source: 'telegram-bridge'
      }

      state.tx.push(newRecord)
      const serialized = JSON.stringify(state)

      // Save to localStorage in partition
      await r.webContents.executeJavaScript(
        `localStorage.setItem('finance-helper.state', ${JSON.stringify(serialized)}); true;`
      )

      // Sync folder backup
      try {
        folder.push(JSON.stringify({ v: 1, data: state }))
      } catch (err) {
        console.warn('Finance folder sync push warning:', err)
      }

      // Notify live page if open
      toPage('tg-updates', [
        {
          update_id: now,
          message: {
            message_id: now,
            date: Math.floor(now / 1000),
            text: `${tx.type === 'income' ? '+' : ''}${tx.amount / 100} ${tx.note || ''}`
          }
        }
      ])

      // Compute total balance in bani
      const bal: Record<string, number> = {}
      for (const a of state.settings.accounts) bal[a.id] = a.start || 0
      for (const t of state.tx) {
        if (t.type === 'income' && t.account in bal) bal[t.account] += t.amount
        else if (t.type === 'expense' && t.account in bal) bal[t.account] -= t.amount
        else if (t.type === 'transfer') {
          if (t.from in bal) bal[t.from] -= t.amount
          if (t.to in bal) bal[t.to] += (Number.isInteger(t.toAmount) ? t.toAmount : t.amount)
        }
      }

      let totalBani = 0
      for (const a of state.settings.accounts) {
        if (!a.archived) totalBani += (bal[a.id] || 0)
      }

      return {
        ok: true,
        txId,
        balanceTotal: totalBani,
        accountName: accName
      }
    } catch (err: any) {
      return { ok: false, error: err.message || 'Failed to add finance transaction' }
    }
  }

  const getFinanceSummary = async (): Promise<{ totalMdl: number; currency: string; accounts: { id: string; name: string; balanceMdl: number }[] } | null> => {
    try {
      const stateStr = await readState()
      if (!stateStr || stateStr === 'null') return null
      const state = JSON.parse(stateStr)
      if (!state || !state.settings || !Array.isArray(state.settings.accounts)) return null

      const bal: Record<string, number> = {}
      for (const a of state.settings.accounts) bal[a.id] = a.start || 0
      for (const t of state.tx || []) {
        if (t.type === 'income' && t.account in bal) bal[t.account] += t.amount
        else if (t.type === 'expense' && t.account in bal) bal[t.account] -= t.amount
        else if (t.type === 'transfer') {
          if (t.from in bal) bal[t.from] -= t.amount
          if (t.to in bal) bal[t.to] += (Number.isInteger(t.toAmount) ? t.toAmount : t.amount)
        }
      }

      const accounts: { id: string; name: string; balanceMdl: number }[] = []
      let totalBani = 0
      for (const a of state.settings.accounts) {
        if (a.archived) continue
        const b = bal[a.id] || 0
        totalBani += b
        accounts.push({ id: a.id, name: a.name || 'Account', balanceMdl: Math.round(b) / 100 })
      }

      return {
        totalMdl: Math.round(totalBani) / 100,
        currency: state.settings.currency || 'MDL',
        accounts
      }
    } catch {
      return null
    }
  }

  const syncTelegram = async (token: string, chatId: string): Promise<boolean> => {
    try {
      if (!token) return false
      const binFile = join(dataDir, 'telegram.bin')
      const obj = {
        token,
        botName: 'LifeSystemFinanceBot',
        chatId: Number(chatId) || chatId,
        userName: 'Owner'
      }
      const raw = JSON.stringify(obj)
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        writeFileSync(binFile, safeStorage.encryptString(raw))
      } else {
        writeFileSync(binFile, Buffer.from(raw, 'utf8'))
      }
      telegram.connect(token).catch(() => {})
      return true
    } catch (e) {
      console.warn('Failed to sync telegram.bin for finance helper:', e)
      return false
    }
  }

  return {
    readState,
    preload: join(root, 'electron', 'preload.cjs'),
    quickAdd: () => {
      onShow()
      toPage('quick-add')
    },
    addTransaction,
    getFinanceSummary,
    syncTelegram
  }
}
