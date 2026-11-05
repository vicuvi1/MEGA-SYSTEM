// Toast motion without framer (AF8): a new toast springs in (CSS, see
// motion.css .t-in), the others glide to their new places (FLIP with the Web
// Animations API: transform only), a toast leaves with a short fade, and you
// can swipe one away sideways.
import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type RefObject } from 'react'

const SPRING = 'linear(0, 0.18 7%, 0.6 18%, 0.95 30%, 1.06 40%, 1.04 50%, 1 64%, 0.995 80%, 1)'
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Children with [data-flip] glide from where they were to where they are now, whenever `key` changes. */
export function useFlip(box: RefObject<HTMLElement | null>, key: unknown): void {
  const last = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const next = new Map<string, number>()
    const skip = reduced() || document.hidden
    for (const c of Array.from(el.querySelectorAll<HTMLElement>(':scope > [data-flip]'))) {
      const id = c.dataset.flip!
      const top = c.offsetTop
      next.set(id, top)
      const before = last.current.get(id)
      if (!skip && before != null && before !== top && typeof c.animate === 'function') {
        c.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }], { duration: 280, easing: SPRING, composite: 'add' })
      }
    }
    last.current = next
  }, [box, key])
}

/** A list where removed items first play their exit (`.t-out`) for `ms`. */
export function useLeaving(ms = 180) {
  const [leaving, setLeaving] = useState<ReadonlySet<string | number>>(new Set())
  const leave = useCallback(
    (id: string | number, remove: () => void) => {
      if (reduced()) return remove()
      setLeaving((s) => new Set(s).add(id))
      setTimeout(() => {
        remove()
        setLeaving((s) => {
          const n = new Set(s)
          n.delete(id)
          return n
        })
      }, ms)
    },
    [ms]
  )
  return { leaving, leave }
}

/** Pointer handlers: drag a toast sideways; past 80 px (or a quick flick) it is dismissed. */
export function useSwipeDismiss(onDismiss: () => void) {
  const start = useRef<{ x: number; t: number; id: number } | null>(null)
  const onPointerDown = (e: RPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input')) return
    start.current = { x: e.clientX, t: performance.now(), id: e.pointerId }
  }
  const onPointerMove = (e: RPointerEvent<HTMLElement>) => {
    const s = start.current
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.x
    if (Math.abs(dx) > 4 && !e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.style.translate = `${dx}px 0`
    e.currentTarget.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 220))
  }
  const end = (e: RPointerEvent<HTMLElement>) => {
    const s = start.current
    start.current = null
    if (!s) return
    const el = e.currentTarget
    const dx = e.clientX - s.x
    const fast = Math.abs(dx) / Math.max(1, performance.now() - s.t) > 0.6
    if (Math.abs(dx) > 80 || (fast && Math.abs(dx) > 24)) {
      el.style.translate = `${Math.sign(dx) * 420}px 0`
      el.style.opacity = '0'
      el.style.transition = 'translate 0.18s ease-in, opacity 0.18s ease-in'
      setTimeout(onDismiss, 170)
    } else {
      el.style.transition = 'translate 0.25s ease-out, opacity 0.25s ease-out'
      el.style.translate = ''
      el.style.opacity = ''
      setTimeout(() => (el.style.transition = ''), 260)
    }
  }
  return { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end }
}
