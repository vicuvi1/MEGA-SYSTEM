// The desktop island window: frameless, transparent, always on top. It lives
// at the top of the screen, docked on the left or right edge, or floating
// where you dropped it. The window has ONE fixed size and never resizes: the
// pill, the peek and the command center are one shape animated inside it
// (resizing a transparent window on Windows is what made it jump and flicker).
// It never takes the keyboard on its own, only when you type in it.
// It never touches your data: the app window sends it snapshots and gets its
// taps back. Clicks pass through everything except the visible shape.
//
// Clicks (IC1): the island page decides when it takes clicks. The desktop
// forwards every mouse move to it (setIgnoreMouseEvents with forward), the page
// checks the pointer against its own shape in its own pixels and says
// island:takeClicks at once; no screen scaling has to be converted, so mixed
// screens and 125/150% scaling can't put the pointer "outside" the right end
// of the peek. The desktop's own 50 ms look at the pointer only notices it
// leaving the window (and is the fallback for an older page).
// The window still never takes the focus (focusable: false, a tool window, so
// no taskbar button): a press on a window that doesn't take the focus can be
// swallowed by Windows, so the page fires its buttons on the release (that
// always arrives) and counts releases without a press in Island debug.
//
// Size: the page scales itself with CSS (`scale` in island:prefs). The island
// page has the same origin as the app, and Chromium shares page zoom per
// origin, so zooming the island would zoom the app too: its zoom stays locked.
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, powerMonitor, screen } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IslandPlacement } from '../shared/desktop'
import { cleanIslandPrefs, ISLAND_ZOOM, quietUntil, type IslandPrefs } from '../core/islandModel'
import { applyProfile, autoProfile } from '../core/islandProfiles'
import { typingFade } from '../core/islandCommands'
import type { IslandControls, IslandProfileId } from '../core/islandControlPrefs'
import { cursorNear, snapBounce } from './islandPlace'
import { clampFree, PANEL_MAX, resizePanel, dragTo, dropSpot, fitShift, hideFor, hideText, hideTick, rememberSpot, rushing, screenKey, SHOWN, toggleHide, DODGE_MS, type HideChoice, type Rect, type Sample } from '../core/islandMove'
import {
  chooseDisplay, cleanDeskPrefs, displayKey, displayLabel, dragStale, followTick, hideOverApp, hotRects, islandBase, islandSize, isPlacement, migrateShortcuts,
  noteRecentApp, overRects, parseWatcherLine, placeIsland, QUNS_PRESENTATION, rateLimit, rectsToDip, rememberLayout, sampleSeconds, SHORTCUTS_VERSION,
  type HotRect, type IslandDeskPrefs, type IslandLayout, type MonitorMode
} from './islandWin'

/** The app's colours for the island's "Match the app" look (IP4): sent by the app window. */
export interface IslandAppTheme { dark: boolean; accent: string; accentText: string; surface: string; text: string }
const cleanTheme = (t: any): IslandAppTheme | null => {
  if (!t || typeof t !== 'object') return null
  // Only plain colour values (no url(), no semicolons): they go into CSS variables.
  const c = (v: unknown, d: string) => (typeof v === 'string' && /^[#a-z0-9(),.%\s-]{1,60}$/i.test(v) && !/url|expression/i.test(v) ? v.trim() : d)
  return { dark: t.dark !== false, accent: c(t.accent, '#d4ff3f'), accentText: c(t.accentText, '#d4ff3f'), surface: c(t.surface, '#0f131b'), text: c(t.text, '#f5f5f6') }
}
/** Where the pill sits inside the window on the side placements (from the window's top). */
const SIDE_PILL_Y = 40
/** Above normal windows (on Windows every level above "normal" is plain topmost). */
const LEVEL = 'pop-up-menu' as const
/** Island debug switches itself off after this long (IC13). */
const DEBUG_MS = 30 * 60_000

type Slot = 'island' | 'quiet' | 'capture' | 'voice' | 'hide'
const SLOT_LABEL: Record<Slot, string> = { island: 'open the island', quiet: 'quiet', capture: 'add a task', voice: 'talk to Ben', hide: 'hide the island' }

export function createIsland(o: { origin: string; preload: string; appWindow: BrowserWindow; showApp: (page?: string) => void; dir: string; onChange?: () => void; pc?: () => { activeApp: boolean; titles: boolean }; onApp?: (proc: string, title: string | null, seconds: number) => void; onFg?: (proc: string) => void }) {
  const prefFile = join(o.dir, 'island.json')
  let enabled = true
  let place: IslandPlacement = 'top'
  // top: center share of the width; free: center share + px from the top; sides: center share of the height.
  let pos = { cx: 0.5, top: 0, cy: 0.5 }
  // Your settings (Settings → Desktop island): size, look, sections, sound, hide speed, shortcut.
  let prefs: IslandPrefs = cleanIslandPrefs(null)
  // The settings only this PC has: full-screen behaviour, the add-a-task and talk-to-Ben shortcuts.
  let desk: IslandDeskPrefs = cleanDeskPrefs(null)
  // The screen you put it on (kept after a restart; the main screen if it's gone).
  let savedDisplay = -1
  // Quiet until this time (Q1): no reminders, only a small moon; 0 = not quiet.
  let quietEnd = 0
  // What Windows says (Q2, Q3): mic or camera in use, a full-screen app on the island's screen;
  // and from the island page: a calendar meeting going on now.
  let busy = { mic: false, fullscreen: false, meeting: false, app: '' }
  // IF6: programs seen in front lately (memory only, for picking in Settings).
  let recentApps: string[] = []
  let version = 0
  // IP4: the app's colours (the app window sends them; kept so the island has them at start).
  let appTheme: IslandAppTheme | null = null
  try {
    if (existsSync(prefFile)) {
      const p = JSON.parse(readFileSync(prefFile, 'utf8'))
      enabled = p.enabled !== false
      if (isPlacement(p.place)) place = p.place
      if (Number.isFinite(p.cx)) pos.cx = Math.min(1, Math.max(0, p.cx))
      if (Number.isFinite(p.top)) pos.top = Math.max(0, p.top)
      if (Number.isFinite(p.cy)) pos.cy = Math.min(1, Math.max(0, p.cy))
      if (Number.isFinite(p.displayId)) savedDisplay = p.displayId
      if (Number.isFinite(p.quietUntil) && p.quietUntil > Date.now()) quietEnd = p.quietUntil
      // Older versions saved a dragged spot without a placement: that was "free".
      if (!p.place && p.top > 0) place = 'free'
      prefs = cleanIslandPrefs(p.prefs)
      desk = cleanDeskPrefs(p.desk)
      if (Number.isFinite(p.v)) version = p.v
      // IC7: a right click now opens the menu for what the pill shows (it was the quiet menu by default).
      if (!p.clicksV && prefs.clicks.right === 'quiet') prefs = { ...prefs, clicks: { ...prefs.clicks, right: 'menu' } }
      appTheme = cleanTheme(p.theme)
    }
  } catch { /* defaults */ }
  // IS15: the old Ctrl+Alt shortcuts (AltGr on Windows: they ate "@" and "ł") move to the new ones, once.
  const migrated = migrateShortcuts(prefs, version)
  const needsSave = version < SHORTCUTS_VERSION
  prefs = cleanIslandPrefs(migrated)
  // IP5: where it is now, for the set of screens plugged in now.
  let screensKey = ''
  const layoutNow = (): IslandLayout => ({ place, pos: { ...pos }, offset: { ...desk.offset }, displayId: savedDisplay, size: prefs.size })
  const savePrefs = () => {
    if (desk.perScreen && screensKey) desk = { ...desk, layouts: rememberLayout(desk.layouts, screensKey, layoutNow()) }
    try { writeFileSync(prefFile, JSON.stringify({ v: SHORTCUTS_VERSION, clicksV: 1, enabled, place, ...pos, displayId: savedDisplay, quietUntil: quietEnd, prefs, desk, theme: appTheme })) } catch { /* fine */ }
  }
  if (needsSave) savePrefs()
  const allPrefs = () => ({ ...prefs, ...desk, place, displayId: savedDisplay })

  let win: BrowserWindow | null = null
  let last: unknown = null
  /** The clickable areas, in CSS pixels of the island page. */
  let hot: HotRect[] = []
  /** Over the shape (null: not known, check again on the next poll). */
  let inside: boolean | null = null
  /** Clicks pass through the window right now (IC1). */
  let ignoring = true
  /** The page decides when it takes clicks (it said so at least once). */
  let pageCtl = false
  /** The pointer is inside the window's box (null: not known). */
  let inWin: boolean | null = null
  /** Island debug (IC13): the last poll's timing, for the overlay. */
  const timing = { lastPoll: 0, jitter: 0, lastTick: 0, lag: 0, flips: 0 }
  let drag: { timer: ReturnType<typeof setInterval>; offX: number; offY: number; w: number; h: number; startedAt: number; lastMove: number; lx: number; ly: number; spot?: string } | null = null
  /** H1: move mode (arrow keys nudge it, Enter saves, Esc puts it back). */
  let moveMode: { orig: Electron.Rectangle; place: IslandPlacement; pos: { cx: number; top: number; cy: number } } | null = null
  /** The page is listening (IS22): shortcuts pressed before that wait here. */
  let ready = false
  let pending: string[] = []

  // ---- The island log (IS23): what the desktop side did, for Settings → Diagnostics ----
  const log: { at: string; from: 'main' | 'island'; line: string }[] = []
  const limit = rateLimit(2000)
  const diag = (key: string, line: string, force = false) => {
    if (!force && !limit(key)) return
    const e = { at: new Date().toISOString(), from: 'main' as const, line }
    log.push(e)
    if (log.length > 200) log.splice(0, log.length - 200)
    if (win && !win.isDestroyed() && ready) win.webContents.send('island:diag', e)
  }

  // IF2: following the mouse / the window in front: the screen it moved to last.
  let followId: number | null = null
  let follow = { candidate: null as number | null, since: 0 }
  /** The screen it should be on now: the one you picked, the main one, or the one it follows (IF2). */
  const display = () => {
    try {
      const all = screen.getAllDisplays()
      const primary = screen.getPrimaryDisplay()
      const cur = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()).id : null
      const id = chooseDisplay({ mode: desk.monitor, ids: all.map((d) => d.id), primaryId: primary.id, savedId: savedDisplay, followId, currentId: cur })
      return all.find((d) => d.id === id) ?? primary
    } catch {
      return screen.getPrimaryDisplay()
    }
  }
  /** The page's real zoom (1 unless something zoomed the app's origin). */
  const pageZoom = () => {
    try { return win && !win.isDestroyed() ? win.webContents.getZoomFactor() || 1 : 1 } catch { return 1 }
  }
  /** Clicks pass through (true) or the island takes them (false). */
  const setIgnore = (ign: boolean, why: string, force = false) => {
    if (!win || win.isDestroyed() || (!force && ign === ignoring)) return
    ignoring = ign
    timing.flips++
    try { win.setIgnoreMouseEvents(ign, { forward: true }) } catch { /* fine */ }
    diag(ign ? 'pass' : 'take', ign ? `Clicks pass through (${why})` : `The island takes clicks (${why})`)
  }
  /** The size setting, done by the page itself with CSS. */
  const cssScale = () => ISLAND_ZOOM[prefs.size] ?? 1
  /** IF3: room for your widest view (the peek / panel width sliders). */
  // IN39: the panel's own size on this screen (drag its corner); while you drag it, room for the largest.
  let resizing = false
  const panelNow = (): { w: number; h: number } | null => {
    if (resizing) return PANEL_MAX
    try { return desk.spots[screenKey(display())]?.size ?? null } catch { return null }
  }
  const base = () => {
    const p = panelNow()
    const b = islandBase(p ? { ...prefs, panelWidth: p.w } : prefs)
    return { width: b.width, height: Math.max(b.height, Math.round((p?.h ?? 0) + 100)) }
  }
  const sizeNow = () => islandSize(base(), cssScale() * pageZoom(), display().workArea)

  // H1: the pill's part of the window (DIP) when it floats: it stays on the screen, the rest may hang off.
  const keepBox = (width: number): Rect => {
    const k = cssScale() * pageZoom()
    return { x: width / 2 - 130 * k, y: 0, w: 260 * k, h: 48 * k }
  }
  /** H1: the panel opened near an edge: the window slides this far to show it (back to 0 when it closes). */
  let fit = { x: 0, y: 0 }
  // H1: the screen it was placed on last; a new one brings back that screen's own spot.
  let spotDisplay: number | null = null
  const loadSpot = (d: Electron.Display) => {
    if (spotDisplay === d.id) return
    const first = spotDisplay == null
    spotDisplay = d.id
    const sp = desk.spots[screenKey(d)]
    if (!sp || (first && !desk.perScreen)) return
    place = sp.place
    pos = { ...sp.pos }
    desk = { ...desk, offset: { x: 0, y: 0 } }
    sendPlacement()
  }
  /** Where the window sits normally (no fit shift). */
  const homeOf = (d: Electron.Display, width: number, height: number) => {
    const wa = d.workArea
    if (place === 'free') return clampFree({ x: wa.x + pos.cx * wa.width - width / 2 + desk.offset.x, y: wa.y + pos.top + desk.offset.y }, { width, height }, wa, keepBox(width))
    return placeIsland({ wa, width, height, place, pos, offset: desk.offset, sidePillY: SIDE_PILL_Y * cssScale() * pageZoom() })
  }
  const placeWin = () => {
    if (!win || win.isDestroyed() || drag || moveMode) return
    const d = display()
    loadSpot(d)
    const { width, height } = sizeNow()
    const home = homeOf(d, width, height)
    const x = home.x + fit.x
    const y = home.y + fit.y
    const b = win.getBounds()
    if (b.x !== x || b.y !== y || b.width !== width || b.height !== height) win.setBounds({ x, y, width, height })
  }
  /** H1: the visible parts changed (the panel opened or closed): slide just enough to show them. */
  const refit = () => {
    if (!win || win.isDestroyed() || drag || moveMode) return
    const d = display()
    const { width, height } = sizeNow()
    const next = fitShift(homeOf(d, width, height), rectsToDip(hot, pageZoom()), d.workArea)
    if (next.x === fit.x && next.y === fit.y) return
    fit = next
    placeWin()
  }

  // IC18: the island gets your settings with the profile in use on top (Settings keeps editing your own).
  let fgProc = ''
  let activeProfile: IslandProfileId = 'none'
  const profileNow = (): IslandProfileId => autoProfile(prefs.controls, { now: new Date(), app: fgProc || null })
  const sendPrefs = () => {
    activeProfile = profileNow()
    const panel = panelNow()
    win?.webContents.send('island:prefs', { ...applyProfile(prefs, activeProfile), ...desk, ...(panel && !resizing ? { panelWidth: panel.w, panelMaxH: panel.h } : {}), place, displayId: savedDisplay, scale: cssScale(), theme: appTheme, profile: activeProfile })
  }
  /** The profile changed by itself (the time, the app in front): the island hears it. */
  const checkProfile = () => {
    if (prefs.controls.profileAuto === 'off' || profileNow() === activeProfile) return
    diag('profile', `Island profile: ${profileNow()} (by itself)`, true)
    sendPrefs()
    o.onChange?.()
  }
  setInterval(checkProfile, 60_000)
  const setControls = (c: Partial<IslandControls>) => {
    prefs = cleanIslandPrefs({ ...prefs, controls: { ...prefs.controls, ...c } })
    savePrefs()
    sendPrefs()
    o.onChange?.()
  }
  /** Shown or hidden: the page pauses its animations while hidden (IC10). */
  const sendVisible = () => { if (win && !win.isDestroyed() && ready) win.webContents.send('island:visible', win.isVisible()) }
  const sendPlacement = () => win?.webContents.send('island:placement', place)
  const onTop = () => {
    if (!win || win.isDestroyed()) return
    try { win.setAlwaysOnTop(true, LEVEL) } catch { /* fine */ }
  }
  const showWin = () => {
    if (!win || win.isDestroyed()) return
    if (!win.isVisible()) win.showInactive()
    onTop()
  }
  /** Sends now, or once the page says it's listening. */
  const sendWhenReady = (channel: string) => {
    if (win && !win.isDestroyed() && ready) win.webContents.send(channel)
    else if (!pending.includes(channel)) pending.push(channel)
  }
  const greet = () => {
    sendPrefs()
    sendQuiet()
    sendPlacement()
    sendHide()
    if (last) win?.webContents.send('island:state', last)
    sendVisible()
  }
  const markReady = () => {
    if (!win || win.isDestroyed()) return
    const first = !ready
    ready = true
    greet()
    if (first) for (const e of log.slice(-20)) win.webContents.send('island:diag', e)
    const q = pending
    pending = []
    for (const ch of q) win.webContents.send(ch)
  }

  const open = () => {
    if (win && !win.isDestroyed()) return
    ready = false
    inside = null
    inWin = null
    pageCtl = false
    const wa = display().workArea
    win = new BrowserWindow({
      ...islandSize(base(), cssScale(), wa), frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      // Not focusable: clicking it never takes the keyboard from your app (only typing in it does).
      fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true, backgroundColor: '#00000000', focusable: false,
      type: process.platform === 'win32' ? 'toolbar' : undefined, title: 'Life System island',
      webPreferences: { preload: o.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
    })
    const w = win
    onTop()
    // Only macOS knows "all workspaces / over full screen"; on Windows the watcher below decides.
    if (process.platform === 'darwin') { try { w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false }) } catch { /* fine */ } }
    // No menu: its Ctrl+= / Ctrl+- would zoom the island (and with it the app).
    try { w.setMenu(null) } catch { /* fine */ }
    w.setIgnoreMouseEvents(true, { forward: true })
    ignoring = true
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    // IS2: the zoom stays as it is (pinch, Ctrl+wheel and Ctrl+plus/minus do nothing here).
    w.webContents.on('zoom-changed', () => diag('zoom', 'Zoom gesture ignored on the island'))
    w.webContents.on('before-input-event', (e, input) => {
      if ((input.control || input.meta) && ['+', '-', '=', '0', 'Add', 'Subtract', 'NumpadAdd', 'NumpadSubtract'].includes(input.key)) e.preventDefault()
    })
    w.webContents.on('did-start-loading', () => { ready = false })
    w.webContents.on('did-finish-load', () => {
      void w.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {})
      greet()
      diag('zoom-load', `Island loaded: page zoom ${pageZoom().toFixed(2)}, size ${prefs.size} (scale ${cssScale()})`, true)
      placeWin()
      // An older page never says "ready": don't keep shortcuts waiting forever.
      setTimeout(() => { if (!ready && win === w && !w.isDestroyed()) markReady() }, 3000)
    })
    w.on('closed', () => {
      if (win === w) { win = null; ready = false }
    })
    // CL8: the island's page died (crash, out of memory) → a fresh island window, at most
    // a few times in a row; frozen for 30 s → reloaded.
    w.webContents.on('render-process-gone', (_e, d) => {
      diag('gone', `Island page stopped (${d.reason}): starting a new one`, true)
      if (win !== w) return
      const now = Date.now()
      revived = revived.filter((t) => now - t < 10 * 60_000)
      if (revived.length >= 3) return
      revived.push(now)
      win = null
      ready = false
      try { w.destroy() } catch { /* already gone */ }
      setTimeout(() => { if (enabled && !win) open() }, 2000)
    })
    let frozen: ReturnType<typeof setTimeout> | null = null
    w.webContents.on('unresponsive', () => {
      frozen ??= setTimeout(() => {
        frozen = null
        if (!w.isDestroyed()) w.webContents.reload()
      }, 30_000)
    })
    w.webContents.on('responsive', () => {
      if (frozen) clearTimeout(frozen)
      frozen = null
    })
    // You clicked into another app: the panel may close (the island decides).
    w.on('blur', () => { if (!w.isDestroyed()) w.webContents.send('island:blur') })
    w.on('always-on-top-changed', (_e, on) => { if (!on) onTop() })
    w.on('show', () => sendVisible())
    w.on('hide', () => { sendVisible(); setIgnore(true, 'hidden') })
    placeWin()
    // IS13: shown only when it should be (not over a full-screen app or in a call you hide it in).
    void w.loadURL(o.origin + '/?island=1').then(() => applyVisibility(), () => applyVisibility())
  }
  const close = () => { if (win && !win.isDestroyed()) win.destroy() }
  let revived: number[] = []

  const fromIsland = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => !!win && !win.isDestroyed() && e.sender === win.webContents
  const fromApp = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => e.sender === o.appWindow.webContents
  ipcMain.on('island:state', (e, s) => {
    if (!fromApp(e)) return
    // IC9: "still the same" (a heartbeat) is passed on but never replaces the last real snapshot.
    const beat = !!s && typeof s === 'object' && 'beat' in s && Object.keys(s).length === 1
    if (!beat) last = s
    if (win && !win.isDestroyed()) win.webContents.send('island:state', s)
  })
  // The island page is ready (it loads a moment after the window): tell it where it lives and what to show.
  ipcMain.on('island:ready', (e) => { if (fromIsland(e)) markReady() })
  ipcMain.on('island:action', (e, a) => { if (fromIsland(e)) o.appWindow.webContents.send('island:action', a) })
  ipcMain.on('island:ack', (e, ack) => { if (fromApp(e)) win?.webContents.send('island:ack', ack) })
  // Typing: the island takes the keyboard (it never takes it on its own), and gives it back.
  // IS5: the mouse is left to the hover check (it looks again right away), so the
  // rest of the window keeps letting clicks through to the apps below.
  ipcMain.on('island:focus', (e) => {
    if (!fromIsland(e) || !win) return
    win.setFocusable(true)
    // setFocusable(true) also brings back a taskbar button on Windows: never for the island.
    try { win.setSkipTaskbar(true) } catch { /* fine */ }
    win.focus()
    win.webContents.focus()
    inside = null
  })
  ipcMain.on('island:keyboard', (e, on) => {
    if (!fromIsland(e) || !win || on) return
    if (win.isFocused()) win.blur()
    win.setFocusable(false)
    try { win.setSkipTaskbar(true) } catch { /* fine */ }
    inside = null
  })
  ipcMain.on('island:showApp', (e, page) => { if (fromIsland(e)) o.showApp(typeof page === 'string' ? page : undefined) })

  // Drag it anywhere. Drop it on the left/right edge → docked there; at the top →
  // top; anywhere else → floating right there. The spot is remembered.
  /** H1: the spot from where the window is now, on the screen under `c`, remembered for that screen. */
  const keepSpot = (c: { x: number; y: number }, b: Electron.Rectangle, spot: IslandPlacement) => {
    const d = screen.getDisplayNearestPoint(c)
    savedDisplay = d.id
    spotDisplay = d.id
    // You put it on this screen yourself: following the main screen / the mouse doesn't pull it back.
    if (desk.monitor === 'main' && d.id !== screen.getPrimaryDisplay().id) desk = { ...desk, monitor: 'fixed' }
    if (desk.monitor === 'mouse' || desk.monitor === 'window') { followId = d.id; follow = { candidate: null, since: 0 } }
    const wa = d.workArea
    place = spot
    // Where you drop it is the spot: no extra offset on top.
    desk = { ...desk, offset: { x: 0, y: 0 } }
    pos.cy = Math.min(1, Math.max(0, (b.y + SIDE_PILL_Y * cssScale() * pageZoom() - wa.y) / wa.height))
    pos.cx = Math.min(1, Math.max(0, (b.x + b.width / 2 - wa.x) / wa.width))
    pos.top = Math.max(0, b.y - wa.y)
    desk = { ...desk, spots: rememberSpot(desk.spots, screenKey(d), { ...desk.spots[screenKey(d)], place, pos: { ...pos } }) }
    fit = { x: 0, y: 0 }
    savePrefs()
    sendPlacement()
  }
  // Drag it anywhere. Dropped in the top zone of a screen → the nearest top spot;
  // anywhere else → it stays exactly there (H1). The spot is remembered per screen.
  const endDrag = (why: 'drop' | 'stuck') => {
    if (!drag) return
    clearInterval(drag.timer)
    drag = null
    inside = null
    inWin = null
    if (!win || win.isDestroyed()) return
    const c = screen.getCursorScreenPoint()
    const b = win.getBounds()
    win.webContents.send('island:snapGhost', null)
    keepSpot(c, b, dropSpot(c, screen.getDisplayNearestPoint(c).bounds))
    placeWin()
    // IM7: the window moved once; the page plays the last bit of the way as a bounce.
    try {
      const nb = win.getBounds()
      const bounce = snapBounce({ x: b.x, y: b.y }, { x: nb.x, y: nb.y }, pageZoom())
      if (why === 'drop' && (bounce.dx || bounce.dy)) win.webContents.send('island:snapped', bounce)
    } catch { /* fine */ }
    // IS21: clicks pass through again where there's no island (the page takes them again on the next move).
    setIgnore(true, 'drag ended', true)
    if (why === 'stuck') {
      win.webContents.send('island:dragCancel')
      diag('drag', 'Drag ended by itself (no movement for 10 s)', true)
    }
    o.onChange?.()
  }
  ipcMain.on('island:dragStart', (e) => {
    if (!fromIsland(e) || !win || drag || moveMode) return
    const c = screen.getCursorScreenPoint()
    const b = win.getBounds()
    setIgnore(false, 'dragging', true)
    const now = Date.now()
    drag = {
      offX: c.x - b.x,
      offY: c.y - b.y,
      // H1: the size stays the same all the way (moving between screens with a
      // different scale must not grow or shrink the window).
      w: b.width,
      h: b.height,
      startedAt: now,
      lastMove: now,
      lx: c.x,
      ly: c.y,
      // H1: ~120 times a second while you drag (nothing runs otherwise), so the window keeps up with the mouse.
      timer: setInterval(() => {
        if (!drag) return
        if (!win || win.isDestroyed()) return endDrag('stuck')
        const p = screen.getCursorScreenPoint()
        const t = Date.now()
        if (p.x !== drag.lx || p.y !== drag.ly) {
          drag.lx = p.x
          drag.ly = p.y
          drag.lastMove = t
          const np = dragTo(p, { x: drag.offX, y: drag.offY })
          win.setBounds({ x: np.x, y: np.y, width: drag.w, height: drag.h })
          // IM7: the spot it would snap to, for the ghost (only when it changes).
          const spot = dropSpot(p, screen.getDisplayNearestPoint(p).bounds)
          if (spot !== drag.spot) {
            drag.spot = spot
            win.webContents.send('island:snapGhost', spot)
          }
        } else if (dragStale({ now: t, lastMove: drag.lastMove, startedAt: drag.startedAt })) endDrag('stuck')
      }, 8)
    }
  })
  ipcMain.on('island:dragEnd', (e) => { if (fromIsland(e)) endDrag('drop') })

  // ---- H1: move mode: the arrow keys nudge it, Enter saves, Esc puts it back ----
  const takeKeys = () => {
    if (!win || win.isDestroyed()) return
    win.setFocusable(true)
    try { win.setSkipTaskbar(true) } catch { /* fine */ }
    win.focus()
    win.webContents.focus()
  }
  const giveKeys = () => {
    if (!win || win.isDestroyed()) return
    if (win.isFocused()) win.blur()
    win.setFocusable(false)
    try { win.setSkipTaskbar(true) } catch { /* fine */ }
  }
  const startMove = () => {
    if (!enabled) return
    if (!win || win.isDestroyed()) open()
    if (desk.hidden.mode !== 'shown') setHide(null)
    showWin()
    if (!win || win.isDestroyed() || moveMode || drag) return
    moveMode = { orig: win.getBounds(), place, pos: { ...pos } }
    setIgnore(false, 'move mode', true)
    takeKeys()
    sendWhenReady('island:moveMode')
    diag('move', 'Move mode: arrow keys nudge it, Enter saves, Esc puts it back', true)
  }
  const endMove = (save: boolean) => {
    if (!moveMode || !win || win.isDestroyed()) { moveMode = null; return }
    const m = moveMode
    moveMode = null
    if (save) {
      const b = win.getBounds()
      keepSpot({ x: b.x + b.width / 2, y: b.y + 20 }, b, 'free')
    } else {
      place = m.place
      pos = m.pos
      win.setBounds(m.orig)
    }
    placeWin()
    giveKeys()
    setIgnore(true, 'move mode ended', true)
    win.webContents.send('island:moveModeEnd')
    o.onChange?.()
  }
  ipcMain.on('island:moveMode', (e) => { if (fromIsland(e) || fromApp(e)) startMove() })
  ipcMain.on('island:nudge', (e, d) => {
    if (!fromIsland(e) || !moveMode || !win || win.isDestroyed()) return
    const dx = Math.max(-200, Math.min(200, Math.round(Number(d?.x) || 0)))
    const dy = Math.max(-200, Math.min(200, Math.round(Number(d?.y) || 0)))
    const b = win.getBounds()
    const wa = screen.getDisplayMatching(b).workArea
    const np = clampFree({ x: b.x + dx, y: b.y + dy }, { width: b.width, height: b.height }, wa, keepBox(b.width))
    win.setBounds({ ...np, width: b.width, height: b.height })
  })
  ipcMain.on('island:moveEnd', (e, save) => { if (fromIsland(e)) endMove(save === true) })
  // IN39: the panel resized by its corner: room to grow while you drag, then the size is kept for this screen.
  ipcMain.on('island:panelSize', (e, phase, size) => {
    if (!fromIsland(e) || !win || win.isDestroyed()) return
    if (phase === 'start') {
      resizing = true
      placeWin()
      return
    }
    resizing = false
    try {
      const d = display()
      const key = screenKey(d)
      const sp = desk.spots[key] ?? { place, pos: { ...pos } }
      const wa = d.workArea
      const k = cssScale() * pageZoom()
      const sz = resizePanel({ w: Number(size?.w) || 460, h: Number(size?.h) || 520 }, { x: 0, y: 0 }, { w: Math.floor(wa.width / k) - 40, h: Math.floor(wa.height / k) - 100 })
      desk = { ...desk, spots: rememberSpot(desk.spots, key, { ...sp, size: sz }) }
    } catch { /* fine */ }
    savePrefs()
    placeWin()
    sendPrefs()
  })

  // ---- H1: hide it (for an hour, until tomorrow, until you bring it back) or tuck it into a dot ----
  const sendHide = () => { if (win && !win.isDestroyed()) win.webContents.send('island:hideState', desk.hidden) }
  function setHide(choice: HideChoice | null) {
    desk = { ...desk, hidden: choice ? hideFor(choice, Date.now()) : SHOWN }
    savePrefs()
    sendHide()
    applyVisibility()
    diag('hide', hideText(desk.hidden, Date.now()), true)
    o.onChange?.()
  }
  const toggleHidden = () => {
    desk = { ...desk, hidden: toggleHide(desk.hidden, Date.now()) }
    if (desk.hidden.mode === 'shown' && (!win || win.isDestroyed()) && enabled) open()
    savePrefs()
    sendHide()
    applyVisibility()
    diag('hide', hideText(desk.hidden, Date.now()), true)
    o.onChange?.()
  }
  ipcMain.on('island:hide', (e, choice) => {
    if (!fromIsland(e) && !fromApp(e)) return
    setHide(['1h', 'tomorrow', 'manual', 'dot'].includes(choice) ? choice : null)
  })
  setInterval(() => {
    const next = hideTick(desk.hidden, Date.now())
    if (next !== desk.hidden) setHide(null)
  }, 15_000)

  // ---- H1: slides out of the way for a moment when the mouse rushes at it (a setting, off by default) ----
  let dodgeSample: Sample | null = null
  let dodgeT: ReturnType<typeof setTimeout> | null = null
  const dodgeCheck = (c: { x: number; y: number }, b: Electron.Rectangle) => {
    const now = Date.now()
    const prev = dodgeSample
    dodgeSample = { x: c.x, y: c.y, t: now }
    if (!desk.dodge || dodgeT || inside || !prev || !hot[0]) return
    const z = pageZoom()
    const r = hot[0]
    // Only the small pill dodges (never an open panel).
    if (r.h * z > 90) return
    if (!rushing(prev, dodgeSample, { x: b.x + r.x * z, y: b.y + r.y * z, w: r.w * z, h: r.h * z })) return
    win?.webContents.send('island:dodge', true)
    setIgnore(true, 'out of the way', true)
    dodgeT = setTimeout(() => {
      dodgeT = null
      if (win && !win.isDestroyed()) win.webContents.send('island:dodge', false)
    }, DODGE_MS)
  }
  // IS2: the clickable areas, in CSS pixels of the page (one or more; the old single rect works too).
  ipcMain.on('island:hot', (e, r) => {
    if (!fromIsland(e)) return
    const list = hotRects(r)
    if (!list) return
    hot = list
    refit()
    diag('hot', `Click area: ${list.map((h) => `${Math.round(h.x)},${Math.round(h.y)} ${Math.round(h.w)}×${Math.round(h.h)}`).join(' + ') || 'none'} (zoom ${pageZoom().toFixed(2)})`)
  })
  // IC1: the page says when it takes clicks (it sees every mouse move in its own pixels).
  ipcMain.on('island:takeClicks', (e, on) => {
    if (!fromIsland(e) || !win || win.isDestroyed() || drag || moveMode) return
    if (!pageCtl) diag('ctl', 'The island page decides where it takes clicks', true)
    pageCtl = true
    inside = !!on
    // A late "take" after the pointer already left the window is ignored.
    if (on && inWin === false) return
    setIgnore(!on, on ? 'pointer on the island' : 'pointer off the island')
  })
  // The real pointer, ~20 times a second. With the page deciding (IC1) it only
  // notices the pointer leaving the window (the page then gets no more moves);
  // an older page: over the shape → it takes clicks (and hears "hover"),
  // elsewhere clicks pass through. (Polling avoids the browser's false
  // mouse-leave events on Windows.)
  setInterval(() => {
    const t = Date.now()
    if (timing.lastPoll) timing.jitter = Math.max(timing.jitter * 0.9, Math.abs(t - timing.lastPoll - 50))
    timing.lastPoll = t
    if (!win || win.isDestroyed() || drag || moveMode || !win.isVisible()) return
    const c = screen.getCursorScreenPoint()
    const b = win.getBounds()
    dodgeCheck(c, b)
    if (pageCtl) {
      const nowIn = c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height
      if (nowIn === inWin) return
      inWin = nowIn
      if (!nowIn) {
        setIgnore(true, 'pointer left the window')
        if (inside !== false) win.webContents.send('island:hover', false)
        inside = false
      }
      return
    }
    const now = overRects(c.x - b.x, c.y - b.y, rectsToDip(hot, pageZoom()))
    if (now === inside) return
    inside = now
    setIgnore(!now, now ? 'pointer on the click area' : 'pointer off the click area', true)
    win.webContents.send('island:hover', now)
    diag(now ? 'hover-in' : 'hover-out', now ? 'Mouse over the island: it takes clicks' : 'Mouse left the island: clicks pass through')
  }, 50)

  // IM11, IM12: the pointer near the island (within 40 px), ~30 times a second,
  // only while it is near: the pill leans toward it and a sleeping dot wakes.
  let leanSent = false
  setInterval(() => {
    if (!win || win.isDestroyed() || drag || !win.isVisible() || !hot.length) return
    const c = screen.getCursorScreenPoint()
    const b = win.getBounds()
    const z = pageZoom() || 1
    const near = cursorNear({ x: (c.x - b.x) / z, y: (c.y - b.y) / z }, hot[0])
    if (near) {
      leanSent = true
      win.webContents.send('island:cursor', near)
    } else if (leanSent) {
      leanSent = false
      win.webContents.send('island:cursor', null)
    }
  }, 33)

  // ---- Island debug (IC13): what the desktop sees, ~10 times a second ----
  const debugOn = () => desk.debugUntil > Date.now()
  setInterval(() => {
    const t = Date.now()
    if (timing.lastTick) timing.lag = Math.max(timing.lag * 0.9, t - timing.lastTick - 100)
    timing.lastTick = t
    if (!desk.debugUntil) return
    if (!debugOn()) {
      // 30 minutes are over: it switches itself off.
      desk = { ...desk, debugUntil: 0 }
      savePrefs()
      sendPrefs()
      diag('debug', 'Island debug switched itself off (30 minutes)', true)
      o.onChange?.()
      return
    }
    if (!win || win.isDestroyed() || !ready || !win.isVisible()) return
    try {
      const c = screen.getCursorScreenPoint()
      const b = win.getBounds()
      const d = screen.getDisplayMatching(b)
      const z = pageZoom()
      win.webContents.send('island:debug', {
        at: t, cursor: { x: c.x - b.x, y: c.y - b.y }, bounds: b, scaleFactor: d.scaleFactor, zoom: z,
        rects: rectsToDip(hot, z), ignoring, ctl: pageCtl ? 'page' : 'poll', inWin, focused: win.isFocused(),
        pollJitter: Math.round(timing.jitter), lag: Math.round(Math.max(0, timing.lag)), flips: timing.flips, until: desk.debugUntil
      })
    } catch { /* fine */ }
  }, 100)
  // IC13: "Copy report" from the island (its window can't always reach the clipboard without the focus).
  ipcMain.on('island:copy', (e, text) => {
    if (!fromIsland(e) || typeof text !== 'string') return
    try { clipboard.writeText(text.slice(0, 400_000)) } catch { /* fine */ }
  })

  // IS20: still on top after sleep, the screen turning off, a new screen or Explorer restarting.
  const reassert = (why: string) => {
    if (!win || win.isDestroyed() || drag) return
    if (savedDisplay >= 0 && !screen.getAllDisplays().some((d) => d.id === savedDisplay)) savedDisplay = -1
    placeWin()
    if (win.isVisible()) {
      onTop()
      try { win.moveTop() } catch { /* fine */ }
    }
    if (why !== 'minute') {
      inside = null
      diag('ontop', `Back on top (${why})`)
    }
  }
  // IP5: a new set of screens (laptop alone, docked with two…): back to where it was for that set.
  const applyScreens = (why: string) => {
    let key = ''
    try { key = displayKey(screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds }))) } catch { return }
    if (!key || key === screensKey) return
    const first = !screensKey
    screensKey = key
    const l = desk.perScreen ? desk.layouts[key] : undefined
    if (!l) {
      if (!first) savePrefs()
      return
    }
    place = l.place
    pos = { ...l.pos }
    desk = { ...desk, offset: { ...l.offset } }
    if (l.displayId >= 0) savedDisplay = l.displayId
    const sizeChanged = !!l.size && l.size !== prefs.size
    if (l.size) prefs = { ...prefs, size: l.size }
    diag('layout', `Screens changed (${why}): back to this setup's spot (${place})`, true)
    sendPlacement()
    if (sizeChanged) sendPrefs()
    placeWin()
    o.onChange?.()
  }
  applyScreens('start')
  screen.on('display-metrics-changed', () => reassert('screen changed'))
  screen.on('display-removed', () => (applyScreens('a screen was removed'), reassert('screen removed')))
  screen.on('display-added', () => (applyScreens('a screen was added'), reassert('screen added')))

  // IF2: follow the mouse / the window in front: look every 2 s, move once the
  // new screen has held for 1.5 s, never while you drag it or have the mouse on it.
  /** The middle of the front window's screen, from the Windows watcher (physical pixels). */
  let fgPoint: { x: number; y: number } | null = null
  let moving = false
  const moveSmoothly = () => {
    if (!win || win.isDestroyed() || moving) return placeWin()
    const w = win
    moving = true
    const steps = [0.75, 0.5, 0.25, 0]
    let i = 0
    const fade = setInterval(() => {
      if (w.isDestroyed()) { clearInterval(fade); moving = false; return }
      try { w.setOpacity(steps[i]) } catch { /* fine */ }
      if (++i >= steps.length) {
        clearInterval(fade)
        placeWin()
        let j = 0
        const back = setInterval(() => {
          if (w.isDestroyed()) { clearInterval(back); moving = false; return }
          try { w.setOpacity([0.25, 0.5, 0.75, 1][j]) } catch { /* fine */ }
          if (++j >= 4) { clearInterval(back); moving = false; inside = null }
        }, 30)
      }
    }, 30)
  }
  setInterval(() => {
    if (desk.monitor !== 'mouse' && desk.monitor !== 'window') return
    if (!win || win.isDestroyed() || drag || inside || !win.isVisible()) return
    let seen: number | null = null
    try {
      if (desk.monitor === 'window' && fgPoint) {
        const dip = process.platform === 'win32' ? screen.screenToDipPoint(fgPoint) : fgPoint
        seen = screen.getDisplayNearestPoint({ x: Math.round(dip.x), y: Math.round(dip.y) }).id
      } else seen = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id
    } catch { return }
    const cur = display().id
    const r = followTick(follow, seen, cur, Date.now())
    follow = r.st
    if (r.moveTo != null) {
      followId = r.moveTo
      diag('follow', `Moved to the screen ${desk.monitor === 'mouse' ? 'the mouse is on' : 'you work on'}`, true)
      moveSmoothly()
    }
  }, 2000)
  powerMonitor.on('resume', () => setTimeout(() => reassert('woke up'), 1500))
  powerMonitor.on('unlock-screen', () => setTimeout(() => reassert('unlocked'), 1000))
  setInterval(() => reassert('minute'), 60_000)

  // ---- Quiet, calls and full screen (Q1–Q3, Q5) ----------------------------
  const inCall = () => busy.mic || busy.meeting
  const fullscreenShown = () => busy.fullscreen && desk.fullscreen !== 'show'
  const sendQuiet = () => win?.webContents.send('island:quiet', { until: quietEnd, call: inCall(), fullscreen: fullscreenShown(), mic: busy.mic, meeting: busy.meeting, fullscreenMode: desk.fullscreen })
  let shownWhy = ''
  let leaving = false
  /** Hidden over a full-screen app on its screen (if you chose "hide"), and in a call when you chose "hide". */
  const applyVisibility = () => {
    if (!win || win.isDestroyed() || !enabled) return
    const why = desk.hidden.mode === 'hidden' ? 'you hid it' : busy.app ? `${busy.app} is in front (you hide it over this app)` : busy.fullscreen && desk.fullscreen === 'hide' ? 'a full-screen app' : inCall() && prefs.callMode === 'hide' ? (busy.meeting ? 'a calendar meeting' : 'a call (mic or camera on)') : ''
    // H1: it slides away first (the page plays it with transform and opacity), then the window goes.
    if (why) {
      if (win.isVisible() && !leaving) {
        leaving = true
        const w = win
        if (ready) w.webContents.send('island:leaving')
        setTimeout(() => {
          leaving = false
          if (!w.isDestroyed() && shownWhy && w.isVisible()) w.hide()
        }, ready ? 220 : 0)
      }
    } else showWin()
    if (why !== shownWhy) {
      shownWhy = why
      diag('vis', why ? `Hidden: ${why}` : 'Shown', true)
    }
  }
  /** Quiet for `choice` minutes / until tomorrow 06:00, or off (null). */
  const setQuiet = (choice: number | 'tomorrow' | null) => {
    quietEnd = choice == null ? 0 : quietUntil(choice, Date.now())
    savePrefs()
    sendQuiet()
    diag('quiet', quietEnd ? `Quiet until ${new Date(quietEnd).toTimeString().slice(0, 5)}` : 'Quiet off', true)
    o.onChange?.()
  }
  // Quiet time over: back by itself (checked every 15 s and when the PC wakes up).
  const quietCheck = () => { if (quietEnd && Date.now() >= quietEnd) setQuiet(null) }
  setInterval(quietCheck, 15_000)
  powerMonitor.on('resume', quietCheck)
  ipcMain.on('island:quiet', (e, choice) => {
    // The app window too: a recipe or the focus pack (SI7, SI19) quiets the island.
    if (!fromIsland(e) && !fromApp(e)) return
    setQuiet(choice === 'tomorrow' ? 'tomorrow' : Number.isFinite(choice) && choice > 0 ? Number(choice) : null)
  })
  // IS12: a calendar meeting is on now (the island page knows the plan).
  ipcMain.on('island:call', (e, c) => {
    if (!fromIsland(e) && !fromApp(e)) return
    const on = !!(c && typeof c === 'object' ? (c as { inCall?: unknown }).inCall : c)
    if (on === busy.meeting) return
    busy = { ...busy, meeting: on }
    diag('meeting', on ? 'A calendar meeting started' : 'The calendar meeting ended', true)
    sendQuiet()
    applyVisibility()
  })
  // IS23: lines from the island page go in the same log.
  ipcMain.on('island:log', (e, line) => {
    if (!fromIsland(e) || typeof line !== 'string') return
    log.push({ at: new Date().toISOString(), from: 'island', line: line.slice(0, 300) })
    if (log.length > 200) log.splice(0, log.length - 200)
  })
  ipcMain.handle('island:getLog', (e) => (fromApp(e) || fromIsland(e) ? log.slice() : []))

  // Windows: a call (any app using the microphone or camera, from Windows'
  // own privacy log) and a full-screen app (the window in front covers its
  // whole screen; only the island's screen counts) or presentation mode.
  // One small PowerShell process stays running: every 4 s, every 10 s once
  // nothing changes.
  let watcher: ChildProcess | null = null
  let restarting = false
  let lastSample = 0
  /** Is that point (physical pixels, from Windows) on the island's screen? */
  const onIslandScreen = (p: { x: number; y: number }) => {
    try {
      const dip = process.platform === 'win32' ? screen.screenToDipPoint(p) : p
      return screen.getDisplayNearestPoint({ x: Math.round(dip.x), y: Math.round(dip.y) }).id === display().id
    } catch {
      return true
    }
  }
  const startWatcher = () => {
    if (process.platform !== 'win32' || watcher) return
    // P2: the app in front, only when you turned it on (Settings → Ben on this PC); the title only with "titles".
    const pc = o.pc?.() ?? { activeApp: false, titles: false }
    const cs = [
      'using System;using System.Text;using System.Text.RegularExpressions;using System.Runtime.InteropServices;using Microsoft.Win32;',
      'public static class QN{',
      '[DllImport("shell32.dll")]public static extern int SHQueryUserNotificationState(out int s);',
      '[StructLayout(LayoutKind.Sequential)]public struct R{public int L;public int T;public int Rt;public int B;}',
      '[StructLayout(LayoutKind.Sequential)]public struct MI{public int cbSize;public R rcMonitor;public R rcWork;public uint dwFlags;}',
      '[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();',
      '[DllImport("user32.dll")]static extern bool SetProcessDpiAwarenessContext(IntPtr v);',
      // Real pixels on every screen (per-monitor), so the screen can be matched; older Windows: system DPI.
      'public static void Dpi(){try{if(SetProcessDpiAwarenessContext(new IntPtr(-4)))return;}catch{}SetProcessDPIAware();}',
      '[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();',
      '[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);',
      '[DllImport("user32.dll")]public static extern bool IsZoomed(IntPtr h);',
      '[DllImport("user32.dll")]public static extern int GetWindowLong(IntPtr h,int i);',
      '[DllImport("user32.dll")]public static extern IntPtr MonitorFromWindow(IntPtr h,uint f);',
      '[DllImport("user32.dll")]public static extern bool GetMonitorInfo(IntPtr m,ref MI i);',
      '[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetClassName(IntPtr h,StringBuilder s,int n);',
      '[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);',
      '[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);',
      // The window in front covers its whole monitor (not the desktop, not a normal maximized window): that monitor's middle.
      'public static string Fs(){IntPtr h=GetForegroundWindow();if(h==IntPtr.Zero)return "";var c=new StringBuilder(64);GetClassName(h,c,64);string k=c.ToString();',
      'if(k=="Progman"||k=="WorkerW"||k=="Shell_TrayWnd"||k=="Shell_SecondaryTrayWnd")return "";',
      'bool cap=(GetWindowLong(h,-16)&0x00C00000)==0x00C00000;if(cap&&IsZoomed(h))return "";R r;if(!GetWindowRect(h,out r))return "";',
      'MI i=new MI();i.cbSize=Marshal.SizeOf(typeof(MI));if(!GetMonitorInfo(MonitorFromWindow(h,2),ref i))return "";R m=i.rcMonitor;',
      'if(r.L<=m.L&&r.T<=m.T&&r.Rt>=m.Rt&&r.B>=m.B)return ((m.L+m.Rt)/2)+","+((m.T+m.B)/2);return "";}',
      // IF2: the middle of the screen the window in front is on (follow the active window).
      'public static string Mon(){IntPtr h=GetForegroundWindow();if(h==IntPtr.Zero)return "";MI i=new MI();i.cbSize=Marshal.SizeOf(typeof(MI));if(!GetMonitorInfo(MonitorFromWindow(h,2),ref i))return "";R m=i.rcMonitor;return ((m.L+m.Rt)/2)+","+((m.T+m.B)/2);}',
      // Mic / camera: only the apps\' own keys and NonPackaged\'s, not the whole tree.
      'static bool Live(RegistryKey p,string n){if(Regex.IsMatch(n,"Life System|electron",RegexOptions.IgnoreCase))return false;using(var k=p.OpenSubKey(n)){if(k==null)return false;object s=k.GetValue("LastUsedTimeStart");object e=k.GetValue("LastUsedTimeStop");return s!=null&&e!=null&&Convert.ToInt64(s)>0&&Convert.ToInt64(e)==0;}}',
      'public static int Media(){foreach(string w in new string[]{"microphone","webcam"}){using(var b=Registry.CurrentUser.OpenSubKey(@"Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\"+w)){if(b==null)continue;',
      'foreach(string n in b.GetSubKeyNames()){if(n=="NonPackaged"){using(var np=b.OpenSubKey(n)){if(np==null)continue;foreach(string a in np.GetSubKeyNames()){if(Live(np,a))return 1;}}}else if(Live(b,n))return 1;}}}return 0;}',
      '}'
    ].join('')
    // The program in front is read always (IF6: apps it hides over; it stays in memory);
    // its window title only with the PC sensor's "titles" on.
    const fgLine = ` $h=[QN]::GetForegroundWindow(); $fp=0; [void][QN]::GetWindowThreadProcessId($h,[ref]$fp); $pn=''; try { $pn=[System.Diagnostics.Process]::GetProcessById([int]$fp).ProcessName } catch {}; $tt=''; ${pc.activeApp && pc.titles ? '$sb=New-Object System.Text.StringBuilder 300; [void][QN]::GetWindowText($h,$sb,300); $tt=$sb.ToString() -replace "[\\r\\n|]"," "' : ''}`
    const ps = [
      "$ErrorActionPreference='SilentlyContinue'",
      `Add-Type -TypeDefinition '${cs}'`,
      '[QN]::Dpi()',
      "$prev=''; $same=0",
      'while($true){',
      ' $s=0; [void][QN]::SHQueryUserNotificationState([ref]$s)',
      ' $m=[QN]::Media(); $f=[QN]::Fs(); $g=[QN]::Mon()',
      fgLine,
      ' $o="qs=$s media=$m"; if($f){ $o+=" fs=$f" }; if($g){ $o+=" fgm=$g" }; if($pn){ $o+=" fgp=$($pn -replace \'\\s\',\'_\')" }',
      ...(pc.activeApp ? [' $o+=" app=$pn|$tt"'] : []),
      ' Write-Output $o',
      ' if($o -eq $prev){ $same++ } else { $same=0 }; $prev=$o',
      ' if($same -ge 3){ Start-Sleep -Seconds 10 } else { Start-Sleep -Seconds 4 }',
      '}'
    ].join('\n')
    try {
      watcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      watcher = null
      return
    }
    lastSample = 0
    let buf = ''
    watcher.stdout?.on('data', (d: Buffer) => {
      buf += d.toString()
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      const raw = lines.reverse().find((l) => l.startsWith('qs='))
      const w = raw ? parseWatcherLine(raw) : null
      if (!w) return
      const now = Date.now()
      // P2: the app in front ("app=chrome|Lofi - YouTube"), with the real time since the last look.
      if (w.app) o.onApp?.(w.app.proc, w.app.title, sampleSeconds(now, lastSample))
      lastSample = now
      fgPoint = w.fg ?? null
      if (w.proc) recentApps = noteRecentApp(recentApps, w.proc)
      // IC18: the app in front can pick the profile.
      if ((w.proc ?? '') !== fgProc) {
        fgProc = w.proc ?? ''
        checkProfile()
        // Island eyes: the window in front changed (EY1 reads it only if you turned that on).
        if (fgProc) o.onFg?.(fgProc)
      }
      // Full screen counts only on the island's own screen; presentation mode everywhere.
      const fsHere = !!w.fs && onIslandScreen(w.fs)
      // IF6: an app you hide it over is in front (on the island's screen, when known).
      const hideApp = hideOverApp({ proc: w.proc ?? null, hideApps: desk.hideApps, onIslandScreen: w.fg ? onIslandScreen(w.fg) : true }) ? w.proc! : ''
      const next = { ...busy, fullscreen: fsHere || w.qs === QUNS_PRESENTATION, mic: w.media, app: hideApp }
      if (next.app !== busy.app) diag('app', next.app ? `${next.app} is in front: hidden (your list)` : 'The app you hide it over is gone', true)
      if (next.fullscreen === busy.fullscreen && next.mic === busy.mic && next.app === busy.app) return
      if (next.fullscreen !== busy.fullscreen) diag('fs', next.fullscreen ? (fsHere ? 'A full-screen app is on the island\'s screen' : 'Presentation mode is on') : 'No full-screen app on the island\'s screen', true)
      if (next.mic !== busy.mic) diag('mic', next.mic ? 'Microphone or camera in use' : 'Microphone and camera free', true)
      busy = next
      sendQuiet()
      applyVisibility()
    })
    watcher.on('exit', () => {
      watcher = null
      if (restarting) {
        restarting = false
        return startWatcher()
      }
      // It stopped (e.g. PowerShell blocked): try again in a minute.
      setTimeout(startWatcher, 60_000)
    })
  }
  /** The PC sensors changed (Settings → Ben on this PC): start the watcher again with them. */
  const restartWatcher = () => {
    if (!watcher) return startWatcher()
    restarting = true
    try {
      watcher.kill()
    } catch {
      restarting = false
    }
  }
  startWatcher()
  const stopWatcher = (): void => {
    restarting = false
    try { watcher?.kill() } catch { /* fine */ }
  }
  app.on('will-quit', stopWatcher)
  // main.ts exitNow (the release check): app.exit skips will-quit.
  ;(app as unknown as NodeJS.EventEmitter).on('life-exit-now', stopWatcher)

  // ---- Shortcuts (IS15, IS22) ------------------------------------------------
  // Open / close it from anywhere.
  const toggle = () => {
    if (!enabled) return
    // H1: hidden or tucked away: the island's shortcut brings it back too.
    if (desk.hidden.mode !== 'shown') setHide(null)
    if (!win || win.isDestroyed()) open()
    showWin()
    sendWhenReady('island:toggle')
  }
  // P4: add a task from anywhere. P9: start (and send) a voice note to Ben.
  const openFor = (what: 'capture' | 'voice') => {
    if (!enabled) {
      enabled = true
      savePrefs()
    }
    if (!win || win.isDestroyed()) open()
    showWin()
    sendWhenReady(`island:${what}`)
  }
  const bound: Record<Slot, string> = { island: '', quiet: '', capture: '', voice: '', hide: '' }
  const failed = new Map<Slot, string>()
  const actions: Record<Slot, () => void> = {
    island: toggle,
    quiet: () => setQuiet(quietEnd > Date.now() ? null : 60),
    capture: () => openFor('capture'),
    voice: () => openFor('voice'),
    hide: () => toggleHidden()
  }
  const wanted = (slot: Slot) => (slot === 'island' ? prefs.shortcut : slot === 'quiet' ? prefs.quietShortcut : slot === 'capture' ? desk.captureShortcut : slot === 'hide' ? desk.hideShortcut : desk.voiceShortcut)
  /** Registers a shortcut; false (and a note to Settings) when another app already uses it. */
  const bind = (slot: Slot): boolean => {
    if (bound[slot]) { try { globalShortcut.unregister(bound[slot]) } catch { /* fine */ } }
    bound[slot] = ''
    failed.delete(slot)
    const acc = wanted(slot)
    if (!acc) return true
    let ok = false
    try { ok = globalShortcut.register(acc, actions[slot]) } catch { ok = false }
    if (ok) { bound[slot] = acc; return true }
    failed.set(slot, acc)
    diag(`key-${slot}`, `Shortcut ${acc} is taken by another app`, true)
    try { if (!o.appWindow.isDestroyed()) o.appWindow.webContents.send('island:shortcutFailed', { accelerator: acc, what: slot }) } catch { /* fine */ }
    return false
  }
  for (const s of Object.keys(bound) as Slot[]) bind(s)
  ipcMain.handle('island:shortcutStatus', (e) => (fromApp(e) ? { failed: [...failed].map(([what, accelerator]) => ({ what, accelerator })) } : null))

  // Settings → Desktop island (from the app window).
  ipcMain.handle('island:getPrefs', (e) => (fromApp(e) ? allPrefs() : null))
  ipcMain.handle('island:setPrefs', (e, p: Partial<IslandPrefs & IslandDeskPrefs> & { place?: unknown; displayId?: unknown }) => {
    // IC17: the island's edit mode may save its pill order, and nothing else.
    if (!fromApp(e)) {
      if (!fromIsland(e) || !p || !Array.isArray(p.pillOrder)) return null
      p = { pillOrder: p.pillOrder }
    }
    const before = allPrefs()
    prefs = cleanIslandPrefs({ ...prefs, ...p })
    // Saved spots are the desktop's own: Settings can't overwrite them.
    desk = cleanDeskPrefs({ ...desk, ...p, layouts: desk.layouts, spots: desk.spots, hidden: desk.hidden })
    // IC13: Island debug runs 30 minutes at most.
    if (desk.debugUntil) desk = { ...desk, debugUntil: Math.min(desk.debugUntil, Date.now() + DEBUG_MS) }
    if (!!desk.debugUntil !== !!before.debugUntil) diag('debug', desk.debugUntil ? 'Island debug on (30 minutes)' : 'Island debug off', true)
    // IF1: a position from Settings; IF2: a screen picked from the list.
    if (isPlacement(p?.place)) {
      place = p.place
      if (p.place === 'top') pos.cx = 0.5
      sendPlacement()
    }
    if (typeof p?.displayId === 'number' && screen.getAllDisplays().some((d) => d.id === p.displayId)) {
      savedDisplay = p.displayId
      desk = { ...desk, monitor: 'fixed' }
    }
    let shortcutOk = true
    if (prefs.shortcut !== before.shortcut) shortcutOk = bind('island') && shortcutOk
    if (prefs.quietShortcut !== before.quietShortcut) shortcutOk = bind('quiet') && shortcutOk
    if (desk.captureShortcut !== before.captureShortcut) shortcutOk = bind('capture') && shortcutOk
    if (desk.voiceShortcut !== before.voiceShortcut) shortcutOk = bind('voice') && shortcutOk
    if (desk.hideShortcut !== before.hideShortcut) shortcutOk = bind('hide') && shortcutOk
    savePrefs()
    sendQuiet()
    applyVisibility()
    if (win && !win.isDestroyed()) {
      sendPrefs()
      placeWin()
    }
    o.onChange?.()
    return { prefs: allPrefs(), shortcutOk }
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  // IF2: the screens to pick from.
  const displays = () => {
    try {
      const primary = screen.getPrimaryDisplay().id
      const here = display().id
      return screen.getAllDisplays().map((d, i) => ({ id: d.id, label: displayLabel({ id: d.id, bounds: d.bounds, primary: d.id === primary }, i), primary: d.id === primary, current: d.id === here }))
    } catch {
      return []
    }
  }
  ipcMain.handle('island:displays', (e) => (fromApp(e) ? displays() : []))
  // IF6: the programs seen in front lately (only the names; only for Settings).
  ipcMain.handle('island:recentApps', (e) => (fromApp(e) ? recentApps.slice() : []))
  // IP4: the app's colours, for "Match the app".
  ipcMain.on('island:theme', (e, t) => {
    if (!fromApp(e)) return
    const next = cleanTheme(t)
    if (!next || JSON.stringify(next) === JSON.stringify(appTheme)) return
    appTheme = next
    savePrefs()
    sendPrefs()
  })
  const setMonitor = (mode: MonitorMode, id?: number) => {
    desk = { ...desk, monitor: mode }
    if (mode === 'fixed' && typeof id === 'number') savedDisplay = id
    followId = null
    savePrefs()
    placeWin()
    showWin()
    o.onChange?.()
  }

  // ---- IC19: typing in another app: the island fades back ----
  // Twice a second: input in the last second (the system's idle time is 0)
  // with the mouse not moving means typing; far from the pill (160 px) it
  // fades to ~20%; moving near it or two seconds without typing brings it back.
  let typing = false
  let lastTypeAt = 0
  let lastCur = { x: -1, y: -1 }
  setInterval(() => {
    if (!win || win.isDestroyed() || !ready) return
    const on = prefs.controls.fadeTyping && win.isVisible() && !drag
    if (!on) {
      if (typing) win.webContents.send('island:typing', (typing = false))
      return
    }
    try {
      const c = screen.getCursorScreenPoint()
      const moved = Math.abs(c.x - lastCur.x) + Math.abs(c.y - lastCur.y) > 2
      lastCur = c
      const now = Date.now()
      if (powerMonitor.getSystemIdleTime() < 1 && !moved) lastTypeAt = now
      const b = win.getBounds()
      const z = pageZoom()
      const r = rectsToDip(hot, z)[0] ?? { x: b.width / 2 - 60, y: 0, w: 120, h: 40 }
      const dx = Math.max(r.x - (c.x - b.x), 0, c.x - b.x - (r.x + r.w))
      const dy = Math.max(r.y - (c.y - b.y), 0, c.y - b.y - (r.y + r.h))
      const next = typingFade({ idleMs: now - lastTypeAt, cursorDist: Math.hypot(dx, dy), faded: typing, islandActive: win.isFocused() || !ignoring })
      if (next !== typing) {
        typing = next
        win.webContents.send('island:typing', typing)
      }
    } catch { /* fine */ }
  }, 500)

  if (enabled) open()
  return {
    /** CL9: memory the island's page uses (bytes; 0 when it isn't open). */
    memory: () => {
      if (!win || win.isDestroyed()) return 0
      const pid = win.webContents.getOSProcessId()
      return (app.getAppMetrics().find((m) => m.pid === pid)?.memory.workingSetSize ?? 0) * 1024
    },
    /** CL9: a fresh page (the window stays where it is). */
    reload: () => { if (win && !win.isDestroyed()) win.webContents.reload() },
    /** IC18: the profile in use, your pick, and how it switches by itself. */
    profile: () => ({ active: profileNow(), pick: prefs.controls.profile, auto: prefs.controls.profileAuto }),
    setProfile: (id: IslandProfileId) => setControls({ profile: id }),
    setProfileAuto: (mode: IslandControls['profileAuto']) => setControls({ profileAuto: mode }),
    capture: () => openFor('capture'),
    voice: () => openFor('voice'),
    restartWatcher,
    enabled: () => enabled,
    /** Island 2 (islandKit.ts): an event for the page, is this the page, the island's own shortcuts, shown now. */
    kit: {
      send: (ev: Record<string, unknown>) => { if (win && !win.isDestroyed() && ready) win.webContents.send('islandKit', ev) },
      isIsland: (wc: Electron.WebContents) => !!win && !win.isDestroyed() && wc === win.webContents,
      reserved: () => (Object.entries(bound) as [Slot, string][]).map(([what, accelerator]) => ({ what: SLOT_LABEL[what], accelerator: accelerator || wanted(what) })).filter((x) => x.accelerator),
      shown: () => enabled && !!win && !win.isDestroyed() && win.isVisible() && desk.hidden.mode !== 'hidden'
    },
    /** H1: hidden / a dot / shown, and until when. */
    hideState: () => desk.hidden,
    hideLabel: () => hideText(desk.hidden, Date.now()),
    setHide,
    toggleHidden,
    get hideShortcut() { return bound.hide || '' },
    /** H1: move mode (arrow keys, Enter saves). */
    startMove,
    dodge: () => desk.dodge,
    setDodge(on: boolean) { desk = { ...desk, dodge: on }; savePrefs(); sendPrefs(); o.onChange?.() },
    /** Quiet until (ms), or 0. */
    quietUntil: () => (quietEnd > Date.now() ? quietEnd : 0),
    setQuiet,
    placement: () => place,
    monitor: () => desk.monitor,
    displayId: () => display().id,
    displays,
    setMonitor,
    get shortcut() { return bound.island || prefs.shortcut || 'no shortcut' },
    setPlacement(p: IslandPlacement) {
      place = p
      if (p === 'top') pos.cx = 0.5
      desk = { ...desk, offset: { x: 0, y: 0 } }
      fit = { x: 0, y: 0 }
      try { const d = display(); spotDisplay = d.id; desk = { ...desk, spots: rememberSpot(desk.spots, screenKey(d), { ...desk.spots[screenKey(d)], place, pos: { ...pos } }) } } catch { /* fine */ }
      savePrefs()
      sendPlacement()
      placeWin()
      showWin()
    },
    /** Back to the top center. */
    resetPosition() {
      pos = { cx: 0.5, top: 0, cy: 0.5 }
      desk = { ...desk, offset: { x: 0, y: 0 } }
      this.setPlacement('top')
    },
    setEnabled(on: boolean) {
      enabled = on
      savePrefs()
      if (on) open()
      else close()
    }
  }
}
