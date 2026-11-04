// The desktop island window: a frameless, transparent, always-on-top pill at
// the top center of the screen the mouse is on. It never touches your data:
// the app window (running hidden in the tray) sends it snapshots and gets its
// taps back. Clicks pass through everything except the pill itself.
import { BrowserWindow, ipcMain, screen } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IslandMode } from '../shared/desktop'

const SIZES: Record<IslandMode, { width: number; height: number }> = {
  hidden: { width: 320, height: 34 },
  pill: { width: 420, height: 60 },
  open: { width: 480, height: 660 }
}

export function createIsland(o: { origin: string; preload: string; appWindow: BrowserWindow; showApp: (page?: string) => void; dir: string }) {
  const prefFile = join(o.dir, 'island.json')
  let enabled = true
  try {
    if (existsSync(prefFile)) enabled = JSON.parse(readFileSync(prefFile, 'utf8')).enabled !== false
  } catch { /* defaults */ }
  let win: BrowserWindow | null = null
  let mode: IslandMode = 'hidden'
  let last: unknown = null
  let displayId = -1
  let openHeight = SIZES.open.height
  let hot = { x: 0, y: 0, width: 0, height: 0 }
  let inside = false

  const place = () => {
    if (!win || win.isDestroyed()) return
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    displayId = d.id
    const { width } = SIZES[mode]
    const height = mode === 'open' ? openHeight : SIZES[mode].height
    const wa = d.workArea
    win.setBounds({ x: Math.round(wa.x + (wa.width - width) / 2), y: wa.y, width, height })
  }

  const open = () => {
    if (win && !win.isDestroyed()) return
    win = new BrowserWindow({
      ...SIZES.hidden, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true, backgroundColor: '#00000000',
      type: process.platform === 'win32' ? 'toolbar' : undefined, title: 'Life System island',
      webPreferences: { preload: o.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
    win.setIgnoreMouseEvents(true, { forward: true })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.webContents.on('did-finish-load', () => { if (last) win?.webContents.send('island:state', last) })
    win.on('closed', () => { win = null })
    place()
    void win.loadURL(o.origin + '/?island=1').then(() => win?.showInactive())
  }
  const close = () => { if (win && !win.isDestroyed()) win.destroy() }

  const fromIsland = (e: Electron.IpcMainEvent) => !!win && e.sender === win.webContents
  const fromApp = (e: Electron.IpcMainEvent) => e.sender === o.appWindow.webContents
  ipcMain.on('island:state', (e, s) => {
    if (!fromApp(e)) return
    last = s
    if (win && !win.isDestroyed()) win.webContents.send('island:state', s)
  })
  ipcMain.on('island:action', (e, a) => { if (fromIsland(e)) o.appWindow.webContents.send('island:action', a) })
  ipcMain.on('island:showApp', (e, page) => { if (fromIsland(e)) o.showApp(typeof page === 'string' ? page : undefined) })
  ipcMain.on('island:hot', (e, r) => {
    if (fromIsland(e) && r && [r.x, r.y, r.width, r.height].every(Number.isFinite)) hot = r
  })
  ipcMain.on('island:mode', (e, m: IslandMode, height?: number) => {
    if (!fromIsland(e) || !SIZES[m]) return
    const h = m === 'open' && Number.isFinite(height) ? Math.max(120, Math.min(SIZES.open.height, Math.round(height!))) : openHeight
    if (m === mode && h === openHeight) return
    mode = m
    openHeight = h
    place()
    // Typing to Ben needs the keyboard; collapsed it never steals focus.
    if (m !== 'open' && win?.isFocused()) win.blur()
  })

  // The real pointer: over the pill/card → it takes clicks (and hears "hover");
  // anywhere else clicks pass through to the apps below. Polling the cursor
  // avoids the browser's false mouse-leave events when click-through toggles.
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return
    const c = screen.getCursorScreenPoint()
    const b = win.getBounds()
    const x = c.x - b.x
    const y = c.y - b.y
    const now = hot.width > 0 && x >= hot.x - 4 && x <= hot.x + hot.width + 4 && y >= hot.y - 2 && y <= hot.y + hot.height + 6
    if (now === inside) return
    inside = now
    win.setIgnoreMouseEvents(!now, { forward: true })
    win.webContents.send('island:hover', now)
  }, 60)

  // Follow the mouse to another screen (only while collapsed).
  setInterval(() => {
    if (!win || win.isDestroyed() || mode === 'open') return
    if (screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id !== displayId) place()
  }, 1500)
  screen.on('display-metrics-changed', place)

  if (enabled) open()
  return {
    enabled: () => enabled,
    setEnabled(on: boolean) {
      enabled = on
      try { writeFileSync(prefFile, JSON.stringify({ enabled: on })) } catch { /* fine */ }
      if (on) open()
      else close()
    }
  }
}
