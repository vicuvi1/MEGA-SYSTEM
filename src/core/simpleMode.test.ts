import { describe, expect, it } from 'vitest'
import { isHidden, readSimple, simpleHiddenPages } from './simpleMode'
import { isSettingKey } from './settingsKeys'

describe('Simple mode', () => {
  it('is on by default, with the budget on and the afternoon nudge off', () => {
    expect(readSimple(null)).toEqual({ on: true, budget: true, afternoon: false })
    expect(readSimple('not json')).toEqual({ on: true, budget: true, afternoon: false })
    expect(readSimple('{"on":false}')).toEqual({ on: false, budget: true, afternoon: false })
  })

  it('hides the unused modules and the Tasks page while on', () => {
    expect(isHidden(readSimple(null), 'loot')).toBe(true)
    expect(isHidden(readSimple({ on: false }), 'loot')).toBe(false)
    expect(simpleHiddenPages(readSimple(null))).toEqual(['tasks'])
    expect(simpleHiddenPages(readSimple({ on: false }))).toEqual([])
  })

  it('is a registered setting', () => {
    expect(isSettingKey('simple_mode')).toBe(true)
  })
})
