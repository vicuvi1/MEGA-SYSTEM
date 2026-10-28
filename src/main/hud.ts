import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

export class HudManager {
  private win: BrowserWindow | null = null

  create(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win

    const primaryDisplay = screen.getPrimaryDisplay()
    const { workArea } = primaryDisplay
    const width = 760
    const height = 72
    const x = Math.round(workArea.x + (workArea.width - width) / 2)
    const y = Math.round(workArea.y + 40)

    this.win = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      show: false,
      type: process.platform === 'win32' ? 'toolbar' : undefined,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false
      }
    })

    if (isDev && process.env.ELECTRON_RENDERER_URL) {
      this.win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?hud=1`)
    } else {
      this.win.loadFile(join(__dirname, '../renderer/index.html'), { query: { hud: '1' } })
    }

    this.win.on('blur', () => {
      if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
        this.win.hide()
      }
    })

    this.win.on('closed', () => {
      this.win = null
    })

    return this.win
  }

  show(): void {
    if (!this.win || this.win.isDestroyed()) {
      this.create()
    }
    if (this.win) {
      const cursor = screen.getCursorScreenPoint()
      const currentDisplay = screen.getDisplayNearestPoint(cursor)
      const { workArea } = currentDisplay
      const width = 760
      const height = 72
      const x = Math.round(workArea.x + (workArea.width - width) / 2)
      const y = Math.round(workArea.y + 40)
      this.win.setBounds({ x, y, width, height })
      this.win.show()
      this.win.focus()
      this.win.webContents.send('hud:focus')
    }
  }

  hide(): void {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.win.hide()
    }
  }

  toggle(): void {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.hide()
    } else {
      this.show()
    }
  }

  destroy(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.close()
      this.win = null
    }
  }
}
