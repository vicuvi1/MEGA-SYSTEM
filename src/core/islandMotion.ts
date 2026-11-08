// Island v2: one animation system. Every moving part of the island (the pill
// growing into a card, the split pill, a notification landing, a tap) takes
// its timing from here, from the look's style + speed + bounciness, per
// moment. The result is a plain transition object framer-motion understands
// (spring or tween), so the renderer has nothing else to decide.
// Reduced motion or "off" always means instant. Pure and tested.
import type { EventMotion, IslandLooks, MotionEvent, MotionStyle } from './islandLooks'

export type MotionSpec =
  | { type: 'spring'; stiffness: number; damping: number; mass: number }
  | { duration: number; ease?: number[] | string }

export const INSTANT: MotionSpec = { duration: 0 }

const round = (n: number, p = 2) => Math.round(n * 10 ** p) / 10 ** p

/**
 * The transition for a style. Springs: stiffness grows with speed², and the
 * damping ratio falls from 1 (no overshoot) at bounce 0 to 0.3 at bounce 1.
 */
export function motionSpec(style: MotionStyle, speed = 1, bounce = 0.35): MotionSpec {
  const sp = Math.min(2, Math.max(0.5, speed || 1))
  const b = Math.min(1, Math.max(0, bounce))
  if (style === 'off') return INSTANT
  if (style === 'smooth') return { duration: round(0.34 / sp, 3), ease: [0.25, 0.1, 0.25, 1] }
  const k = (style === 'snappy' ? 700 : 380) * sp * sp
  const zeta = style === 'snappy' ? Math.max(0.6, 0.9 - 0.3 * b) : 1 - 0.7 * b
  return { type: 'spring', stiffness: round(k, 1), damping: round(2 * zeta * Math.sqrt(k), 2), mass: 1 }
}

/** About how long a transition takes to settle (ms): springs to within 1 % of the end. */
export function settleMs(t: MotionSpec): number {
  if (!('type' in t)) return Math.round(t.duration * 1000)
  const w = Math.sqrt(t.stiffness / t.mass)
  const zeta = t.damping / (2 * Math.sqrt(t.stiffness * t.mass))
  // Envelope e^(-ζωt) under 1 %: t = ln(100) / (ζω); a critically damped one needs a bit more.
  return Math.round((Math.log(100) / (Math.min(1, zeta) * w)) * (zeta >= 0.99 ? 1.6 : 1) * 1000)
}

/**
 * The transition for one moment, from the look: the moment's own setting
 * first, then the look's. `null` = the look says "auto": keep the island's
 * own feel (Settings → Animations). Reduced motion: always instant.
 */
export function motionFor(m: IslandLooks['motion'], ev: MotionEvent, reduce = false): MotionSpec | null {
  if (reduce) return INSTANT
  const e: EventMotion = m.events[ev] ?? {}
  const style = e.style ?? (m.style === 'auto' ? null : m.style)
  if (!style) return null
  return motionSpec(style, e.speed ?? m.speed, e.bounce ?? m.bounce)
}

/** Which of the island's feel slots each moment drives. */
export const FEEL_SLOT: Record<MotionEvent, 'open' | 'close' | 'drop' | 'fly' | 'pop'> = { open: 'open', close: 'close', peek: 'open', split: 'fly', notify: 'drop', tap: 'pop' }

/**
 * The parts of the island's feel the look changes (empty: nothing changes).
 * `peek` and `open` share the open spring; `open` wins when both are set.
 */
export function feelPatch(m: IslandLooks['motion'], reduce = false): Partial<Record<'open' | 'close' | 'drop' | 'fly' | 'pop', MotionSpec>> {
  const out: Partial<Record<'open' | 'close' | 'drop' | 'fly' | 'pop', MotionSpec>> = {}
  for (const ev of ['peek', 'open', 'close', 'split', 'notify', 'tap'] as MotionEvent[]) {
    const t = motionFor(m, ev, reduce)
    if (t) out[FEEL_SLOT[ev]] = t
  }
  return out
}
