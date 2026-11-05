// One feel for every motion on the desktop island: the springs that open and
// close it, the drop of a new alert, the little pops, and the water's slosh.
// "Animations" in Settings picks how much moves:
// - full: springs with a small overshoot, flights between views, bubbles,
//   marquee, particles;
// - calm: crossfades and gentle springs that never bounce, no particles;
// - off: everything jumps to its end at once.
// The system's "reduce motion" setting always means off.
import { createContext, useContext } from 'react'
import type { Transition } from 'framer-motion'

export type MotionMode = 'full' | 'calm' | 'off'

export interface Feel {
  mode: MotionMode
  /** The shape growing into the peek or the panel: snappy, a little overshoot. */
  open: Transition
  /** Back to the pill: softer, settles without a wobble. */
  close: Transition
  /** A new alert landing: low damping, a visible bounce. */
  drop: Transition
  /** Views crossfading inside the shape. */
  fadeIn: Transition
  fadeOut: Transition
  /** Icons, titles and times flying between pill, peek and panel. */
  fly: Transition
  /** Small things popping in (bubbles, chips, digits). */
  pop: Transition
  /** The water level easing to its new height. */
  level: Transition
  /** The water's surface rocking after a pour. */
  slosh: Transition
  /** Flights, bounces, rolling digits and the hover lift. */
  moves: boolean
  /** Bubbles, splashes, confetti, coins, marquee, breathing glows. */
  extras: boolean
}

const NONE: Transition = { duration: 0 }

/** The springs for a mode (pure: tested). `reduce`: the system asks for less motion. */
export function feelFor(mode: MotionMode | undefined, reduce = false): Feel {
  const m: MotionMode = reduce ? 'off' : mode === 'calm' || mode === 'off' ? mode : 'full'
  if (m === 'off') return { mode: m, open: NONE, close: NONE, drop: NONE, fadeIn: NONE, fadeOut: NONE, fly: NONE, pop: NONE, level: NONE, slosh: NONE, moves: false, extras: false }
  if (m === 'calm') {
    // Critically damped (damping ≥ 2·√stiffness): no overshoot anywhere.
    const gentle: Transition = { type: 'spring', stiffness: 220, damping: 32, mass: 1 }
    return {
      mode: m,
      open: gentle,
      close: gentle,
      drop: gentle,
      fadeIn: { duration: 0.22, ease: 'easeOut' },
      fadeOut: { duration: 0.14, ease: 'easeIn' },
      fly: gentle,
      pop: { duration: 0.2, ease: 'easeOut' },
      level: { type: 'spring', stiffness: 60, damping: 18 },
      slosh: NONE,
      moves: false,
      extras: false
    }
  }
  return {
    mode: m,
    open: { type: 'spring', stiffness: 420, damping: 30, mass: 1 },
    close: { type: 'spring', stiffness: 340, damping: 34, mass: 1 },
    drop: { type: 'spring', stiffness: 460, damping: 15, mass: 1 },
    fadeIn: { delay: 0.04, duration: 0.2, ease: [0.2, 0.8, 0.2, 1] },
    fadeOut: { duration: 0.12, ease: 'easeIn' },
    fly: { type: 'spring', stiffness: 420, damping: 32, mass: 1 },
    pop: { type: 'spring', stiffness: 520, damping: 22, mass: 0.8 },
    level: { type: 'spring', stiffness: 70, damping: 13, mass: 1 },
    slosh: { type: 'spring', stiffness: 140, damping: 5, mass: 1 },
    moves: true,
    extras: true
  }
}

export const FeelContext = createContext<Feel>(feelFor('full'))
/** The island's current feel (Full / Calm / Off and the system setting). */
export const useFeel = () => useContext(FeelContext)

/** A shared id for a flight between views, only when things may fly. */
export const flyId = (f: Feel, id: string) => (f.moves ? id : undefined)

/**
 * The colour of a timer ring in its last minutes: null while more than 5
 * minutes are left (the island's own accent shows, also in light mode), then
 * warming from lime to amber, red once time is up (pure: tested).
 */
export function ringColor(leftMs: number): string | null {
  if (leftMs < 0) return '#ff5a5f'
  if (leftMs > 5 * 60_000) return null
  const t = Math.max(0, Math.min(1, 1 - leftMs / (5 * 60_000)))
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  // #d4ff3f → #ffb547
  return `rgb(${mix(212, 255)} ${mix(255, 181)} ${mix(63, 71)})`
}

/** A quick "boing" on an element you tapped (Full only). Web Animations: no re-render. */
export function bump(el: Element | null, f: Feel, scale = 1.08) {
  if (!el || !f.moves || typeof (el as HTMLElement).animate !== 'function') return
  ;(el as HTMLElement).animate([{ transform: 'scale(1)' }, { transform: `scale(${scale})`, offset: 0.35 }, { transform: 'scale(0.98)', offset: 0.7 }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' })
}

// ---- one animation frame for every live thing (rings, sweeps) ----
// IC10: every frame only while the island moves; otherwise 4 times a second
// (a ring over 25 minutes moves a hair in that time); nothing at all while
// the island is hidden or tucked away.
type FrameFn = (now: number) => void
export type FrameMode = 'fast' | 'slow' | 'paused'
const frameFns = new Set<FrameFn>()
let frameId = 0
let slowId = 0
let mode: FrameMode = 'slow'
const stopLoop = () => {
  if (frameId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameId)
  if (slowId) clearTimeout(slowId)
  frameId = 0
  slowId = 0
}
const runAll = () => {
  const t = Date.now()
  for (const fn of frameFns) fn(t)
}
const loop = () => {
  frameId = 0
  slowId = 0
  if (!frameFns.size || mode === 'paused') return
  runAll()
  schedule()
}
const schedule = () => {
  if (frameId || slowId || !frameFns.size || mode === 'paused') return
  if (mode === 'fast' && typeof requestAnimationFrame === 'function') frameId = requestAnimationFrame(loop)
  else slowId = setTimeout(loop, 250) as unknown as number
}
/** Every frame (fast), 4 times a second (slow) or not at all (paused). */
export function setFrameMode(m: FrameMode) {
  if (m === mode) return
  mode = m
  stopLoop()
  if (m !== 'paused') {
    // Catch up at once (back from hidden, or starting to move).
    if (frameFns.size) runAll()
    schedule()
  }
}
export const frameMode = () => mode
/** Run `fn` on the shared clock (see setFrameMode); returns the stop function. */
export function onFrame(fn: FrameFn): () => void {
  frameFns.add(fn)
  fn(Date.now())
  schedule()
  return () => {
    frameFns.delete(fn)
    if (!frameFns.size) stopLoop()
  }
}

/**
 * A smooth sine-wave band for the water (viewBox units): two periods wide so
 * sliding it left by half its width loops without a seam (pure: tested).
 */
export function wavePath(width: number, amp: number, depth: number): string {
  const half = width / 2
  let d = `M0 0`
  for (let x = 0; x < width * 2; x += half) d += ` Q${x + half / 2} ${x / half % 2 === 0 ? -amp : amp} ${x + half} 0`
  return `${d} L${width * 2} ${depth} L0 ${depth} Z`
}
