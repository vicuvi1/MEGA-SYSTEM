import { useEffect, useState } from 'react'

/** Re-renders every second while `on` (paused while the tab is hidden). */
export function useTicker(on: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      setNow(Date.now())
    }, 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}
