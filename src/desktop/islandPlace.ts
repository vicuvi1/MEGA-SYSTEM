// IM7: where a dragged island snaps to (pure: no Electron, tested). While you
// drag, the island shows a small "ghost" of where it will land; when you let
// go the window moves once, and the page plays the last bit of the way as a
// bounce (the window itself never animates).
import type { Box, Placement } from './islandWin'
import { dropSpot } from '../core/islandMove'

/** How close to a side edge docks it there (DIP). */
export const DOCK_PX = 70
/** Dropped this close to the top of the screen: it snaps to the nearest top spot. */
export const SNAP_BAND_PX = 160
/** The bounce inside the page is at most this far (CSS px), so it stays inside the window. */
export const BOUNCE_MAX = 60

/**
 * The spot for a drop at cursor `c` on a screen with bounds `sb`: a side
 * edge docks; near the top it snaps to the nearest of top left, top center
 * and top right (the left and right quarters are the corners); anywhere else
 * it floats where you let go.
 */
export function dropPlacement(c: { x: number; y: number }, sb: Box): Placement {
  // H1: only the top zone snaps; anywhere else (the sides too) it stays where you let go.
  return dropSpot(c, sb)
}

/** What the ghost says while you drag. */
export const SNAP_LABEL: Record<Placement, string> = { 'top-left': 'Top left', top: 'Top center', 'top-right': 'Top right', left: 'Docks left', right: 'Docks right', free: 'Stays here' }

/**
 * The bounce the page plays after the window jumped from where you dropped
 * it (`from`) to its spot (`to`): the page starts that far back (clamped)
 * and springs to rest. Zero when nothing moved.
 */
export function snapBounce(from: { x: number; y: number }, to: { x: number; y: number }, zoom = 1, max = BOUNCE_MAX): { dx: number; dy: number } {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const clamp = (v: number) => Math.round(Math.max(-max, Math.min(max, v)))
  // From the window's new place, where it was is (from - to); in CSS px of the page.
  return { dx: clamp((from.x - to.x) / z), dy: clamp((from.y - to.y) / z) }
}

/**
 * IM12: the pointer's offset from the island's middle (CSS px), when it is
 * within `near` px of the island's click area; else null. `rects` and `p` are
 * in the page's CSS px.
 */
export function cursorNear(p: { x: number; y: number }, rect: { x: number; y: number; w: number; h: number } | undefined, near = 40): { dx: number; dy: number; dist: number } | null {
  if (!rect || !(rect.w > 0) || !(rect.h > 0)) return null
  const cx = Math.max(rect.x, Math.min(rect.x + rect.w, p.x))
  const cy = Math.max(rect.y, Math.min(rect.y + rect.h, p.y))
  const dist = Math.hypot(p.x - cx, p.y - cy)
  if (dist > near) return null
  return { dx: Math.round(p.x - (rect.x + rect.w / 2)), dy: Math.round(p.y - (rect.y + rect.h / 2)), dist: Math.round(dist) }
}
