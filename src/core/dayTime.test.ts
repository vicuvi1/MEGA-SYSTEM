import { describe, expect, it } from 'vitest'
import { agendaText, freeGaps, suggestBlocks, type CalEvent } from './dayTime'

const day = '2026-11-02'
const ev = (title: string, s: string, e: string): CalEvent => ({ id: title, calendarId: 'c', title, start: new Date(`${day}T${s}:00`).toISOString(), end: new Date(`${day}T${e}:00`).toISOString(), allDay: false })

describe('your day in time', () => {
  const events = [ev('Lecture', '09:00', '10:30'), ev('Lab', '11:00', '14:00'), ev('Gym', '18:00', '19:00')]
  it('finds the free gaps (07:00–23:00), from now on', () => {
    expect(freeGaps(events, day)).toEqual([
      { start: '07:00', end: '09:00', minutes: 120 },
      { start: '10:30', end: '11:00', minutes: 30 },
      { start: '14:00', end: '18:00', minutes: 240 },
      { start: '19:00', end: '23:00', minutes: 240 }
    ])
    expect(freeGaps(events, day, { after: '15:00', minMinutes: 45 })[0]).toEqual({ start: '15:00', end: '18:00', minutes: 180 })
  })
  it('fits blocks into the gaps with a breather, leaving out what does not fit', () => {
    const gaps = freeGaps(events, day, { after: '14:00' })
    const b = suggestBlocks(gaps, [{ title: 'Etica', minutes: 50 }, { title: 'Lab fixes', minutes: 50 }, { title: 'Huge', minutes: 500 }])
    expect(b).toEqual([
      { title: 'Etica', start: '14:00', end: '14:50', minutes: 50 },
      { title: 'Lab fixes', start: '15:00', end: '15:50', minutes: 50 }
    ])
  })
  it('says the agenda in one line', () => {
    expect(agendaText(events, day)).toBe('09:00–10:30 Lecture; 11:00–14:00 Lab; 18:00–19:00 Gym')
    expect(agendaText([], day)).toBe('nothing in the calendar')
  })
})
