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

/**
 * Parses iCalendar date string:
 * - 20261027 -> { isAllDay: true, date: Date, day: '2026-10-27' }
 * - 20261027T123000Z -> { isAllDay: false, date: Date, day: '2026-10-27' }
 * - 20261027T143000 -> { isAllDay: false, date: Date, day: '2026-10-27' }
 */
export function parseIcsDate(raw: string, timeZone = 'UTC'): { date: Date; day: string; time: string; allDay: boolean } {
  const val = raw.trim()
  if (val.length === 8 && /^\d{8}$/.test(val)) {
    // All day date: YYYYMMDD
    const y = val.slice(0, 4)
    const m = val.slice(4, 6)
    const d = val.slice(6, 8)
    const day = `${y}-${m}-${d}`
    const date = new Date(`${day}T00:00:00Z`)
    return { date, day, time: 'All Day', allDay: true }
  }

  // DateTime format: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
  const match = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?/)
  if (match) {
    const [, y, m, d, hh, mm, ss, z] = match
    const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}${z ? 'Z' : ''}`
    const date = new Date(iso)
    const day = `${y}-${m}-${d}`
    const time = `${hh}:${mm}`
    return { date, day, time, allDay: false }
  }

  // Fallback
  const fallbackDate = new Date(val)
  const isAllDay = val.length <= 10
  const day = !isNaN(fallbackDate.getTime()) ? dayKey(fallbackDate, timeZone) : val.slice(0, 10)
  const time = isAllDay ? 'All Day' : fallbackDate.toTimeString().slice(0, 5)
  return { date: fallbackDate, day, time, allDay: isAllDay }
}

/**
 * Parses raw iCalendar (.ics) string into structured CalendarEvents.
 */
export function parseIcs(icsText: string, timeZone = 'UTC'): CalendarEvent[] {
  if (!icsText || !icsText.trim()) return []

  // Unfold multi-line strings per RFC 5545
  const unfolded = icsText.replace(/\r?\n[ \t]/g, '')
  const lines = unfolded.split(/\r?\n/)

  const events: CalendarEvent[] = []
  let inEvent = false
  let current: Partial<Record<string, string>> = {}

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true
      current = {}
      continue
    }

    if (trimmed === 'END:VEVENT') {
      inEvent = false
      if (current.DTSTART) {
        try {
          const startInfo = parseIcsDate(current.DTSTART, timeZone)
          let endInfo = current.DTEND ? parseIcsDate(current.DTEND, timeZone) : null

          if (!endInfo) {
            // Default end to 1 hour after start or same day for all-day
            if (startInfo.allDay) {
              endInfo = { ...startInfo }
            } else {
              const endDate = new Date(startInfo.date.getTime() + 3600_000)
              const [ehh, emm] = [
                String(endDate.getUTCHours()).padStart(2, '0'),
                String(endDate.getUTCMinutes()).padStart(2, '0')
              ]
              endInfo = {
                date: endDate,
                day: startInfo.day,
                time: `${ehh}:${emm}`,
                allDay: false
              }
            }
          }

          const id = current.UID || `cal-${startInfo.day}-${Math.random().toString(36).slice(2, 9)}`
          const title = current.SUMMARY ? unescapeIcsText(current.SUMMARY) : 'Untitled Event'
          const location = current.LOCATION ? unescapeIcsText(current.LOCATION) : null
          const description = current.DESCRIPTION ? unescapeIcsText(current.DESCRIPTION) : null
          const status = current.STATUS ? current.STATUS.toLowerCase() : 'confirmed'

          if (status !== 'cancelled') {
            events.push({
              id,
              title,
              start: startInfo.date.toISOString(),
              end: endInfo.date.toISOString(),
              day: startInfo.day,
              startTime: startInfo.time,
              endTime: endInfo.time,
              allDay: startInfo.allDay,
              location,
              description,
              status
            })
          }
        } catch {
          // Skip invalid event row
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
        // Strip parameters like DTSTART;VALUE=DATE or DTSTART;TZID=Europe/Chisinau
        const key = rawKey.split(';')[0].toUpperCase()
        current[key] = value
      }
    }
  }

  // Sort events by day and start time
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
