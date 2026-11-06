import { describe, expect, it } from 'vitest'
import { eyesAlert, morningAlert, moveAlert, waterAlert, windDown, windDownAlert } from './islandBody'

const at = (s: string) => Date.parse(`2026-11-04T${s}:00`)
const base = (now: number, extra = {}) => ({ now, busy: false, idleSec: 10, activeSince: now - 80 * 60_000, water: { ml: 1000, target: 2700 }, lastWaterAt: now - 2 * 3600_000, lastMoveAt: 0, lastEyesAt: 0, eyeBreaks: false, dismissed: {}, ...extra })

describe('the island and your body', () => {
  it('water every 90 min, at the PC, 09–21, until the target', () => {
    expect(waterAlert(base(at('14:00')))?.kind).toBe('water')
    expect(waterAlert(base(at('14:00'), { lastWaterAt: at('13:00') }))).toBeNull()
    expect(waterAlert(base(at('22:00')))).toBeNull()
    expect(waterAlert(base(at('14:00'), { busy: true }))).toBeNull()
    expect(waterAlert(base(at('14:00'), { idleSec: 900 }))).toBeNull()
    expect(waterAlert(base(at('14:00'), { water: { ml: 2700, target: 2700 } }))).toBeNull()
  })
  it('a movement break after 75 min at the PC', () => {
    expect(moveAlert(base(at('14:00')))?.text).toContain('squats')
    expect(moveAlert(base(at('14:00'), { activeSince: at('13:30') }))).toBeNull()
    expect(moveAlert(base(at('14:00'), { lastMoveAt: at('13:30') }))).toBeNull()
  })
  it('eye breaks only when you turned them on', () => {
    expect(eyesAlert(base(at('14:00')))).toBeNull()
    expect(eyesAlert(base(at('14:00'), { eyeBreaks: true }))?.kind).toBe('eyes')
  })
  it('wind-down is the hour before bed, also past midnight', () => {
    expect(windDown(at('22:15'), '23:00', false)).toEqual({ bedAt: '23:00', minutesLeft: 45 })
    expect(windDown(at('21:30'), '23:00', false)).toBeNull()
    expect(windDown(at('23:50'), '00:30', false)?.minutesLeft).toBe(40)
    expect(windDown(at('22:15'), '23:00', true)).toBeNull()
    expect(windDownAlert(windDown(at('22:15'), '23:00', false), at('22:15'), {})?.actions[0].action.kind).toBe('closeDay')
  })
  it('morning launch: wake-up from your first minute at the PC, and the first block', () => {
    const a = morningAlert({ now: at('07:50'), firstActiveAt: at('07:42'), wakeLogged: false, firstBlock: { title: 'Lecture', start: at('09:45') }, dismissed: {} })
    expect(a?.text).toBe('First up: Lecture at 09:45. Up since 07:42?')
    expect(a?.actions[0].action).toEqual({ kind: 'wake', time: '07:42' })
    expect(morningAlert({ now: at('13:00'), firstActiveAt: at('12:30'), wakeLogged: false, firstBlock: null, dismissed: {} })).toBeNull()
  })
  it('wake already logged (Telegram, Waky…): no "Up at" ask, just when you got up; gone once the first block began', () => {
    const a = morningAlert({ now: at('07:50'), firstActiveAt: at('07:42'), wakeLogged: true, wakeTime: '06:36', firstBlock: { title: 'Deep block 1', start: at('08:00') }, dismissed: {} })
    expect(a?.text).toBe('Up at 06:36. First up: Deep block 1 at 08:00.')
    expect(a?.actions.some((x) => x.action.kind === 'wake')).toBe(false)
    expect(morningAlert({ now: at('08:10'), firstActiveAt: at('07:42'), wakeLogged: true, wakeTime: '06:36', firstBlock: null, blockStarted: true, dismissed: {} })).toBeNull()
  })
})
