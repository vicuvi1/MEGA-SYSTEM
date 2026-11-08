// Custom Center: which mode is on now. Pure, on the local clock of `now`.
//
// Each mode may have time windows ("weekdays 09:00–17:00", "every day from
// 18:00"). A window with no end lasts until the next window of any mode
// starts (at most 24 h). When several windows are on, the one that started
// last wins. With none on, the base mode is used.
//
// A mode picked by hand wins until its `until`, or until a scheduled window
// starts after the moment you picked it: so "Gaming now" holds through the
// evening, and Night still takes over at 23:00.
import type { CustomSetup, Mode, ModeWindow } from './model'

const DAY_MS = 864e5

const minutesOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/** The local time `hm` on the calendar day of `dayStart` (DST-safe: built from the date parts). */
function at(dayStart: Date, hm: string): number {
  const d = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 0, 0, 0, 0)
  d.setHours(Number(hm.slice(0, 2)), Number(hm.slice(3, 5)), 0, 0)
  return d.getTime()
}

interface Run { mode: string; start: number; end: number | null }

/** Every window start from 2 days back to now, with its own end (null: open). */
function runs(modes: Mode[], now: number): Run[] {
  const out: Run[] = []
  const today = new Date(now)
  for (let back = 2; back >= 0; back--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back)
    for (const m of modes) {
      for (const w of m.schedule) {
        if (w.days.length && !w.days.includes(day.getDay())) continue
        const start = at(day, w.from)
        if (start > now) continue
        let end: number | null = null
        if (w.to) {
          end = at(day, w.to)
          // "23:00–07:00" runs past midnight.
          if (minutesOf(w.to) <= minutesOf(w.from)) end = at(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1), w.to)
        }
        out.push({ mode: m.id, start, end })
      }
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** The next window start of any mode after `t` (from the list), or t + 24 h. */
function nextStart(all: Run[], t: number): number {
  const n = all.find((r) => r.start > t)
  return Math.min(n ? n.start : Infinity, t + DAY_MS)
}

/** The scheduled mode now and when its window started, or null when no window is on. */
export function scheduledMode(modes: Mode[], now: number): { mode: string; since: number } | null {
  const all = runs(modes, now)
  let best: Run | null = null
  for (const r of all) {
    const end = r.end ?? nextStart(all, r.start)
    if (now < end && (!best || r.start >= best.start)) best = r
  }
  return best ? { mode: best.mode, since: best.start } : null
}

/** The latest window start at or before `now` (null if none in the last 2 days). */
function lastStart(modes: Mode[], now: number): number | null {
  const all = runs(modes, now)
  return all.length ? all[all.length - 1].start : null
}

export type ModeWhy = 'manual' | 'schedule' | 'base'

/** The mode on now, and why. */
export function activeMode(setup: Pick<CustomSetup, 'modes' | 'baseMode' | 'manual'>, now: number): { mode: Mode; why: ModeWhy } {
  const byId = (id: string | undefined) => setup.modes.find((m) => m.id === id)
  const base = byId(setup.baseMode) ?? setup.modes[0]
  const man = setup.manual
  if (man && byId(man.mode)) {
    const expired = man.until != null && now >= man.until
    const started = lastStart(setup.modes, now)
    const overtaken = started != null && started > man.at
    if (!expired && !overtaken) return { mode: byId(man.mode)!, why: 'manual' }
  }
  const s = scheduledMode(setup.modes, now)
  if (s && byId(s.mode)) return { mode: byId(s.mode)!, why: 'schedule' }
  return { mode: base, why: 'base' }
}

/** When the mode will next change by schedule (the next window start or end after now), or null. */
export function nextModeChange(modes: Mode[], now: number): number | null {
  let best: number | null = null
  const consider = (t: number) => {
    if (t > now && (best == null || t < best)) best = t
  }
  for (let ahead = 0; ahead <= 7; ahead++) {
    const day = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() + ahead)
    for (const m of modes)
      for (const w of m.schedule) {
        if (w.days.length && !w.days.includes(day.getDay())) continue
        consider(at(day, w.from))
        if (w.to) consider(minutesOf(w.to) <= minutesOf(w.from) ? at(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1), w.to) : at(day, w.to))
      }
    if (best != null) break
  }
  return best
}

/** "Weekdays 09:00–17:00", "Every day from 18:00". */
export function windowText(w: ModeWindow): string {
  const d = [...w.days].sort().join(',')
  const days = !w.days.length || d === '0,1,2,3,4,5,6' ? 'Every day' : d === '1,2,3,4,5' ? 'Weekdays' : d === '0,6' ? 'Weekends' : w.days.map((x) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x]).join(' ')
  return w.to ? `${days} ${w.from}–${w.to}` : `${days} from ${w.from}`
}
