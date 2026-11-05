// Island eyes, the desktop side (EY1–EY3, EY6). Off until you turn it on in
// Settings → Island eyes. Every look goes through one gate (eyesGuard:
// switches, Pause, your private list, the rate limit) and only a short
// summary is kept; no picture is ever stored or sent.
//
// - EY1: when the window in front changes (the island's watcher already
//   tells us; nothing new polls), one UI Automation read of its text.
// - EY2: "Read screen" on the island (or, if you allow it, once for a window
//   that gave little text): a capture of that window → Windows OCR.
// - EY3: a one-line caption from the downloaded Florence-2 model, run in a
//   worker in the app window (which stops after 2 idle minutes).
import { BrowserWindow, ipcMain, powerMonitor, type IpcMainEvent, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { addLog, checkSeen, cleanEyesPrefs, cleanLog, deniedBy, denyRegex, mayLook, newGuardState, noteLook, pauseLabel, pauseUntil, skipLine, whyText, type EyeKind, type EyesLogEntry, type EyesPrefs, type PauseChoice } from '../../core/eyesGuard'
import { eyesHint, seenLine, type EyesSeen } from '../../core/eyesSense'
import { appLabel } from '../../core/pcActivity'
import type { EyesInfo, EyesModelStatus, EyesState } from '../../shared/eyes'
import { bgraToRgb, captureWindow, ocrImage } from './capture'
import { createModels, MODEL_SIZE_ESTIMATE } from './models'
import { readActiveWindow, type WindowRead } from './uia'

/** A window that gave fewer characters than this is "little text" (EY2's own fallback). */
const LITTLE_TEXT = 80
/** Wait this long after a switch before reading (a quick Alt+Tab past a window reads nothing). */
const SETTLE_MS = 1500
const CAPTION_SIZE = 768
const OCR_SIZE = 1600

export interface EyesHandle {
  /** The protocol handler asks: is this one of the eyes' files? */
  serve(pathname: string): Promise<Response | null>
  /** Once the app window exists. `onChange`: the tray menu should be rebuilt. */
  attach(win: BrowserWindow, onChange: () => void, goalWords?: () => string[]): void
  /** The window in front changed (from the island's watcher; the title only with that switch on). */
  noteWindow(proc: string, title: string | null): void
  /** Tray menu items (Pause the eyes…), only when the eyes are on. */
  trayItems(refresh: () => void): MenuItemConstructorOptions[]
}

export function createEyes(o: { dir: string; origin: string }): EyesHandle {
  const file = join(o.dir, 'eyes.json')
  let prefs: EyesPrefs = cleanEyesPrefs(null)
  let log: EyesLogEntry[] = []
  let guard = newGuardState()
  let reading: EyeKind | null = null
  let last: EyesSeen | null = null
  let win: BrowserWindow | null = null
  let changed = () => {}
  let goals: () => string[] = () => []
  const loaded = readFile(file, 'utf8')
    .then((t) => {
      const j = JSON.parse(t)
      prefs = cleanEyesPrefs(j.prefs)
      log = cleanLog(j.log)
    })
    .catch(() => {})
  let saveTimer: NodeJS.Timeout | null = null
  const save = () => {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void writeFile(file, JSON.stringify({ prefs, log })).catch(() => {})
    }, 500)
  }

  const models = createModels({ dir: o.dir, onStatus: () => broadcast() })

  // ---- who may ask: the app's own pages (the app window and the island), never the embedded apps ----
  const own = (e: IpcMainEvent | IpcMainInvokeEvent) => {
    const url = e.senderFrame?.url ?? ''
    return url.startsWith(o.origin + '/') && !url.startsWith(o.origin + '/apps/')
  }
  const pages = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.webContents.getURL().startsWith(o.origin + '/'))
  const state = (): EyesState => ({ windows: process.platform === 'win32', prefs, pausedUntil: prefs.pausedUntil > Date.now() ? prefs.pausedUntil : 0, reading, last, model: models.status() })
  const info = (): EyesInfo => ({ ...state(), log, modelSize: MODEL_SIZE_ESTIMATE })
  let lastSent = ''
  const broadcast = () => {
    const s = state()
    const key = JSON.stringify(s)
    if (key === lastSent) return
    lastSent = key
    for (const w of pages()) w.webContents.send('eyes:state', s)
  }
  const setReading = (k: EyeKind | null) => {
    reading = k
    broadcast()
  }
  // A pause that ran out: tell the pages and the tray once.
  let pauseTimer: NodeJS.Timeout | null = null
  const armPause = () => {
    if (pauseTimer) clearTimeout(pauseTimer)
    pauseTimer = null
    const left = prefs.pausedUntil - Date.now()
    if (prefs.pausedUntil && left > 0 && left < 2 ** 31 - 1) pauseTimer = setTimeout(() => (broadcast(), changed()), left + 500)
  }

  const keep = (kind: EyeKind, app: string, outcome: EyesLogEntry['outcome'], summary: string) => {
    log = addLog(log, { at: Date.now(), kind, app, summary, outcome })
    save()
  }

  /** What an eye found → checked → kept (or skipped) → the pages. */
  const found = (kind: EyeKind, raw: { proc: string; title: string; text: string }) => {
    const app = appLabel(raw.proc, null)
    const c = checkSeen({ proc: raw.proc, app, title: raw.title, text: raw.text }, prefs.deny)
    if (c.outcome !== 'kept') {
      keep(kind, app, c.outcome, skipLine(c.outcome, c.rule))
      return null
    }
    const summary = seenLine({ app, title: c.title, text: c.text, kind })
    if (!summary) {
      keep(kind, app, 'empty', skipLine('empty'))
      return null
    }
    keep(kind, app, 'kept', summary)
    // The offer is worked out here, from the short title and text (never the long text);
    // the app window drops a focus offer while a timer runs.
    const hint = prefs.suggest ? eyesHint({ title: c.title, text: c.text, running: false, goals: goals() }) : null
    last = { at: Date.now(), kind, app, summary, hint }
    if (win && !win.isDestroyed()) win.webContents.send('eyes:seen', last)
    broadcast()
    return last
  }

  // ---- EY1: the window in front changed ----
  let lastKey = ''
  let settle: NodeJS.Timeout | null = null
  let littleFor = ''
  let ocrDoneFor = ''
  const readWindow = async (manual: boolean) => {
    const a = mayLook(prefs, guard, { kind: 'read', now: Date.now(), manual, busy: !!reading })
    if (!a.ok) return { ok: false, said: whyText(a) }
    guard = noteLook(guard, 'read', Date.now())
    setReading('read')
    let r: WindowRead | null = null
    try {
      r = await readActiveWindow(denyRegex(prefs.deny), true)
    } finally {
      setReading(null)
    }
    if (!r) return { ok: false, said: 'Nothing to read' }
    if (r.denied) {
      keep('read', appLabel(r.proc, null), 'denied', skipLine('denied'))
      return { ok: false, said: 'On your private list' }
    }
    const seen = found('read', r)
    const key = `${r.proc}|${r.title}`
    littleFor = r.text.replace(/\s+/g, '').length < LITTLE_TEXT ? key : ''
    // EY2's fallback: a window with little text gets one screen read (only with that switch on).
    if (littleFor && prefs.ocrAuto && ocrDoneFor !== key) {
      ocrDoneFor = key
      setTimeout(() => void readScreen(false, key), 500)
    }
    return { ok: !!seen, said: seen ? seen.summary : 'Nothing kept' }
  }
  const noteWindow = (proc: string, title: string | null) => {
    if (!prefs.on || !prefs.read || prefs.pausedUntil > Date.now()) return
    // Without a title (the app sensor's titles are off) only a change of app counts.
    if (title == null && lastKey.split('|')[0] === proc) return
    const key = `${proc}|${title ?? ''}`
    if (key === lastKey) return
    lastKey = key
    // Known private from the app name / title already: not even a look.
    if (deniedBy({ proc, app: appLabel(proc, null), title }, prefs.deny)) return
    if (settle) clearTimeout(settle)
    settle = setTimeout(() => {
      settle = null
      void readWindow(false)
    }, SETTLE_MS)
  }

  // ---- EY2: the screen's text, from a capture of just that window ----
  const readScreen = async (manual: boolean, onlyFor?: string) => {
    const a = mayLook(prefs, guard, { kind: 'ocr', now: Date.now(), manual, busy: !!reading })
    if (!a.ok) return { ok: false, said: whyText(a) }
    if (process.platform !== 'win32') return { ok: false, said: 'Screen reading works on Windows only' }
    guard = noteLook(guard, 'ocr', Date.now())
    setReading('ocr')
    try {
      // App, title and handle first (no text), so your list is checked before the capture.
      const w = await readActiveWindow(denyRegex(prefs.deny), false)
      if (!w) return { ok: false, said: 'No window to read' }
      if (w.denied || deniedBy({ proc: w.proc, app: appLabel(w.proc, null), title: w.title }, prefs.deny)) {
        keep('ocr', appLabel(w.proc, null), 'denied', skipLine('denied'))
        return { ok: false, said: 'On your private list' }
      }
      // The automatic fallback reads only the window it was meant for.
      if (onlyFor && `${w.proc}|${w.title}` !== onlyFor) return { ok: false, said: '' }
      let img = await captureWindow(w.hwnd, OCR_SIZE)
      if (!img) return { ok: false, said: "Couldn't see that window" }
      const r = await ocrImage(img)
      img = null
      if (!r.ok) return { ok: false, said: r.error ?? 'Could not read the screen' }
      const seen = found('ocr', { proc: w.proc, title: w.title, text: r.text })
      return { ok: !!seen, said: seen ? `Read: ${seen.summary}` : 'Nothing kept' }
    } finally {
      setReading(null)
    }
  }

  // ---- EY3: a caption (the app window's worker runs the model) ----
  const jobs = new Map<string, (r: { ok: boolean; text?: string; error?: string }) => void>()
  const captionNow = async (manual: boolean) => {
    const a = mayLook(prefs, guard, { kind: 'caption', now: Date.now(), manual, busy: !!reading })
    if (!a.ok) return { ok: false, said: whyText(a) }
    if (!models.ready()) return { ok: false, said: 'Download the caption model first (Settings → Island eyes)' }
    if (!win || win.isDestroyed()) return { ok: false, said: 'The app is not open' }
    if (process.platform !== 'win32') return { ok: false, said: 'Captions work on Windows only' }
    guard = noteLook(guard, 'caption', Date.now())
    setReading('caption')
    try {
      const w = await readActiveWindow(denyRegex(prefs.deny), false)
      if (!w) return { ok: false, said: 'No window to look at' }
      if (w.denied || deniedBy({ proc: w.proc, app: appLabel(w.proc, null), title: w.title }, prefs.deny)) {
        keep('caption', appLabel(w.proc, null), 'denied', skipLine('denied'))
        return { ok: false, said: 'On your private list' }
      }
      let img = await captureWindow(w.hwnd, CAPTION_SIZE)
      if (!img) return { ok: false, said: "Couldn't see that window" }
      const { width, height } = img.getSize()
      const rgb = bgraToRgb(img.toBitmap(), width, height)
      img = null
      const id = `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
      const r = await new Promise<{ ok: boolean; text?: string; error?: string }>((done) => {
        const t = setTimeout(() => (jobs.delete(id), done({ ok: false, error: 'The caption took too long' })), 120_000)
        jobs.set(id, (x) => (clearTimeout(t), jobs.delete(id), done(x)))
        win!.webContents.send('eyes:captionJob', { id, w: width, h: height, rgb })
      })
      if (!r.ok) return { ok: false, said: r.error || 'No caption' }
      const seen = found('caption', { proc: w.proc, title: '', text: String(r.text ?? '') })
      return { ok: !!seen, said: seen ? seen.summary : 'Nothing kept' }
    } finally {
      setReading(null)
    }
  }
  // Captions by themselves: only while you're at the PC (not idle 2 min, not locked), at your gap (5 min at least).
  let captionTimer: NodeJS.Timeout | null = null
  let locked = false
  const armCaptions = () => {
    if (captionTimer) clearInterval(captionTimer)
    captionTimer = null
    if (!prefs.on || !prefs.caption || !prefs.captionAuto || !models.ready()) return
    captionTimer = setInterval(() => {
      if (locked || powerMonitor.getSystemIdleTime() > 120) return
      void captionNow(false)
    }, Math.max(5, prefs.captionEveryMin) * 60_000)
  }
  powerMonitor.on('lock-screen', () => (locked = true))
  powerMonitor.on('unlock-screen', () => (locked = false))

  // ---- IPC ----
  const handle = (name: string, fn: (...a: any[]) => unknown) => ipcMain.handle(name, async (e, ...a) => (own(e) ? fn(...a) : null))
  handle('eyes:get', async () => (await loaded, info()))
  handle('eyes:set', async (patch: Partial<EyesPrefs>) => {
    await loaded
    const wasOn = prefs.on
    prefs = cleanEyesPrefs({ ...prefs, ...(patch && typeof patch === 'object' ? patch : {}) })
    if (!prefs.on && wasOn) lastKey = ''
    save()
    armPause()
    armCaptions()
    // Captions off: the model's worker stops now.
    if (!prefs.caption || !prefs.on) win?.webContents.send('eyes:captionUnload')
    broadcast()
    changed()
    return info()
  })
  const pause = (choice: PauseChoice) => {
    prefs = { ...prefs, pausedUntil: pauseUntil(['15m', '1h', 'tomorrow', 'forever', 'resume'].includes(choice) ? choice : '1h', Date.now()) }
    lastKey = ''
    save()
    armPause()
    broadcast()
    changed()
    return state()
  }
  handle('eyes:pause', (choice: PauseChoice) => pause(choice))
  handle('eyes:readScreen', () => readScreen(true))
  handle('eyes:captionNow', () => captionNow(true))
  handle('eyes:clearLog', () => {
    log = []
    save()
    return true
  })
  handle('eyes:modelDownload', async () => {
    const s = await models.download()
    armCaptions()
    return s
  })
  handle('eyes:modelCancel', () => models.cancel())
  handle('eyes:modelDelete', async () => {
    win?.webContents.send('eyes:captionUnload')
    const s = await models.remove()
    armCaptions()
    return s
  })
  ipcMain.on('eyes:captionDone', (e, id: unknown, r: { ok: boolean; text?: string; error?: string }) => {
    if (!win || e.sender !== win.webContents) return
    jobs.get(String(id))?.({ ok: !!r?.ok, text: String(r?.text ?? '').slice(0, 400), error: String(r?.error ?? '').slice(0, 200) })
  })

  void loaded.then(() => {
    armPause()
    armCaptions()
  })

  return {
    serve: (pathname) => models.serve(pathname),
    attach(w, onChange, goalWords) {
      win = w
      changed = onChange
      if (goalWords) goals = goalWords
      w.webContents.on('did-finish-load', () => {
        lastSent = ''
        broadcast()
      })
    },
    noteWindow,
    trayItems(refresh) {
      if (!prefs.on) return []
      const until = prefs.pausedUntil > Date.now() ? prefs.pausedUntil : 0
      if (until) return [{ label: `Island eyes: ${pauseLabel(until, Date.now()).toLowerCase()} · Resume`, click: () => (pause('resume'), refresh()) }]
      return [
        {
          label: 'Pause the island eyes',
          submenu: ([['15m', '15 minutes'], ['1h', '1 hour'], ['tomorrow', 'Until tomorrow 06:00'], ['forever', 'Until I resume']] as const).map(([c, label]) => ({ label, click: () => (pause(c), refresh()) }))
        }
      ]
    }
  }
}

export type { EyesModelStatus }
