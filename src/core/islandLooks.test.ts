import { describe, expect, it } from 'vitest'
import { cleanColor, cleanLooks, cleanWidgets, cleanZone, soundGain, DEFAULT_LOOKS, DEFAULT_WIDGETS } from './islandLooks'
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
