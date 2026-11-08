import { describe, expect, it } from 'vitest'
import { celebrationPlan, cleanColor, cleanLooks, cleanWidgets, cleanZone, clockAngles, clockText, fileFor, lookGain, openSizeOf, packVoices, pillHeight, placementOf, restRadius, soundGain, soundKindOf, DEFAULT_LOOKS, DEFAULT_WIDGETS } from './islandLooks'
import { feelPatch, motionFor, motionSpec, settleMs, INSTANT } from './islandMotion'

describe('island looks', () => {
  it('anything becomes the defaults', () => {
    expect(cleanLooks(undefined)).toEqual(DEFAULT_LOOKS)
    expect(cleanLooks('x')).toEqual(DEFAULT_LOOKS)
    expect(cleanWidgets(null)).toEqual(DEFAULT_WIDGETS)
  })
  it('clamps and drops bad values', () => {
    const l = cleanLooks({ size: 'huge', radius: 99, blur: -3, accent: '#ABC', motion: { style: 'spring', speed: 9, bounce: '0.5', events: { open: { style: 'snappy', speed: 0.1 }, nope: {}, tap: { style: 'wobble' } } }, sound: { pack: 'soft', volume: { tap: 2 } }, clock: { zone: 'Not/AZone', hour12: true } })
    expect(l.size).toBe('medium')
    expect(l.radius).toBe(40)
    expect(l.blur).toBe(0)
    expect(l.accent).toBe('#aabbcc')
    expect(l.motion).toEqual({ style: 'spring', speed: 2, bounce: 0.5, events: { open: { style: 'snappy', speed: 0.5 } } })
    expect(l.sound.volume.tap).toBe(1)
    expect(l.clock).toMatchObject({ zone: null, hour12: true })
  })
  it('widgets keep known buttons once', () => {
    expect(cleanWidgets({ instant: ['water250', 'nope', 'water250', 'push25'], live: { music: false }, split: false })).toMatchObject({ instant: ['water250', 'push25'], split: false, live: { music: false, timer: true } })
  })
  it('helpers', () => {
    expect(cleanColor('red')).toBeNull()
    expect(cleanZone('Europe/Paris')).toBe('Europe/Paris')
    expect(soundGain(DEFAULT_LOOKS, 'tap')).toBe(0.7)
    expect(soundGain({ sound: { ...DEFAULT_LOOKS.sound, pack: 'soft' } }, 'done')).toBe(0.48)
    expect(soundGain({ sound: { ...DEFAULT_LOOKS.sound, pack: 'none' } }, 'done')).toBe(0)
  })
})

describe('island motion', () => {
  it('auto keeps the island feel; reduced motion is always instant', () => {
    expect(motionFor(DEFAULT_LOOKS.motion, 'open')).toBeNull()
    expect(feelPatch(DEFAULT_LOOKS.motion)).toEqual({})
    expect(motionFor(DEFAULT_LOOKS.motion, 'open', true)).toEqual(INSTANT)
    expect(motionFor({ ...DEFAULT_LOOKS.motion, style: 'spring' }, 'tap', true)).toEqual(INSTANT)
  })
  it('a moment overrides the look', () => {
    const m = { style: 'smooth' as const, speed: 1, bounce: 0.3, events: { notify: { style: 'spring' as const, bounce: 0.8 } } }
    expect(motionFor(m, 'open')).toEqual({ duration: 0.34, ease: [0.25, 0.1, 0.25, 1] })
    expect(motionFor(m, 'notify')).toMatchObject({ type: 'spring' })
    expect(Object.keys(feelPatch(m)).sort()).toEqual(['close', 'drop', 'fly', 'open', 'pop'])
  })
  it('springs: no bounce = critically damped; more bounce = less damping; faster = stiffer', () => {
    const calm = motionSpec('spring', 1, 0) as { stiffness: number; damping: number }
    expect(calm.damping).toBeCloseTo(2 * Math.sqrt(calm.stiffness), 1)
    const bouncy = motionSpec('spring', 1, 1) as { damping: number }
    expect(bouncy.damping).toBeLessThan(calm.damping)
    expect((motionSpec('spring', 2, 0) as { stiffness: number }).stiffness).toBe(calm.stiffness * 4)
    expect(motionSpec('off')).toEqual(INSTANT)
  })
  it('the default spring settles well under a second (60 fps friendly)', () => {
    expect(settleMs(motionSpec('spring', 1, 0.35))).toBeLessThan(800)
    expect(settleMs(motionSpec('snappy'))).toBeLessThan(500)
    expect(settleMs(motionSpec('smooth', 2))).toBe(170)
  })
})

describe('applying the looks (Custom Center phase 3)', () => {
  it('keeps the new values and drops bad ones', () => {
    const l = cleanLooks({ celebration: 'burst', numbers: 'segment', sound: { pack: 'arcade', files: { reminder: 'local:abc1', open: 'https://x.test/a.mp3', done: 'local:../x' } } })
    expect(l.celebration).toBe('burst')
    expect(l.numbers).toBe('segment')
    expect(l.sound.pack).toBe('arcade')
    expect(l.sound.files).toEqual({ reminder: 'local:abc1' })
  })
  it('size, corners, position and open size', () => {
    expect(pillHeight({ size: 'medium' }, 38)).toBe(38)
    expect(pillHeight({ size: 'large' }, 38)).toBeGreaterThan(38)
    expect(pillHeight({ size: 'small' }, 38)).toBeLessThan(38)
    expect(restRadius({ radius: null }, 14, 30)).toBe(14)
    expect(restRadius({ radius: 6 }, 14, 30)).toBe(6)
    expect(restRadius({ radius: 40 }, 14, 30)).toBe(15)
    expect(placementOf('top-center')).toBe('top')
    expect(placementOf('top-left')).toBe('top-left')
    expect(placementOf(null)).toBeNull()
    expect(openSizeOf({ openSize: { width: 480, height: null } }, { w: 600, h: 560 })).toEqual({ w: 480, h: 560 })
    expect(openSizeOf({ openSize: { width: 900, height: 900 } }, { w: 600, h: 560 })).toEqual({ w: 600, h: 560 })
  })
  it('celebrations', () => {
    expect(celebrationPlan('confetti').particles?.n).toBe(60)
    expect(celebrationPlan('burst')).toMatchObject({ cls: 'v2-cel-glow' })
    expect(celebrationPlan('burst').particles!.n).toBeLessThan(60)
    expect(celebrationPlan('glow')).toEqual({ particles: null, cls: 'v2-cel-glow', ms: 1200 })
    expect(celebrationPlan('none')).toEqual({ particles: null, cls: null, ms: 0 })
  })
  it('sound: the defaults change nothing; packs, volumes and your own files', () => {
    for (const n of ['tap', 'open', 'done', 'levelup', 'notify', 'error']) expect(lookGain(DEFAULT_LOOKS, n)).toBe(1)
    expect(lookGain({ sound: { ...DEFAULT_LOOKS.sound, pack: 'none' } }, 'done')).toBe(0)
    expect(lookGain({ sound: { ...DEFAULT_LOOKS.sound, volume: { ...DEFAULT_LOOKS.sound.volume, done: 0.4 } } }, 'levelup')).toBe(0.5)
    const v = [{ f: 440, len: 0.1, gain: 0.5 }, { f: 100, len: 0.2, gain: 0.5, noise: true }]
    expect(packVoices(v, 'default')).toBe(v)
    expect(packVoices(v, 'arcade')[0]).toMatchObject({ wave: 'square' })
    expect(packVoices(v, 'arcade')[1]).toBe(v[1])
    expect(packVoices(v, 'glass')[0]).toMatchObject({ wave: 'sine', f: 880 })
    const own = { sound: { ...DEFAULT_LOOKS.sound, files: { open: 'local:o1', celebrate: 'local:c1' } } }
    expect(fileFor(own, 'open')).toBe('local:o1')
    expect(fileFor(own, 'levelup')).toBe('local:c1')
    expect(fileFor(own, 'tap')).toBeNull()
    expect(soundKindOf('page')).toBe('tap')
  })
  it('the clock: 12/24 h, the date and a second zone (pinned time)', () => {
    const d = new Date(2026, 10, 13, 15, 7, 30)
    expect(clockText(d, { style: 'digital', hour12: false, seconds: false, date: false, zone: null })).toEqual({ time: '15:07', ampm: '', date: '', zone: null })
    const c12 = clockText(d, { style: 'digital', hour12: true, seconds: true, date: true, zone: 'UTC' })
    expect(c12.time).toBe('3:07')
    expect(c12.ampm).toBe('pm')
    expect(c12.date).toMatch(/13 Nov/)
    expect(c12.zone?.label).toBe('UTC')
    expect(clockAngles(new Date(2026, 10, 13, 3, 0, 0))).toEqual({ h: 90, m: 0, s: 0 })
    expect(clockAngles(new Date(2026, 10, 13, 12, 30, 15)).m).toBeCloseTo(181.5)
  })
})
