import { dayKey } from './dates'

export interface CalendarEvent {
  id: string
  title: string
  start: string // ISO string or YYYY-MM-DD
  end: string // ISO string or YYYY-MM-DD
  day: string // YYYY-MM-DD
  startTime: string // HH:mm or "All Day"
  endTime: string // HH:mm or "All Day"
  allDay: boolean
  location?: string | null
  description?: string | null
  status?: string
}

export interface CalendarConfig {
  feedUrl: string
  enabled: boolean
  autoSyncIntervalMin: number
  lastSyncAt: string | null
  lastError: string | null
  cachedEventsCount: number
}

export const DEFAULT_CALENDAR_CONFIG: CalendarConfig = {
  feedUrl: '',
  enabled: false,
  autoSyncIntervalMin: 15,
  lastSyncAt: null,
  lastError: null,
  cachedEventsCount: 0
}

/**
 * Unescapes RFC 5545 text sequences.
 */
function unescapeIcsText(text: string): string {
  return text
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim()
}

const LOCAL_TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
})()

/** The UTC instant of a wall-clock time in a time zone (handles DST). */
export function zonedToUtc(y: number, mo: number, d: number, hh: number, mm: number, ss: number, timeZone: string): Date {
  const guess = Date.UTC(y, mo - 1, d, hh, mm, ss)
  const offsetAt = (t: number) => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(t))
      const g = (k: string) => Number(parts.find((p) => p.type === k)?.value)
      return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - t
    } catch {
      return 0
    }
  }
  const first = guess - offsetAt(guess)
  return new Date(guess - offsetAt(first))
}

const hmIn = (date: Date, timeZone: string) => {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
  } catch {
    return date.toISOString().slice(11, 16)
  }
}
const dayIn = (date: Date, timeZone: string) => dayKey(date, timeZone, 0)

/**
 * Parses an iCalendar date: all-day (20261027), UTC (…T123000Z), a time in a
 * named zone (TZID=Europe/Chisinau) or a floating local time (in `timeZone`).
 */
export function parseIcsDate(raw: string, timeZone = LOCAL_TZ, tzid?: string | null): { date: Date; day: string; time: string; allDay: boolean } {
  const val = raw.trim()
  if (val.length === 8 && /^\d{8}$/.test(val)) {
    const day = `${val.slice(0, 4)}-${val.slice(4, 6)}-${val.slice(6, 8)}`
    return { date: new Date(`${day}T00:00:00Z`), day, time: 'All Day', allDay: true }
  }
  const match = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/)
  if (match) {
    const [, y, m, d, hh, mm, ss, z] = match
    const zone = tzid || timeZone
    const date = z ? new Date(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`) : zonedToUtc(+y, +m, +d, +hh, +mm, +ss, zone)
    return { date, day: dayIn(date, timeZone), time: hmIn(date, timeZone), allDay: false }
  }
  const fallbackDate = new Date(val)
  const isAllDay = val.length <= 10
  const day = !isNaN(fallbackDate.getTime()) ? dayKey(fallbackDate, timeZone, 0) : val.slice(0, 10)
  return { date: fallbackDate, day, time: isAllDay ? 'All Day' : hmIn(fallbackDate, timeZone), allDay: isAllDay }
}

const WD = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** Start times of a repeating event (DAILY / WEEKLY with BYDAY, INTERVAL, COUNT, UNTIL), within [from, to]. */
export function expandRrule(start: Date, rrule: string, from: Date, to: Date, exdates: Set<number> = new Set(), max = 400): Date[] {
  const r = Object.fromEntries(rrule.split(';').map((kv) => kv.split('=')).filter((x) => x.length === 2).map(([k, v]) => [k.toUpperCase(), v]))
  const freq = r.FREQ
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return [start]
  const interval = Math.max(1, Number(r.INTERVAL) || 1)
  const count = r.COUNT ? Number(r.COUNT) : Infinity
  const until = r.UNTIL ? parseIcsDate(r.UNTIL, 'UTC').date.getTime() + (r.UNTIL.length === 8 ? 86400000 - 1 : 0) : Infinity
  const byday = r.BYDAY ? r.BYDAY.split(',').map((x: string) => WD.indexOf(x.slice(-2))).filter((x: number) => x >= 0) : [start.getUTCDay()]
  const out: Date[] = []
  let n = 0
  const day0 = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  const timeOfDay = start.getTime() - day0
  for (let k = 0; k < 3660 && n < count && out.length < max; k++) {
    const dayT = day0 + k * 86400000
    const t = dayT + timeOfDay
    if (t > until || t > to.getTime()) break
    const dt = new Date(dayT)
    const weeks = Math.floor(k / 7)
    const ok = freq === 'DAILY' ? k % interval === 0 : byday.includes(dt.getUTCDay()) && Math.floor((k + ((start.getUTCDay() + 6) % 7)) / 7) % interval === 0 && weeks >= 0
    if (!ok) continue
    n++
    if (exdates.has(t)) continue
    if (t >= from.getTime()) out.push(new Date(t))
  }
  return out
}

const stableId = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return `cal-${(h >>> 0).toString(36)}`
}

/**
 * Parses raw iCalendar (.ics) into events: time zones (TZID) honoured, an
 * all-day DTEND treated as exclusive, repeating events (RRULE) expanded from
 * a week ago to 60 days ahead, cancelled ones and EXDATEs left out.
 */
export function parseIcs(icsText: string, timeZone = LOCAL_TZ, now = new Date()): CalendarEvent[] {
  if (!icsText || !icsText.trim()) return []
  const unfolded = icsText.replace(/\r?\n[ \t]/g, '')
  const lines = unfolded.split(/\r?\n/)
  const events: CalendarEvent[] = []
  let inEvent = false
  let current: Record<string, string> = {}
  let tz: Record<string, string | null> = {}
  let exdates: string[] = []
  const from = new Date(now.getTime() - 7 * 86400000)
  const to = new Date(now.getTime() + 60 * 86400000)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true
      current = {}
      tz = {}
      exdates = []
      continue
    }
    if (trimmed === 'END:VEVENT') {
      inEvent = false
      if (current.DTSTART) {
        try {
          const startInfo = parseIcsDate(current.DTSTART, timeZone, tz.DTSTART)
          let endInfo = current.DTEND ? parseIcsDate(current.DTEND, timeZone, tz.DTEND) : null
          if (startInfo.allDay) {
            // DTEND of an all-day event is the day AFTER it ends.
            const lastDay = endInfo && endInfo.date.getTime() > startInfo.date.getTime() ? new Date(endInfo.date.getTime() - 86400000) : startInfo.date
            endInfo = { date: lastDay, day: lastDay.toISOString().slice(0, 10), time: 'All Day', allDay: true }
          } else if (!endInfo) {
            const endDate = new Date(startInfo.date.getTime() + 3600_000)
            endInfo = { date: endDate, day: dayIn(endDate, timeZone), time: hmIn(endDate, timeZone), allDay: false }
          }
          const title = current.SUMMARY ? unescapeIcsText(current.SUMMARY) : 'Untitled Event'
          const location = current.LOCATION ? unescapeIcsText(current.LOCATION) : null
          const description = current.DESCRIPTION ? unescapeIcsText(current.DESCRIPTION) : null
          const status = current.STATUS ? current.STATUS.toLowerCase() : 'confirmed'
          const baseId = current.UID || stableId(`${current.DTSTART}|${title}`)
          const length = endInfo.date.getTime() - startInfo.date.getTime()
          if (status !== 'cancelled') {
            const ex = new Set(exdates.map((x) => parseIcsDate(x, timeZone, tz.DTSTART).date.getTime()))
            const starts = current.RRULE ? expandRrule(startInfo.date, current.RRULE, from, to, ex) : [startInfo.date]
            for (const st of starts) {
              const en = new Date(st.getTime() + length)
              events.push({
                id: current.RRULE ? `${baseId}_${st.toISOString().slice(0, 16)}` : baseId,
                title,
                start: st.toISOString(),
                end: en.toISOString(),
                day: startInfo.allDay ? st.toISOString().slice(0, 10) : dayIn(st, timeZone),
                startTime: startInfo.allDay ? 'All Day' : hmIn(st, timeZone),
                endTime: startInfo.allDay ? 'All Day' : hmIn(en, timeZone),
                allDay: startInfo.allDay,
                location,
                description,
                status
              })
            }
          }
        } catch {
          // Skip an event we can't read
        }
      }
      current = {}
      continue
    }
    if (inEvent) {
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx > 0) {
        const rawKey = trimmed.slice(0, colonIdx)
        const value = trimmed.slice(colonIdx + 1)
        const [name, ...params] = rawKey.split(';')
        const key = name.toUpperCase()
        if (key === 'EXDATE') exdates.push(...value.split(','))
        else current[key] = value
        const tzParam = params.find((p) => /^TZID=/i.test(p))
        if (tzParam) tz[key] = tzParam.slice(5).replace(/^"|"$/g, '')
      }
    }
  }
  return events.sort((a, b) => a.start.localeCompare(b.start))
}

/**
 * Filters events active for a specific day (YYYY-MM-DD).
 */
export function filterEventsForDay(events: CalendarEvent[], targetDay: string): CalendarEvent[] {
  return events.filter((e) => {
    if (e.day === targetDay) return true
    if (e.allDay) {
      const startDay = e.start.slice(0, 10)
      const endDay = e.end.slice(0, 10)
      return targetDay >= startDay && targetDay <= endDay
    }
    return false
  })
}

/**
 * Formats calendar events into a concise briefing block for LLM prompts.
 */
export function formatCalendarSummaryForAi(events: CalendarEvent[], day?: string): string {
  if (!events || events.length === 0) {
    return 'No Google Calendar events scheduled for this day.'
  }

  const lines = events.map((e) => {
    const timeStr = e.allDay ? 'All Day' : `${e.startTime} - ${e.endTime}`
    let locStr = e.location ? ` (Location: ${e.location})` : ''
    let descStr = e.description ? ` [Notes: ${e.description.slice(0, 80)}]` : ''
    return `• ${timeStr}: ${e.title}${locStr}${descStr}`
  })

  const header = day ? `Google Calendar Agenda for ${day}:` : 'Google Calendar Agenda:'
  return `${header}\n${lines.join('\n')}`
}
