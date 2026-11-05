// CL10: the app's day turns at 04:00 (dayKey in src/core/dates.ts). A page
// left open overnight hears 'life-day-turned' then (and 'life-data-changed',
// so every live screen reloads), instead of showing yesterday until something
// else changes. No server call: it only looks at the clock.
import { dayKey } from '@core/dates'

/** The day the page shows, and a check every 30 s (and when you come back to it). Returns a stop function. */
export function watchDayTurn(onTurn?: (from: string, to: string) => void): () => void {
  let day = dayKey(new Date())
  const look = () => {
    const now = dayKey(new Date())
    if (now === day) return
    const from = day
    day = now
    onTurn?.(from, now)
    window.dispatchEvent(new CustomEvent('life-day-turned', { detail: { from, to: now } }))
    window.dispatchEvent(new CustomEvent('life-data-changed', { detail: { dayTurned: true } }))
  }
  const t = setInterval(look, 30_000)
  document.addEventListener('visibilitychange', look)
  window.addEventListener('focus', look)
  return () => {
    clearInterval(t)
    document.removeEventListener('visibilitychange', look)
    window.removeEventListener('focus', look)
  }
}
