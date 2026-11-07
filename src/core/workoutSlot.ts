// BD8: the workout slot that fits your day. Strength is near its daily peak
// in the early afternoon, so the 20–45 min home workout goes in the
// 12:00–16:00 gap before an evening shift when it can; else the nearest free
// time; never ending after 22:00 (it hurts sleep), never inside the work
// window or a class. The planner (dayPacker.ts) uses it for the plan's
// training slot, which syncs to Google Calendar like the other blocks.
// Pure and tested.

export interface FreeWin {
  /** Minutes after midnight. */
  s: number
  e: number
  /** Inside the work window (only light tasks): never a workout. */
  light?: boolean
}

export interface SlotPrefs {
  /** Workout length in minutes (20–45 from the Sport Track plan). */
  minutes: number
  /** The best time to start, as [from, to] minutes (default 12:00–16:00). */
  prefer?: [number, number]
  /** It must end by then (default 22:00). */
  latestEnd?: number
  /** Not before then (default 07:00). */
  earliest?: number
  /** Gap kept free after a class or before the next thing (default 10). */
  buffer?: number
  /** Shortest acceptable session when the full one doesn't fit (default 20). */
  minMinutes?: number
}

export interface Slot {
  start: number
  minutes: number
  /** Inside the preferred window. */
  preferred: boolean
}

export const PREFER: [number, number] = [12 * 60, 16 * 60]
export const LATEST_END = 22 * 60

/**
 * The best start: in a free window (not the work window), whole session
 * inside it with a buffer, starting on a quarter hour. Inside the preferred
 * window first (the earliest start there), else the start nearest to it.
 * When nothing fits at full length it tries shorter (down to 20 min).
 */
export function pickWorkoutSlot(wins: FreeWin[], prefs: SlotPrefs): Slot | null {
  const prefer = prefs.prefer ?? PREFER
  const latestEnd = Math.min(prefs.latestEnd ?? LATEST_END, LATEST_END)
  const earliest = prefs.earliest ?? 7 * 60
  const buffer = prefs.buffer ?? 10
  const full = Math.max(15, Math.min(90, Math.round(prefs.minutes || 30)))
  const floor = Math.min(full, Math.max(15, prefs.minMinutes ?? 20))
  for (let len = full; len >= floor; len -= 5) {
    let best: { start: number; cost: number } | null = null
    for (const w of wins) {
      if (w.light) continue
      const lo = Math.max(w.s + (w.s > 0 ? buffer : 0), earliest)
      const hi = Math.min(w.e - buffer, latestEnd) - len
      for (let s = Math.ceil(lo / 15) * 15; s <= hi; s += 15) {
        // Distance from the preferred window (0 inside it), earlier inside it wins.
        const cost = s >= prefer[0] && s + len <= prefer[1] + 30 ? (s - prefer[0]) / 1000 : s < prefer[0] ? prefer[0] - s : s - prefer[1]
        if (!best || cost < best.cost) best = { start: s, cost }
      }
    }
    if (best) return { start: best.start, minutes: len, preferred: best.cost < 1 }
  }
  return null
}

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** "Workout · 30 min" with a lighter label for a short night or a lighter dose. */
export function slotTitle(minutes: number, opts: { easy?: boolean } = {}): string {
  return `${opts.easy ? 'easy: ' : ''}Workout · ${minutes} min`
}

/** "13:00–13:30, before your shift" for Ben's line. */
export function slotLine(slot: Slot, shiftFrom?: string | null): string {
  return `${hm(slot.start)}–${hm(slot.start + slot.minutes)}${slot.preferred && shiftFrom ? ', before your shift' : slot.preferred ? ', when strength peaks' : ''}`
}
