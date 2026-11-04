import { describe, expect, it } from 'vitest'
import { autoApproveDue, helpLine, missedBlocks, nextSlot, nudgeText, shownMood } from './benActs'
import { followUpText } from './coachKit'
import type { CalEvent } from './dayTime'

const ev = (id: string, s: string, e: string, ours = true, title = 'Deep block 1'): CalEvent => ({ id, calendarId: 'c', title, start: new Date(`2026-11-04T${s}:00`).toISOString(), end: new Date(`2026-11-04T${e}:00`).toISOString(), allDay: false, ours })
const at = (hm: string) => new Date(`2026-11-04T${hm}:00`)

describe('Ben acts', () => {
  it('approves a waiting plan from 10:00, once', () => {
    expect(autoApproveDue('proposed', '09:59', false)).toBe(false)
    expect(autoApproveDue('proposed', '10:05', false)).toBe(true)
    expect(autoApproveDue('proposed', '10:05', true)).toBe(false)
    expect(autoApproveDue('approved', '11:00', false)).toBe(false)
    expect(autoApproveDue('proposed', '20:10', false)).toBe(false)
  })

  it('finds a missed block (not focused, just ended), not a focused one or a workout', () => {
    const events = [ev('a', '09:00', '10:00'), ev('b', '09:10', '09:50', true, '💪 Workout'), ev('c', '08:00', '08:30', false)]
    expect(missedBlocks(events, [], at('10:10'), []).map((m) => m.event.id)).toEqual(['a'])
    // Focused 40 of 60 minutes: kept.
    expect(missedBlocks(events, [{ startedAt: at('09:10').toISOString(), endedAt: at('09:50').toISOString() }], at('10:10'), [])).toEqual([])
    // Already handled, or ended long ago: left alone.
    expect(missedBlocks(events, [], at('10:10'), ['a'])).toEqual([])
    expect(missedBlocks(events, [], at('11:00'), [])).toEqual([])
  })

  it('moves it into the next free time today', () => {
    const busy = [ev('x', '10:30', '12:00', false, 'Class')]
    expect(nextSlot(busy, '2026-11-04', '10:10', 60)).toEqual({ start: '12:00', end: '13:00' })
    expect(nextSlot([ev('y', '20:00', '23:00', false, 'Late')], '2026-11-04', '19:40', 60)).toBeNull()
  })

  it('no angry faces below tone 5', () => {
    expect(shownMood('furious', 4)).toBe('focused')
    expect(shownMood('furious', 5)).toBe('furious')
    expect(shownMood('happy', 1)).toBe('happy')
    for (const n of [1, 2, 5]) expect(nudgeText(n, '2h 10m', 'Lab report', 0, 4)).not.toMatch(/😤|😠|😡/)
    expect(nudgeText(1, '2h', 'Lab report', 0, 4)).toContain('first 10 minutes')
    expect(nudgeText(2, '2h', 'x', 0, 5)).toContain('😠')
    const r = { id: '1', at: '', text: 'Gym', kind: 'checkin' as const, createdAt: new Date().toISOString(), tries: 3 }
    expect(followUpText(r, { kept: 0, broken: 2, ignored: 1, open: 0, misses: [] })).not.toMatch(/😡|miss #/)
    expect(followUpText(r, { kept: 0, broken: 2, ignored: 1, open: 0, misses: [] }, 5)).toContain('😡')
    expect(helpLine('2 promises missed this week, no focus yet today')).toContain('25-minute')
  })
})
