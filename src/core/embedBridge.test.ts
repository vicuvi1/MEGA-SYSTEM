import { describe, expect, it } from 'vitest'
import { hostCall, parseBridgeLine, parseBridgeMessage } from './embedBridge'

const me = 'https://life.example'

describe('the embedded-app bridge', () => {
  it('reads typed messages only from our own origin and only known actions', () => {
    expect(parseBridgeMessage({ type: 'LIFE_SYSTEM_BRIDGE', action: 'MAN_CHECKIN', payload: { day: 3 } }, me, me)).toEqual({ action: 'MAN_CHECKIN', payload: { day: 3 } })
    expect(parseBridgeMessage({ type: 'LIFE_SYSTEM_BRIDGE', action: 'MAN_CHECKIN' }, 'https://evil.example', me)).toBeNull()
    expect(parseBridgeMessage({ type: 'LIFE_SYSTEM_BRIDGE', action: 'DELETE_ALL' }, me, me)).toBeNull()
    expect(parseBridgeMessage('MAN_CHECKIN', me, me)).toBeNull()
    expect(parseBridgeMessage({ type: 'SPORT_WORKOUT_LOGGED', workout: { name: 'Push' } }, me, me)).toEqual({ action: 'SPORT_WORKOUT_LOGGED', payload: { workout: { name: 'Push' } } })
  })
  it('reads the desktop console lines', () => {
    expect(parseBridgeLine('LIFE_SYSTEM_BRIDGE:MAN_SET_STREAK:{"streakDays":12}')).toEqual({ action: 'MAN_SET_STREAK', payload: { streakDays: 12 } })
    expect(parseBridgeLine('LIFE_SYSTEM_BRIDGE:MAN_OATH:not json')).toEqual({ action: 'MAN_OATH', payload: {} })
    expect(parseBridgeLine('LIFE_SYSTEM_BRIDGE:RUN_CODE:{}')).toBeNull()
    expect(parseBridgeLine('hello')).toBeNull()
  })
  it('what Life System sends MAN is data, never code', () => {
    const line = hostCall({ action: 'checkin', today: "2026-11-05'); alert(1); ('", streak: 4 })
    expect(line.startsWith('window.__lifeHost ? window.__lifeHost({')).toBe(true)
    // The odd text stays inside a JSON string.
    expect(line).toContain(JSON.stringify("2026-11-05'); alert(1); ('"))
  })
})
