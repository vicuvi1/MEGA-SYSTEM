import { describe, expect, it } from 'vitest'
import { isHidden, readSimple } from './simpleMode'
import { isSettingKey } from './settingsKeys'

describe('Simple mode', () => {
  it('is on by default, with the budget on and the afternoon nudge off', () => {
    expect(readSimple(null)).toEqual({ on: true, budget: true, afternoon: false })
    expect(readSimple('not json')).toEqual({ on: true, budget: true, afternoon: false })
    expect(readSimple('{"on":false}')).toEqual({ on: false, budget: true, afternoon: false })
  })

  it('an old setting with Archive pages still reads (the module switch replaced the Archive)', () => {
    expect(readSimple({ on: true, shown: ['sleep'] })).toEqual({ on: true, budget: true, afternoon: false })
  })

  it('hides the unused game parts while on', () => {
    expect(isHidden(readSimple(null), 'loot')).toBe(true)
    expect(isHidden(readSimple({ on: false }), 'loot')).toBe(false)
  })

  it('is a registered setting', () => {
    expect(isSettingKey('simple_mode')).toBe(true)
  })
})
