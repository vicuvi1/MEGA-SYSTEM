import { calendarDay } from './dates'
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
  const from = ((Number.isFinite(h) ? h : 23) * 60 + (mm || 0) - 90 + 1440) % 1440
  return m >= from || m < 4 * 60
}

/** Show "☀️ I'm up": 05:00–12:00, if the wake-up isn't logged yet. */
export function showWakeButton(now: Date, wakeLogged: boolean): boolean {
  const m = minOf(now)
  return !wakeLogged && m >= 5 * 60 && m < 12 * 60
}

/** Was a bedtime logged for the night that ends this morning / starts tonight? */
export function bedLoggedTonight(logs: { day: string; bedTime: string | null }[], now: Date): boolean {
  const day = (d: Date) => calendarDay(d)
  const today = day(now)
  const yesterday = day(new Date(now.getTime() - 86400000))
  const tomorrow = day(new Date(now.getTime() + 86400000))
  const morning = now.getHours() < 12
  // A bedtime sits on the row of the morning the night ends in (older rows: the evening's own day).
  return logs.some((l) => !!l.bedTime && (morning ? l.day === today || (l.day === yesterday && toMin(l.bedTime) >= 18 * 60) : l.day === tomorrow || (l.day === today && toMin(l.bedTime) >= 18 * 60)))
}
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/**
 * "Going to bed" checks you really stopped (owner, 2026-11-12; honest points).
 * A live "Going to bed" tap starts a watch. The desktop reports the PC's idle
 * seconds every minute. Still using the PC more than 30 minutes after the tap:
 * the bed points go back at once. Then, once the PC has been left alone for 30
 * minutes, the real bedtime is the last moment it was used. Every step is kept
 * as a plain sentence he can read on the Sleep page.
 */
export const BED_CHECK_MIN = 30
/** A watch ends by itself after this long (he slept, or the PC was off all night). */
export const BED_WATCH_MAX_H = 16
/** Minutes without a check that mean the PC slept or the app was closed. */
export const BED_GAP_MIN = 10

export interface BedWatch {
  /** The morning row the night sits on. */
  day: string
  /** The app day the bed points were paid on. */
  payDay: string
  /** When he tapped "Going to bed" (ms) and the time it logged. */
  tapAt: number
  tapTime: string
  /** The last moment the PC was used after the tap (ms). */
  lastActive: number
  /** The last check (ms): a long gap means the PC slept or the app was closed. */
  lastTick?: number
  /** Points taken back: still up more than 30 minutes after the tap. */
  stillUp: boolean
  /** Finished: the bedtime is final. */
  done: boolean
  /** What happened, in plain words, oldest first. */
  log: string[]
}

export type BedStep = { kind: 'none' } | { kind: 'stillUp' } | { kind: 'settle'; time: string } | { kind: 'end' }

export function startBedWatch(tapAt: Date, day: string, payDay: string, time = hm(tapAt)): BedWatch {
  const t = time
  return { day, payDay, tapAt: tapAt.getTime(), tapTime: t, lastActive: tapAt.getTime(), stillUp: false, done: false, log: [`${t}: you tapped "Going to bed".`] }
}

/** Reads a stored watch (or null when it isn't one). */
export function cleanBedWatch(raw: unknown): BedWatch | null {
  const w = raw as Partial<BedWatch> | null
  if (!w || typeof w !== 'object' || typeof w.tapAt !== 'number' || typeof w.day !== 'string' || typeof w.tapTime !== 'string') return null
  return {
    day: w.day,
    payDay: typeof w.payDay === 'string' ? w.payDay : w.day,
    tapAt: w.tapAt,
    tapTime: w.tapTime,
    lastActive: typeof w.lastActive === 'number' ? w.lastActive : w.tapAt,
    ...(typeof w.lastTick === 'number' ? { lastTick: w.lastTick } : {}),
    stillUp: !!w.stillUp,
    done: !!w.done,
    log: Array.isArray(w.log) ? w.log.filter((x): x is string => typeof x === 'string').slice(-12) : []
  }
}

/**
 * One check (every minute from the desktop): `idleSec` is how long since the
 * last mouse or key input. Returns the new watch and what to do now.
 */
export function bedWatchStep(w: BedWatch, now: Date, idleSec: number): { watch: BedWatch; step: BedStep } {
  if (w.done) return { watch: w, step: { kind: 'none' } }
  const t = now.getTime()
  // No check for 10+ minutes: the PC slept, was off or the app was closed. Input after
  // that (the next morning) is not "still up": the night is judged by what came before.
  if (t - (w.lastTick ?? w.tapAt) > BED_GAP_MIN * 60_000) {
    const next: BedWatch = { ...w, lastTick: t, done: true, log: [...w.log] }
    if (!w.stillUp) {
      next.log.push(`The PC was off or asleep after that: bedtime ${w.tapTime} stands.`)
      return { watch: next, step: { kind: 'end' } }
    }
    const time = hm(new Date(w.lastActive))
    next.log.push(`Bedtime set to ${time}, the last time the PC was used.`)
    return { watch: next, step: { kind: 'settle', time } }
  }
  const used = Math.max(w.lastActive, t - Math.max(0, idleSec) * 1000)
  const next: BedWatch = { ...w, lastActive: used, lastTick: t, log: [...w.log] }
  const usedAt = new Date(used)
  if (!next.stillUp && used - w.tapAt > BED_CHECK_MIN * 60_000) {
    next.stillUp = true
    next.log.push(`${hm(usedAt)}: the PC was still in use more than ${BED_CHECK_MIN} minutes after that, so the bed points went back.`)
    return { watch: next, step: { kind: 'stillUp' } }
  }
  if (next.stillUp && t - used >= BED_CHECK_MIN * 60_000) {
    const time = hm(usedAt)
    next.done = true
    next.log.push(`Bedtime set to ${time}, the last time the PC was used.`)
    return { watch: next, step: { kind: 'settle', time } }
  }
  // Not touched for 30 minutes after the tap: he really went to bed, and the tap stands.
  if (!next.stillUp && t - used >= BED_CHECK_MIN * 60_000) {
    next.done = true
    next.log.push(`The PC was left alone after that: bedtime ${w.tapTime} stands.`)
    return { watch: next, step: { kind: 'end' } }
  }
  if (t - w.tapAt > BED_WATCH_MAX_H * 3600_000) {
    next.done = true
    return { watch: next, step: { kind: 'end' } }
  }
  return { watch: next, step: { kind: 'none' } }
}
