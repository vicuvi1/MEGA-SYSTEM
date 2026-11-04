// Knowing when you went to bed without watching your screen: the desktop app
// notes the last moment you used the PC (mouse/keys, before it locked, slept
// or shut down). When you come back after hours, and that last moment was in
// the evening or night, that's your bedtime. Plus when to offer the "Going to
// bed" and "I'm up" buttons on the island.

const minOf = (d: Date) => d.getHours() * 60 + d.getMinutes()
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/** Away this long (minutes) counts as a night's sleep, not a break. */
export const SLEEP_GAP_MIN = 180

/**
 * The bedtime to log (HH:MM) after you were away from `lastActive` until
 * `back`, or null: too short, the evening hadn't started (before 20:00), or
 * it started after 05:00 (a morning nap, a day out), or bed is already logged.
 */
export function bedFromAway(lastActive: Date, back: Date, bedLogged: boolean): string | null {
  if (bedLogged) return null
  const gap = (back.getTime() - lastActive.getTime()) / 60000
  if (gap < SLEEP_GAP_MIN || gap > 16 * 60) return null
  const m = minOf(lastActive)
  if (m < 20 * 60 && m >= 5 * 60) return null
  return hm(lastActive)
}

/** Show "🌙 Going to bed": from 90 min before your bedtime target until 04:00, if not logged yet. */
export function showBedButton(now: Date, bedTarget: string, bedLogged: boolean): boolean {
  if (bedLogged) return false
  const m = minOf(now)
  const [h, mm] = bedTarget.split(':').map(Number)
  const from = ((h || 23) * 60 + (mm || 0) - 90 + 1440) % 1440
  return m >= from || m < 4 * 60
}

/** Show "☀️ I'm up": 05:00–12:00, if the wake-up isn't logged yet. */
export function showWakeButton(now: Date, wakeLogged: boolean): boolean {
  const m = minOf(now)
  return !wakeLogged && m >= 5 * 60 && m < 12 * 60
}

/** Was a bedtime logged for the night that ends this morning / starts tonight? */
export function bedLoggedTonight(logs: { day: string; bedTime: string | null }[], now: Date): boolean {
  const day = (d: Date) => d.toLocaleDateString('sv-SE')
  const today = day(now)
  const yesterday = day(new Date(now.getTime() - 86400000))
  const morning = now.getHours() < 12
  return logs.some((l) => !!l.bedTime && (l.day === today || (morning && l.day === yesterday && toMin(l.bedTime) >= 18 * 60)))
}
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
