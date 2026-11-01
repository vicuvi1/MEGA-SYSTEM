// Swipe a row right to complete it (touch screens). One listener on the
// list: rows carry data-swipe="<key>"; a clear sideways swipe past the
// threshold calls onSwipe(key). Vertical scrolling is never blocked.
import { useEffect, type RefObject } from 'react'

const THRESHOLD = 84

export function useSwipeRows(ref: RefObject<HTMLElement | null>, onSwipe: (key: string) => void): void {
  useEffect(() => {
    // Listen on the document: the list may render after a loading state.
    const root = document
    let row: HTMLElement | null = null
    let x0 = 0
    let y0 = 0
    let dx = 0
    let sideways: boolean | null = null
    const reset = () => {
      if (row) {
        row.style.transform = ''
        row.style.transition = ''
        row.classList.remove('swiping', 'swipe-ready')
      }
      row = null
      sideways = null
      dx = 0
    }
    const start = (e: TouchEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-swipe]')
      if (!el || !ref.current?.contains(el) || (e.target as HTMLElement).closest('input, textarea, select')) return
      row = el
      x0 = e.touches[0].clientX
      y0 = e.touches[0].clientY
      sideways = null
    }
    const move = (e: TouchEvent) => {
      if (!row) return
      const mx = e.touches[0].clientX - x0
      const my = e.touches[0].clientY - y0
      if (sideways === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) sideways = Math.abs(mx) > Math.abs(my) * 1.4 && mx > 0
      if (!sideways) return
      dx = Math.max(0, Math.min(mx, 160))
      row.classList.add('swiping')
      row.classList.toggle('swipe-ready', dx >= THRESHOLD)
      row.style.transition = 'none'
      row.style.transform = `translateX(${dx}px)`
    }
    const end = () => {
      if (!row) return
      const key = row.dataset.swipe
      const done = sideways && dx >= THRESHOLD
      row.style.transition = 'transform 0.2s ease'
      row.style.transform = ''
      const r = row
      setTimeout(() => r.classList.remove('swiping', 'swipe-ready'), 200)
      row = null
      sideways = null
      dx = 0
      if (done && key) {
        if ('vibrate' in navigator) {
          try {
            navigator.vibrate(12)
          } catch {
            // no vibration here
          }
        }
        onSwipe(key)
      }
    }
    root.addEventListener('touchstart', start, { passive: true })
    root.addEventListener('touchmove', move, { passive: true })
    root.addEventListener('touchend', end)
    root.addEventListener('touchcancel', reset)
    return () => {
      root.removeEventListener('touchstart', start)
      root.removeEventListener('touchmove', move)
      root.removeEventListener('touchend', end)
      root.removeEventListener('touchcancel', reset)
    }
  }, [ref, onSwipe])
}
