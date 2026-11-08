// Island v2: scroll on the island to change a number. Rest the mouse on a
// counter (push-ups, water, focus minutes), scroll to the number you want
// (say 37), click to log it. One wheel notch is one step; a fast trackpad
// adds up the same way. Values stay inside the counter's range and on its
// step. Pure and tested (islandScrub.test.ts).

export interface ScrubSpec {
  min: number
  max: number
  step: number
  /** What a fresh counter shows. */
  start: number
  unit: string
}

export type ScrubKind = 'reps' | 'water' | 'focus'

export const SCRUB: Record<ScrubKind, ScrubSpec> = {
  reps: { min: 1, max: 200, step: 1, start: 25, unit: 'reps' },
  water: { min: 50, max: 1500, step: 50, start: 250, unit: 'ml' },
  focus: { min: 5, max: 180, step: 5, start: 25, unit: 'min' }
}

/**
 * Small wheel bits (a precision trackpad) add up: this many px is one step.
 * A mouse wheel notch is one event of 33 px or more (100 px at 100 % scale,
 * less at higher Windows scaling, different again in Chromium), so any event
 * of `SCRUB_EVENT_PX` or more counts as exactly one step, whatever its size.
 */
export const SCRUB_NOTCH = 40
export const SCRUB_EVENT_PX = 15

/** Snap a value onto the counter's range and step. */
export function scrubClamp(v: number, s: ScrubSpec): number {
  if (!Number.isFinite(v)) return s.start
  const snapped = s.min + Math.round((v - s.min) / s.step) * s.step
  return Math.min(s.max, Math.max(s.min, snapped))
}

/**
 * One wheel event: scrolling up (negative deltaY) counts up. Returns the new
 * value and the small scroll left over. `fast` (Shift held) moves five steps.
 */
export function scrubWheel(value: number, acc: number, deltaY: number, s: ScrubSpec, fast = false): { value: number; acc: number; changed: boolean } {
  if (!deltaY) return { value, acc, changed: false }
  let notches: number
  let rest: number
  if (Math.abs(deltaY) >= SCRUB_EVENT_PX) {
    notches = deltaY < 0 ? 1 : -1
    rest = 0
  } else {
    const total = (Math.sign(-deltaY) !== Math.sign(acc) && acc !== 0 ? 0 : acc) - deltaY
    notches = Math.trunc(total / SCRUB_NOTCH)
    rest = total - notches * SCRUB_NOTCH
    if (!notches) return { value, acc: rest, changed: false }
  }
  const next = scrubClamp(value + notches * s.step * (fast ? 5 : 1), s)
  // At an end, extra scrolling is dropped (scrolling back moves at once).
  return { value: next, acc: next === s.max || next === s.min ? 0 : rest, changed: next !== value }
}

/** Arrow keys on a focused counter: up/right count up, down/left count down, PageUp/PageDown five steps. */
export function scrubKey(value: number, key: string, s: ScrubSpec): number | null {
  const by = key === 'ArrowUp' || key === 'ArrowRight' ? 1 : key === 'ArrowDown' || key === 'ArrowLeft' ? -1 : key === 'PageUp' ? 5 : key === 'PageDown' ? -5 : 0
  if (key === 'Home') return s.min
  if (key === 'End') return s.max
  return by ? scrubClamp(value + by * s.step, s) : null
}
