import { describe, expect, it } from 'vitest'
import { autoStartBlock, callNow, focusQuality, isCall, smartAlert } from './islandSmart'

const T = Date.parse('2026-11-04T10:00:00')
const m = (n: number) => n * 60_000
const blk = (title: string, s: number, e: number, id?: string) => ({ title, start: T + m(s), end: T + m(e), id })

describe('the island, smarter', () => {
  it('knows calls and meetings', () => {
    expect(isCall('Client call')).toBe(true)
    expect(isCall('Ședință echipa')).toBe(true)
    expect(isCall('Algorithms')).toBe(false)
    expect(callNow([blk('Stand-up', -5, 10)], T)?.title).toBe('Stand-up')
  })
  it('drift: a work block on, no timer, away 8+ min', () => {
    const a = smartAlert({ now: T, blocks: [blk('Algorithms', -20, 25)], running: false, idleSec: 9 * 60, dismissed: {}, answered: {} })
    expect(a?.kind).toBe('drift')
    expect(a?.title).toBe('Algorithms · 25 min left')
    expect(a?.actions.map((x) => x.action.kind)).toEqual(['start', 'push', 'blockResult'])
    expect(smartAlert({ now: T, blocks: [blk('Algorithms', -20, 25)], running: false, idleSec: 60, dismissed: {}, answered: {} })).toBeNull()
    expect(smartAlert({ now: T, blocks: [blk('Algorithms', -20, 25)], running: true, idleSec: 900, dismissed: {}, answered: {} })).toBeNull()
    expect(smartAlert({ now: T, blocks: [blk('Client call', -20, 25)], running: false, idleSec: 900, dismissed: {}, answered: {} })).toBeNull()
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
    expect(autoStartBlock([blk('Team call', -1, 50, 'c')], T, false, {})).toBeNull()
  })
})
