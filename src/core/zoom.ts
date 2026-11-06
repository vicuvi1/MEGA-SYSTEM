// App zoom (Ctrl + / Ctrl - / Ctrl 0, Ctrl + mouse wheel, Settings → Look).
// The same steps as a browser, shared by the desktop window and the website.

/** The zoom steps, as factors (67 % … 200 %). */
export const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const
export const ZOOM_MIN = ZOOM_STEPS[0]
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1]

export type ZoomOp = 'in' | 'out' | 'reset' | number

/** A saved or asked-for factor, kept inside 67–200 % (anything odd is 100 %). */
export function cleanZoom(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return 1
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) * 100) / 100
}

/** The next factor after `op` from `cur`. In/out go to the next step, even from an in-between factor. */
export function nextZoom(cur: number, op: ZoomOp): number {
  if (op === 'reset') return 1
  if (typeof op === 'number') return cleanZoom(op)
  const c = cleanZoom(cur)
  if (op === 'in') return ZOOM_STEPS.find((s) => s > c + 0.001) ?? ZOOM_MAX
  return [...ZOOM_STEPS].reverse().find((s) => s < c - 0.001) ?? ZOOM_MIN
}

/** "110%". */
export const zoomLabel = (f: number) => `${Math.round(cleanZoom(f) * 100)}%`

/**
 * What a key press means for zoom, or null. Ctrl (or Cmd) with = or + zooms in,
 * - zooms out, 0 resets; the number pad's keys too. Shift/Alt combos are left alone
 * except Shift with = (that is "+" on most keyboards).
 */
export function zoomKey(k: { key: string; code?: string; control?: boolean; meta?: boolean; alt?: boolean; shift?: boolean }): Exclude<ZoomOp, number> | null {
  if (!(k.control || k.meta) || k.alt) return null
  const key = k.key
  const code = k.code ?? ''
  if (key === '+' || key === '=' || key === 'Add' || code === 'NumpadAdd' || code === 'Equal') return 'in'
  if (k.shift) return null
  if (key === '-' || key === '_' || key === 'Subtract' || code === 'NumpadSubtract' || code === 'Minus') return 'out'
  if (key === '0' || code === 'Numpad0' || code === 'Digit0') return 'reset'
  return null
}

/** Saved zoom: the last one, and one per screen (so the laptop screen and a big monitor can differ). */
export interface ZoomPrefs { last: number; byScreen: Record<string, number> }

export function cleanZoomPrefs(v: unknown): ZoomPrefs {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<ZoomPrefs>
  const byScreen: Record<string, number> = {}
  if (o.byScreen && typeof o.byScreen === 'object') {
    for (const [k, f] of Object.entries(o.byScreen).slice(0, 20)) if (/^[\w:.-]{1,40}$/.test(k)) byScreen[k] = cleanZoom(f)
  }
  return { last: cleanZoom(o.last ?? 1), byScreen }
}

/** The zoom for a screen: its own if it has one, else the last one used. */
export const zoomFor = (p: ZoomPrefs, screen: string | null) => (screen && p.byScreen[screen]) || p.last
