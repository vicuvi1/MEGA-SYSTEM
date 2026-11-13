import { describe, expect, it } from 'vitest'
import { isHidden, readSimple } from './simpleMode'
import { isSettingKey } from './settingsKeys'

describe('Simple mode', () => {
  it('is on by default, with the budget on and the afternoon nudge off', () => {
    expect(readSimple(null)).toEqual({ on: true, budget: true, afternoon: false, coins: false })
    expect(readSimple('not json')).toEqual({ on: true, budget: true, afternoon: false, coins: false })
    expect(readSimple('{"on":false}')).toEqual({ on: false, budget: true, afternoon: false, coins: false })
  })

  it('an old setting with Archive pages still reads (the module switch replaced the Archive)', () => {
    expect(readSimple({ on: true, shown: ['sleep'] })).toEqual({ on: true, budget: true, afternoon: false, coins: false })
  })

  it('hides the unused game parts while on', () => {
    expect(isHidden(readSimple(null), 'loot')).toBe(true)
    expect(isHidden(readSimple({ on: false }), 'loot')).toBe(false)
  })

  it('is a registered setting', () => {
    expect(isSettingKey('simple_mode')).toBe(true)
  })
})

describe('Show coins and rewards', () => {
  it('is off by default and only an explicit true turns it on', () => {
    expect(readSimple(null).coins).toBe(false)
    expect(readSimple('{"coins":"yes"}').coins).toBe(false)
    expect(readSimple({ coins: true }).coins).toBe(true)
    expect(readSimple({ on: false, coins: true })).toMatchObject({ on: false, coins: true })
  })
})
