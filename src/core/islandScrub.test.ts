import { describe, expect, it } from 'vitest'
import { SCRUB, SCRUB_NOTCH, scrubClamp, scrubKey, scrubWheel } from './islandScrub'

const reps = SCRUB.reps
describe('scroll to change a number', () => {
  it('scrolling up counts up one step a notch, down counts down', () => {
    expect(scrubWheel(25, 0, -SCRUB_NOTCH, reps)).toEqual({ value: 26, acc: 0, changed: true })
    expect(scrubWheel(25, 0, SCRUB_NOTCH, reps).value).toBe(24)
  })
  it('one mouse notch is one step, whatever size the browser reports', () => {
    expect(scrubWheel(25, 0, -100, reps).value).toBe(26)
    expect(scrubWheel(25, 0, -16.7, reps).value).toBe(26)
    expect(scrubWheel(25, 0, 300, reps).value).toBe(24)
  })
  it('reaches 37 from 25 with twelve notches', () => {
    let v = 25
    let acc = 0
    for (let i = 0; i < 12; i++) ({ value: v, acc } = scrubWheel(v, acc, -SCRUB_NOTCH, reps))
    expect(v).toBe(37)
  })
  it('small trackpad bits add up', () => {
    let r = scrubWheel(25, 0, -10, reps)
    expect(r).toEqual({ value: 25, acc: 10, changed: false })
    for (let i = 0; i < 4; i++) r = scrubWheel(r.value, r.acc, -10, reps)
    expect(r.value).toBe(26)
    expect(r.acc).toBe(10)
    // Turning back starts again from zero.
    expect(scrubWheel(26, 30, 5, reps)).toEqual({ value: 26, acc: -5, changed: false })
  })
  it('stays in range and drops extra scroll at an end', () => {
    expect(scrubWheel(199, 0, -SCRUB_NOTCH, reps)).toEqual({ value: 200, acc: 0, changed: true })
    expect(scrubWheel(200, 0, -SCRUB_NOTCH, reps).changed).toBe(false)
    expect(scrubWheel(1, 0, SCRUB_NOTCH, reps).changed).toBe(false)
  })
  it('Shift moves five steps; water moves 50 ml a step', () => {
    expect(scrubWheel(25, 0, -SCRUB_NOTCH, reps, true).value).toBe(30)
    expect(scrubWheel(250, 0, -SCRUB_NOTCH, SCRUB.water).value).toBe(300)
  })
  it('snaps onto the step and range', () => {
    expect(scrubClamp(263, SCRUB.water)).toBe(250)
    expect(scrubClamp(9999, SCRUB.water)).toBe(1500)
    expect(scrubClamp(-4, SCRUB.focus)).toBe(5)
    expect(scrubClamp(NaN, SCRUB.focus)).toBe(25)
  })
  it('keys', () => {
    expect(scrubKey(25, 'ArrowUp', reps)).toBe(26)
    expect(scrubKey(25, 'PageDown', reps)).toBe(20)
    expect(scrubKey(25, 'End', reps)).toBe(200)
    expect(scrubKey(25, 'a', reps)).toBeNull()
  })
})
