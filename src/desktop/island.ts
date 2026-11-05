// The desktop island window: frameless, transparent, always on top. It lives
// at the top of the screen, docked on the left or right edge, or floating
// where you dropped it. The window has ONE fixed size and never resizes: the
// pill, the peek and the command center are one shape animated inside it
// (resizing a transparent window on Windows is what made it jump and flicker).
// It never takes the keyboard on its own, only when you type in it.
// It never touches your data: the app window sends it snapshots and gets its
// taps back. Clicks pass through everything except the visible shape.
import { app, BrowserWindow, globalShortcut, ipcMain, powerMonitor, screen } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IslandPlacement } from '../shared/desktop'
import { cleanIslandPrefs, ISLAND_ZOOM, quietUntil, type IslandPrefs } from '../core/islandModel'

/** The window: room for the biggest state (the command center); the rest is see-through. */
const WIN = { width: 500, height: 660 }
/** Where the pill sits inside the window on the side placements (from the window's top). */
const SIDE_PILL_Y = 40

export function createIsland(o: { origin: string; preload: string; appWindow: BrowserWindow; showApp: (page?: string) => void; dir: string; onChange?: () => void }) {
  const prefFile = join(o.dir, 'island.json')
  let enabled = true
  let place: IslandPlacement = 'top'
  // top: center share of the width; free: center share + px from the top; sides: center share of the height.
  let pos = { cx: 0.5, top: 0, cy: 0.5 }
  // Your settings (Settings → Desktop island): size, look, sections, sound, hide speed, shortcut.
  let prefs: IslandPrefs = cleanIslandPrefs(null)
  // The screen you put it on (kept after a restart; the main screen if it's gone).
  let savedDisplay = -1
  // Quiet until this time (Q1): no reminders, only a small moon; 0 = not quiet.
  let quietEnd = 0
  // What Windows says (Q2, Q3): a call (mic or camera in use) or a full-screen app / Focus Assist.
  let busy = { call: false, fullscreen: false }
  try {
    if (existsSync(prefFile)) {
      const p = JSON.parse(readFileSync(prefFile, 'utf8'))
      enabled = p.enabled !== false
      if (['top', 'left', 'right', 'free'].includes(p.place)) place = p.place
      if (Number.isFinite(p.cx)) pos.cx = Math.min(1, Math.max(0, p.cx))
      if (Number.isFinite(p.top)) pos.top = Math.max(0, p.top)
      if (Number.isFinite(p.cy)) pos.cy = Math.min(1, Math.max(0, p.cy))
      if (Number.isFinite(p.displayId)) savedDisplay = p.displayId
      if (Number.isFinite(p.quietUntil) && p.quietUntil > Date.now()) quietEnd = p.quietUntil
      // Older versions saved a dragged spot without a placement: that was "free".
      if (!p.place && p.top > 0) place = 'free'
      prefs = cleanIslandPrefs(p.prefs)
    }
  } catch { /* defaults */ }
  const savePrefs = () => { try { writeFileSync(prefFile, JSON.stringify({ enabled, place, ...pos, displayId: savedDisplay, quietUntil: quietEnd, prefs })) } catch { /* fine */ } }
  /** Size setting: the page is zoomed, so the window and its click areas scale too. */
  const zoom = () => ISLAND_ZOOM[prefs.size]
  const scaled = () => ({ width: Math.round(WIN.width * zoom()), height: Math.round(WIN.height * zoom()) })

  let win: BrowserWindow | null = null
  let last: unknown = null
  let hot = { x: 0, y: 0, width: 0, height: 0 }
  let inside = false
  let drag: { timer: ReturnType<typeof setInterval>; offX: number; offY: number } | null = null

  const display = () => (savedDisplay >= 0 ? screen.getAllDisplays().find((d) => d.id === savedDisplay) : null) ?? screen.getPrimaryDisplay()

  const placeWin = () => {
    if (!win || win.isDestroyed()) return
    const wa = display().workArea
    const { width, height } = scaled()
    const clampX = (x: number) => Math.round(Math.min(wa.x + wa.width - width, Math.max(wa.x, x)))
    const clampY = (y: number) => Math.round(Math.min(wa.y + wa.height - height, Math.max(wa.y, y)))
    let x: number
    let y: number
    if (place === 'left' || place === 'right') {
      x = place === 'left' ? wa.x : wa.x + wa.width - width
      y = clampY(wa.y + pos.cy * wa.height - SIDE_PILL_Y * zoom())
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
    win.setAlwaysOnTop(true, 'pop-up-menu')
  }

  const open = () => {
    if (win && !win.isDestroyed()) return
    win = new BrowserWindow({
      ...scaled(), frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      // Not focusable: clicking it never takes the keyboard from your app (only typing in it does).
      fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true, backgroundColor: '#00000000', focusable: false,
      type: process.platform === 'win32' ? 'toolbar' : undefined, title: 'Life System island',
      webPreferences: { preload: o.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
    })
    // Above normal windows, below full-screen video and games.
    win.setAlwaysOnTop(true, 'pop-up-menu')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
    win.setIgnoreMouseEvents(true, { forward: true })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.webContents.on('did-finish-load', () => {
      win?.webContents.setZoomFactor(zoom())
      win?.webContents.send('island:prefs', prefs)
      sendQuiet()
      sendPlacement()
      if (last) win?.webContents.send('island:state', last)
    })
    win.on('closed', () => { win = null })
    // You clicked into another app: the panel may close (the island decides).
    win.on('blur', () => win?.webContents.send('island:blur'))
    win.on('always-on-top-changed', (_e, on) => { if (!on) win?.setAlwaysOnTop(true, 'pop-up-menu') })
    placeWin()
    void win.loadURL(o.origin + '/?island=1').then(() => showWin())
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
    sendQuiet()
    sendPlacement()
    if (last) win?.webContents.send('island:state', last)
  })
  ipcMain.on('island:action', (e, a) => { if (fromIsland(e)) o.appWindow.webContents.send('island:action', a) })
  ipcMain.on('island:ack', (e, ack) => { if (fromApp(e)) win?.webContents.send('island:ack', ack) })
  // Typing: the island takes the keyboard (it never takes it on its own), and gives it back.
  ipcMain.on('island:focus', (e) => {
    if (!fromIsland(e) || !win) return
    win.setFocusable(true)
    win.setIgnoreMouseEvents(false)
    win.focus()
    win.webContents.focus()
  })
  ipcMain.on('island:keyboard', (e, on) => {
    if (!fromIsland(e) || !win || on) return
    if (win.isFocused()) win.blur()
    win.setFocusable(false)
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
        // Only the position: the size is set once on drop (no jumps between screens).
        win.setPosition(p.x - drag!.offX, p.y - drag!.offY)
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
    savedDisplay = d.id
    const sb = d.bounds
    const wa = d.workArea
    if (c.x - sb.x < 70) place = 'left'
    else if (sb.x + sb.width - c.x < 70) place = 'right'
    else if (c.y - sb.y < 50) place = 'top'
    else place = 'free'
    pos.cy = Math.min(1, Math.max(0, (b.y + SIDE_PILL_Y * zoom() - wa.y) / wa.height))
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
  // The real pointer, ~16 times a second: over the shape → it takes clicks
  // (and hears "hover"); elsewhere clicks pass through to the apps below.
  // (Polling avoids the browser's false mouse-leave events on Windows.)
  setInterval(() => {
    if (!win || win.isDestroyed() || drag || !win.isVisible()) return
    const c = screen.getCursorScreenPoint()
    const b = win.getBounds()
    const x = c.x - b.x
    const y = c.y - b.y
    const z = zoom()
    const now = hot.width > 0 && x >= hot.x * z - 4 && x <= (hot.x + hot.width) * z + 4 && y >= hot.y * z - 4 && y <= (hot.y + hot.height) * z + 4
    if (now === inside) return
    inside = now
    win.setIgnoreMouseEvents(!now, { forward: true })
    win.webContents.send('island:hover', now)
  }, 50)

  // Screens plugged in or out, scaling changed: back on its screen (or the main one).
  const replace = () => {
    if (savedDisplay >= 0 && !screen.getAllDisplays().some((d) => d.id === savedDisplay)) savedDisplay = -1
    if (win && !win.isDestroyed()) win.setBounds({ ...win.getBounds(), ...scaled() })
    placeWin()
  }
  screen.on('display-metrics-changed', replace)
  screen.on('display-removed', replace)
  screen.on('display-added', replace)

  // ---- Quiet, calls and full screen (Q1–Q3, Q5) ----------------------------
  const sendQuiet = () => win?.webContents.send('island:quiet', { until: quietEnd, call: busy.call, fullscreen: busy.fullscreen })
  /** Hidden over full-screen apps / Focus Assist, and in a call when you chose "hide". */
  const applyVisibility = () => {
    if (!win || win.isDestroyed() || !enabled) return
    const hide = busy.fullscreen || (busy.call && prefs.callMode === 'hide')
    if (hide) { if (win.isVisible()) win.hide() } else showWin()
  }
  /** Quiet for `choice` minutes / until tomorrow 06:00, or off (null). */
  const setQuiet = (choice: number | 'tomorrow' | null) => {
    quietEnd = choice == null ? 0 : quietUntil(choice, Date.now())
    savePrefs()
    sendQuiet()
    o.onChange?.()
  }
  // Quiet time over: back by itself (checked every 15 s and when the PC wakes up).
  const quietCheck = () => { if (quietEnd && Date.now() >= quietEnd) setQuiet(null) }
  setInterval(quietCheck, 15_000)
  powerMonitor.on('resume', quietCheck)
  ipcMain.on('island:quiet', (e, choice) => {
    if (!fromIsland(e)) return
    setQuiet(choice === 'tomorrow' ? 'tomorrow' : Number.isFinite(choice) && choice > 0 ? Number(choice) : null)
  })

  // Windows: a call (any app using the microphone or camera, from Windows'
  // own privacy log) and full-screen apps / presentation / Focus Assist
  // (SHQueryUserNotificationState). One small PowerShell loop, every 4 s.
  let watcher: ChildProcess | null = null
  const startWatcher = () => {
    if (process.platform !== 'win32' || watcher) return
    const ps = [
      "$ErrorActionPreference='SilentlyContinue'",
      'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public static class QN{[DllImport("shell32.dll")]public static extern int SHQueryUserNotificationState(out int s);}\'',
      "$base='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore'",
      'while($true){',
      ' $s=0; [void][QN]::SHQueryUserNotificationState([ref]$s)',
      " $m=0; foreach($k in 'microphone','webcam'){ Get-ChildItem -Path \"$base\\$k\" -Recurse | Where-Object { $_.PSChildName -notmatch 'Life System|electron' } | ForEach-Object { $p=Get-ItemProperty -Path $_.PSPath; if($p.LastUsedTimeStart -gt 0 -and $p.LastUsedTimeStop -eq 0){ $m=1 } } }",
      ' Write-Output "qs=$s media=$m"',
      ' Start-Sleep -Seconds 4',
      '}'
    ].join('\n')
    try {
      watcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      watcher = null
      return
    }
    let buf = ''
    watcher.stdout?.on('data', (d: Buffer) => {
      buf += d.toString()
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      const last = lines.reverse().find((l) => l.startsWith('qs='))
      if (!last) return
      const qs = Number(/qs=(\d+)/.exec(last)?.[1] ?? 0)
      // 2 busy (full screen), 3 full-screen game/video, 4 presentation, 6 Focus Assist / quiet time, 7 full-screen app.
      const next = { fullscreen: [2, 3, 4, 6, 7].includes(qs), call: / media=1/.test(last) }
      if (next.fullscreen === busy.fullscreen && next.call === busy.call) return
      busy = next
      sendQuiet()
      applyVisibility()
    })
    watcher.on('exit', () => {
      watcher = null
      // It stopped (e.g. PowerShell blocked): try again in a minute.
      setTimeout(startWatcher, 60_000)
    })
  }
  startWatcher()
  app.on('will-quit', () => { try { watcher?.kill() } catch { /* fine */ } })

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
  // Ctrl+Alt+Q: quiet for an hour, or back on (Q6).
  let boundQuiet = ''
  const bindQuiet = (): boolean => {
    if (boundQuiet) { try { globalShortcut.unregister(boundQuiet) } catch { /* fine */ } }
    boundQuiet = ''
    if (!prefs.quietShortcut) return true
    try {
      if (globalShortcut.register(prefs.quietShortcut, () => setQuiet(quietEnd > Date.now() ? null : 60))) { boundQuiet = prefs.quietShortcut; return true }
    } catch { /* invalid */ }
    return false
  }
  bindQuiet()
  // Settings → Desktop island (from the app window).
  ipcMain.handle('island:getPrefs', (e) => (e.sender === o.appWindow.webContents ? prefs : null))
  ipcMain.handle('island:setPrefs', (e, p: Partial<IslandPrefs>) => {
    if (e.sender !== o.appWindow.webContents) return null
    const before = prefs
    prefs = cleanIslandPrefs({ ...prefs, ...p })
    const shortcutOk = (prefs.shortcut === before.shortcut ? true : bindShortcut()) && (prefs.quietShortcut === before.quietShortcut ? true : bindQuiet())
    savePrefs()
    applyVisibility()
    if (win && !win.isDestroyed()) {
      win.webContents.setZoomFactor(zoom())
      win.webContents.send('island:prefs', prefs)
      win.setBounds({ ...win.getBounds(), ...scaled() })
      placeWin()
    }
    o.onChange?.()
    return { prefs, shortcutOk }
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())

  if (enabled) open()
  return {
    enabled: () => enabled,
    /** Quiet until (ms), or 0. */
    quietUntil: () => (quietEnd > Date.now() ? quietEnd : 0),
    setQuiet,
    placement: () => place,
    get shortcut() { return prefs.shortcut || 'no shortcut' },
    setPlacement(p: IslandPlacement) {
      place = p
      if (p === 'top') pos.cx = 0.5
      savePrefs()
      sendPlacement()
      placeWin()
      showWin()
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
