// App zoom. Desktop: the window's real zoom (Ctrl + / Ctrl - / Ctrl 0, Ctrl +
// mouse wheel, remembered per screen by the desktop app). Website: the browser's
// own Ctrl + / Ctrl - work as always, and Settings → Look scales the page
// itself (CSS zoom on the page, remembered in this browser).
import { useEffect, useRef, useState } from 'react'
import { cleanZoom, nextZoom, zoomLabel, ZOOM_STEPS, type ZoomOp } from '@core/zoom'

const KEY = 'ls.zoom'
const subs = new Set<(f: number) => void>()
let current = 1

const readSaved = () => {
  try {
    return cleanZoom(localStorage.getItem(KEY) ?? 1)
  } catch {
    return 1
  }
}
/**
 * Website only: CSS zoom doesn't change the page width the layout sees, so a big zoom
 * on a small window would push things off the right edge. It goes only as far as
 * leaves the page at least 1024 px wide (your browser's own Ctrl + goes further).
 */
export function webZoomMax(width = typeof window !== 'undefined' ? window.innerWidth : 1440): number {
  return [...ZOOM_STEPS].reverse().find((s) => s <= 1 || width / s >= 1024) ?? 1
}
const applyCss = (want: number) => {
  const f = Math.min(want, isIsland() || window.desktop?.zoom ? 1 : webZoomMax())
  const root = document.documentElement
  // The layout's breakpoints don't see a CSS zoom: these classes tell the top bar how much room is really left.
  const room = window.innerWidth / f
  root.classList.toggle('zoom-room-1440', f > 1 && room <= 1440)
  root.classList.toggle('zoom-room-1100', f > 1 && room <= 1100)
  if (Math.abs(f - 1) < 0.001) {
    root.style.removeProperty('zoom')
    root.style.removeProperty('--app-zoom')
  } else {
    root.style.setProperty('zoom', String(f))
    root.style.setProperty('--app-zoom', String(f))
  }
}
const tell = (f: number, announce: boolean) => {
  current = f
  for (const s of subs) s(announce ? f : -f)
}

// IC11: never on the desktop island: its window is sized by the desktop, which doesn't know this zoom.
const isIsland = () => typeof location !== 'undefined' && /[?&]island=1/.test(location.search)
const hasSaved = () => {
  try {
    return localStorage.getItem(KEY) !== null
  } catch {
    return false
  }
}
/** The old "Text size" (90–125 %), the starting zoom until you pick one. */
let legacy = 1

/** Called with the theme: the website scales the page itself; the desktop window zooms for real (no CSS zoom). */
let resizeHooked = false
export function applyPageZoom(textSizePct: number) {
  if (!resizeHooked && typeof window !== 'undefined') {
    resizeHooked = true
    window.addEventListener('resize', () => !window.desktop?.zoom && !isIsland() && applyCss(current))
  }
  legacy = cleanZoom(textSizePct / 100)
  if (typeof document === 'undefined') return
  if (isIsland() || window.desktop?.zoom) return applyCss(1)
  current = hasSaved() ? readSaved() : legacy
  applyCss(current)
}

let started = false
/** Once, at start: the desktop reports the window's zoom (and takes over an old "Text size" once). */
export function startZoom() {
  if (started || isIsland()) return
  started = true
  const desk = window.desktop
  if (!desk?.zoom) return
  applyCss(1)
  desk.onZoom?.((f) => tell(cleanZoom(f), true))
  void desk
    .zoom(null)
    .then((f) => {
      tell(cleanZoom(f), false)
      if (legacy !== 1 && cleanZoom(f) === 1 && !hasSaved()) {
        try {
          localStorage.setItem(KEY, String(legacy))
        } catch {
          /* fine */
        }
        return desk.zoom!(legacy).then((g) => tell(cleanZoom(g), false))
      }
    })
    .catch(() => {})
}

export const zoomNow = () => current

export async function setZoom(op: ZoomOp): Promise<number> {
  const desk = window.desktop
  if (desk?.zoom) {
    const f = cleanZoom(await desk.zoom(op))
    tell(f, true)
    return f
  }
  const f = Math.min(nextZoom(current, op), webZoomMax())
  try {
    localStorage.setItem(KEY, String(f))
  } catch {
    /* private window: just for now */
  }
  applyCss(f)
  tell(f, true)
  return f
}

/** The zoom, live. */
export function useZoom(): number {
  const [z, setZ] = useState(current)
  useEffect(() => {
    const on = (f: number) => setZ(Math.abs(f))
    subs.add(on)
    setZ(current)
    return () => void subs.delete(on)
  }, [])
  return z
}

/** "Zoom 110%" for a moment when the zoom changes. */
export function ZoomToast() {
  const [shown, setShown] = useState<number | null>(null)
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    const on = (f: number) => {
      if (f < 0) return
      setShown(f)
      clearTimeout(t.current)
      t.current = setTimeout(() => setShown(null), 1300)
    }
    subs.add(on)
    return () => {
      subs.delete(on)
      clearTimeout(t.current)
    }
  }, [])
  if (shown === null) return null
  return (
    <div className="zoom-toast" role="status" aria-live="polite">
      Zoom {zoomLabel(shown)}
    </div>
  )
}

/** Settings → Look: − 100% + and Reset. */
export function ZoomControl() {
  const z = useZoom()
  const pct = zoomLabel(z)
  return (
    <div className="zoom-ctl" role="group" aria-label="Zoom">
      <button type="button" className="zoom-btn" onClick={() => void setZoom('out')} disabled={z <= 0.67} aria-label="Zoom out" title="Zoom out (Ctrl −)">
        −
      </button>
      <output className="zoom-val" aria-live="polite" aria-label={`Zoom ${pct}`}>
        {pct}
      </output>
      <button
        type="button"
        className="zoom-btn"
        onClick={() => void setZoom('in')}
        disabled={z >= (window.desktop?.zoom ? 2 : webZoomMax())}
        aria-label="Zoom in"
        title={!window.desktop?.zoom && z >= webZoomMax() && z < 2 ? 'As big as this window allows: your browser’s Ctrl + zooms further' : 'Zoom in (Ctrl +)'}
      >
        +
      </button>
      <button type="button" className="btn ghost small zoom-reset" onClick={() => void setZoom('reset')} disabled={Math.abs(z - 1) < 0.001} title="Back to 100% (Ctrl 0)">
        Reset
      </button>
    </div>
  )
}
