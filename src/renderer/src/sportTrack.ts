// Sport Track's data on this device (localStorage), shared by the Today
// banner, the Telegram bot and the Body page. Sport Track starts a new
// checklist when its `lastDate` (your local date) changes; everything that
// adds reps here applies the same rule first, so reps never land on yesterday.
import { dayKey } from '@core/dates'
import { numberDeltas, sportNumbers, withTotals } from '@core/bodyLog'

/** Where Sport Track keeps its data in this PC's storage. */
export const SPORT_KEY = 'life_sport_tracker_v1'
const KEY = SPORT_KEY

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

/**
 * This copy is only a view of the one water + reps log (body_log): what a
 * change here adds or takes back goes to the log as rows (the app registers
 * how, see tursoWebBridge), and the log's sums come back into this copy.
 */
type SportLogger = (changes: { kind: string; amount: number }[], source: string) => Promise<any | null>
let logger: SportLogger | null = null
export function setSportLogger(fn: SportLogger | null): void {
  logger = fn
}

/**
 * Changes Sport Track's data and tells its open page to reload. Water and reps
 * it adds or takes back are logged (`source`: where, e.g. 'island'); `log: false`
 * when the change already came from the log.
 */
export function updateSport(fn: (s: any) => void, opts: { log?: boolean; source?: string; echo?: boolean } = {}): any | null {
  const s = readSport()
  if (!s) return null
  const before = JSON.parse(JSON.stringify(s))
  fn(s)
  const next = JSON.stringify(s)
  // The log's sums coming back with nothing new: nothing to write, nothing to tell the open page.
  if (opts.echo && next === JSON.stringify(before)) return s
  try {
    localStorage.setItem(KEY, next)
  } catch {
    return null
  }
  // `echo`: the log's sums coming back. The open page hears the storage change and updates in place, so it
  // must not be reloaded (that closed the workout screen in the middle of a set).
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('life-sport-changed', { detail: opts.echo ? { echo: true } : undefined }))
  const changes = opts.log === false || !logger ? [] : numberDeltas(before, s)
  if (changes.length) void logShared(changes, opts.source ?? '')
  return s
}

/** Sends changes to the log, then shows the log's sums here. */
export async function logShared(changes: { kind: string; amount: number; id?: string }[], source: string): Promise<any | null> {
  if (!logger || !changes.length) return null
  const shared = await logger(changes, source).catch(() => null)
  if (shared) applyShared(shared)
  return shared
}

/** Today's water and reps from the shared copy (the log's sums) into this device's copy, without logging them again. */
export function applyShared(shared: any): void {
  const day = sportDay()
  if (!shared || String(shared.lastDate ?? '') !== day) return
  const nums = sportNumbers(shared)
  updateSport((d) => void Object.assign(d, withTotals(d, day, nums)), { log: false, echo: true })
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
