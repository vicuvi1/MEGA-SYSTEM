// The desktop island's clicks, decided in the island page itself (pure: tested).
// The window lets clicks pass through to the apps below except over the
// island's shape. The page sees every mouse move (the desktop forwards them),
// so it knows exactly where the pointer is in its own pixels, with no screen
// scaling to convert: it says "take clicks" or "let them through" at once.
// - a click shield: it starts taking clicks only ON the shape; once on, it
//   keeps them a little around it (SHIELD_PAD) and for a short moment after
//   it left (SHIELD_MS), but only while the pointer is still close
//   (SHIELD_NEAR). The window is much bigger than the pill (it never resizes),
//   and while the island takes clicks the WHOLE window takes them, so the
//   shield must stay tight or clicks on the apps below get swallowed (IC30);
// - a press that started off the shape never keeps the clicks;
// - the page says "take" again every TAKE_BEAT_MS while it takes them, and the
//   desktop lets clicks through by itself when that stops (TAKE_TTL_MS): a
//   frozen page or a lost message can't leave a big invisible wall;
// - hover intent: the island only counts as "hovered" (bubble, peek timer)
//   after the pointer rested on the shape itself for HOVER_INTENT_MS, so
//   passing over it on the way to something else does nothing;
// - while the peek or the panel opens, the area is the size it will END at,
//   not the size it is mid-animation;
// - a button fires when the press and the release are on the same button,
//   even if the button was redrawn in between (or the press got lost).

export interface Rect { x: number; y: number; w: number; h: number }

/** Once taking, clicks are still taken this far around the shape (never to start). */
export const SHIELD_PAD = 6
/** ...and for this long after the pointer was last on it... */
export const SHIELD_MS = 150
/** ...but only while the pointer is still this close; farther off, clicks pass through at once. */
export const SHIELD_NEAR = 24
/** While taking clicks the page says so again this often. */
export const TAKE_BEAT_MS = 500
/** The desktop lets clicks through by itself when no "take" came for this long. */
export const TAKE_TTL_MS = 1500
/** The pointer must rest on the shape this long before it counts as hovering. */
export const HOVER_INTENT_MS = 120
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

export interface Shield { take: boolean; lastInside: number; pressIn?: boolean }
export const SHIELD_OFF: Shield = { take: false, lastInside: 0, pressIn: false }

/**
 * Where the pointer is against the click area: `inside` (on the shape; once
 * taking, with SHIELD_PAD around it) and `near` (within SHIELD_NEAR).
 */
export function shieldHit(x: number, y: number, rects: Rect[], taking: boolean): { inside: boolean; near: boolean } {
  const inside = inRects(x, y, rects, taking ? SHIELD_PAD : 0)
  return { inside, near: inside || inRects(x, y, rects, SHIELD_NEAR) }
}

/**
 * One pointer update: `inside` the shape, `near` it, a button `pressed`.
 * Returns the new state, and when to look again (ms) if the pointer may have
 * left and no further move comes. `near` left out counts as near (older callers).
 */
export function shieldStep(st: Shield, o: { inside: boolean; near?: boolean; pressed: boolean; now: number }, ms = SHIELD_MS): { st: Shield; recheckIn: number | null } {
  if (o.inside) return { st: { take: true, lastInside: o.now, pressIn: o.pressed }, recheckIn: null }
  const near = o.near !== false
  const since = o.now - st.lastInside
  // A press (a drag, a swipe) that started on the island keeps the clicks until it's let go.
  if (o.pressed && st.take && st.pressIn) return { st, recheckIn: null }
  // A press right at its edge, just after the pointer was on it, counts as on the island too.
  if (o.pressed && st.take && near && since < ms) return { st: { ...st, pressIn: true }, recheckIn: null }
  if (st.take && near && !o.pressed && since < ms) return { st, recheckIn: ms - since }
  return { st: { take: false, lastInside: st.lastInside, pressIn: false }, recheckIn: null }
}

/** The desktop side: the page's last "take" is too old (it froze, or a message got lost), so clicks pass through. */
export function takeExpired(o: { taking: boolean; lastTakeAt: number; now: number }, ttl = TAKE_TTL_MS): boolean {
  return o.taking && o.now - o.lastTakeAt > ttl
}

export interface HoverGate { over: boolean; since: number | null }
export const HOVER_OFF: HoverGate = { over: false, since: null }
/**
 * Hover intent: `onShape` (the shape itself, no pad) for HOVER_INTENT_MS in a
 * row turns it on; clicks passing through again (`take` false) turns it off.
 * Returns when to look again while it waits.
 */
export function hoverStep(st: HoverGate, o: { onShape: boolean; take: boolean; now: number }, ms = HOVER_INTENT_MS): { st: HoverGate; recheckIn: number | null } {
  if (!o.take) return { st: HOVER_OFF, recheckIn: null }
  if (st.over) return { st, recheckIn: null }
  if (!o.onShape) return { st: { over: false, since: null }, recheckIn: null }
  const since = st.since ?? o.now
  if (o.now - since >= ms) return { st: { over: true, since }, recheckIn: null }
  return { st: { over: false, since }, recheckIn: ms - (o.now - since) }
}

/** The peek waits the rest of your "wait before peeking" after hover intent (so the total is your setting). */
export const peekWaitAfterIntent = (hoverMs: number) => Math.max(0, hoverMs - HOVER_INTENT_MS)

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
