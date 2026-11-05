import { describe, expect, it } from 'vitest'
import { feelFor, flyId, ringColor, wavePath } from './islandFeel'

describe('island feel (IA3, IA6)', () => {
  it('opens snappy with a small overshoot and closes softer', () => {
    const f = feelFor('full')
    expect(f.mode).toBe('full')
    expect(f.open).toMatchObject({ type: 'spring', stiffness: 420, damping: 30 })
    // Damping ratio below 1 on open (overshoot), closer to 1 on close (softer).
    const ratio = (t: any) => t.damping / (2 * Math.sqrt(t.stiffness * (t.mass ?? 1)))
    expect(ratio(f.open)).toBeLessThan(0.8)
    expect(ratio(f.close)).toBeGreaterThan(ratio(f.open))
    expect(ratio(f.drop)).toBeLessThan(0.5)
    expect(f.moves && f.extras).toBe(true)
  })
  it('calm never bounces and has no extras', () => {
    const f = feelFor('calm')
    const ratio = (t: any) => t.damping / (2 * Math.sqrt(t.stiffness * (t.mass ?? 1)))
    for (const t of [f.open, f.close, f.drop, f.fly]) expect(ratio(t)).toBeGreaterThanOrEqual(1)
    expect(f.moves).toBe(false)
    expect(f.extras).toBe(false)
    expect(flyId(f, 'x')).toBeUndefined()
  })
  it('off is instant, and the system reduce-motion means off', () => {
    expect(feelFor('off').open).toEqual({ duration: 0 })
    expect(feelFor('full', true).mode).toBe('off')
    expect(feelFor(undefined).mode).toBe('full')
    expect(flyId(feelFor('full'), 'ic-timer')).toBe('ic-timer')
  })
})

describe('timer ring colour (IL1)', () => {
  it('is lime until the last 5 minutes, warms to amber, red when over', () => {
    expect(ringColor(10 * 60_000)).toBeNull()
    expect(ringColor(5 * 60_000)).toBe('rgb(212 255 63)')
    expect(ringColor(0)).toBe('rgb(255 181 71)')
    expect(ringColor(150_000)).toBe('rgb(234 218 67)')
    expect(ringColor(-1)).toBe('#ff5a5f')
  })
})

describe('water wave (WATER)', () => {
  it('is two periods wide and closed, so sliding by half loops', () => {
    const d = wavePath(40, 2, 7)
    expect(d.startsWith('M0 0')).toBe(true)
    expect(d.match(/Q/g)).toHaveLength(4)
    expect(d).toContain('L80 7 L0 7 Z')
    expect(d).toContain('Q10 -2 20 0')
    expect(d).toContain('Q30 2 40 0')
  })
})
