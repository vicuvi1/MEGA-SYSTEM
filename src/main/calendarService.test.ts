import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CalendarService } from './calendarService'

const MOCK_ICS = `
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
BEGIN:VEVENT
DTSTART:20261027T100000Z
DTEND:20261027T113000Z
UID:google-workout-1@google.com
SUMMARY:Calisthenics Conditioning
LOCATION:Campus Gym
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR
`

describe('CalendarService (main backend)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'life-cal-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('saves and reads calendar config', () => {
    const service = new CalendarService(dir)
    const initial = service.getConfig()
    expect(initial.feedUrl).toBe('')

    service.saveConfig({ feedUrl: 'https://calendar.google.com/calendar/ical/test/basic.ics', enabled: true })
    const updated = service.getConfig()
    expect(updated.feedUrl).toBe('https://calendar.google.com/calendar/ical/test/basic.ics')
    expect(updated.enabled).toBe(true)
  })

  it('syncs mock Google Calendar iCal feed and caches events', async () => {
    const mockFetch = (async () => ({
      ok: true,
      text: async () => MOCK_ICS
    })) as any

    const service = new CalendarService(dir, mockFetch)
    service.saveConfig({ feedUrl: 'webcal://calendar.google.com/calendar/ical/test/basic.ics' })

    const res = await service.sync()
    expect(res.count).toBe(1)
    expect(res.events[0].title).toBe('Calisthenics Conditioning')
    expect(res.events[0].location).toBe('Campus Gym')

    const dayEvents = service.getEvents('2026-10-27')
    expect(dayEvents.length).toBe(1)
    expect(dayEvents[0].startTime).toBe('10:00')

    const aiSummary = service.getEventsForAi('2026-10-27')
    expect(aiSummary).toContain('Google Calendar Agenda for 2026-10-27:')
    expect(aiSummary).toContain('Calisthenics Conditioning')
    expect(aiSummary).toContain('Campus Gym')
  })

  it('handles fetch failure gracefully without throwing', async () => {
    const failingFetch = (async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    })) as any

    const service = new CalendarService(dir, failingFetch)
    service.saveConfig({ feedUrl: 'https://calendar.google.com/calendar/ical/bad/basic.ics' })

    const res = await service.sync()
    expect(res.error).toContain('HTTP 404')
    expect(service.getConfig().lastError).toContain('HTTP 404')
  })
})
