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
import type { CSSProperties, ReactNode } from 'react'
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

type VTDoc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }

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
    void t.finished.finally(() => root.classList.remove('vt-page'))
  } catch {
    root.classList.remove('vt-page')
    update()
  }
}
