// H1: moving and hiding the desktop island, the pure part (tested in
// islandMove.test.ts; the desktop's island.ts and the island page use it).
//
// Moving: the window follows the mouse in real time. When you let go it snaps
// only if you dropped it in the top zone of a screen (top left / center /
// right); anywhere else it stays exactly where you dropped it. The window may
// hang off the screen's edge as long as the pill itself stays on it, so it
// never jumps back toward the middle. When the panel opens near an edge, the
// window slides just enough to show it, and back when it closes.
//
// Hiding: hidden for an hour, until tomorrow, or until you bring it back;
// tucked into a small dot; or slid out of the way for a moment when the mouse
// rushes at it.

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Area { x: number; y: number; width: number; height: number }

/** The top zone of a screen (DIP): a drop here snaps to the nearest top spot. */
export const TOP_ZONE_PX = 120
/** How much of the pill must stay on the screen at least (DIP). */
export const KEEP_MIN_PX = 28

export type TopSpot = 'top-left' | 'top' | 'top-right'

/**
 * Where a drop lands: a top spot when the pointer is in the top zone of its
 * screen, else 'free' (exactly where you let go). Side docking is no longer a
 * drop target (it fought free placement); it stays in the tray and Settings.
 */
export function dropSpot(c: Pt, sb: Area, zone = TOP_ZONE_PX): TopSpot | 'free' {
  if (c.y - sb.y >= zone || c.y < sb.y - 4) return 'free'
  const fx = (c.x - sb.x) / Math.max(1, sb.width)
  return fx < 0.25 ? 'top-left' : fx > 0.75 ? 'top-right' : 'top'
}

/**
 * A floating window's top-left so that the pill (`keep`, in window DIP) stays
 * on the work area, while the rest of the window may hang off the screen.
 * Without a known pill, the top middle 240 × 60 of the window counts.
 */
export function clampFree(p: Pt, size: { width: number; height: number }, wa: Area, keep?: Rect | null): Pt {
  const k = keep && keep.w > 0 && keep.h > 0 ? keep : { x: size.width / 2 - 120, y: 0, w: 240, h: 60 }
  const minX = wa.x - k.x
  const maxX = wa.x + wa.width - (k.x + k.w)
  const minY = wa.y - k.y
  const maxY = wa.y + wa.height - (k.y + Math.max(KEEP_MIN_PX, Math.min(k.h, 80)))
  return {
    x: Math.round(Math.max(Math.min(minX, maxX), Math.min(Math.max(minX, maxX), p.x))),
    y: Math.round(Math.max(Math.min(minY, maxY), Math.min(Math.max(minY, maxY), p.y)))
  }
}

/**
 * The panel opened near an edge: how far to slide the window (DIP) so every
 * visible part (`rects`, window DIP) is on the work area. `home` is where the
 * window sits normally. Zero when everything fits.
 */
export function fitShift(home: Pt, rects: Rect[], wa: Area): Pt {
  const live = rects.filter((r) => r.w > 0 && r.h > 0)
  if (!live.length) return { x: 0, y: 0 }
  const l = Math.min(...live.map((r) => home.x + r.x))
  const t = Math.min(...live.map((r) => home.y + r.y))
  const rgt = Math.max(...live.map((r) => home.x + r.x + r.w))
  const btm = Math.max(...live.map((r) => home.y + r.y + r.h))
  const axis = (lo: number, hi: number, min: number, max: number) => (hi - lo > max - min ? min - lo : lo < min ? min - lo : hi > max ? max - hi : 0)
  return { x: Math.round(axis(l, rgt, wa.x, wa.x + wa.width)), y: Math.round(axis(t, btm, wa.y, wa.y + wa.height)) }
}

/** The drag's window position for the pointer at `c` (offset kept from the press). */
export const dragTo = (c: Pt, off: Pt): Pt => ({ x: Math.round(c.x - off.x), y: Math.round(c.y - off.y) })

// ---- Move mode: the arrow keys nudge it, Enter saves, Esc puts it back ----

export type MoveKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
/** One arrow press: 2 px, 20 px with Shift, 1 px with Alt. */
export function nudgeStep(key: string, mods: { shift?: boolean; alt?: boolean } = {}): Pt | null {
  const n = mods.alt ? 1 : mods.shift ? 20 : 2
  switch (key) {
    case 'ArrowLeft': return { x: -n, y: 0 }
    case 'ArrowRight': return { x: n, y: 0 }
    case 'ArrowUp': return { x: 0, y: -n }
    case 'ArrowDown': return { x: 0, y: n }
    default: return null
  }
}

/** What a key does in move mode. */
export function moveModeKey(key: string, mods: { shift?: boolean; alt?: boolean } = {}): { nudge: Pt } | 'save' | 'cancel' | null {
  if (key === 'Enter') return 'save'
  if (key === 'Escape') return 'cancel'
  const s = nudgeStep(key, mods)
  return s ? { nudge: s } : null
}

// ---- Where it was, per screen ----

/** One screen, the same after a restart: "id:WxH". */
export const screenKey = (d: { id: number; bounds: Area }) => `${d.id}:${Math.round(d.bounds.width)}x${Math.round(d.bounds.height)}`

export interface ScreenSpot { place: 'top' | 'top-left' | 'top-right' | 'left' | 'right' | 'free'; pos: { cx: number; top: number; cy: number }; size?: { w: number; h: number } }
export const SPOTS_MAX = 8
/** Remember the spot for one screen; the oldest goes after 8. */
export function rememberSpot(all: Record<string, ScreenSpot>, key: string, s: ScreenSpot): Record<string, ScreenSpot> {
  const rest = Object.entries(all).filter(([k]) => k !== key)
  return Object.fromEntries([...rest.slice(-(SPOTS_MAX - 1)), [key, s]])
}
const PLACES = ['top', 'top-left', 'top-right', 'left', 'right', 'free']
export function cleanSpots(v: unknown): Record<string, ScreenSpot> {
  const out: Record<string, ScreenSpot> = {}
  if (!v || typeof v !== 'object') return out
  for (const [k, s] of Object.entries(v as Record<string, any>).slice(-SPOTS_MAX)) {
    if (k.length > 60 || !s || !PLACES.includes(s.place)) continue
    const p = s.pos ?? {}
    const f = (n: unknown, lo: number, hi: number, d: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d)
    out[k] = {
      place: s.place,
      pos: { cx: f(p.cx, 0, 1, 0.5), top: f(p.top, -2000, 8000, 0), cy: f(p.cy, 0, 1, 0.5) },
      ...(s.size && Number.isFinite(s.size.w) && Number.isFinite(s.size.h) ? { size: cleanPanelSize(s.size) } : {})
    }
  }
  return out
}

// ---- IN39: the panel's own size ----

export const PANEL_MIN = { w: 300, h: 260 }
export const PANEL_MAX = { w: 900, h: 900 }
export function cleanPanelSize(s: { w: number; h: number }): { w: number; h: number } {
  const c = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : d)
  return { w: c(s?.w, PANEL_MIN.w, PANEL_MAX.w, 420), h: c(s?.h, PANEL_MIN.h, PANEL_MAX.h, 520) }
}
/** Dragging the corner by (dx, dy) from `start`, kept within the limits and the screen. */
export function resizePanel(start: { w: number; h: number }, d: Pt, screenMax?: { w: number; h: number }): { w: number; h: number } {
  const s = cleanPanelSize({ w: start.w + d.x, h: start.h + d.y })
  return screenMax ? { w: Math.max(PANEL_MIN.w, Math.min(s.w, screenMax.w)), h: Math.max(PANEL_MIN.h, Math.min(s.h, screenMax.h)) } : s
}

// ---- Hiding ----

export type HideChoice = '1h' | 'tomorrow' | 'manual' | 'dot'
export interface HideState {
  /** shown; hidden (the window is gone, nothing runs); dot (a small dot at its place). */
  mode: 'shown' | 'hidden' | 'dot'
  /** Back by itself at this time (ms), or 0 for "until I bring it back". */
  until: number
}
export const SHOWN: HideState = { mode: 'shown', until: 0 }
export const HIDE_LABEL: Record<HideChoice, string> = { '1h': 'Hide for 1 hour', tomorrow: 'Hide until tomorrow', manual: 'Hide until I bring it back', dot: 'Tuck into a small dot' }

/** Tomorrow 06:00 local time (or today 06:00 if it's still before then). */
export function nextMorning(now: number, hour = 6): number {
  const d = new Date(now)
  d.setHours(hour, 0, 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.getTime()
}

export function hideFor(choice: HideChoice, now: number): HideState {
  if (choice === 'dot') return { mode: 'dot', until: 0 }
  if (choice === '1h') return { mode: 'hidden', until: now + 3600_000 }
  if (choice === 'tomorrow') return { mode: 'hidden', until: nextMorning(now) }
  return { mode: 'hidden', until: 0 }
}

/** The shortcut / the tray toggle: hidden or a dot → shown; shown → hidden until you bring it back. */
export const toggleHide = (s: HideState, now: number): HideState => (s.mode === 'shown' ? hideFor('manual', now) : SHOWN)

/** Its time is up: shown again. */
export const hideTick = (s: HideState, now: number): HideState => (s.mode !== 'shown' && s.until > 0 && now >= s.until ? SHOWN : s)

export function cleanHide(v: any, now: number): HideState {
  if (!v || (v.mode !== 'hidden' && v.mode !== 'dot')) return SHOWN
  const until = typeof v.until === 'number' && Number.isFinite(v.until) && v.until > 0 ? v.until : 0
  return hideTick({ mode: v.mode, until }, now)
}

/** "Hidden until 14:05", "Hidden until tomorrow 06:00", "Hidden until you bring it back". */
export function hideText(s: HideState, now: number): string {
  if (s.mode === 'shown') return 'Shown'
  if (s.mode === 'dot') return 'Tucked into a dot'
  if (!s.until) return 'Hidden until you bring it back'
  const d = new Date(s.until)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return new Date(now).toDateString() === d.toDateString() ? `Hidden until ${hm}` : `Hidden until tomorrow ${hm}`
}

// ---- Out of the way when the mouse rushes at it ----

export interface Sample { x: number; y: number; t: number }
/** Faster than this (DIP/s) toward the pill, and this close, it slides away for a moment. */
export const RUSH_SPEED = 2200
export const RUSH_NEAR = 110
export const DODGE_MS = 1600

/**
 * The mouse is rushing at the pill (`r`, screen DIP): fast, close and heading
 * toward it. Slow moves (you want to click it) never count.
 */
export function rushing(a: Sample, b: Sample, r: Rect): boolean {
  const dt = (b.t - a.t) / 1000
  if (!(dt > 0) || dt > 0.25) return false
  const vx = (b.x - a.x) / dt
  const vy = (b.y - a.y) / dt
  if (Math.hypot(vx, vy) < RUSH_SPEED) return false
  const cx = Math.max(r.x, Math.min(r.x + r.w, b.x))
  const cy = Math.max(r.y, Math.min(r.y + r.h, b.y))
  const dist = Math.hypot(b.x - cx, b.y - cy)
  if (dist > RUSH_NEAR) return false
  // Heading toward the pill's middle (within ~50°).
  const mx = r.x + r.w / 2 - b.x
  const my = r.y + r.h / 2 - b.y
  const dot = (vx * mx + vy * my) / (Math.hypot(vx, vy) * Math.max(1, Math.hypot(mx, my)))
  return dist === 0 || dot > 0.64
}
