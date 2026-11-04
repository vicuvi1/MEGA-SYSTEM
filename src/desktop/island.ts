// The desktop island window: frameless, transparent, always on top. It lives
// at the top of the screen, docked on the left or right edge, or floating
// where you dropped it. When nothing is happening it is fully hidden: touch
// that screen edge with the mouse (or press Ctrl+Alt+Space) and it appears;
// a running timer, a block coming up or Ben's message show it on their own.
// It never touches your data: the app window sends it snapshots and gets its
// taps back. Clicks pass through everything except the visible pill/card.
import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IslandMode, IslandPlacement } from '../shared/desktop'
import { cleanIslandPrefs, ISLAND_ZOOM, type IslandPrefs } from '../core/islandModel'

const OPEN_W = 490
const OPEN_MAX_H = 680

/** Window size for each placement and mode (the open height follows the card). */
function size(place: IslandPlacement, mode: IslandMode, openH: number): { width: number; height: number } {
  if (mode === 'open') return { width: OPEN_W, height: openH }
  if (place === 'left' || place === 'right') return { width: 100, height: 140 }
  if (mode === 'pill') return { width: 500, height: 60 }
  return place === 'free' ? { width: 64, height: 40 } : { width: 320, height: 34 }
}

export function createIsland(o: { origin: string; preload: string; appWindow: BrowserWindow; showApp: (page?: string) => void; dir: string; onChange?: () => void }) {
  const prefFile = join(o.dir, 'island.json')
  let enabled = true
  let place: IslandPlacement = 'top'
  // top: center share of the width; free: center share + px from the top; sides: center share of the height.
  let pos = { cx: 0.5, top: 0, cy: 0.5 }
  // Your settings (Settings → Desktop island): size, look, sections, sound, hide speed, shortcut.
  let prefs: IslandPrefs = cleanIslandPrefs(null)
  try {
    if (existsSync(prefFile)) {
      const p = JSON.parse(readFileSync(prefFile, 'utf8'))
      enabled = p.enabled !== false
      if (['top', 'left', 'right', 'free'].includes(p.place)) place = p.place
      if (Number.isFinite(p.cx)) pos.cx = Math.min(1, Math.max(0, p.cx))
      if (Number.isFinite(p.top)) pos.top = Math.max(0, p.top)
      if (Number.isFinite(p.cy)) pos.cy = Math.min(1, Math.max(0, p.cy))
      // Older versions saved a dragged spot without a placement: that was "free".
      if (!p.place && p.top > 0) place = 'free'
      prefs = cleanIslandPrefs(p.prefs)
    }
  } catch { /* defaults */ }
  const savePrefs = () => { try { writeFileSync(prefFile, JSON.stringify({ enabled, place, ...pos, prefs })) } catch { /* fine */ } }
  /** Size setting: the page is zoomed, so the window and its click areas scale too. */
  const zoom = () => ISLAND_ZOOM[prefs.size]
  const scaled = (m: IslandMode) => {
    const s = size(place, m, openHeight)
    return { width: Math.round(s.width * zoom()), height: Math.round(s.height * zoom()) }
  }

  let win: BrowserWindow | null = null
  let mode: IslandMode = 'hidden'
  let last: unknown = null
  let displayId = -1
  let openHeight = OPEN_MAX_H
  let hot = { x: 0, y: 0, width: 0, height: 0 }
  let inside = false
  let drag: { timer: ReturnType<typeof setInterval>; offX: number; offY: number } | null = null

  const display = () => (displayId >= 0 ? screen.getAllDisplays().find((d) => d.id === displayId) : null) ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  /** Fully hidden: only for the edge placements (floating keeps a small dot). */
  const tucked = () => mode === 'hidden' && place !== 'free'

  const placeWin = () => {
    if (!win || win.isDestroyed()) return
    const d = display()
    displayId = d.id
    const wa = d.workArea
    const { width, height } = scaled(mode)
    const clampX = (x: number) => Math.round(Math.min(wa.x + wa.width - width, Math.max(wa.x, x)))
    const clampY = (y: number) => Math.round(Math.min(wa.y + wa.height - height, Math.max(wa.y, y)))
    let x: number
    let y: number
    if (place === 'left' || place === 'right') {
      x = place === 'left' ? wa.x : wa.x + wa.width - width
      y = clampY(wa.y + pos.cy * wa.height - height / 2)
    } else {
      x = clampX(wa.x + pos.cx * wa.width - width / 2)
      y = place === 'free' ? clampY(wa.y + pos.top) : wa.y
    }
    win.setBounds({ x, y, width, height })
  }

  const sendPlacement = () => win?.webContents.send('island:placement', place)
  const showWin = () => {
    if (!win || win.isDestroyed()) return
    if (!win.isVisible()) win.showInactive()
  }

  const open = () => {
    if (win && !win.isDestroyed()) return
    win = new BrowserWindow({
      ...scaled('hidden'), frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true, backgroundColor: '#00000000',
      type: process.platform === 'win32' ? 'toolbar' : undefined, title: 'Life System island',
      webPreferences: { preload: o.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
    win.setIgnoreMouseEvents(true, { forward: true })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.webContents.on('did-finish-load', () => {
      win?.webContents.setZoomFactor(zoom())
      win?.webContents.send('island:prefs', prefs)
      sendPlacement()
      if (last) win?.webContents.send('island:state', last)
    })
    win.on('closed', () => { win = null })
    placeWin()
    void win.loadURL(o.origin + '/?island=1').then(() => { if (!tucked()) showWin() })
  }
  const close = () => { if (win && !win.isDestroyed()) win.destroy() }

  const fromIsland = (e: Electron.IpcMainEvent) => !!win && e.sender === win.webContents
  const fromApp = (e: Electron.IpcMainEvent) => e.sender === o.appWindow.webContents
  ipcMain.on('island:state', (e, s) => {
    if (!fromApp(e)) return
    last = s
    if (win && !win.isDestroyed()) win.webContents.send('island:state', s)
  })
  // The island page is ready (it loads a moment after the window): tell it where it lives and what to show.
  ipcMain.on('island:ready', (e) => {
    if (!fromIsland(e)) return
    win?.webContents.send('island:prefs', prefs)
    sendPlacement()
    if (last) win?.webContents.send('island:state', last)
  })
  ipcMain.on('island:action', (e, a) => { if (fromIsland(e)) o.appWindow.webContents.send('island:action', a) })
  ipcMain.on('island:ack', (e, ack) => { if (fromApp(e)) win?.webContents.send('island:ack', ack) })
  // Typing to Ben: the island takes the keyboard (it never takes it on its own).
  ipcMain.on('island:focus', (e) => {
    if (!fromIsland(e) || !win) return
    win.setIgnoreMouseEvents(false)
    win.focus()
    win.webContents.focus()
  })
  ipcMain.on('island:showApp', (e, page) => { if (fromIsland(e)) o.showApp(typeof page === 'string' ? page : undefined) })

  // Drag it anywhere. Drop it on the left/right edge → docked there; at the top →
  // top; anywhere else → floating right there. The spot is remembered.
  ipcMain.on('island:dragStart', (e) => {
    if (!fromIsland(e) || !win || drag) return
    const c = screen.getCursorScreenPoint()
    const b = win.getBounds()
    win.setIgnoreMouseEvents(false)
    drag = {
      offX: c.x - b.x,
      offY: c.y - b.y,
      timer: setInterval(() => {
        if (!win || win.isDestroyed()) return
        const p = screen.getCursorScreenPoint()
        const nb = win.getBounds()
        win.setBounds({ x: p.x - drag!.offX, y: p.y - drag!.offY, width: nb.width, height: nb.height })
      }, 16)
    }
  })
  ipcMain.on('island:dragEnd', (e) => {
    if (!fromIsland(e) || !win || !drag) return
    clearInterval(drag.timer)
    drag = null
    const c = screen.getCursorScreenPoint()
    const b = win.getBounds()
    const d = screen.getDisplayNearestPoint(c)
    displayId = d.id
    const sb = d.bounds
    const wa = d.workArea
    if (c.x - sb.x < 70) place = 'left'
    else if (sb.x + sb.width - c.x < 70) place = 'right'
    else if (c.y - sb.y < 50) place = 'top'
    else place = 'free'
    pos.cy = Math.min(1, Math.max(0, (c.y - wa.y) / wa.height))
    pos.cx = Math.min(1, Math.max(0, (b.x + b.width / 2 - wa.x) / wa.width))
    pos.top = Math.max(0, b.y - wa.y)
    savePrefs()
    sendPlacement()
    placeWin()
    o.onChange?.()
  })
  ipcMain.on('island:hot', (e, r) => {
    if (fromIsland(e) && r && [r.x, r.y, r.width, r.height].every(Number.isFinite)) hot = r
  })
  ipcMain.on('island:mode', (e, m: IslandMode, height?: number) => {
    if (!fromIsland(e) || !['hidden', 'pill', 'open'].includes(m)) return
    const h = m === 'open' && Number.isFinite(height) ? Math.max(120, Math.min(OPEN_MAX_H, Math.round(height!))) : openHeight
    if (m === mode && h === openHeight && (m !== 'hidden' || !win?.isVisible() || place === 'free')) return
    mode = m
    openHeight = h
    placeWin()
    if (tucked()) win?.hide()
    else showWin()
    // Typing to Ben needs the keyboard; collapsed it never steals focus.
    if (m !== 'open' && win?.isFocused()) win.blur()
  })

  const reveal = () => {
    if (!win || win.isDestroyed()) return
    showWin()
    win.webContents.send('island:reveal')
  }

  // The real pointer, ~16 times a second:
  // - over the pill/card → it takes clicks (and hears "hover"); elsewhere clicks
  //   pass through (polling avoids the browser's false mouse-leave events);
  // - hidden at an edge → touching that edge of the screen brings it out.
  let edgeHits = 0
  setInterval(() => {
    if (!win || win.isDestroyed() || drag) return
    const c = screen.getCursorScreenPoint()
    if (!win.isVisible()) {
      if (!tucked()) return
      const d = screen.getDisplayNearestPoint(c)
      const sb = d.bounds
      const wa = d.workArea
      const near =
        place === 'top' ? c.y <= sb.y + 1 && Math.abs(c.x - (wa.x + pos.cx * wa.width)) <= 230
        : place === 'left' ? c.x <= sb.x + 1 && Math.abs(c.y - (wa.y + pos.cy * wa.height)) <= 280
        : c.x >= sb.x + sb.width - 2 && Math.abs(c.y - (wa.y + pos.cy * wa.height)) <= 280
      edgeHits = near ? edgeHits + 1 : 0
      if (edgeHits === 2) {
        displayId = d.id
        reveal()
      }
      return
    }
    const b = win.getBounds()
    const x = c.x - b.x
    const y = c.y - b.y
    const z = zoom()
    const now = hot.width > 0 && x >= hot.x * z - 4 && x <= (hot.x + hot.width) * z + 4 && y >= hot.y * z - 4 && y <= (hot.y + hot.height) * z + 6
    if (now === inside) return
    inside = now
    win.setIgnoreMouseEvents(!now, { forward: true })
    win.webContents.send('island:hover', now)
  }, 60)

  // Follow the mouse to another screen (only while collapsed and visible).
  setInterval(() => {
    if (!win || win.isDestroyed() || mode === 'open' || drag || !win.isVisible()) return
    if (screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id !== displayId) {
      displayId = -1
      placeWin()
    }
  }, 1500)
  screen.on('display-metrics-changed', placeWin)

  // Ctrl+Alt+Space: open / close it from anywhere.
  const toggle = () => {
    if (!enabled) return
    if (!win || win.isDestroyed()) open()
    showWin()
    win?.webContents.send('island:toggle')
  }
  let bound = ''
  /** Registers your shortcut; false when another app already uses it. */
  const bindShortcut = (): boolean => {
    if (bound) { try { globalShortcut.unregister(bound) } catch { /* fine */ } }
    bound = ''
    if (!prefs.shortcut) return true
    try {
      if (globalShortcut.register(prefs.shortcut, toggle)) { bound = prefs.shortcut; return true }
    } catch { /* invalid */ }
    return false
  }
  bindShortcut()
  // Settings → Desktop island (from the app window).
  ipcMain.handle('island:getPrefs', (e) => (e.sender === o.appWindow.webContents ? prefs : null))
  ipcMain.handle('island:setPrefs', (e, p: Partial<IslandPrefs>) => {
    if (e.sender !== o.appWindow.webContents) return null
    const before = prefs
    prefs = cleanIslandPrefs({ ...prefs, ...p })
    const shortcutOk = prefs.shortcut === before.shortcut ? true : bindShortcut()
    savePrefs()
    if (win && !win.isDestroyed()) {
      win.webContents.setZoomFactor(zoom())
      win.webContents.send('island:prefs', prefs)
      placeWin()
    }
    o.onChange?.()
    return { prefs, shortcutOk }
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())

  if (enabled) open()
  return {
    enabled: () => enabled,
    placement: () => place,
    get shortcut() { return prefs.shortcut || 'no shortcut' },
    setPlacement(p: IslandPlacement) {
      place = p
      if (p === 'top') pos.cx = 0.5
      savePrefs()
      sendPlacement()
      placeWin()
      if (tucked()) win?.hide()
      else showWin()
    },
    /** Back to the top center. */
    resetPosition() {
      pos = { cx: 0.5, top: 0, cy: 0.5 }
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
