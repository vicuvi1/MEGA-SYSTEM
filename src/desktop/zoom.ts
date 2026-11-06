// Zoom for the main app window: Ctrl + / Ctrl - / Ctrl 0, Ctrl + mouse wheel
// and Settings → Look. Remembered on this PC, per screen, and put back on start.
// The window's zoom is "isolated": Chromium shares zoom per origin, and the
// island page has the same origin, so without it the island would zoom too.
import { screen, type BrowserWindow } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanZoomPrefs, nextZoom, zoomFor, zoomKey, type ZoomOp, type ZoomPrefs } from '../core/zoom'

export function setupZoom(win: BrowserWindow, dir: string, tell: (factor: number) => void) {
  const file = join(dir, 'zoom.json')
  let prefs: ZoomPrefs = cleanZoomPrefs(null)
  try { if (existsSync(file)) prefs = cleanZoomPrefs(JSON.parse(readFileSync(file, 'utf8'))) } catch { /* start at 100 % */ }
  const wc = win.webContents
  try { wc.setZoomMode('isolated') } catch { /* older Electron: zoom stays per origin */ }
  const screenId = () => {
    try { return String(screen.getDisplayMatching(win.getBounds()).id) } catch { return null }
  }
  const save = () => { try { writeFileSync(file, JSON.stringify(prefs)) } catch { /* not saved this time */ } }
  const get = () => { try { return wc.getZoomFactor() || 1 } catch { return 1 } }
  const apply = (f: number, announce: boolean) => {
    if (Math.abs(get() - f) > 0.001) wc.setZoomFactor(f)
    if (announce) tell(f)
  }
  const set = (op: ZoomOp) => {
    const f = nextZoom(get(), op)
    const id = screenId()
    prefs = { last: f, byScreen: id ? { ...prefs.byScreen, [id]: f } : prefs.byScreen }
    save()
    apply(f, true)
    return f
  }
  // Back to the saved zoom once the page has loaded (and after a reload).
  wc.on('did-finish-load', () => apply(zoomFor(prefs, screenId()), false))
  // The keys, handled here so one press is one step (the window has no menu with its own zoom keys).
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const op = zoomKey({ key: input.key, code: input.code, control: input.control, meta: input.meta, alt: input.alt, shift: input.shift })
    if (!op) return
    e.preventDefault()
    set(op)
  })
  // Ctrl + mouse wheel (Chromium asks; it doesn't zoom by itself here).
  let wheelAt = 0
  wc.on('zoom-changed', (_e, dir) => {
    if (Date.now() - wheelAt < 60) return
    wheelAt = Date.now()
    set(dir === 'in' ? 'in' : 'out')
  })
  // Moved to another screen: that screen's own zoom, if it has one.
  let lastScreen = screenId()
  win.on('moved', () => {
    const id = screenId()
    if (id === lastScreen) return
    lastScreen = id
    if (id && prefs.byScreen[id]) apply(prefs.byScreen[id], true)
  })
  return { get, set }
}
