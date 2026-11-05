// Ben on this PC (Windows), the desktop side. Everything that watches you is
// a switch in Settings → Ben on this PC (P1), off for the app sensor until you
// turn it on, and stays on this computer:
// - the app in front (P2) → work / distraction (P3), the day's totals (P8);
// - lock the PC for a break (P14), Windows Do Not Disturb (P20);
// - taskbar shortcuts (P17);
// - a tiny local server for the browser helper that keeps sites away during
//   focus (P19): 127.0.0.1 only, with a secret token.
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { activityLine, addActivity, appLabel, classifyApp, cleanPcPrefs, type AppKind, type DayActivity, type PcPrefs } from '../core/pcActivity'
import { addFocusSample, FOCUS_SAMPLE_SEC, focusAppsSummary, newFocusApps, type FocusApps } from '../core/focusApps'
import { browserDistraction } from './history'
import { calendarDay } from '../core/dates'

export const SITE_PORT = 47321

export interface PcHandle {
  prefs(): PcPrefs
  /** A sample from the Windows watcher (every ~4 s): the process in front and maybe its title. */
  sample(proc: string, title: string | null, seconds: number): void
  /** Focus running? (from the app window) */
  focus(): { running: boolean; subject: string; endsAt: number; startedAt: number }
  /** Jump-list / second-start actions ("--action=focus25"). */
  actionFrom(argv: string[]): string | null
}

const dayKey = (d = new Date()) => calendarDay(d)

export async function createPc(o: { dir: string; win: BrowserWindow; onPrefs: (p: PcPrefs) => void; onAction: (a: string) => void }): Promise<PcHandle> {
  const file = join(o.dir, 'pc.json')
  const histDir = join(o.dir, 'pc-activity')
  let prefs = cleanPcPrefs(null)
  let token = ''
  try {
    const j = JSON.parse(await readFile(file, 'utf8'))
    prefs = cleanPcPrefs(j.prefs)
    token = typeof j.token === 'string' ? j.token : ''
  } catch {
    /* first run: the defaults (app sensor off) */
  }
  if (!token) token = randomBytes(12).toString('hex')
  const save = () => writeFile(file, JSON.stringify({ prefs, token })).catch(() => {})
  await save()

  // ---- the day's activity (P8): only kept when "history" is on, only on this PC ----
  let today: DayActivity | null = null
  const histFile = (day: string) => join(histDir, `${day}.json`)
  try {
    today = JSON.parse(await readFile(histFile(dayKey()), 'utf8'))
  } catch {
    today = null
  }
  let dirty = false
  setInterval(async () => {
    if (!dirty || !today || !prefs.history) return
    dirty = false
    await mkdir(histDir, { recursive: true }).catch(() => {})
    await writeFile(histFile(today.day), JSON.stringify(today)).catch(() => {})
  }, 60_000)

  let focusState = { running: false, subject: '', endsAt: 0, startedAt: 0 }
  let current: { label: string; kind: AppKind } | null = null
  const sample = (proc: string, title: string | null, seconds: number) => {
    if (!prefs.activeApp || !proc) return
    const t = prefs.titles ? title : null
    const kind = classifyApp(proc, t, prefs)
    const label = appLabel(proc, t)
    current = { label, kind }
    if (prefs.history) {
      today = addActivity(today, dayKey(), label, kind, seconds)
      dirty = true
    }
    if (!o.win.isDestroyed()) o.win.webContents.send('desktop:app', { label, kind, seconds })
  }

  // ---- IPC (only the app window) ----
  const mine = (e: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => e.sender === o.win.webContents
  ipcMain.handle('pc:getPrefs', (e) => (mine(e) ? { prefs, port: SITE_PORT, token, now: current, windows: process.platform === 'win32', siteServer: serverProblem } : null))
  ipcMain.handle('pc:setPrefs', async (e, p: Partial<PcPrefs>) => {
    if (!mine(e)) return null
    prefs = cleanPcPrefs({ ...prefs, ...p })
    if (!prefs.activeApp) current = null
    if (!prefs.browserHistory) historyCache = null
    await save()
    o.onPrefs(prefs)
    return prefs
  })
  /** What it saw today (the totals), for the privacy page and Ben (if you share). */
  ipcMain.handle('pc:today', (e) => (mine(e) ? { line: activityLine(today && today.day === dayKey() ? today : null), apps: today && today.day === dayKey() ? today.apps : {} } : null))
  /** Delete every day of app history on this PC. */
  ipcMain.handle('pc:clear', async (e) => {
    if (!mine(e)) return false
    today = null
    await rm(histDir, { recursive: true, force: true }).catch(() => {})
    return true
  })
  ipcMain.on('pc:focus', (e, f: { running: boolean; subject: string; endsAt: number; startedAt?: number }) => {
    if (mine(e)) focusState = { running: !!f?.running, subject: String(f?.subject ?? '').slice(0, 60), endsAt: Number(f?.endsAt) || 0, startedAt: Number(f?.startedAt) || 0 }
  })

  // ---- MC10: honest focus from what's on screen ----
  // While a focus timer runs (and the app sensor is on), every 30 s: the app in
  // front counts as work, distraction or other for this session. App names
  // only. 2 minutes of drift in a row: the island says it once.
  let session: FocusApps | null = null
  let lastSession: FocusApps | null = null
  setInterval(() => {
    const on = focusState.running && focusState.endsAt > Date.now() && focusState.startedAt > 0
    if (!on || (session && session.startedAt !== focusState.startedAt)) {
      if (session) lastSession = session
      session = null
    }
    if (!on || !prefs.activeApp || !current) return
    session ??= newFocusApps(focusState.startedAt, focusState.subject)
    const r = addFocusSample(session, current.kind, current.label, FOCUS_SAMPLE_SEC)
    session = r.s
    if (r.warn && !o.win.isDestroyed()) o.win.webContents.send('desktop:drift', { startedAt: session.startedAt, label: current.label, subject: session.subject, minutes: Math.round(session.streakSec / 60) })
  }, FOCUS_SAMPLE_SEC * 1000)
  /** This session's (or the one that just ended) minutes on work vs distracting apps. */
  ipcMain.handle('pc:focusApps', (e, startedAt?: number) => {
    if (!mine(e)) return null
    const pick = [session, lastSession].find((x) => x && (!startedAt || x.startedAt === startedAt)) ?? null
    return pick ? { startedAt: pick.startedAt, subject: pick.subject, ...focusAppsSummary(pick)! } : null
  })

  // ---- MC11: distraction minutes from browser history (off until you turn it on) ----
  let historyCache: { at: number; value: Awaited<ReturnType<typeof browserDistraction>> } | null = null
  ipcMain.handle('pc:browserMinutes', async (e) => {
    if (!mine(e) || !prefs.browserHistory) return null
    if (historyCache && Date.now() - historyCache.at < 10 * 60_000) return historyCache.value
    const value = await browserDistraction(prefs.sites).catch(() => null)
    if (value) historyCache = { at: Date.now(), value }
    return value
  })
  /** P14: lock the PC (Windows), for a real break. */
  ipcMain.handle('pc:lock', (e) => {
    if (!mine(e) || process.platform !== 'win32') return false
    execFile('rundll32.exe', ['user32.dll,LockWorkStation'], () => {})
    return true
  })
  /** P20: Windows' own Do Not Disturb settings page. */
  ipcMain.handle('pc:dnd', (e) => {
    if (!mine(e)) return false
    void shell.openExternal(process.platform === 'win32' ? 'ms-settings:quiethours' : 'x-apple.systempreferences:com.apple.preference.notifications').catch(() => {})
    return true
  })
  /** Where the browser helper lives (to load it unpacked). */
  ipcMain.handle('pc:extensionFolder', async (e) => {
    if (!mine(e)) return null
    const dir = join(process.resourcesPath ?? '', 'extension')
    const ok = await readdir(dir).then(() => true, () => false)
    if (ok) void shell.openPath(dir)
    return ok ? dir : null
  })

  // ---- P19: the browser helper asks "is a focus block on, and which sites?" ----
  // BG17: if the port is busy it tries again (30 s, 1 min, 2 min… up to 10 min)
  // and the PC privacy page shows why. LT20: the token is compared in
  // constant time, and only the browser helper (an extension) may read it.
  let server: Server | null = null
  let serverProblem: string | null = null
  let retry: NodeJS.Timeout | null = null
  let delay = 30_000
  const sameToken = (got: string | null) => {
    const a = Buffer.from(String(got ?? ''))
    const b = Buffer.from(token)
    return a.length === b.length && b.length > 0 && timingSafeEqual(a, b)
  }
  const startServer = () => {
    if (server) return
    const srv = createServer((req, res) => {
      const u = new URL(req.url ?? '/', `http://127.0.0.1:${SITE_PORT}`)
      const origin = String(req.headers.origin ?? '')
      if (/^(chrome|moz)-extension:\/\//.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Content-Type', 'application/json')
      if (u.pathname !== '/focus' || !sameToken(u.searchParams.get('token'))) {
        res.statusCode = 403
        return res.end('{"error":"no"}')
      }
      const on = prefs.blockSites && focusState.running && focusState.endsAt > Date.now()
      res.end(JSON.stringify({ on, subject: on ? focusState.subject : '', endsAt: on ? focusState.endsAt : 0, sites: on ? prefs.sites : [] }))
    })
    srv.on('error', (err: NodeJS.ErrnoException) => {
      server = null
      serverProblem = err.code === 'EADDRINUSE' ? `Port ${SITE_PORT} is used by another program; trying again soon` : `The site blocker couldn't start (${err.code ?? err.message}); trying again soon`
      if (retry) clearTimeout(retry)
      retry = setTimeout(startServer, delay)
      delay = Math.min(delay * 2, 10 * 60_000)
    })
    srv.on('listening', () => {
      serverProblem = null
      delay = 30_000
    })
    server = srv
    srv.listen(SITE_PORT, '127.0.0.1')
  }
  startServer()
  app.on('will-quit', () => {
    if (retry) clearTimeout(retry)
    try {
      server?.close()
    } catch {
      /* fine */
    }
  })

  // ---- P17: right-click the taskbar icon ----
  if (process.platform === 'win32') {
    try {
      app.setUserTasks([
        { program: process.execPath, arguments: '--action=focus25', iconPath: process.execPath, iconIndex: 0, title: 'Start a 25-min focus', description: 'Starts a focus timer' },
        { program: process.execPath, arguments: '--action=talk', iconPath: process.execPath, iconIndex: 0, title: 'Talk to Ben', description: 'A voice note to Ben' },
        { program: process.execPath, arguments: '--action=capture', iconPath: process.execPath, iconIndex: 0, title: 'Capture a task', description: 'Add a task to Todoist' }
      ])
    } catch {
      /* not on this Windows */
    }
  }
  const actionFrom = (argv: string[]) => argv.find((a) => a.startsWith('--action='))?.slice(9) ?? null
  const first = actionFrom(process.argv)
  if (first) setTimeout(() => o.onAction(first), 4000)

  return { prefs: () => prefs, sample, focus: () => focusState, actionFrom }
}
