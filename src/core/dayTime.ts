// Your day in time: Google Calendar events, the free gaps between them
// (07:00–23:00) and time blocks that fit your must-dos and big tasks into
// those gaps. Pure: the app, the bots and the coach use it.

export interface CalEvent {
  id: string
  calendarId: string
  title: string
  /** ISO date-time, or YYYY-MM-DD for all-day events. */
  start: string
  end: string
  allDay: boolean
  color?: string | null
  location?: string | null
  /** Made by Life System (focus sessions, planned blocks). */
  ours?: boolean
}

export interface Gap {
  start: string // HH:MM
  end: string
  minutes: number
}

export interface Block {
  title: string
  start: string // HH:MM
  end: string
  minutes: number
}

export const DAY_START = '07:00'
export const DAY_END = '23:00'

const toMin = (hm: string) => {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + (m || 0)
}
export const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

/** "2026-11-01T14:30:00+02:00" → "14:30" in local time (the server runs in your time zone). */
export function localHM(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '00:00'
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** The local day (YYYY-MM-DD) an event starts on. */
export function localDay(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Timed events of one day as minute ranges, clipped to the day window. */
function busy(events: CalEvent[], day: string, from: string, to: string): [number, number][] {
  const lo = toMin(from)
  const hi = toMin(to)
  return events
    .filter((e) => !e.allDay && localDay(e.start) === day)
    .map((e): [number, number] => {
      const s = toMin(localHM(e.start))
      const endDay = localDay(e.end)
      const en = endDay > day ? 24 * 60 : toMin(localHM(e.end))
      return [Math.max(lo, s), Math.min(hi, en)]
    })
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0])
}

/**
 * Free time between events (07:00–23:00 by default), from `after` (e.g. now)
 * on, at least `minMinutes` long.
 */
export function freeGaps(events: CalEvent[], day: string, opts: { from?: string; to?: string; after?: string; minMinutes?: number } = {}): Gap[] {
  const from = opts.from ?? DAY_START
  const to = opts.to ?? DAY_END
  const min = opts.minMinutes ?? 25
  let cursor = Math.max(toMin(from), opts.after ? toMin(opts.after) : 0)
  const out: Gap[] = []
  for (const [s, e] of busy(events, day, from, to)) {
    if (s - cursor >= min) out.push({ start: fromMin(cursor), end: fromMin(s), minutes: s - cursor })
    cursor = Math.max(cursor, e)
  }
  if (toMin(to) - cursor >= min) out.push({ start: fromMin(cursor), end: to, minutes: toMin(to) - cursor })
  return out
}

/**
 * Puts each item into the free gaps, in order, with a 10-minute breather
 * after each block. Items that don't fit are left out.
 */
export function suggestBlocks(gaps: Gap[], items: { title: string; minutes: number }[], breather = 10): Block[] {
  const free = gaps.map((g) => ({ s: toMin(g.start), e: toMin(g.end) }))
  const out: Block[] = []
  for (const it of items) {
    const need = Math.max(15, Math.round(it.minutes))
    const g = free.find((x) => x.e - x.s >= need)
    if (!g) continue
    out.push({ title: it.title, start: fromMin(g.s), end: fromMin(g.s + need), minutes: need })
    g.s += need + breather
  }
  return out
}

/** "09:00–10:30 Lecture; 14:00–15:00 Gym" for the coach. */
export function agendaText(events: CalEvent[], day: string): string {
  const list = events.filter((e) => localDay(e.start) === day).sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1))
  if (!list.length) return 'nothing in the calendar'
  return list.map((e) => (e.allDay ? `all day: ${e.title}` : `${localHM(e.start)}–${localHM(e.end)} ${e.title}`)).join('; ')
}
