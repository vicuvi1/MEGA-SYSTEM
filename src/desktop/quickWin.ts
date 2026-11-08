// Quick add from anywhere (desktop). A small window made hidden at start, so
// the global shortcut (Alt+Space by default) shows it at once over any app.
// It never opens your data: it sends the line to the app window (the one
// owner of the local database, running hidden in the tray), which saves it
// and answers; then the window shows a small Undo toast for 5 s.
import { BrowserWindow, globalShortcut, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bindQuick, cleanQuickShortcut, quickBounds, type BindResult } from './quickKeys'

export interface QuickAddOpts {
  origin: string
  preload: string
  appWindow: BrowserWindow
  dir: string
  /** Shortcuts other parts of the app own (the island's), never taken here. */
  avoid?: () => string[]
}

export function createQuickAdd(o: QuickAddOpts) {
  const file = join(o.dir, 'quick-add.json')
  let shortcut = (() => {
    try {
      return cleanQuickShortcut(JSON.parse(readFileSync(file, 'utf8'))?.shortcut)
    } catch {
      return cleanQuickShortcut(undefined)
    }
  })()
  let bound: BindResult = { active: null, fellBack: false, tried: [] }
  let mode: 'box' | 'toast' = 'box'
  let win: BrowserWindow | null = null

  const make = () => {
    const w = new BrowserWindow({
      ...quickBounds('box', screen.getPrimaryDisplay().workArea),
      frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true, backgroundColor: '#00000000',
      webPreferences: { preload: o.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
    })
    w.setAlwaysOnTop(true, 'pop-up-menu')
    w.setMenu(null)
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    // Click elsewhere: the box goes away (the toast stays until its time is up).
    w.on('blur', () => {
      if (mode === 'box' && !w.isDestroyed()) w.hide()
    })
    w.on('closed', () => {
      if (win === w) win = null
    })
    void w.loadURL(o.origin + '/?quick=1').catch(() => {})
    return w
  }
  win = make()

  const ready = () => (win && !win.isDestroyed() ? win : (win = make()))
  const area = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const app = () => (o.appWindow.isDestroyed() ? null : o.appWindow.webContents)

  const showBox = () => {
    const w = ready()
    if (w.isVisible() && mode === 'box') return void w.hide()
    mode = 'box'
    w.setBounds(quickBounds('box', area()))
    w.show()
    w.focus()
    w.webContents.send('quick:show')
    app()?.send('quick:run', { op: 'ctx' })
  }
  const showToast = () => {
    const w = ready()
    mode = 'toast'
    w.setBounds(quickBounds('toast', area()))
    // Without taking the keyboard: you go on typing where you were.
    w.showInactive()
  }

  const bind = () => {
    bound = bindQuick(globalShortcut, shortcut, showBox, bound.active, o.avoid?.() ?? [])
    return bound
  }
  bind()

  const fromQuick = (e: IpcMainEvent) => !!win && !win.isDestroyed() && e.sender === win.webContents
  const fromApp = (e: IpcMainEvent | IpcMainInvokeEvent) => !o.appWindow.isDestroyed() && e.sender === o.appWindow.webContents

  ipcMain.on('quick:submit', (e, line: unknown, sure: unknown, pick: unknown) => {
    if (!fromQuick(e) || typeof line !== 'string' || !line.trim()) return
    win?.hide()
    const n = Number(pick)
    app()?.send('quick:run', { op: 'line', line: line.slice(0, 500), sure: sure === true, pick: Number.isInteger(n) && n >= 0 && n < 20 ? n : 0 })
  })
  ipcMain.on('quick:undo', (e, id: unknown) => {
    if (fromQuick(e) && typeof id === 'string') app()?.send('quick:run', { op: 'undo', id: id.slice(0, 80) })
  })
  ipcMain.on('quick:hide', (e) => {
    if (fromQuick(e)) win?.hide()
  })
  ipcMain.on('quick:reply', (e, m: any) => {
    if (!fromApp(e) || !m || typeof m !== 'object' || !win || win.isDestroyed()) return
    if (m.op === 'update' && (!win.isVisible() || mode !== 'toast')) return
    // A line was saved: the Undo toast. Not saved: the box again, with why.
    if (m.op === 'item') m.ok ? showToast() : showBox()
    win.webContents.send('quick:msg', m)
  })
  const view = () => ({ shortcut, active: bound.active, fellBack: bound.fellBack })
  ipcMain.handle('quick:getPrefs', (e) => (fromApp(e) ? view() : null))
  ipcMain.handle('quick:setPrefs', (e, p: any) => {
    if (!fromApp(e)) return null
    shortcut = cleanQuickShortcut(p?.shortcut)
    try {
      writeFileSync(file, JSON.stringify({ shortcut }))
    } catch {
      /* kept for this run */
    }
    bind()
    return view()
  })

  return {
    /** For the tray menu: "Quick add (Alt+Space)". */
    shortcut: () => bound.active,
    open: showBox,
    dispose: () => {
      if (bound.active) globalShortcut.unregister(bound.active)
      if (win && !win.isDestroyed()) win.destroy()
    }
  }
}
