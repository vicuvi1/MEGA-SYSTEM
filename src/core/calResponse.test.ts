import { describe, expect, it } from 'vitest'
import { canBeNow, isRealMeeting, selfResponse, takesTime } from './calResponse'
import type { CalEvent } from './dayTime'
import { agendaText, freeGaps } from './dayTime'
import { DEFAULT_NOTIF_SETTINGS, eventAlerts, warnable } from './eventAlerts'
import { meetingNow, nextUp } from './dayGlance'
import { rescueFromEvents } from './benPlans'

const ev = (over: Partial<CalEvent>): CalEvent => ({ id: 'e1', calendarId: 'c', title: 'Team sync', start: '2026-11-05T15:00:00', end: '2026-11-05T15:30:00', allDay: false, ...over })

describe('only events you accepted (IS6)', () => {
  it('reads your answer from Google: the self attendee, null for your own events', () => {
    expect(selfResponse({ attendees: [{ self: true, responseStatus: 'needsAction' }, { responseStatus: 'accepted' }] })).toBe('needsAction')
    expect(selfResponse({ attendees: [{ self: true, responseStatus: 'tentative' }] })).toBe('tentative')
    expect(selfResponse({ organizer: { self: true }, attendees: [{ self: true, responseStatus: 'accepted' }] })).toBeNull()
    expect(selfResponse({})).toBeNull()
    expect(selfResponse({ attendees: [{ responseStatus: 'accepted' }] })).toBeNull()
  })
  it('accepted (or yours) is Now; a maybe takes time but is never Now; an invite does neither', () => {
    expect(canBeNow(ev({}))).toBe(true)
    expect(canBeNow(ev({ response: 'accepted' }))).toBe(true)
    expect(canBeNow(ev({ response: 'tentative' }))).toBe(false)
    expect(takesTime(ev({ response: 'tentative' }))).toBe(true)
    expect(canBeNow(ev({ response: 'needsAction' }))).toBe(false)
    expect(takesTime(ev({ response: 'needsAction' }))).toBe(false)
    expect(canBeNow(ev({ declined: true }))).toBe(false)
    expect(canBeNow(ev({ eventType: 'outOfOffice' }))).toBe(false)
    expect(takesTime(ev({ eventType: 'workingLocation' }))).toBe(false)
  })
  it('a real meeting by its data: accepted, with a link or other people, not focus time', () => {
    expect(isRealMeeting(ev({ meet: 'https://meet.example.com/abc', response: 'accepted' }))).toBe(true)
    expect(isRealMeeting(ev({ attendees: 3 }))).toBe(true)
    expect(isRealMeeting(ev({ attendees: 3, response: 'needsAction' }))).toBe(false)
    expect(isRealMeeting(ev({ title: 'Call mom' }))).toBe(false)
    expect(isRealMeeting(ev({ attendees: 2, eventType: 'focusTime' }))).toBe(false)
  })
  it('alerts, Today, planning and Ben skip unanswered invites', () => {
    expect(warnable(ev({ response: 'needsAction' }))).toBe(false)
    expect(warnable(ev({ response: 'tentative' }))).toBe(false)
    expect(warnable(ev({ response: 'accepted' }))).toBe(true)
    const s = { ...DEFAULT_NOTIF_SETTINGS, quiet: { on: false, from: '23:00', to: '07:00' } }
    const before = new Date('2026-11-05T14:50:00')
    expect(eventAlerts([ev({ response: 'needsAction' })], before, s)).toEqual([])
    expect(eventAlerts([ev({ response: 'accepted' })], before, s)).toHaveLength(1)
    const t = Date.parse('2026-11-05T15:10:00')
    expect(meetingNow([ev({ response: 'tentative' })], t)).toBeNull()
    expect(meetingNow([ev({ response: 'accepted' })], t)?.id).toBe('e1')
    expect(nextUp([ev({ response: 'needsAction' })], Date.parse('2026-11-05T14:00:00'))).toBeNull()
    // The invite leaves its time free; the maybe takes it.
    const gaps = (e: CalEvent) => freeGaps([e], '2026-11-05', { from: '14:00', to: '16:00' }).map((g) => `${g.start}-${g.end}`)
    expect(gaps(ev({ response: 'needsAction' }))).toEqual(['14:00-16:00'])
    expect(gaps(ev({ response: 'tentative' }))).toEqual(['14:00-15:00', '15:30-16:00'])
    expect(agendaText([ev({ response: 'tentative' }), ev({ id: 'e2', title: 'Offsite', response: 'needsAction' })], '2026-11-05')).toBe('15:00–15:30 Team sync (maybe)')
    expect(rescueFromEvents([ev({ response: 'needsAction' })], t, t + 3600_000).blocks).toEqual([])
  })
})
