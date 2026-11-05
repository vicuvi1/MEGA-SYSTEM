import { describe, expect, it } from 'vitest'
import { autoStartBlock, callNow, focusQuality, smartAlert } from './islandSmart'

const T = Date.parse('2026-11-04T10:00:00')
const m = (n: number) => n * 60_000
const blk = (title: string, s: number, e: number, id?: string, call = false) => ({ title, start: T + m(s), end: T + m(e), id, call })

describe('the island, smarter', () => {
  it('knows meetings by their data, never by their name (IS11)', () => {
    expect(callNow([blk('Stand-up', -5, 10, 's', true)], T)?.title).toBe('Stand-up')
    // "Call mom" in your own plan is a block you do, not a meeting.
    expect(callNow([blk('Call mom', -5, 10)], T)).toBeNull()
    // A "maybe" is never on now.
    expect(callNow([{ ...blk('Sync', -5, 10, 'x', true), maybe: 'tentative' as const }], T)).toBeNull()
  })
  it('drift: a work block on, no timer, away 8+ min', () => {
    const a = smartAlert({ now: T, blocks: [blk('Algorithms', -20, 25)], running: false, idleSec: 9 * 60, dismissed: {}, answered: {} })
    expect(a?.kind).toBe('drift')
    expect(a?.title).toBe('Algorithms · 25 min left')
    expect(a?.actions.map((x) => x.action.kind)).toEqual(['start', 'push', 'blockResult'])
    expect(smartAlert({ now: T, blocks: [blk('Algorithms', -20, 25)], running: false, idleSec: 60, dismissed: {}, answered: {} })).toBeNull()
    expect(smartAlert({ now: T, blocks: [blk('Algorithms', -20, 25)], running: true, idleSec: 900, dismissed: {}, answered: {} })).toBeNull()
    expect(smartAlert({ now: T, blocks: [blk('Client call', -20, 25, 'c', true)], running: false, idleSec: 900, dismissed: {}, answered: {} })).toBeNull()
    // Named like a call but it's your own block: drifting counts.
    expect(smartAlert({ now: T, blocks: [blk('Call mom', -20, 25)], running: false, idleSec: 900, dismissed: {}, answered: {} })?.kind).toBe('drift')
  })
  it('end-of-block check once, not for short blocks or calls', () => {
    const a = smartAlert({ now: T, blocks: [blk('Lab report', -60, -5, 'g1')], running: false, idleSec: 0, dismissed: {}, answered: {} })
    expect(a?.kind).toBe('end')
    expect(a?.text).toContain('Lab report')
    expect(smartAlert({ now: T, blocks: [blk('Lab report', -60, -5, 'g1')], running: false, idleSec: 0, dismissed: {}, answered: { g1: 'done' } })).toBeNull()
    expect(smartAlert({ now: T, blocks: [blk('Quick', -10, -5)], running: false, idleSec: 0, dismissed: {}, answered: {} })).toBeNull()
    expect(smartAlert({ now: T, blocks: [blk('Lab report', -90, -40)], running: false, idleSec: 0, dismissed: {}, answered: {} })).toBeNull()
  })
  it('focus quality is the share you were there', () => {
    expect(focusQuality(50 * 60, 9 * 60)).toBe(82)
    expect(focusQuality(600, 0)).toBe(100)
    expect(focusQuality(600, 900)).toBe(0)
  })
  it('auto-start: once, at the start of a work block', () => {
    expect(autoStartBlock([blk('Algorithms', -1, 50, 'a')], T, false, {})?.id).toBe('a')
    expect(autoStartBlock([blk('Algorithms', -1, 50, 'a')], T, false, { a: true })).toBeNull()
    expect(autoStartBlock([blk('Algorithms', -10, 50, 'a')], T, false, {})).toBeNull()
    expect(autoStartBlock([blk('Team call', -1, 50, 'c', true)], T, false, {})).toBeNull()
    expect(autoStartBlock([blk('Prep the sync slides', -1, 50, 'p')], T, false, {})?.id).toBe('p')
    expect(autoStartBlock([{ ...blk('Maybe gym', -1, 50, 'g'), maybe: 'invite' as const }], T, false, {})).toBeNull()
  })
})
