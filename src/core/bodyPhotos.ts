// BD10: when the next progress photo is due (every 2 weeks by default) and
// which two photos to put side by side (about 8 weeks apart). The photos
// themselves stay on the device (IndexedDB in the browser and the desktop
// app); only these rules are shared. Pure and tested.
import { addDays, daysBetween } from './dates'

export interface PhotoMeta {
  id: string
  day: string
}

export interface PhotoPlan {
  /** Days until the next check-in (0 or less: due). */
  dueIn: number
  due: boolean
  next: string
  last: PhotoMeta | null
  /** The pair for the side-by-side, when there are two photos 6+ weeks apart (else the first and the last). */
  compare: { before: PhotoMeta; after: PhotoMeta; weeks: number } | null
  /** It's been 8 weeks since the photo that the compare starts from: a good moment to look. */
  compareDue: boolean
  line: string
}

export const COMPARE_WEEKS = 8

export function photoPlan(list: PhotoMeta[], today: string, every = 14): PhotoPlan {
  const photos = [...list].filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.day)).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id < b.id ? -1 : 1))
  const last = photos[photos.length - 1] ?? null
  const next = last ? addDays(last.day, every) : today
  const dueIn = daysBetween(today, next)
  let compare: PhotoPlan['compare'] = null
  if (last && photos.length >= 2) {
    // The latest photo, against the one closest to 8 weeks before it (at least 6 weeks back if there is one).
    const target = addDays(last.day, -COMPARE_WEEKS * 7)
    const older = photos.filter((p) => p.id !== last.id && p.day <= addDays(last.day, -42))
    const pool = older.length ? older : photos.filter((p) => p.id !== last.id)
    const before = pool.reduce((a, b) => (Math.abs(daysBetween(b.day, target)) < Math.abs(daysBetween(a.day, target)) ? b : a))
    compare = { before, after: last, weeks: Math.round(daysBetween(before.day, last.day) / 7) }
  }
  const compareDue = !!compare && compare.weeks >= COMPARE_WEEKS && daysBetween(compare.after.day, today) <= 3
  const line = !last ? 'Take your first photo: same spot, same light, relaxed pose.' : dueIn <= 0 ? 'Check-in photo due today: line up with the ghost of the last one.' : `Next check-in in ${dueIn} day${dueIn === 1 ? '' : 's'} (${next.slice(5)}).`
  return { dueIn, due: dueIn <= 0, next, last, compare, compareDue, line }
}
