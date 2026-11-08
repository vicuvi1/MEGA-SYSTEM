// Island v2: gestures. What a pointer or trackpad movement was (a tap, a
// swipe, a long press, a hover) and what it does on each part of the island.
// The pill itself still drags to move the island, so on the pill swipes come
// from the trackpad (two fingers sideways) or the wheel; on the split pill's
// two halves a tap, a long press, a hover and a sideways swipe each do their
// own thing. Pure and tested (islandGestures.test.ts).

export type Gesture = 'tap' | 'longPress' | 'hover' | 'swipeLeft' | 'swipeRight' | 'swipeUp' | 'swipeDown'

export const GESTURE = {
  /** Further than this is not a tap. */
  tapPx: 8,
  /** A press held this long without moving is a long press. */
  longPressMs: 500,
  /** A swipe is at least this long… */
  swipePx: 40,
  /** …or a quick flick of at least `flickPx` at this speed (px per ms). */
  flickPx: 20,
  flickSpeed: 0.6,
  /** One axis must be this much bigger than the other (no diagonal guesses). */
  axisRatio: 1.4,
  /** Trackpad: this much sideways scroll is one swipe. */
  wheelPx: 60,
  /** Resting the mouse this long on a half of the split pill peeks at it. */
  hoverMs: 350
} as const

/** A press from its start to its release: how far it moved and how long it took. */
export function gestureOf(t: { dx: number; dy: number; ms: number }): Gesture | null {
  const ax = Math.abs(t.dx)
  const ay = Math.abs(t.dy)
  const dist = Math.hypot(t.dx, t.dy)
  if (dist < GESTURE.tapPx) return t.ms >= GESTURE.longPressMs ? 'longPress' : 'tap'
  const fast = dist >= GESTURE.flickPx && dist / Math.max(1, t.ms) >= GESTURE.flickSpeed
  if (dist < GESTURE.swipePx && !fast) return null
  if (ax >= ay * GESTURE.axisRatio) return t.dx < 0 ? 'swipeLeft' : 'swipeRight'
  if (ay >= ax * GESTURE.axisRatio) return t.dy < 0 ? 'swipeUp' : 'swipeDown'
  return null
}

/**
 * Trackpad / wheel: sideways scroll adds up into one swipe. Returns the swipe
 * (if one is complete) and what is left over. A tilt back the other way
 * starts again from zero.
 */
export function wheelSwipe(acc: number, deltaX: number, deltaY: number): { gesture: Gesture | null; acc: number } {
  if (Math.abs(deltaX) <= Math.abs(deltaY)) return { gesture: null, acc }
  const next = Math.sign(deltaX) !== Math.sign(acc) && acc !== 0 ? deltaX : acc + deltaX
  if (Math.abs(next) < GESTURE.wheelPx) return { gesture: null, acc: next }
  // Scrolling content to the left (positive deltaX) is a swipe to the left.
  return { gesture: next > 0 ? 'swipeLeft' : 'swipeRight', acc: 0 }
}

export type GestureTarget = 'pill' | 'left' | 'right' | 'peek' | 'card'
export type GestureAction =
  | { do: 'open' }
  | { do: 'close' }
  /** Show this half's card (left / right of the split pill) or the usual peek. */
  | { do: 'peek'; side?: 'left' | 'right' }
  /** The actions menu for this half (or for what the pill shows). */
  | { do: 'menu'; side?: 'left' | 'right' }
  /** The next (1) or previous (-1) view or page. */
  | { do: 'switch'; dir: 1 | -1 }
  /** The two halves of the split pill change places. */
  | { do: 'swap' }

/**
 * What a gesture does where it happened. With gestures switched off only a
 * tap and a hover still work (they are the island's basics).
 */
export function gestureAction(g: Gesture, where: GestureTarget, o: { split: boolean; enabled: boolean }): GestureAction | null {
  const half = where === 'left' || where === 'right' ? where : undefined
  if (g === 'tap') return where === 'card' ? null : half ? { do: 'peek', side: half } : where === 'peek' ? { do: 'open' } : { do: 'open' }
  if (g === 'hover') return where === 'card' || where === 'peek' ? null : { do: 'peek', ...(half ? { side: half } : {}) }
  if (!o.enabled) return null
  if (g === 'longPress') return where === 'card' ? null : { do: 'menu', ...(half ? { side: half } : {}) }
  if (g === 'swipeLeft' || g === 'swipeRight') {
    if ((half || where === 'pill') && o.split) return { do: 'swap' }
    return { do: 'switch', dir: g === 'swipeLeft' ? 1 : -1 }
  }
  if (g === 'swipeDown') return where === 'card' ? null : { do: 'open' }
  if (g === 'swipeUp') return where === 'peek' || where === 'card' ? { do: 'close' } : null
  return null
}
