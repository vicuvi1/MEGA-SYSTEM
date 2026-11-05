// Sport Track's data on this device (localStorage), shared by the Today
// banner, the Telegram bot and the Body page. Sport Track starts a new
// checklist when its `lastDate` (your local date) changes; everything that
// adds reps here applies the same rule first, so reps never land on yesterday.
import { dayKey } from '@core/dates'

const KEY = 'life_sport_tracker_v1'

/** Your day for water and reps: it turns at 04:00, like the rest of the app (S4). */
export const sportDay = (d = new Date()) => dayKey(d)

/** Sport Track's data with today's checklist (reset if its day has passed). */
export function readSport(): any | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!s || !Array.isArray(s.exercises)) return s
    if (s.lastDate !== sportDay()) {
      s.lastDate = sportDay()
      s.exercises.forEach((e: any) => (e.doneToday = 0))
      if (s.water) s.water.currentMl = 0
    }
    return s
  } catch {
    return null
  }
}

/** Changes Sport Track's data and tells its open page to reload. */
export function updateSport(fn: (s: any) => void): any | null {
  const s = readSport()
  if (!s) return null
  fn(s)
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    return null
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('life-sport-changed'))
  return s
}

/** The exercise a name like "pushups", "Push-ups" or "ex_situps" means. */
export function findExercise(s: any, name: string): any | null {
  const key = name.toLowerCase().replace(/[^a-z]/g, '')
  if (!key || !Array.isArray(s?.exercises)) return null
  return (
    s.exercises.find((e: any) => {
      const id = String(e.id ?? '').toLowerCase().replace(/[^a-z]/g, '')
      const n = String(e.name ?? '').toLowerCase().replace(/[^a-z]/g, '')
      return id.includes(key) || n.includes(key) || (n.length > 3 && key.includes(n))
    }) ?? null
  )
}
