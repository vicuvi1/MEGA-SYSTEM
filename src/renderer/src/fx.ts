// One small success burst (AF5): about a dozen dots fly out from what you
// just finished and fade in under 400 ms. One shared canvas for the whole app;
// it draws only while dots are alive (requestAnimationFrame stops after) and
// is hidden the rest of the time. Nothing at all with "reduce motion", in a
// hidden window, or when the app did something on its own (no click nearby).
//
// feedback(kind) is the one hook for the matching sound (and haptic): it plays
// the kind's cue through soundKit and tells any onFeedback() listener.
// celebrate() is visual only, because the places that call it already play
// their own sound; call feedback() where a success has no sound yet.
import type { SoundName } from '@core/sounds'
import { play } from './soundKit'

export type FxKind = 'habit' | 'mustdo' | 'water' | 'workout' | 'checkin' | 'reward'

const COLORS: Record<FxKind, string[]> = {
  habit: ['#c8f135', '#e4ff7a', '#9fd11a'],
  mustdo: ['#f5c451', '#ffe27a', '#ffb84d'],
  water: ['#47b5ff', '#7fd4ff', '#bfeaff'],
  workout: ['#ff7a45', '#ffb38a', '#ff5a5f'],
  checkin: ['#00d2ff', '#7cf0ff', '#c8f135'],
  reward: ['#f5c451', '#ff8ad8', '#b18cff'],
}

const COUNT = 12
const LIFE_MS = 380

interface Dot { x: number; y: number; vx: number; vy: number; r: number; c: string; t0: number }

let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let dots: Dot[] = []
let raf = 0
let dirty: { x0: number; y0: number; x1: number; y1: number } | null = null
let lastPress: { x: number; y: number; at: number } | null = null

const CUE: Record<FxKind, SoundName> = { habit: 'habit', mustdo: 'mustDo', water: 'water', workout: 'success', checkin: 'success', reward: 'reward' }

const listeners = new Set<(kind: FxKind) => void>()

/** Also told about every feedback() (e.g. a visual or haptic of its own). */
export function onFeedback(fn: (kind: FxKind) => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

/** The sound (and haptic) for `kind`: soundKit's cue, then any listener. */
export function feedback(kind: FxKind): void {
  try {
    play(CUE[kind])
  } catch {
    /* no sound is never an error */
  }
  for (const fn of listeners) {
    try {
      fn(kind)
    } catch {
      /* a broken listener never breaks the action */
    }
  }
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

if (typeof window !== 'undefined') {
  // Where you last pressed: a burst with no element starts there.
  window.addEventListener('pointerdown', (e) => void (lastPress = { x: e.clientX, y: e.clientY, at: Date.now() }), { capture: true, passive: true })
}

function ensureCanvas(): CanvasRenderingContext2D | null {
  if (ctx && canvas?.isConnected) return ctx
  canvas = document.createElement('canvas')
  canvas.className = 'fx-canvas'
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '9999', display: 'none' })
  document.body.appendChild(canvas)
  ctx = canvas.getContext('2d')
  return ctx
}

function resize() {
  if (!canvas) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = Math.round(window.innerWidth * dpr)
  const h = Math.round(window.innerHeight * dpr)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function frame(now: number) {
  if (!ctx || !canvas) return
  if (dirty) ctx.clearRect(dirty.x0, dirty.y0, dirty.x1 - dirty.x0, dirty.y1 - dirty.y0)
  dots = dots.filter((d) => now - d.t0 < LIFE_MS)
  if (!dots.length) {
    raf = 0
    dirty = null
    canvas.style.display = 'none'
    return
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const d of dots) {
    const t = Math.max(0, now - d.t0) / LIFE_MS
    const ease = 1 - (1 - t) * (1 - t) * (1 - t)
    const x = d.x + d.vx * ease
    const y = d.y + d.vy * ease + 18 * t * t
    const r = d.r * (1 - t * 0.6)
    ctx.globalAlpha = 1 - t * t
    ctx.fillStyle = d.c
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    x0 = Math.min(x0, x - r - 1); y0 = Math.min(y0, y - r - 1); x1 = Math.max(x1, x + r + 1); y1 = Math.max(y1, y + r + 1)
  }
  ctx.globalAlpha = 1
  dirty = { x0, y0, x1, y1 }
  raf = requestAnimationFrame(frame)
}

/**
 * A short burst for something you just did. `from` is the element you
 * finished (its centre) or a point; without one it starts where you last
 * pressed, and only if that was a moment ago (so background work never bursts).
 */
export function celebrate(from: Element | { x: number; y: number } | null | undefined, kind: FxKind): void {
  if (typeof document === 'undefined' || document.hidden || reduced()) return
  let at: { x: number; y: number } | null = null
  if (from && 'getBoundingClientRect' in from) {
    const r = from.getBoundingClientRect()
    if (r.width || r.height) at = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  } else if (from) at = from
  if (!at && lastPress && Date.now() - lastPress.at < 2500) at = lastPress
  if (!at) return
  const c = ensureCanvas()
  if (!c || !canvas) return
  canvas.style.display = 'block'
  resize()
  const colors = COLORS[kind]
  const t0 = performance.now()
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2 + Math.random() * 0.5
    const dist = 26 + Math.random() * 22
    dots.push({ x: at.x, y: at.y, vx: Math.cos(a) * dist, vy: Math.sin(a) * dist - 6, r: 2 + Math.random() * 2, c: colors[i % colors.length], t0 })
  }
  if (!raf) raf = requestAnimationFrame(frame)
}

/** For tests: how many dots are alive. */
export const _aliveDots = () => dots.length
