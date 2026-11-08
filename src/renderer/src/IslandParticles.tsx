// IM4: one small particle engine for the desktop island's celebrations. One
// canvas over the top of the island window, ~60 bits of confetti per burst,
// drawn with requestAnimationFrame only while some are alive (then the canvas
// is cleared and nothing runs). Full animations only; nothing while hidden.
import { useEffect, useRef } from 'react'

export interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; rot: number; vr: number; round: boolean }

/** Gravity (px/s²), air drag (per second) and the most bits alive at once. */
export const GRAVITY = 520
export const DRAG = 1.6
export const MAX_PARTICLES = 140

/**
 * One step of the simulation (pure: tested): moves every bit `dt` seconds
 * and returns the ones still alive.
 */
export function stepParticles(parts: Particle[], dt: number): Particle[] {
  const k = Math.max(0, 1 - DRAG * dt)
  const out: Particle[] = []
  for (const p of parts) {
    const life = p.life + dt
    if (life >= p.max) continue
    out.push({ ...p, life, vx: p.vx * k, vy: p.vy * k + GRAVITY * dt, x: p.x + p.vx * dt, y: p.y + p.vy * dt, rot: p.rot + p.vr * dt })
  }
  return out
}

/** A burst's bits (pure apart from `rand`): `n` of them from (x, y), fanning out and up. */
export function makeBurst(o: { x: number; y: number; colors: string[]; n?: number; power?: number; spread?: number }, rand: () => number = Math.random): Particle[] {
  const n = Math.max(1, Math.min(MAX_PARTICLES, Math.round(o.n ?? 60)))
  const power = o.power ?? 340
  const spread = o.spread ?? Math.PI * 0.9
  const out: Particle[] = []
  for (let i = 0; i < n; i++) {
    // Mostly sideways and down from the pill (it sits at the top of the screen), a few up.
    const a = Math.PI / 2 + (rand() - 0.5) * 2 * spread
    const v = power * (0.45 + rand() * 0.75)
    out.push({
      x: o.x + (rand() - 0.5) * 30,
      y: o.y + (rand() - 0.5) * 8,
      vx: Math.cos(a) * v * 1.4,
      vy: Math.sin(a) * v * 0.55 - 60,
      life: 0,
      max: 0.9 + rand() * 0.8,
      size: 3 + rand() * 3.5,
      color: o.colors[i % Math.max(1, o.colors.length)] ?? '#d4ff3f',
      rot: rand() * Math.PI,
      vr: (rand() - 0.5) * 14,
      round: rand() < 0.3
    })
  }
  return out
}

// ---- the shared engine ----
let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let parts: Particle[] = []
let raf = 0
let last = 0
let allowed = true

const clear = () => {
  if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
}
const frame = (t: number) => {
  raf = 0
  const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60
  last = t
  parts = stepParticles(parts, dt)
  if (!canvas || !ctx) return
  const dpr = canvas.width / Math.max(1, canvas.clientWidth)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  clear()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  for (const p of parts) {
    const fade = p.life > p.max * 0.7 ? 1 - (p.life - p.max * 0.7) / (p.max * 0.3) : 1
    ctx.globalAlpha = Math.max(0, fade)
    ctx.fillStyle = p.color
    if (p.round) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.rot)
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
      ctx.restore()
    }
  }
  ctx.globalAlpha = 1
  if (parts.length) raf = requestAnimationFrame(frame)
  else {
    last = 0
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    clear()
  }
}

/** Throw a burst from (x, y) in page px. Does nothing without a canvas or while paused. */
export function burst(o: { x: number; y: number; colors: string[]; n?: number; power?: number; spread?: number }) {
  if (!allowed || !canvas || typeof requestAnimationFrame !== 'function') return
  parts = [...parts, ...makeBurst(o)].slice(-MAX_PARTICLES)
  if (!raf) {
    last = 0
    raf = requestAnimationFrame(frame)
  }
}
/** A burst from the middle of an element's top half (the pill). */
export function burstFrom(el: Element | null, colors: string[], n = 60, shape: { power?: number; spread?: number } = {}) {
  if (!el) return
  const r = el.getBoundingClientRect()
  burst({ x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 24), colors, n, ...shape })
}
/** Hidden, tucked away or not Full: stop at once and clear. */
export function setParticlesAllowed(on: boolean) {
  allowed = on
  if (on) return
  parts = []
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  last = 0
  if (ctx) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    clear()
  }
}
export const particlesAlive = () => parts.length

/** The one canvas (over the top of the island window, clicks pass through). */
export function IslandParticles() {
  const el = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = el.current
    if (!c) return
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = window.innerWidth
      const h = Math.min(window.innerHeight, 340)
      c.style.width = `${w}px`
      c.style.height = `${h}px`
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    size()
    canvas = c
    ctx = c.getContext('2d')
    window.addEventListener('resize', size)
    return () => {
      window.removeEventListener('resize', size)
      if (canvas === c) {
        setParticlesAllowed(false)
        canvas = null
        ctx = null
        allowed = true
      }
    }
  }, [])
  return <canvas ref={el} className="di-particles" aria-hidden />
}
