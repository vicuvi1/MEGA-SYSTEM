import { describe, expect, it } from 'vitest'
import { DEFAULT_SOUND_PREFS, HAPTICS, SOUND_CATEGORY, SOUND_NAMES, SOUND_THEMES, bedSamples, canPlay, cleanSoundPrefs, createDebounce, lastTenSecond, panFor, recipe, remindSound, soundBlock, themed, type PlayCheck } from './sounds'

const base: PlayCheck = { sound: true, volume: 80, cats: { ...DEFAULT_SOUND_PREFS.cats }, quiet: { on: true, from: '23:00', to: '07:30' }, time: '12:00', meeting: false, muted: false }

describe('canPlay (SO3)', () => {
  it('plays by default', () => expect(canPlay('success', base)).toBe(true))
  it('main switch, volume 0 and a kind switched off stop it', () => {
    expect(soundBlock('success', { ...base, sound: false })).toBe('sounds are off')
    expect(canPlay('success', { ...base, volume: 0 })).toBe(false)
    expect(canPlay('ui', { ...base, cats: { ...base.cats, ui: false } })).toBe(false)
    expect(canPlay('money', { ...base, cats: { ...base.cats, ui: false } })).toBe(true)
  })
  it('quiet hours wrap past midnight', () => {
    expect(soundBlock('alerts', { ...base, time: '23:30' })).toBe('quiet hours')
    expect(soundBlock('alerts', { ...base, time: '06:00' })).toBe('quiet hours')
    expect(canPlay('alerts', { ...base, time: '07:30' })).toBe(true)
    expect(canPlay('alerts', { ...base, time: '23:30', quiet: { ...base.quiet, on: false } })).toBe(true)
  })
  it('a meeting or a muted system keeps it quiet', () => {
    expect(soundBlock('focus', { ...base, meeting: true })).toBe('in a meeting')
    expect(canPlay('focus', { ...base, muted: true })).toBe(false)
  })
  it('a preview skips quiet hours and meetings, not the switches', () => {
    expect(canPlay('success', { ...base, time: '01:00', meeting: true }, { preview: true })).toBe(true)
    expect(canPlay('success', { ...base, sound: false }, { preview: true })).toBe(false)
  })
  it('a sound with its own switch ignores the main one, not quiet hours', () => {
    expect(canPlay('alerts', { ...base, sound: false }, { ownSwitch: true })).toBe(true)
    expect(canPlay('alerts', { ...base, sound: false, time: '02:00' }, { ownSwitch: true })).toBe(false)
  })
})

describe('debounce', () => {
  it('the same sound within 60 ms plays once; others still play', () => {
    const ok = createDebounce(60)
    expect(ok('coin', 1000)).toBe(true)
    expect(ok('coin', 1040)).toBe(false)
    expect(ok('habit', 1040)).toBe(true)
    expect(ok('coin', 1061)).toBe(true)
  })
})

describe('themes (SO8)', () => {
  it('three tables', () => expect(Object.keys(SOUND_THEMES)).toEqual(['soft', 'arcade', 'glass']))
  it('arcade is square waves, glass adds bell partials, soft keeps the notes', () => {
    expect(themed('mustDo', 'arcade').every((v) => v.wave === 'square')).toBe(true)
    expect(themed('mustDo', 'glass').length).toBe(recipe('mustDo').length * 3)
    expect(themed('coin', 'soft').map((v) => v.wave)).toEqual(['triangle', 'triangle'])
  })
  it('the gong and the thud stay the same in every theme', () => {
    for (const t of ['soft', 'arcade', 'glass'] as const) {
      expect(themed('focusEnd', t)).toEqual(recipe('focusEnd'))
      expect(themed('error', t)).toEqual(recipe('error'))
    }
  })
  it('every sound has notes and a kind', () => {
    for (const n of SOUND_NAMES) {
      expect(recipe(n).length).toBeGreaterThan(0)
      expect(SOUND_CATEGORY[n]).toBeTruthy()
    }
  })
})

describe('the sounds (SO2)', () => {
  it('the habit pluck climbs with the day’s count', () => {
    const f = [0, 1, 2, 3].map((s) => recipe('habit', s)[0].f)
    expect(f[1]).toBeGreaterThan(f[0])
    expect(f[3]).toBeGreaterThan(f[2])
    expect(recipe('habit', 99)[0].f).toBe(recipe('habit', 10)[0].f)
  })
  it('must-do goes up, water falls, the error is low, reward is coin then spend', () => {
    const m = recipe('mustDo')
    expect(m[1].f).toBeGreaterThan(m[0].f)
    expect(recipe('water')[0].f2!).toBeLessThan(recipe('water')[0].f)
    expect(recipe('error')[0].f).toBeLessThan(200)
    expect(recipe('error')[0].wave).not.toBe('sawtooth')
    expect(recipe('reward').length).toBe(recipe('coin').length + recipe('spend').length)
  })
  it('phone buzz patterns', () => {
    expect(HAPTICS.habit).toBe(8)
    expect(HAPTICS.mustDo).toEqual([10, 30, 10])
    expect(HAPTICS.error).toEqual([30])
  })
  it('island reminders map to sounds; time up is the gong', () => {
    expect(remindSound('water')).toBe('remindWater')
    expect(remindSound('winddown')).toBe('remindBed')
    expect(remindSound('over')).toBe('focusEnd')
    expect(remindSound('whatever')).toBe('remind')
  })
})

describe('the rest', () => {
  it('pan follows the island (SO5)', () => {
    expect(panFor('left')).toBe(-0.4)
    expect(panFor('top-right')).toBe(0.4)
    expect(panFor('top')).toBe(0)
  })
  it('last 10 seconds (SO7)', () => {
    expect(lastTenSecond(10_500)).toBeNull()
    expect(lastTenSecond(10_000)).toBe(10)
    expect(lastTenSecond(400)).toBe(1)
    expect(lastTenSecond(0)).toBeNull()
  })
  it('background loops are bounded noise (SO6)', () => {
    for (const k of ['brown', 'rain', 'tick'] as const) {
      const s = bedSamples(k, 8000, 2)
      expect(s.length).toBe(16000)
      let peak = 0
      for (const x of s) peak = Math.max(peak, Math.abs(x))
      expect(peak).toBeLessThanOrEqual(1)
      expect(peak).toBeGreaterThan(0)
    }
  })
  it('bad saved prefs fall back', () => {
    expect(cleanSoundPrefs({ theme: 'loud', bedVolume: 900, cats: { ui: false } })).toEqual({ ...DEFAULT_SOUND_PREFS, cats: { ...DEFAULT_SOUND_PREFS.cats, ui: false }, bedVolume: 100 })
  })
})
