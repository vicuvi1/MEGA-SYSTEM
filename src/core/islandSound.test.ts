import { describe, expect, it } from 'vitest'
import { createIslandGate, DUCK_GAIN, islandGain, islandRecipe, ISLAND_SOUND_NAMES, MAX_PER_SECOND, pagePan, soundForAction, soundsFromSnapshots, SUBTLE_GAIN, viewSound, type IslandSoundCtx } from './islandSound'
import { cleanSoundPrefs, DEFAULT_SOUND_PREFS, soundLength } from './sounds'
import { EMPTY_ISLAND, type IslandSnapshot } from './islandModel'

const ctx: IslandSoundCtx = { mode: 'full', musicPlaying: false, call: false, focus: false, quietInFocus: false }

describe('island sounds: the notes', () => {
  it('every sound has short, quiet notes', () => {
    for (const n of ISLAND_SOUND_NAMES) {
      const vs = islandRecipe(n)
      expect(vs.length).toBeGreaterThan(0)
      expect(soundLength(vs)).toBeLessThan(1.4)
      for (const x of vs) expect(x.gain).toBeLessThanOrEqual(0.12)
    }
  })
  it('open rises and close falls (the whoosh)', () => {
    const o = islandRecipe('open').find((x) => x.noise)!
    const c = islandRecipe('close').find((x) => x.noise)!
    expect(o.f2!).toBeGreaterThan(o.f)
    expect(c.f2!).toBeLessThan(c.f)
  })
  it('a page tick leans the way you swiped', () => {
    expect(pagePan(1)).toBeGreaterThan(0)
    expect(pagePan(-1)).toBeLessThan(0)
    expect(pagePan(0)).toBe(0)
  })
})

describe('island sounds: how loud', () => {
  it('Off is silent, Subtle is softer than Full', () => {
    expect(islandGain('done', { ...ctx, mode: 'off' })).toBe(0)
    expect(islandGain('done', { ...ctx, mode: 'subtle' })).toBe(SUBTLE_GAIN)
    expect(islandGain('done', ctx)).toBe(1)
  })
  it('ducks to very quiet while music plays', () => {
    expect(islandGain('tap', { ...ctx, musicPlaying: true })).toBeCloseTo(DUCK_GAIN)
    expect(islandGain('tap', { ...ctx, mode: 'subtle', musicPlaying: true })).toBeCloseTo(SUBTLE_GAIN * DUCK_GAIN)
  })
  it('is silent in a call, and in focus only when you asked (errors still sound)', () => {
    expect(islandGain('open', { ...ctx, call: true })).toBe(0)
    expect(islandGain('done', { ...ctx, focus: true })).toBe(1)
    expect(islandGain('done', { ...ctx, focus: true, quietInFocus: true })).toBe(0)
    expect(islandGain('error', { ...ctx, focus: true, quietInFocus: true })).toBe(1)
  })
  it('the hover breath is for Full only', () => {
    expect(islandGain('hover', { ...ctx, mode: 'subtle' })).toBe(0)
    expect(islandGain('hover', ctx)).toBe(1)
  })
  it("Sound check plays in a call, but not when it's off", () => {
    expect(islandGain('notify', { ...ctx, call: true, preview: true })).toBe(1)
    expect(islandGain('notify', { ...ctx, mode: 'off', preview: true })).toBe(0)
  })
  it('the setting is kept and cleaned (Subtle by default)', () => {
    expect(DEFAULT_SOUND_PREFS.island).toBe('subtle')
    expect(cleanSoundPrefs({ island: 'full', islandFocusQuiet: true })).toMatchObject({ island: 'full', islandFocusQuiet: true })
    expect(cleanSoundPrefs({ island: 'loud' }).island).toBe('subtle')
    expect(cleanSoundPrefs(null)).toEqual(DEFAULT_SOUND_PREFS)
  })
})

describe('island sounds: the rate limit', () => {
  it('the same sound twice too fast plays once', () => {
    const g = createIslandGate()
    expect(g('tap', 1000)).toBe(true)
    expect(g('tap', 1030)).toBe(false)
    expect(g('tap', 1100)).toBe(true)
  })
  it(`at most ${MAX_PER_SECOND} a second, but a celebration still gets through`, () => {
    const g = createIslandGate()
    const names = ['tap', 'page', 'open', 'close', 'done', 'hover', 'notify'] as const
    const played = names.map((n, i) => g(n, 1000 + i))
    expect(played.filter(Boolean).length).toBe(MAX_PER_SECOND)
    expect(g('levelup', 1010)).toBe(true)
    // A second later the crowd is gone.
    expect(g('tap', 2100)).toBe(true)
  })
})

describe('island sounds: which event makes which sound', () => {
  const snap = (p: Partial<IslandSnapshot>): IslandSnapshot => ({ ...EMPTY_ISLAND, locked: false, at: 1, ...p })
  it('done things chime; water keeps its glug; chat is silent', () => {
    const s = { mustdos: [{ i: 0, text: 'x', done: false }, { i: 1, text: 'y', done: true }] }
    expect(soundForAction({ kind: 'mustdo', i: 0 }, s)).toBe('done')
    expect(soundForAction({ kind: 'mustdo', i: 1 }, s)).toBe('tap')
    expect(soundForAction({ kind: 'todoDone', id: '1', content: 'x' })).toBe('done')
    expect(soundForAction({ kind: 'reps', id: 'p', name: 'Push-ups', n: 10 })).toBe('done')
    expect(soundForAction({ kind: 'water', ml: 250 })).toBeNull()
    expect(soundForAction({ kind: 'chat', text: 'hi' })).toBeNull()
    expect(soundForAction({ kind: 'pause' })).toBe('tap')
  })
  it('a new alert rings; an automation that finishes chimes or thuds', () => {
    const run = (state: 'running' | 'ok' | 'failed') => ({ paused: false, buttons: [], recent: [], confirm: null, runs: [{ run: 'r1', id: 'a', name: 'A', startedAt: 0, state }] })
    const a = snap({ auto: run('running') })
    expect(soundsFromSnapshots(a, snap({ auto: run('ok') }))).toEqual(['done'])
    expect(soundsFromSnapshots(a, snap({ auto: run('failed') }))).toEqual(['error'])
    expect(soundsFromSnapshots(snap({ auto: run('ok') }), snap({ auto: run('ok') }))).toEqual([])
    const alert = { id: 'w1', kind: 'water' as const, title: 'Water', text: '', actions: [] }
    expect(soundsFromSnapshots(snap({}), snap({ alert }))).toEqual(['notify'])
    expect(soundsFromSnapshots(snap({ alert }), snap({ alert }))).toEqual([])
    // Never from the first or a locked picture.
    expect(soundsFromSnapshots(null, snap({ alert }))).toEqual([])
  })
  it('opening and closing the panel', () => {
    expect(viewSound('compact', 'expanded')).toBe('open')
    expect(viewSound('peek', 'expanded')).toBe('open')
    expect(viewSound('expanded', 'compact')).toBe('close')
    expect(viewSound('compact', 'peek')).toBeNull()
    expect(viewSound(null, 'expanded')).toBeNull()
  })
})
