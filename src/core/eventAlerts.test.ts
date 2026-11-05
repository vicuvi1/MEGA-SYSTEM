import { describe, expect, it } from 'vitest'
import type { CalEvent } from './dayTime'
import { DEFAULT_NOTIF_SETTINGS, bedtimeAlert, cleanNotifSettings, eventAlerts, quietNow, travelFor, waterAlert } from './eventAlerts'
import { foldRepeats } from './notify'

const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m)
const ev = (o: Partial<CalEvent>): CalEvent => ({ id: 'e1', calendarId: 'c', title: 'Lecture', start: at(14).toISOString(), end: at(15, 30).toISOString(), allDay: false, ...o })

describe('event warnings (N2, N3, N8)', () => {
  it('warns 10 minutes before, with the place and Join; once per event and day', () => {
    const s = DEFAULT_NOTIF_SETTINGS
    expect(eventAlerts([ev({ location: 'Room 204', meet: 'https://meet.example/x' })], at(13, 45), s)).toEqual([])
    const [n] = eventAlerts([ev({ location: 'Room 204', meet: 'https://meet.example/x' })], at(13, 50), s)
    expect(n).toMatchObject({ kind: 'event', title: 'Lecture in 10 min', body: '14:00–15:30 · Room 204', action: { kind: 'link', label: 'Join' } })
    expect(n.id).toBe('event:e1:2026-11-05')
    // Declined, free, all-day and your own focus blocks: no warning.
    for (const o of [{ declined: true }, { free: true }, { ours: true }, { allDay: true }]) expect(eventAlerts([ev(o)], at(13, 50), s)).toEqual([])
  })
  it('"leave now" from your travel times', () => {
    const s = cleanNotifSettings({ travel: [{ place: 'gym', minutes: 15 }] })
    expect(travelFor('Iron Gym, Str. Main 1', s.travel)).toBe(15)
    const out = eventAlerts([ev({ title: 'Gym', location: 'Iron Gym' })], at(13, 40), s)
    expect(out.map((x) => x.kind)).toEqual(['leave'])
    expect(out[0].title).toBe('Leave now for Gym')
  })
  it('quiet hours wrap past midnight; bedtime and water reminders', () => {
    const s = DEFAULT_NOTIF_SETTINGS
    expect(quietNow(s, at(23, 30))).toBe(true)
    expect(quietNow(s, at(12))).toBe(false)
    expect(bedtimeAlert('23:00', at(22, 32), s)?.id).toBe('bedtime:2026-11-05')
    expect(bedtimeAlert('23:00', at(21, 0), s)).toBeNull()
    expect(waterAlert(300, 2700, at(16), s)?.kind).toBe('water')
    expect(waterAlert(2000, 2700, at(16), s)).toBeNull()
  })
})

describe('the bell folds repeats (N5)', () => {
  it('"💧 Water ×3" as one row; events stay separate', () => {
    const n = (id: string, kind: any, h: number) => ({ id, at: at(h).toISOString(), kind, title: id, body: null, action: null, readAt: null })
    const out = foldRepeats([n('w1', 'water', 10), n('w2', 'water', 11), n('w3', 'water', 11), n('e1', 'event', 11), n('e2', 'event', 11)])
    expect(out.find((x) => x.kind === 'water')?.count).toBe(3)
    expect(out.filter((x) => x.kind === 'event')).toHaveLength(2)
  })
})
