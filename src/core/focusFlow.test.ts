import { describe, expect, it } from 'vitest'
import { cleanStages, flowStages, nextBlock, shouldHandOff, stageDots, startBreak } from './focusFlow'
import { applyProfile, autoProfile } from './islandProfiles'
import { cleanControls, DEFAULT_CONTROLS } from './islandControlPrefs'
import { cleanIslandPrefs, DEFAULT_ISLAND_PREFS } from './islandModel'

const NOW = new Date(2026, 10, 4, 10, 0).getTime()
const MIN = 60_000

describe('IC11: focus → break → next block', () => {
  it('stages: a break, then the next block', () => {
    expect(flowStages(5, { subject: 'Math', minutes: 50 })).toEqual([{ kind: 'break', minutes: 5 }, { kind: 'next', minutes: 50, subject: 'Math' }])
    expect(flowStages(0, null)).toEqual([])
    expect(cleanStages([{ kind: 'break', minutes: 999 }, { kind: 'x' }, null])).toEqual([{ kind: 'break', minutes: 180 }])
    expect(stageDots(flowStages(5, null))).toEqual({ n: 2, at: 0 })
  })
  it('the next block: from the plan when one starts soon (never a meeting), else the same again', () => {
    const blocks = [
      { title: 'Standup', start: NOW + 30 * MIN, end: NOW + 45 * MIN, call: true },
      { title: 'Physics', start: NOW + 35 * MIN, end: NOW + 85 * MIN }
    ]
    expect(nextBlock(blocks, NOW + 30 * MIN, { subject: 'Essay', minutes: 25 })).toEqual({ subject: 'Physics', minutes: 50 })
    expect(nextBlock(blocks, NOW + 2 * 3600_000, { subject: 'Essay', minutes: 25 })).toEqual({ subject: 'Essay', minutes: 25 })
  })
  it('hands off only when time is up, you are at the PC, and not long after', () => {
    const st = flowStages(5, null)
    expect(shouldHandOff({ now: NOW, endsAt: NOW - 1000, paused: false, stages: st, idleSec: 10 })).toBe(true)
    expect(shouldHandOff({ now: NOW, endsAt: NOW + 1000, paused: false, stages: st, idleSec: 10 })).toBe(false)
    expect(shouldHandOff({ now: NOW, endsAt: NOW - 1000, paused: false, stages: st, idleSec: 900 })).toBe(false)
    expect(shouldHandOff({ now: NOW, endsAt: NOW - 1000, paused: true, stages: st, idleSec: 10 })).toBe(false)
    expect(shouldHandOff({ now: NOW, endsAt: NOW - 20 * MIN, paused: false, stages: st, idleSec: 10 })).toBe(false)
    expect(shouldHandOff({ now: NOW, endsAt: NOW - 1000, paused: false, stages: [], idleSec: 10 })).toBe(false)
  })
  it('a break knows what comes next', () => {
    const b = startBreak(flowStages(5, { subject: 'Math', minutes: 50 }), NOW, { subject: 'Essay', minutes: 25 }, [])
    expect(b).toEqual({ startedAt: NOW, endsAt: NOW + 5 * MIN, next: { subject: 'Math', minutes: 50 }, dots: { n: 3, at: 1 } })
    expect(startBreak([], NOW, { subject: 'Essay', minutes: 25 }, [])).toBeNull()
  })
})

describe('IC18: profiles', () => {
  const p = cleanIslandPrefs(null)
  it('a profile changes only what it names', () => {
    const g = applyProfile(p, 'gaming')
    expect(g.sound).toBe(false)
    expect(g.motion).toBe('off')
    expect(g.kinds.eyes.show).toBe('never')
    expect(g.kinds.over.show).toBe('peek')
    expect(g.pillOrder.slice(0, 3).map((x) => x.id)).toEqual(['timer', 'next', 'bed'])
    expect(g.pillOrder.length).toBe(p.pillOrder.length)
    expect(g.size).toBe(p.size)
    expect(applyProfile(p, 'none')).toBe(p)
    expect(applyProfile({ ...p, opacity: 0.6 }, 'night').opacity).toBe(0.6)
  })
  it('switches by itself by the time of day or the app in front', () => {
    const c = { ...DEFAULT_CONTROLS, profile: 'study' as const }
    expect(autoProfile({ ...c, profileAuto: 'time' }, { now: new Date(2026, 10, 4, 23, 0), app: null })).toBe('night')
    expect(autoProfile({ ...c, profileAuto: 'time' }, { now: new Date(2026, 10, 4, 10, 0), app: null })).toBe('work')
    expect(autoProfile({ ...c, profileAuto: 'time' }, { now: new Date(2026, 10, 7, 14, 0), app: null })).toBe('study')
    expect(autoProfile({ ...c, profileAuto: 'app' }, { now: new Date(), app: 'Steam.exe' })).toBe('gaming')
    expect(autoProfile({ ...c, profileAuto: 'app' }, { now: new Date(), app: 'paint' })).toBe('study')
    expect(autoProfile({ ...c, profileAuto: 'off' }, { now: new Date(), app: 'steam' })).toBe('study')
  })
  it('controls are cleaned and part of your settings', () => {
    expect(cleanControls({ breakMin: 99, profile: 'boss', profileApps: { gaming: ['Steam.exe', '<bad>'] } })).toEqual(expect.objectContaining({ breakMin: 30, profile: 'none', profileApps: expect.objectContaining({ gaming: ['steam'] }) }))
    expect(cleanIslandPrefs({ controls: { ring: false } }).controls.ring).toBe(false)
    expect(DEFAULT_ISLAND_PREFS.clicks.right).toBe('menu')
    expect(cleanIslandPrefs({ clicks: { right: 'menu' } }).clicks.right).toBe('menu')
  })
})
