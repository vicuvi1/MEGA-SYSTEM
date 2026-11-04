import { describe, expect, it } from 'vitest'
import {
  filterEventsForDay,
  formatCalendarSummaryForAi,
  parseIcs,
  parseIcsDate
} from './calendar'

const SAMPLE_ICS = `
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Victor Barbuta
BEGIN:VEVENT
DTSTART:20261027T083000Z
DTEND:20261027T093000Z
UID:standup-1027@google.com
SUMMARY:Daily Hunter Standup & Alignment
LOCATION:War Room
DESCRIPTION:Review daily quests and sprint goals.
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=Europe/Chisinau:20261027T140000
DTEND;TZID=Europe/Chisinau:20261027T160000
UID:deepwork-1027@google.com
SUMMARY:Deep Focus: Calisthenics & Coding
LOCATION:Home Gym / Desk
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20261027
DTEND;VALUE=DATE:20261027
UID:allday-1027@google.com
SUMMARY:Victory Day Momentum Sprint
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
DTSTART:20261028T100000Z
DTEND:20261028T110000Z
UID:meeting-1028@google.com
SUMMARY:Tomorrow Client Strategy
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
DTSTART:20261027T180000Z
DTEND:20261027T190000Z
UID:cancelled-1027@google.com
SUMMARY:Cancelled Coffee Chat
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR
`

describe('calendar core domain', () => {
  it('parses iCal dates for all-day and timestamps', () => {
    const allDay = parseIcsDate('20261027')
    expect(allDay.allDay).toBe(true)
    expect(allDay.day).toBe('2026-10-27')
    expect(allDay.time).toBe('All Day')

    const timedUtc = parseIcsDate('20261027T143000Z')
    expect(timedUtc.allDay).toBe(false)
    expect(timedUtc.day).toBe('2026-10-27')
    expect(timedUtc.time).toBe('14:30')
  })

  it('parses complete iCal feed into structured CalendarEvents', () => {
    const events = parseIcs(SAMPLE_ICS)
    // 4 confirmed events (1 cancelled event excluded)
    expect(events.length).toBe(4)

    const standup = events.find((e) => e.id === 'standup-1027@google.com')
    expect(standup).toBeDefined()
    expect(standup?.title).toBe('Daily Hunter Standup & Alignment')
    expect(standup?.location).toBe('War Room')
    expect(standup?.startTime).toBe('08:30')
    expect(standup?.endTime).toBe('09:30')
    expect(standup?.allDay).toBe(false)

    const allDay = events.find((e) => e.id === 'allday-1027@google.com')
    expect(allDay).toBeDefined()
    expect(allDay?.allDay).toBe(true)
    expect(allDay?.startTime).toBe('All Day')
  })

  it('filters events for target day', () => {
    const events = parseIcs(SAMPLE_ICS)
    const todayEvents = filterEventsForDay(events, '2026-10-27')
    expect(todayEvents.length).toBe(3)

    const tomorrowEvents = filterEventsForDay(events, '2026-10-28')
    expect(tomorrowEvents.length).toBe(1)
    expect(tomorrowEvents[0].title).toBe('Tomorrow Client Strategy')

    const emptyDay = filterEventsForDay(events, '2026-10-29')
    expect(emptyDay.length).toBe(0)
  })

  it('formats calendar events cleanly for AI system prompt', () => {
    const events = parseIcs(SAMPLE_ICS)
    const todayEvents = filterEventsForDay(events, '2026-10-27')
    const promptText = formatCalendarSummaryForAi(todayEvents, '2026-10-27')

    expect(promptText).toContain('Google Calendar Agenda for 2026-10-27:')
    expect(promptText).toContain('Daily Hunter Standup & Alignment')
    expect(promptText).toContain('Deep Focus: Calisthenics & Coding')
    expect(promptText).toContain('All Day: Victory Day Momentum Sprint')
  })

  it('returns graceful fallback when no events are scheduled', () => {
    const emptyPrompt = formatCalendarSummaryForAi([])
    expect(emptyPrompt).toBe('No Google Calendar events scheduled for this day.')
  })
})

describe('calendar files done right', () => {
  const ics = (body: string) => `BEGIN:VCALENDAR\nBEGIN:VEVENT\n${body}\nEND:VEVENT\nEND:VCALENDAR`
  it('honours TZID', async () => {
    const { parseIcs } = await import('./calendar')
    const [e] = parseIcs(ics('UID:a\nSUMMARY:Lecture\nDTSTART;TZID=Europe/Chisinau:20261104T100000\nDTEND;TZID=Europe/Chisinau:20261104T113000'), 'Europe/Chisinau', new Date('2026-11-04T00:00:00Z'))
    expect(e.start).toBe('2026-11-04T08:00:00.000Z') // 10:00 in Chisinau (UTC+2 in November)
    expect(e.startTime).toBe('10:00')
    expect(e.endTime).toBe('11:30')
  })
  it('an all-day DTEND is exclusive', async () => {
    const { parseIcs } = await import('./calendar')
    const [e] = parseIcs(ics('UID:b\nSUMMARY:Holiday\nDTSTART;VALUE=DATE:20261105\nDTEND;VALUE=DATE:20261106'), 'UTC', new Date('2026-11-04T00:00:00Z'))
    expect(e.end.slice(0, 10)).toBe('2026-11-05')
  })
  it('expands weekly repeats with BYDAY and COUNT, skips EXDATE', async () => {
    const { parseIcs } = await import('./calendar')
    const list = parseIcs(ics('UID:c\nSUMMARY:Lab\nDTSTART:20261102T140000Z\nDTEND:20261102T160000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4\nEXDATE:20261104T140000Z'), 'UTC', new Date('2026-11-02T00:00:00Z'))
    expect(list.map((e) => e.day)).toEqual(['2026-11-02', '2026-11-09', '2026-11-11'])
    expect(new Set(list.map((e) => e.id)).size).toBe(3)
  })
  it('the same event without a UID keeps the same id', async () => {
    const { parseIcs } = await import('./calendar')
    const body = ics('SUMMARY:Gym\nDTSTART:20261104T180000Z')
    expect(parseIcs(body, 'UTC')[0].id).toBe(parseIcs(body, 'UTC')[0].id)
  })
})
