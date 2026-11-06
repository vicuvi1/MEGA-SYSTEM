// Island 2, the desktop's part (one IPC channel, `islandKit`): a global
// shortcut per tile or button (IN41), your own profiles switched by the app
// in front, the Wi-Fi name or the time (IN37), the mini dock window (IN38),
// the clipboard tray (IN42) and the file shelf (IN48).
//
// Light on the PC and on start-up: nothing here blocks the main process; the
// clipboard is read only while the tray is on and the island is shown; the
// Wi-Fi name is asked only when a profile uses one (every 2 minutes, async);
// the dock window exists only while it is on.
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, powerMonitor, screen, shell } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { registrable, shortcutConflicts, type KitShortcut, type ShortcutProblem } from '../core/islandTiles'
import { addClip, addShelf, cleanKitProfiles, cleanPath, cleanShelf, clipAllowed, parseWifiName, pickKitProfile, pinClip, type ClipItem, type KitProfile, type ShelfItem } from '../core/islandKitExtras'

export interface KitIsland {
  /** Send an event to the island page. */
  send(ev: Record<string, unknown>): void
  /** Is this the island page? */
  isIsland(wc: Electron.WebContents): boolean
  /** The island's own shortcuts (a tile can't take them). */
  reserved(): { accelerator: string; what: string }[]
  /** Shown (not hidden, not off). */
  shown(): boolean
}

export function createIslandKit(o: { origin: string; preload: string; appWindow: BrowserWindow; dir: string; island: KitIsland }) {
  const file = join(o.dir, 'island-kit.json')
  let saved: { shelf?: unknown; dock?: { x: number; y: number } | null } = {}
  try { if (existsSync(file)) saved = JSON.parse(readFileSync(file, 'utf8')) } catch { /* defaults */ }
  let shelf: ShelfItem[] = cleanShelf(saved.shelf)
  let dockAt: { x: number; y: number } | null = saved.dock && Number.isFinite(saved.dock.x) && Number.isFinite(saved.dock.y) ? saved.dock : null
  const save = () => { try { writeFileSync(file, JSON.stringify({ shelf, dock: dockAt })) } catch { /* fine */ } }

  // ---- IN41: shortcuts ----
  let bound: KitShortcut[] = []
  let problems: ShortcutProblem[] = []
  const setShortcuts = (list: KitShortcut[]) => {
    for (const s of bound) { try { globalShortcut.unregister(s.accelerator) } catch { /* fine */ } }
    bound = []
    problems = shortcutConflicts(list, o.island.reserved())
    for (const s of registrable(list, problems)) {
      let ok = false
      try { ok = globalShortcut.register(s.accelerator, () => o.island.send({ type: 'shortcut', id: s.id })) } catch { ok = false }
      if (ok) bound.push(s)
      else problems.push({ ...s, why: 'another app already uses it' })
    }
    return problems
  }

  // ---- IN37: your own profiles ----
  let profiles: KitProfile[] = []
  let fgProc = ''
  let wifi: string | null = null
  let active: string | null = null
  const checkProfile = () => {
    const p = pickKitProfile(profiles, { app: fgProc || null, wifi, now: new Date() })
    const id = p?.id ?? null
    if (id === active) return
    active = id
    o.island.send({ type: 'profile', id })
  }
  let wifiBusy = false
  const askWifi = () => {
    if (process.platform !== 'win32' || wifiBusy || !profiles.some((p) => p.wifi.length)) return
    wifiBusy = true
    execFile('netsh', ['wlan', 'show', 'interfaces'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      wifiBusy = false
      const name = err ? null : parseWifiName(String(out))
      if (name !== wifi) { wifi = name; checkProfile() }
    })
  }
  setInterval(() => { askWifi(); checkProfile() }, 120_000)

  // ---- IN42: the clipboard tray ----
  let clipOn = false
  let clips: ClipItem[] = []
  let lastClip = ''
  let clipTimer: ReturnType<typeof setInterval> | null = null
  const readClip = async (): Promise<string> => { try { return String(await clipboard.readText()) } catch { return '' } }
  const setClipboard = (on: boolean) => {
    clipOn = on
    if (!on) {
      if (clipTimer) clearInterval(clipTimer)
      clipTimer = null
      clips = []
      o.island.send({ type: 'clips', list: [] })
      return
    }
    if (clipTimer) return
    // What was already there when you turned it on is never kept.
    void readClip().then((t) => { lastClip = t })
    clipTimer = setInterval(async () => {
      if (!clipOn || !o.island.shown()) return
      const t = await readClip()
      if (!t || t === lastClip) return
      lastClip = t
      if (!clipAllowed(t, { proc: fgProc })) return
      clips = addClip(clips, t, Date.now())
      o.island.send({ type: 'clips', list: clips })
    }, 1500)
  }

  // ---- IN38: the mini dock window ----
  let dock: BrowserWindow | null = null
  const openDock = () => {
    if (dock && !dock.isDestroyed()) return
    const wa = screen.getPrimaryDisplay().workArea
    const at = dockAt ?? { x: wa.x + wa.width - 320, y: wa.y + wa.height - 90 }
    // Kept on a screen you still have.
    const d = screen.getDisplayNearestPoint(at).workArea
    const x = Math.max(d.x, Math.min(d.x + d.width - 120, at.x))
    const y = Math.max(d.y, Math.min(d.y + d.height - 40, at.y))
    dock = new BrowserWindow({
      x, y, width: 300, height: 56, frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true, backgroundColor: '#00000000', focusable: false,
      type: process.platform === 'win32' ? 'toolbar' : undefined, title: 'Life System dock',
      webPreferences: { preload: o.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: true }
    })
    const w = dock
    try { w.setAlwaysOnTop(true, 'pop-up-menu') } catch { /* fine */ }
    try { w.setMenu(null) } catch { /* fine */ }
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    w.once('ready-to-show', () => { if (!w.isDestroyed() && o.island.shown()) w.showInactive() })
    // Dragged by its handle (the system moves it): the spot is kept.
    w.on('moved', () => {
      if (w.isDestroyed()) return
      const b = w.getBounds()
      dockAt = { x: b.x, y: b.y }
      save()
    })
    w.on('closed', () => { if (dock === w) dock = null })
    void w.loadURL(`${o.origin}/?island=1&dock=1`).catch(() => {})
  }
  const closeDock = () => { if (dock && !dock.isDestroyed()) dock.destroy(); dock = null }
  const fromDock = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => !!dock && !dock.isDestroyed() && e.sender === dock.webContents
  // The dock gets the same snapshots and answers as the island, and its taps go to the app window.
  ipcMain.on('island:state', (e, s) => { if (e.sender === o.appWindow.webContents && dock && !dock.isDestroyed()) dock.webContents.send('island:state', s) })
  ipcMain.on('island:ack', (e, a) => { if (e.sender === o.appWindow.webContents && dock && !dock.isDestroyed()) dock.webContents.send('island:ack', a) })
  ipcMain.on('island:action', (e, a) => { if (fromDock(e) && !o.appWindow.isDestroyed()) o.appWindow.webContents.send('island:action', a) })
  /** The island was hidden or shown: the dock follows. */
  const followIsland = () => {
    if (!dock || dock.isDestroyed()) return
    if (o.island.shown()) { if (!dock.isVisible()) dock.showInactive() } else if (dock.isVisible()) dock.hide()
  }
  setInterval(followIsland, 2000)

  // ---- IN-SC: the music pauses when the PC locks ----
  powerMonitor.on('lock-screen', () => o.island.send({ type: 'lock' }))

  // ---- MU: the media keys drive the island's music, only while its player is loaded ----
  // (While they are ours, other players don't get them; they go back when the music stops.)
  const MEDIA_KEYS: [string, string][] = [['MediaPlayPause', 'toggle'], ['MediaNextTrack', 'next'], ['MediaPreviousTrack', 'prev']]
  let mediaKeysOn = false
  const setMediaKeys = (on: boolean) => {
    if (on === mediaKeysOn) return mediaKeysOn
    mediaKeysOn = on
    for (const [key, op] of MEDIA_KEYS) {
      try {
        if (on) globalShortcut.register(key, () => o.island.send({ type: 'media', op }))
        else globalShortcut.unregister(key)
      } catch { /* another app has it */ }
    }
    return mediaKeysOn
  }

  ipcMain.handle('islandKit', async (e, op: string, arg: any) => {
    const isl = o.island.isIsland(e.sender)
    if (!isl && !fromDock(e)) return null
    switch (op) {
      case 'shortcuts': {
        if (!isl || !Array.isArray(arg)) return null
        const list = arg.slice(0, 30).filter((s: any) => s && typeof s.id === 'string' && typeof s.accelerator === 'string').map((s: any) => ({ id: s.id.slice(0, 40), accelerator: s.accelerator.slice(0, 60) }))
        return { problems: setShortcuts(list) }
      }
      case 'profiles':
        if (!isl) return null
        profiles = cleanKitProfiles(arg)
        askWifi()
        // Told again (the page may have reloaded).
        active = '\u0000'
        checkProfile()
        return { active }
      case 'clipboard':
        if (!isl) return null
        setClipboard(arg === true)
        return { on: clipOn, list: clips }
      case 'clipPin':
        clips = pinClip(clips, String(arg?.text ?? ''), arg?.on === true)
        o.island.send({ type: 'clips', list: clips })
        return clips
      case 'clipCopy': {
        const t = String(arg ?? '').slice(0, 5000)
        if (!clips.some((c) => c.text === t)) return false
        lastClip = t
        try { clipboard.writeText(t) } catch { return false }
        return true
      }
      case 'clipClear':
        clips = clips.filter((c) => c.pinned && arg !== 'all')
        o.island.send({ type: 'clips', list: clips })
        return clips
      case 'shelf':
        return shelf
      case 'shelfAdd': {
        const p = cleanPath(arg)
        if (!p) return shelf
        shelf = addShelf(shelf, p, Date.now())
        save()
        return shelf
      }
      case 'shelfOpen': {
        // Only a file that is on the shelf (and still there).
        const it = shelf.find((x) => x.path === arg)
        if (!it || !existsSync(it.path)) return 'That file is gone'
        const err = await shell.openPath(it.path)
        return err || ''
      }
      case 'shelfShow': {
        const it = shelf.find((x) => x.path === arg)
        if (it && existsSync(it.path)) shell.showItemInFolder(it.path)
        return true
      }
      case 'shelfRemove':
        shelf = shelf.filter((x) => x.path !== arg)
        save()
        return shelf
      case 'shelfClear':
        shelf = []
        save()
        return shelf
      case 'mediaKeys':
        if (!isl) return null
        return setMediaKeys(arg === true)
      case 'dock':
        if (!isl) return null
        if (arg === true) openDock()
        else closeDock()
        return !!dock
      case 'dockSize': {
        if (!fromDock(e) || !dock) return null
        const w = Math.round(Math.max(120, Math.min(640, Number(arg?.w) || 300)))
        const h = Math.round(Math.max(36, Math.min(120, Number(arg?.h) || 56)))
        const b = dock.getBounds()
        if (b.width !== w || b.height !== h) dock.setBounds({ x: b.x, y: b.y, width: w, height: h })
        return true
      }
      default:
        return null
    }
  })
  app.on('will-quit', () => { for (const s of bound) { try { globalShortcut.unregister(s.accelerator) } catch { /* fine */ } } })

  return {
    /** The app in front changed (from the Windows watcher). */
    noteFg(proc: string) {
      if (proc === fgProc) return
      fgProc = proc
      checkProfile()
    },
    followIsland,
    problems: () => problems.slice()
  }
}
