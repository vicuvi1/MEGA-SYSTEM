import { describe, expect, it } from 'vitest'
import { agendaText, blockState, freeGaps, isFocusBlock, planKept, suggestBlocks, untilText, type CalEvent } from './dayTime'

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

describe('timeline: focus blocks and done vs planned', () => {
  const at = (hm: string) => `2026-11-01T${hm}:00.000Z`
  it('spots deep-work blocks', () => {
    expect(isFocusBlock({ title: 'Weekend deep block', allDay: false })).toBe(true)
    expect(isFocusBlock({ title: 'c. Criptografie lab', allDay: false })).toBe(true)
    expect(isFocusBlock({ title: 'Family call', allDay: false })).toBe(false)
    expect(isFocusBlock({ title: 'Anything', allDay: false, ours: true })).toBe(true)
    expect(isFocusBlock({ title: 'Study', allDay: true })).toBe(false)
  })
  it('compares a block with real focus sessions', () => {
    const sessions = [{ startedAt: at('09:05'), endedAt: at('09:50') }]
    expect(blockState(at('09:00'), at('10:00'), sessions, Date.parse(at('11:00')))).toEqual({ state: 'done', focusedMin: 45 })
    expect(blockState(at('10:00'), at('11:00'), [{ startedAt: at('10:00'), endedAt: at('10:15') }], Date.parse(at('12:00'))).state).toBe('partial')
    expect(blockState(at('10:00'), at('11:00'), [], Date.parse(at('12:00'))).state).toBe('skipped')
    expect(blockState(at('10:00'), at('11:00'), [], Date.parse(at('10:30')), { startedAt: at('10:10') })).toEqual({ state: 'now', focusedMin: 20 })
    expect(blockState(at('13:00'), at('14:00'), [], Date.parse(at('12:00'))).state).toBe('upcoming')
  })
  it('plan kept and next', () => {
    expect(planKept(['done', 'partial', 'skipped', 'upcoming', 'now'])).toEqual({ done: 1, total: 3, pct: 50 })
    expect(planKept(['upcoming']).pct).toBeNull()
    expect(untilText(at('12:25'), Date.parse(at('12:00')))).toBe('in 25 min')
    expect(untilText(at('13:10'), Date.parse(at('12:00')))).toBe('in 1h 10m')
  })
})

describe('blockSubject', () => {
  it('takes the subject of a goal block', async () => {
    const { blockSubject } = await import('./dayTime')
    expect(blockSubject('Algebra: Pass the algebra exam')).toBe('Algebra')
    expect(blockSubject('📚 Study Rust')).toBe('Study Rust')
    expect(blockSubject('Lab report · draft')).toBe('Lab report')
  })
})
