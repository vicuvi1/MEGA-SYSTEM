// The island's moments (IM4), Today ring (IC5), evening story (IC14), stack (IC15) and bedtime countdown (IC13).
import { describe, expect, it } from 'vitest'
import { EMPTY_ISLAND, activities, bedClock, islandStep, ISLAND_UI, alertPref, liveStack, pillBubbles, windDownLeft, type IslandSnapshot } from './islandModel'
import { momentsFrom, recapAlert, recapLine, todayRings } from './islandMoments'

const at = (h: number, m = 0) => new Date(2026, 10, 4, h, m).getTime()
const base: IslandSnapshot = { ...EMPTY_ISLAND, at: at(10), locked: false, mustdos: [{ i: 0, text: 'A', done: true }, { i: 1, text: 'B', done: false }, { i: 2, text: 'C', done: true }], water: { ml: 1500, target: 2000 } }

describe('celebrations (IM4)', () => {
  it('all must-dos done, once they all are', () => {
    const cur = { ...base, at: at(10, 1), mustdos: base.mustdos.map((m) => ({ ...m, done: true })) }
    expect(momentsFrom(base, cur, at(10, 1)).map((m) => m.text)).toEqual(['All 3 done'])
    // Already all done before: nothing new.
    expect(momentsFrom(cur, cur, at(10, 2))).toEqual([])
  })
  it("the day's water reached", () => {
    const m = momentsFrom(base, { ...base, water: { ml: 2000, target: 2000 } }, at(10))
    expect(m.map((x) => x.kind)).toEqual(['water'])
    expect(m[0].text).toBe('2 L today')
  })
  it('a focus block stopped on time, not one stopped early', () => {
    const run = { subject: 'Essay', startedAt: at(9, 35), endsAt: at(10) }
    expect(momentsFrom({ ...base, running: run }, { ...base, running: null }, at(10, 1)).map((x) => x.text)).toEqual(['25 min, on time'])
    expect(momentsFrom({ ...base, running: run }, { ...base, running: null }, at(9, 50))).toEqual([])
  })
  it('a new best streak', () => {
    const prev = { ...base, streak: { days: 6, kind: 'sport' as const, atRisk: false, best: 6 } }
    const cur = { ...base, streak: { days: 7, kind: 'sport' as const, atRisk: false, best: 7 } }
    expect(momentsFrom(prev, cur, at(10)).map((x) => x.kind)).toEqual(['streak'])
    expect(momentsFrom(prev, { ...cur, streak: { ...cur.streak, days: 3, best: 6 } }, at(10))).toEqual([])
  })
  it('never from the first, empty or locked picture', () => {
    const cur = { ...base, water: { ml: 2000, target: 2000 } }
    expect(momentsFrom(null, cur, at(10))).toEqual([])
    expect(momentsFrom(EMPTY_ISLAND, cur, at(10))).toEqual([])
    expect(momentsFrom(base, { ...cur, locked: true }, at(10))).toEqual([])
  })
})

describe('the Today ring (IC5)', () => {
  it('must-dos, water and focus as 0..1', () => {
    expect(todayRings({ ...base, today: { focusMin: 30, focusGoal: 120 } })).toEqual({ must: 2 / 3, water: 0.75, focus: 0.25 })
    expect(todayRings(EMPTY_ISLAND)).toEqual({ must: 0, water: 0, focus: 0 })
    expect(todayRings({ ...base, water: { ml: 5000, target: 2000 } }).water).toBe(1)
  })
})

describe('the evening story (IC14)', () => {
  const recap = { mustDone: 2, mustTotal: 3, waterMl: 1600, waterTarget: 2000, focusMin: 95, focusGoal: 120 }
  it('shows in the hour after your evening review time, once', () => {
    expect(recapAlert({ now: at(20, 59), recap, dismissed: {} })).toBeNull()
    const a = recapAlert({ now: at(21, 10), recap, dismissed: {} })!
    expect(a.kind).toBe('recap')
    expect(a.recap).toEqual(recap)
    expect(recapAlert({ now: at(22, 0), recap, dismissed: {} })).toBeNull()
    expect(recapAlert({ now: at(21, 10), recap, dismissed: { [a.id]: at(23) } })).toBeNull()
    expect(recapAlert({ now: at(19, 40), eveningAt: '19:30', recap, dismissed: {} })?.kind).toBe('recap')
  })
  it('reads as one line, and falls under Highlights', () => {
    expect(recapLine(recap)).toBe('2 of 3 must-dos · 1.6 of 2.0 L water · 95 min focus')
    expect(alertPref('recap')).toBe('highlight')
  })
  it('peeks long enough to be told', () => {
    const t = { hoverToPeek: 350, peekLeave: 700, alertPeek: 5000, expandedLeave: 2000 }
    expect(islandStep(ISLAND_UI, { type: 'alert', ms: 11_500 }, t).timer?.ms).toBe(11_500)
    expect(islandStep(ISLAND_UI, { type: 'alert' }, t).timer?.ms).toBe(5000)
    // Never shorter than your setting.
    expect(islandStep(ISLAND_UI, { type: 'alert', ms: 100 }, t).timer?.ms).toBe(5000)
  })
})

describe('bedtime countdown (IC13)', () => {
  it('the bed item counts down in the hour before bed', () => {
    const s = { ...base, at: at(22, 18), windDown: { bedAt: '23:00', minutesLeft: 42 }, sleep: { bed: true, wake: false, target: '23:00' } }
    const a = activities(s, at(22, 18)).find((x) => x.key === 'winddown')!
    expect(a.text).toBe('Bed in 0:42')
    expect(a.pct).toBeCloseTo(0.3, 2)
    // It keeps counting between snapshots.
    expect(windDownLeft(s, at(22, 28))).toBeCloseTo(32, 5)
    expect(bedClock(60)).toBe('1:00')
    expect(bedClock(0.2)).toBe('0:01')
    // Not while a timer runs; plain "Going to bed?" without the wind-down hour.
    expect(activities({ ...s, running: { subject: 'x', startedAt: at(22), endsAt: at(23) } }, at(22, 18)).some((x) => x.kind === 'winddown')).toBe(false)
    expect(activities({ ...s, windDown: null }, at(22, 18)).find((x) => x.key === 'bed')?.text).toBe('Going to bed?')
  })
})

describe('the stack of live things (IC15)', () => {
  it('every other live thing, in your order; nothing beside a pill that is not live', () => {
    const now = at(10, 5)
    const s = { ...base, running: { subject: 'Math', startedAt: at(10), endsAt: at(10, 25) }, next: { title: 'Call', start: at(10, 12), end: at(10, 40) }, ben: { ...EMPTY_ISLAND.ben, unread: 1, last: { text: 'Hi', at: 'x', face: '🙂' } } }
    const acts = activities(s, now)
    expect(liveStack(acts, null, now).map((a) => a.kind)).toEqual(['next', 'ben'])
    expect(pillBubbles(acts, null).rest.length).toBe(acts.length - 1)
    // Picking the water pill (not live): no stack.
    expect(liveStack(acts, 'water', now)).toEqual([])
  })
})
