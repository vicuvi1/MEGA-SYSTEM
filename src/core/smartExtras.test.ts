import { describe, expect, it } from 'vitest'
import { moveLateStudy, workHours } from './bestHours'
import { biggestLeak, quickKind, quickReply } from './benQuick'
import { alertGate, DEFAULT_ISLAND_PREFS } from './islandModel'
import { moveAlert } from './islandBody'
import { addContextRule, inferContext } from './activityContext'
import { addDoing, cleanPcPrefs } from './pcActivity'

const T = Date.parse('2026-11-04T10:00:00')

describe('Smart island extras', () => {
  it('SI25: a study block later than ever moves to the best free hour', () => {
    const blocks = [
      { title: 'Gym', start: '18:00', minutes: 60 },
      { title: 'Algorithms set', start: '21:30', minutes: 45 }
    ]
    const r = moveLateStudy(blocks, { lastHour: 20, best: [9, 10], now: '09:20', busy: [{ start: 600, end: 660 }], words: ['Algorithms'] })
    // 09:00 is past and 10:00 is busy: no best hour is free, so it stays.
    expect(r.note).toBe('')
    const r2 = moveLateStudy(blocks, { lastHour: 20, best: [10, 14], now: '09:20', busy: [{ start: 600, end: 660 }], words: ['Algorithms'] })
    expect(r2.note).toBe('You never study after 21:00; moved Algorithms set to 14:00.')
    expect(r2.blocks.map((b) => b.start)).toEqual(['14:00', '18:00'])
    expect(moveLateStudy(blocks, { lastHour: null, best: [10], now: '08:00', busy: [], words: ['Algorithms'] }).blocks).toBe(blocks)
  })
  it('SI22: best work hours from minutes per hour', () => {
    expect(workHours([{ '9': { coding: 30, video: 90 }, '14': { study: 15 } }, { '14': { study: 20 } }])).toEqual([14, 9])
  })
  it('SI23: "what am I doing wrong today?": numbers first, the leak, one push', () => {
    expect(quickKind('What am I doing wrong today?', '2026-11-04')).toEqual({ kind: 'wrong' })
    expect(biggestLeak('coding 35m, video 1h10, social 20m')).toMatchObject({ kind: 'video', min: 70 })
    const r = quickReply({ kind: 'wrong' }, { wrong: { focusMin: 40, focusGoal: 120, mustDone: 1, mustTotal: 3, nextMust: 'Essay intro', doing: 'video 1h10, coding 35m' } })
    expect(r?.reply.split('\n')[0]).toBe('⏱ focus 40m of 2h · ✅ must-dos 1/3 · 🖥 video 1h10, coding 35m')
    expect(r?.reply).toContain('Biggest leak: video 1h10')
    expect(r?.buttons[0].do).toBe('focus:25:Essay intro')
  })
  it('SI6: a dot-only alert never drops down', () => {
    const p = { kinds: DEFAULT_ISLAND_PREFS.kinds, gapMin: 0 }
    expect(alertGate({ kind: 'suggest', prefs: p, quiet: false, call: false, lastPeekAt: 0, now: T })).toBe('peek')
    expect(alertGate({ kind: 'suggest', dot: true, prefs: p, quiet: false, call: false, lastPeekAt: 0, now: T })).toBe('silent')
  })
  it('SI12: breaks wait for a natural pause in real work, and say what it was', () => {
    const base = { now: T, busy: false, idleSec: 5, activeSince: T - 60 * 60_000, water: { ml: 0, target: 2000 }, lastWaterAt: 0, lastMoveAt: 0, lastEyesAt: 0, eyeBreaks: false, dismissed: {} }
    expect(moveAlert({ ...base, doing: { ctx: 'coding', pause: false } })).toBeNull()
    expect(moveAlert({ ...base, doing: { ctx: 'coding', pause: true } })?.title).toBe('60 min of coding: walk + water?')
    expect(moveAlert({ ...base, activeSince: T - 90 * 60_000, doing: { ctx: 'coding', pause: false } })?.title).toBe('90 min of coding: walk + water?')
    expect(moveAlert(base)?.title).toBe('60 min at the PC')
  })
  it('SI1: a fix is kept by the friendly name too', () => {
    const rules = addContextRule([], 'VS Code', 'writing')
    expect(inferContext({ proc: 'code', label: 'VS Code', rules }).kind).toBe('writing')
  })
  it('the Smart island prefs are all off by default; per-day kinds of doing add up', () => {
    const p = cleanPcPrefs(null)
    expect([p.smart, p.smartSuggest, p.smartRecipes, p.smartBank]).toEqual([false, false, false, false])
    expect(cleanPcPrefs({ suggestBudget: 99, musicLink: 'javascript:alert(1)' })).toMatchObject({ suggestBudget: 20, musicLink: '' })
    let d = addDoing(null, '2026-11-04', 'coding', 600, 9)
    d = addDoing(d, '2026-11-04', 'coding', 300, 9)
    expect(d.ctx).toEqual({ coding: 900 })
    expect(d.hours).toEqual({ '9': { coding: 15 } })
  })
})
