import { describe, expect, it } from 'vitest'
import { calmDots, calmRevealed, calmStep, calmTiming, calmZone, cleanPeekFor, DEFAULT_PEEK_FOR, dotColor, inZone, modeGate, peekKind, type CalmEvent, type CalmPhase } from './islandCalm'
import { alertGate, cleanIslandPrefs, DEFAULT_ISLAND_PREFS } from './islandModel'

const peekFor = DEFAULT_PEEK_FOR

describe('island mode: what may peek by itself', () => {
  it('Calm is the default, also for settings saved before it existed', () => {
    expect(DEFAULT_ISLAND_PREFS.mode).toBe('calm')
    expect(cleanIslandPrefs({ size: 'normal' }).mode).toBe('calm')
    expect(cleanIslandPrefs({ mode: 'lively' }).mode).toBe('lively')
    expect(cleanIslandPrefs({ mode: 'loud' }).mode).toBe('calm')
    expect(cleanIslandPrefs(null).calmRest).toBe('line')
    expect(cleanIslandPrefs({ calmRest: 'none' }).calmRest).toBe('none')
  })
  it('Peek for: all on except eye breaks; your choices are kept', () => {
    expect(peekFor.water && peekFor.move && peekFor.ben && peekFor.remind && peekFor.timer && peekFor.meeting && peekFor.bed).toBe(true)
    expect(peekFor.eyes).toBe(false)
    expect(cleanPeekFor({ water: false, junk: true })).toEqual({ ...DEFAULT_PEEK_FOR, water: false })
  })
  it('maps alerts to their switch', () => {
    expect(peekKind('block', true)).toBe('meeting')
    expect(peekKind('block')).toBeNull()
    expect(peekKind('over')).toBe('timer')
    expect(peekKind('winddown')).toBe('bed')
    expect(peekKind('remind')).toBe('remind')
    expect(peekKind('highlight')).toBeNull()
  })
  it('Lively changes nothing', () => {
    for (const base of ['peek', 'silent', 'drop'] as const) expect(modeGate({ mode: 'lively', kind: 'highlight', peekFor, base })).toBe(base)
  })
  it('Calm: the kinds you keep on peek; the rest becomes a dot', () => {
    expect(modeGate({ mode: 'calm', kind: 'water', peekFor, base: 'peek' })).toBe('peek')
    expect(modeGate({ mode: 'calm', kind: 'remind', peekFor, base: 'peek' })).toBe('peek')
    expect(modeGate({ mode: 'calm', kind: 'eyes', peekFor, base: 'peek' })).toBe('silent')
    expect(modeGate({ mode: 'calm', kind: 'highlight', peekFor, base: 'peek' })).toBe('silent')
    expect(modeGate({ mode: 'calm', kind: 'suggest', peekFor, base: 'peek' })).toBe('silent')
    expect(modeGate({ mode: 'calm', kind: 'water', peekFor: { ...peekFor, water: false }, base: 'peek' })).toBe('silent')
  })
  it('Balanced: only timers, your reminders, meetings and bedtime', () => {
    expect(modeGate({ mode: 'balanced', kind: 'over', peekFor, base: 'peek' })).toBe('peek')
    expect(modeGate({ mode: 'balanced', kind: 'block', meeting: true, peekFor, base: 'peek' })).toBe('peek')
    expect(modeGate({ mode: 'balanced', kind: 'water', peekFor, base: 'peek' })).toBe('silent')
    expect(modeGate({ mode: 'balanced', kind: 'ben', peekFor, base: 'peek' })).toBe('silent')
  })
  it('never louder than the usual rules: quiet, calls, caps and the gap still win', () => {
    // A water nudge 1 minute after another peek: the gap makes it a dot, Calm keeps it a dot.
    const base = alertGate({ kind: 'water', prefs: DEFAULT_ISLAND_PREFS, quiet: false, call: false, lastPeekAt: 0, now: 60_000 })
    expect(base).toBe('silent')
    expect(modeGate({ mode: 'calm', kind: 'water', peekFor, base })).toBe('silent')
    // The healthy-day cap (3 an hour) marks it dot: still a dot.
    const capped = alertGate({ kind: 'move', dot: true, prefs: DEFAULT_ISLAND_PREFS, quiet: false, call: false, lastPeekAt: 0, now: 1e9 })
    expect(modeGate({ mode: 'calm', kind: 'move', peekFor, base: capped })).toBe('silent')
    // In a call: a reminder waits.
    const inCall = alertGate({ kind: 'remind', prefs: DEFAULT_ISLAND_PREFS, quiet: false, call: true, lastPeekAt: 0, now: 1e9 })
    expect(modeGate({ mode: 'calm', kind: 'remind', peekFor, base: inCall })).toBe('silent')
    // Dropped stays dropped.
    expect(modeGate({ mode: 'calm', kind: 'water', peekFor, base: 'drop' })).toBe('drop')
  })
})

describe('the dots on the line', () => {
  it('colours: water blue, move green, reminder amber, Ben lime', () => {
    expect(dotColor('water')).toBe('blue')
    expect(dotColor('move')).toBe('green')
    expect(dotColor('eyes')).toBe('green')
    expect(dotColor('remind')).toBe('amber')
    expect(dotColor('ben')).toBe('lime')
    expect(dotColor('block', true)).toBe('amber')
    expect(dotColor('highlight')).toBe('grey')
  })
  it('the waiting alert and Ben, once each', () => {
    expect(calmDots({ alert: null, benUnread: 0 })).toEqual([])
    const d = calmDots({ alert: { id: 'water:1', kind: 'water', title: 'Water' }, benUnread: 2 })
    expect(d.map((x) => [x.color, x.open])).toEqual([['blue', 'alert'], ['lime', 'ben']])
    expect(calmDots({ alert: { id: 'ben:1', kind: 'ben', title: 'Ben' }, benUnread: 1 })).toHaveLength(1)
  })
})

describe('the hover zone', () => {
  const nub = { x: 226, y: 0, w: 48, h: 3 }
  it('the resting width plus a small margin', () => {
    const z = calmZone(nub, { overTitleBar: false, restW: 200 })
    expect(z.w).toBe(216)
    expect(inZone(250, 10, z)).toBe(true)
    expect(inZone(250, 30, z)).toBe(false)
    expect(inZone(120, 2, z)).toBe(false)
  })
  it('tiny over a maximized app (its tabs and window buttons stay free)', () => {
    const z = calmZone(nub, { overTitleBar: true, restW: 200 })
    expect(z.w).toBeLessThanOrEqual(56)
    expect(z.h).toBeLessThanOrEqual(8)
    expect(inZone(250, 12, z)).toBe(false)
    expect(calmTiming(true).dwellMs).toBeGreaterThan(calmTiming(false).dwellMs)
  })
})

describe('the hover state machine', () => {
  const t = calmTiming(false)
  const run = (events: CalmEvent[], from: CalmPhase = 'rest') => events.reduce((p, e) => calmStep(p, e, t).phase, from)
  it('waits a moment before showing (passing by does nothing)', () => {
    expect(calmStep('rest', { type: 'enter' }, t)).toEqual({ phase: 'arming', timer: { ms: t.dwellMs } })
    expect(run([{ type: 'enter' }, { type: 'leave' }])).toBe('rest')
    expect(run([{ type: 'enter' }, { type: 'timer' }])).toBe('shown')
    expect(t.dwellMs).toBeGreaterThanOrEqual(150)
    expect(t.dwellMs).toBeLessThanOrEqual(250)
  })
  it('hides again ~600 ms after the mouse left, unless it comes back', () => {
    expect(calmStep('shown', { type: 'leave' }, t)).toEqual({ phase: 'leaving', timer: { ms: 600 } })
    expect(run([{ type: 'leave' }, { type: 'timer' }], 'shown')).toBe('rest')
    expect(run([{ type: 'leave' }, { type: 'enter' }], 'shown')).toBe('shown')
    expect(calmRevealed('leaving')).toBe(true)
    expect(calmRevealed('arming')).toBe(false)
  })
  it('a peek or the panel holds it out; reset puts it away', () => {
    expect(run([{ type: 'hold' }])).toBe('shown')
    expect(run([{ type: 'reset' }], 'shown')).toBe('rest')
    // A stray timer does nothing.
    expect(run([{ type: 'timer' }], 'rest')).toBe('rest')
    expect(run([{ type: 'timer' }], 'shown')).toBe('shown')
  })
})
