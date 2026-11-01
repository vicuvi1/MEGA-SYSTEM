import { describe, expect, it } from 'vitest'
import { addReminder, afterSend, answered, dueReminders, isBigAsk, makeRefs, nudged, shouldNudge, type NudgeFacts } from './coachKit'

describe('coach toolkit', () => {
  it('gives events and tasks short references', () => {
    const { refs, lines } = makeRefs(
      [
        { id: 'g2', calendarId: 'c', title: 'Sport', start: '2026-11-01T15:00:00.000Z', end: '2026-11-01T15:20:00.000Z', allDay: false },
        { id: 'g1', calendarId: 'c', title: 'Deep block', start: '2026-11-01T08:00:00.000Z', end: '2026-11-01T09:00:00.000Z', allDay: false },
        { id: 'g0', calendarId: 'c', title: 'Holiday', start: '2026-11-01', end: '2026-11-02', allDay: true }
      ],
      [{ id: 't9', content: 'Fix report', priority: 4, due: '2026-11-01', dueTime: null, project: 'Inbox', recurring: false, labels: ['today'] }]
    )
    expect(refs.events.get('E1')?.id).toBe('g1')
    expect(refs.events.get('E2')?.id).toBe('g2')
    expect(refs.events.size).toBe(2)
    expect(refs.tasks.get('T1')?.id).toBe('t9')
    expect(lines).toContain('T1 Fix report (due 2026-11-01) P1 ⭐')
    expect(lines).not.toContain('g1')
  })

  it('spots big asks', () => {
    expect(isBigAsk('plan my afternoon around my calendar')).toBe(true)
    expect(isBigAsk('how was my week, honestly?')).toBe(true)
    expect(isBigAsk('taxi 45')).toBe(false)
    expect(isBigAsk('thanks')).toBe(false)
  })

  it('reminders: due, sent once, check-ins follow up until answered', () => {
    const t0 = new Date('2026-11-01T10:00:00Z')
    let list = addReminder([], { at: '2026-11-01T09:59:00Z', text: 'Call mom', kind: 'remind' }, t0)
    list = addReminder(list, { at: '2026-11-01T09:58:00Z', text: 'Did you start the CV?', kind: 'checkin', follow: true }, t0)
    list = addReminder(list, { at: '2026-11-01T12:00:00Z', text: 'later', kind: 'remind' }, t0)
    expect(dueReminders(list, t0).map((r) => r.text)).toEqual(['Call mom', 'Did you start the CV?'])
    for (const r of dueReminders(list, t0)) list = afterSend(list, r.id, t0)
    expect(dueReminders(list, t0)).toEqual([])
    const follow = list.find((r) => r.kind === 'checkin')!
    expect(follow.done).toBeFalsy()
    expect(follow.at).toBe('2026-11-01T10:45:00.000Z')
    expect(dueReminders(list, new Date('2026-11-01T10:46:00Z')).map((r) => r.text)).toEqual(['Did you start the CV?'])
    list = answered(list, new Date('2026-11-01T10:30:00Z'))
    expect(dueReminders(list, new Date('2026-11-01T10:46:00Z'))).toEqual([])
  })

  it('nudges only when slipping, never when paused, spaced out', () => {
    const f: NudgeFacts = { today: '2026-11-01', time: '14:00', focusRunning: false, focusMinToday: 0, openMustDos: 2, idleMin: 90, wakeLogged: true }
    const now = new Date('2026-11-01T14:00:00Z')
    expect(shouldNudge({}, f, now)).toBe(true)
    expect(shouldNudge({}, { ...f, focusRunning: true }, now)).toBe(false)
    expect(shouldNudge({}, { ...f, idleMin: 20 }, now)).toBe(false)
    expect(shouldNudge({}, { ...f, time: '22:30' }, now)).toBe(false)
    expect(shouldNudge({ pausedDay: '2026-11-01' }, f, now)).toBe(false)
    expect(shouldNudge({ snoozeUntil: '2026-11-01T14:30:00Z' }, f, now)).toBe(false)
    const st = nudged({}, '2026-11-01', now)
    expect(shouldNudge(st, f, new Date('2026-11-01T14:30:00Z'))).toBe(false)
    expect(shouldNudge(st, f, new Date('2026-11-01T14:50:00Z'))).toBe(true)
    expect(shouldNudge({ day: '2026-11-01', count: 8 }, f, now)).toBe(false)
  })
})
