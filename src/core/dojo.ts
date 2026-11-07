// LF14: Dojo mode, a full-screen deep-focus scene. You pick a scene drawn in
// the wallpaper style (a rainy dojo, a starfield bridge, a night city: the
// pictures in src/renderer/src/wallpaper/art), a breathing ink-brush ring
// counts the focus timer down, an optional low ambient sound (the sound
// kit's rain or brown noise) sits under the music, and a calm bow ends it.
// Light on the PC: the ring moves by one transform/opacity pair and the
// dash offset (SVG stroke, allowed by the motion budget), drawn a few times a
// second, nothing while hidden; with "reduce motion" nothing breathes. Esc
// leaves. Pure maths here, tested in dojo.test.ts.

export type DojoScene = 'dojo' | 'starfield' | 'city'
export type DojoAmbient = 'off' | 'rain' | 'brown'
export const DOJO_SCENES: { id: DojoScene; label: string; art: string; fx: 'rain' | 'stars' | 'neon' }[] = [
  { id: 'dojo', label: 'Rainy dojo', art: 'dojo-dawn', fx: 'rain' },
  { id: 'starfield', label: 'Starfield bridge', art: 'nebula', fx: 'stars' },
  { id: 'city', label: 'Night city', art: 'neon-rain', fx: 'neon' }
]
export const DOJO_AMBIENTS: { id: DojoAmbient; label: string }[] = [
  { id: 'off', label: 'No sound' },
  { id: 'rain', label: 'Soft rain' },
  { id: 'brown', label: 'Low hum' }
]

export interface DojoPrefs {
  scene: DojoScene
  ambient: DojoAmbient
  /** 0–100, kept low under the music. */
  ambientVol: number
  /** Seconds for one breath in (the same out). */
  breath: number
  /** Open Dojo by itself when a focus timer of 25+ minutes starts. */
  auto: boolean
}
export const DEFAULT_DOJO: DojoPrefs = { scene: 'dojo', ambient: 'rain', ambientVol: 25, breath: 5, auto: false }
export function cleanDojo(raw: unknown): DojoPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<DojoPrefs>
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d)
  return {
    scene: DOJO_SCENES.some((s) => s.id === o.scene) ? (o.scene as DojoScene) : DEFAULT_DOJO.scene,
    ambient: DOJO_AMBIENTS.some((a) => a.id === o.ambient) ? (o.ambient as DojoAmbient) : DEFAULT_DOJO.ambient,
    ambientVol: n(o.ambientVol, 0, 60, DEFAULT_DOJO.ambientVol),
    breath: n(o.breath, 3, 8, DEFAULT_DOJO.breath),
    auto: o.auto === true
  }
}
export const sceneOf = (id: DojoScene) => DOJO_SCENES.find((s) => s.id === id) ?? DOJO_SCENES[0]

/** Where the breath is: in or out, how far (0–1), and the ring's scale (0.94–1.04). Reduced motion: still. */
export function breathAt(ms: number, breathSec: number, reduced = false): { phase: 'in' | 'out'; t: number; scale: number } {
  if (reduced) return { phase: 'in', t: 0, scale: 1 }
  const half = Math.max(1, breathSec) * 1000
  const p = ((ms % (half * 2)) + half * 2) % (half * 2)
  const phase = p < half ? 'in' : 'out'
  const t = phase === 'in' ? p / half : (p - half) / half
  // Ease in and out (a sine), so it never jerks.
  const e = (1 - Math.cos(Math.PI * t)) / 2
  const scale = 0.94 + 0.1 * (phase === 'in' ? e : 1 - e)
  return { phase, t, scale: Math.round(scale * 1000) / 1000 }
}

/** The ring's stroke for how much time is left (1 = full): dash length and offset. */
export function ringStroke(left: number, r: number): { dash: number; offset: number } {
  const c = 2 * Math.PI * r
  const f = Math.max(0, Math.min(1, left))
  return { dash: Math.round(c * 100) / 100, offset: Math.round(c * (1 - f) * 100) / 100 }
}

/** "24:59", "1:02:03". */
export function dojoClock(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const two = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`
}

/** How often the scene redraws: the second ticks only matter for the clock; the breath needs ~8 a second. */
export const frameMs = (reduced: boolean) => (reduced ? 1000 : 125)

/** The line under the ring. */
export function dojoLine(o: { subject: string; goal?: string | null; msLeft: number; ended: boolean }): string {
  if (o.ended) return 'The bow. Well done.'
  return o.goal ? o.goal : o.subject
}
