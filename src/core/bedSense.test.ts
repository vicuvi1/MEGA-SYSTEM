import { describe, expect, it } from 'vitest'
import { bedFromAway, bedLoggedTonight, showBedButton, showWakeButton } from './bedSense'

const at = (s: string) => new Date(s)

describe('knowing when you went to bed', () => {
  it('a night away after an evening of use is your bedtime', () => {
    expect(bedFromAway(at('2026-11-04T00:40:00'), at('2026-11-04T08:10:00'), false)).toBe('00:40')
    expect(bedFromAway(at('2026-11-03T23:15:00'), at('2026-11-04T07:30:00'), false)).toBe('23:15')
  })
  it('not a short break, not a day out, not twice', () => {
    expect(bedFromAway(at('2026-11-03T23:15:00'), at('2026-11-04T00:30:00'), false)).toBeNull()
    expect(bedFromAway(at('2026-11-04T13:00:00'), at('2026-11-04T18:00:00'), false)).toBeNull()
    expect(bedFromAway(at('2026-11-03T23:15:00'), at('2026-11-04T07:30:00'), true)).toBeNull()
    expect(bedFromAway(at('2026-11-01T23:15:00'), at('2026-11-04T07:30:00'), false)).toBeNull()
  })
  it('the Going to bed button shows from 90 min before your target until 04:00', () => {
    expect(showBedButton(at('2026-11-04T21:40:00'), '23:00', false)).toBe(true)
    expect(showBedButton(at('2026-11-04T01:30:00'), '23:00', false)).toBe(true)
    expect(showBedButton(at('2026-11-04T20:00:00'), '23:00', false)).toBe(false)
    expect(showBedButton(at('2026-11-04T23:30:00'), '23:00', true)).toBe(false)
  })
  it("I'm up shows in the morning until it's logged", () => {
    expect(showWakeButton(at('2026-11-04T07:00:00'), false)).toBe(true)
    expect(showWakeButton(at('2026-11-04T07:00:00'), true)).toBe(false)
    expect(showWakeButton(at('2026-11-04T14:00:00'), false)).toBe(false)
  })
  it("knows last night's bedtime is logged in the morning", () => {
    expect(bedLoggedTonight([{ day: '2026-11-03', bedTime: '23:40' }], at('2026-11-04T08:00:00'))).toBe(true)
    expect(bedLoggedTonight([{ day: '2026-11-03', bedTime: '23:40' }], at('2026-11-04T22:00:00'))).toBe(false)
    expect(bedLoggedTonight([{ day: '2026-11-04', bedTime: '00:30' }], at('2026-11-04T08:00:00'))).toBe(true)
  })
})
