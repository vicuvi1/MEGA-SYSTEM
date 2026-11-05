// The desktop island's clicks, decided in the island page itself (pure: tested).
// The window lets clicks pass through to the apps below except over the
// island's shape. The page sees every mouse move (the desktop forwards them),
// so it knows exactly where the pointer is in its own pixels, with no screen
// scaling to convert: it says "take clicks" or "let them through" at once.
// - a click shield: once the pointer is on the shape it keeps taking clicks a
//   little around it (SHIELD_PAD) and for a moment after it left (SHIELD_MS);
// - while the peek or the panel opens, the area is the size it will END at,
//   not the size it is mid-animation;
// - a button fires when the press and the release are on the same button,
//   even if the button was redrawn in between (or the press got lost).

export interface Rect { x: number; y: number; w: number; h: number }

/** Clicks are taken this far around the shape. */
export const SHIELD_PAD = 12
/** ...and for this long after the pointer was last on it. */
export const SHIELD_MS = 400
/** From a press until this long after the release, nothing moves under the pointer. */
export const PRESS_HOLD_MS = 150
/** A press longer ago than this does not pair with a release. */
export const PRESS_MAX_MS = 3000
/** Moving this far between press and release is a drag, not a tap (the island's DRAG_PX). */
export const TAP_MOVE_PX = 8

export const unionRect = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
export const padRect = (r: Rect, p: number): Rect => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p })
export const inRect = (x: number, y: number, r: Rect, pad = 0) => r.w > 0 && r.h > 0 && x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad
export const inRects = (x: number, y: number, rects: Rect[], pad = 0) => rects.some((r) => inRect(x, y, r, pad))
/** Whole pixels that cover the rect. */
export const roundOut = (r: Rect): Rect => {
  const x = Math.floor(r.x)
  const y = Math.floor(r.y)
  return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y }
}

/**
 * Where the shape will be once it has finished growing or shrinking: it hangs
 * from its top edge, anchored on the left, the middle or the right (the
 * placement). `ax` is that anchor's x; `w`, `h` the final size on screen.
 */
export function finalShapeRect(o: { anchor: 'left' | 'center' | 'right'; ax: number; top: number; w: number; h: number }): Rect {
  const x = o.anchor === 'left' ? o.ax : o.anchor === 'right' ? o.ax - o.w : o.ax - o.w / 2
  return { x, y: o.top, w: o.w, h: o.h }
}

/** The area to take clicks in while the shape moves: where it is now and where it ends, together. */
export function targetRects(now: Rect[], end: Rect[]): Rect[] {
  if (!now.length) return end.slice()
  if (!end.length) return now.slice()
  return now.map((r, i) => (end[i] ? unionRect(r, end[i]) : r)).concat(end.slice(now.length))
}

export interface Shield { take: boolean; lastInside: number }
export const SHIELD_OFF: Shield = { take: false, lastInside: 0 }

/**
 * One pointer update: `inside` the shape (with the pad), a button `pressed`.
 * Returns the new state, and when to look again (ms) if the pointer may have
 * left and no further move comes.
 */
export function shieldStep(st: Shield, o: { inside: boolean; pressed: boolean; now: number }, ms = SHIELD_MS): { st: Shield; recheckIn: number | null } {
  if (o.inside) return { st: { take: true, lastInside: o.now }, recheckIn: null }
  if (o.pressed && st.take) return { st, recheckIn: null }
  const since = o.now - st.lastInside
  if (st.take && since < ms) return { st, recheckIn: ms - since }
  return { st: { take: false, lastInside: st.lastInside }, recheckIn: null }
}

export type TapVerdict = 'fire' | 'lost-down' | 'none'
/**
 * A release on a button: does it fire? Yes when the press was on the same
 * button (by its name, so a redraw in between doesn't matter) and the
 * pointer didn't travel; also when no press was seen at all lately (Windows
 * can swallow the press on a window that doesn't take the focus), but never
 * while dragging, and never twice in a row for one release.
 */
export function tapVerdict(o: { downId: string | null; downAt: number; upId: string | null; now: number; moved: number; dragging: boolean; lastFireAt?: number; lastFireId?: string | null }): TapVerdict {
  if (!o.upId || o.dragging) return 'none'
  if (o.lastFireId === o.upId && o.lastFireAt != null && o.now - o.lastFireAt < 250) return 'none'
  const fresh = o.downAt > 0 && o.now - o.downAt <= PRESS_MAX_MS
  if (fresh && o.downId != null) return o.downId === o.upId && o.moved < TAP_MOVE_PX ? 'fire' : 'none'
  // A press on nothing (the empty part of the window) then a release on a button: not a tap.
  if (fresh && o.downId == null) return 'none'
  return 'lost-down'
}

/** What a snapshot says, without its time: the same key means nothing new to show. */
export function snapshotKey(s: unknown): string {
  try {
    return JSON.stringify(s && typeof s === 'object' ? { ...(s as object), at: 0 } : s)
  } catch {
    return String(Math.random())
  }
}
