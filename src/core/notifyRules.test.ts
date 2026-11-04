import { describe, expect, it } from 'vitest'
import { freshNotifs, inQuietHours, interrupt } from './notifyRules'

const P = { popups: true, sound: true, quiet: true, quietFrom: '23:00', quietTo: '07:30', focusQuiet: true }

describe('when a notification may interrupt you', () => {
  it('quiet hours wrap past midnight', () => {
    expect(inQuietHours('23:30', '23:00', '07:30')).toBe(true)
    expect(inQuietHours('03:00', '23:00', '07:30')).toBe(true)
    expect(inQuietHours('07:30', '23:00', '07:30')).toBe(false)
    expect(inQuietHours('13:00', '12:00', '14:00')).toBe(true)
    expect(inQuietHours('13:00', '10:00', '10:00')).toBe(false)
  })
  it('quiet hours and focus hold it back; otherwise your choices', () => {
    expect(interrupt(P, '23:10', false)).toMatchObject({ popup: false, sound: false, why: 'quiet hours' })
    expect(interrupt(P, '10:00', true)).toMatchObject({ popup: false, why: 'focus' })
    expect(interrupt({ ...P, focusQuiet: false }, '10:00', true)).toMatchObject({ popup: true, sound: true })
    expect(interrupt({ ...P, sound: false }, '10:00', false)).toMatchObject({ popup: true, sound: false })
  })
  it('only new, recent, unread ones, at most 3', () => {
    const now = new Date('2026-11-04T12:00:00Z')
    const n = (id: string, min: number, read = false) => ({ id, at: new Date(now.getTime() - min * 60000).toISOString(), readAt: read ? 'x' : null })
    const list = [n('a', 1), n('b', 2), n('c', 3), n('d', 4), n('old', 60), n('read', 1, true), n('seen', 1)]
    expect(freshNotifs(list, new Set(['seen']), now).map((x) => x.id)).toEqual(['c', 'b', 'a'])
  })
})
