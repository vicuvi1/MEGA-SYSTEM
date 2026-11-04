// When a new notification may interrupt you (pop up, chime), pure and tested.
// Everything always lands in the inbox; this only decides the interruption.

export interface NotifRulePrefs {
  popups: boolean
  sound: boolean
  quiet: boolean
  quietFrom: string
  quietTo: string
  focusQuiet: boolean
}

/** "23:00"–"07:30" wraps past midnight. */
export function inQuietHours(time: string, from: string, to: string): boolean {
  if (from === to) return false
  return from < to ? time >= from && time < to : time >= from || time < to
}

/**
 * New since last time on this device, recent (a device that was off doesn't
 * replay yesterday), at most 3 at once.
 */
export function freshNotifs<T extends { id: string; at: string; readAt: string | null }>(list: T[], popped: Set<string>, now: Date, maxAgeMin = 15): T[] {
  return list
    .filter((n) => !n.readAt && !popped.has(n.id) && now.getTime() - Date.parse(n.at) < maxAgeMin * 60000)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-3)
}

export function interrupt(p: NotifRulePrefs, time: string, focusRunning: boolean): { popup: boolean; sound: boolean; why: string | null } {
  if (p.quiet && inQuietHours(time, p.quietFrom, p.quietTo)) return { popup: false, sound: false, why: 'quiet hours' }
  if (p.focusQuiet && focusRunning) return { popup: false, sound: false, why: 'focus' }
  return { popup: p.popups, sound: p.sound, why: null }
}
