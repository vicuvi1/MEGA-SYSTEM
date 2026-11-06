// The app's motion basics, in one small place (see "Motion & sound budget" in
// docs/AI_HANDOFF.md):
// - MotionRoot: framer's light `m` components need LazyMotion. Its animation
//   code (domAnimation) loads on its own, after the first paint, so the PIN
//   screen and the first page never wait for it. `strict` makes a stray full
//   `motion.` component throw in dev instead of silently pulling in the big
//   bundle. Layout animations (domMax) live only in the desktop island window.
// - MotionConfig reducedMotion="user": framer follows "reduce motion" too.
// - barFill: progress bars move by transform (translateX of a full-width pill
//   inside a clipped track), never by width, so a bar never re-lays the page.
// - viewSwitch: page changes cross-fade with the browser's view transition.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { LazyMotion, MotionConfig } from 'framer-motion'

const loadFeatures = () => import('./motionFeatures').then((m) => m.default)

export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  )
}

/** Style for a `.pbar > i` fill: 0..1 (values outside are clamped). */
export function barFill(fraction: number): CSSProperties {
  const p = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0
  return { '--p': p } as CSSProperties
}

export const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** A checkbox tick that draws itself once (AF6). `lazy`: drawn only when the
 *  row gets `.leaving` (rows that tick and then leave the list). */
export function Tick({ lazy }: { lazy?: boolean }) {
  return (
    <svg className={`fx-tick${lazy ? ' lazy' : ''}`} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.6 6.6 11.6 12.6 4.6" pathLength={1} />
    </svg>
  )
}

/**
 * A number that counts to its value (AF7): requestAnimationFrame, 400 ms
 * ease-out, from what it showed before (so a change mid-count carries on).
 * `fromZero`: the first value counts up from 0 too. `ready: false` while its
 * data is still loading: until then, and for the first loaded value, it shows
 * the value as it is (the card is final on its first draw). Jumps straight
 * there with "reduce motion" or in a hidden window. Show it with tabular
 * numbers (.num / <CountUp>) so the digits don't wobble.
 */
export function useCountUp(value: number, ms = 400, opts: { fromZero?: boolean; ready?: boolean } = {}): number {
  const start0 = opts.fromZero && !reducedMotion() ? 0 : value
  const [n, setN] = useState(start0)
  const shown = useRef(start0)
  const ready = opts.ready ?? true
  const primed = useRef(ready)
  useEffect(() => {
    if (!primed.current) {
      if (ready) primed.current = true
      shown.current = value
      return setN(value)
    }
    if (shown.current === value) return
    if (typeof document === 'undefined' || document.hidden || reducedMotion()) {
      shown.current = value
      return setN(value)
    }
    const t0 = performance.now()
    const a = shown.current
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      shown.current = k < 1 ? a + (value - a) * e : value
      setN(shown.current)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms, ready])
  return n
}

/** A counting number in tabular digits; `format` turns the live value into text. */
export function CountUp({ value, format = (v) => Math.round(v).toLocaleString(), ms }: { value: number; format?: (v: number) => ReactNode; ms?: number }) {
  const v = useCountUp(value, ms)
  return <span className="num">{format(v)}</span>
}

/**
 * True once the element has been on screen (AF20): charts draw in when you
 * first see them, not while scrolled away. Without IntersectionObserver: true.
 */
export function useSeen<T extends Element>(): [(el: T | null) => void, boolean] {
  const [seen, setSeen] = useState(false)
  const io = useRef<IntersectionObserver | null>(null)
  const ref = useCallback((el: T | null) => {
    io.current?.disconnect()
    io.current = null
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') return setSeen(true)
    io.current = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setSeen(true)
        io.current?.disconnect()
      }
    }, { threshold: 0.2 })
    io.current.observe(el)
  }, [])
  useEffect(() => () => io.current?.disconnect(), [])
  return [ref, seen]
}

type VTDoc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void>; ready?: Promise<void> } }

/** Runs a page change inside a short view transition (fade + small rise of the
 *  page only). Falls back to a plain update when the browser has no view
 *  transitions, the window is hidden, or you asked for less motion. */
export function viewSwitch(update: () => void): void {
  const d = typeof document !== 'undefined' ? (document as VTDoc) : null
  if (!d?.startViewTransition || d.hidden || reducedMotion()) return update()
  const root = d.documentElement
  root.classList.add('vt-page')
  try {
    const t = d.startViewTransition(() => flushSync(update))
    // A quick second page change skips this one: its promises reject, which is fine.
    t.ready?.catch(() => {})
    void t.finished.catch(() => {}).finally(() => root.classList.remove('vt-page'))
  } catch {
    root.classList.remove('vt-page')
    update()
  }
}
