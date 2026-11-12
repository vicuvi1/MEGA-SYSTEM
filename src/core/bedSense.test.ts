import { describe, expect, it } from 'vitest'
import { bedFromAway, bedLoggedTonight, bedWatchStep, cleanBedWatch, showBedButton, showWakeButton, startBedWatch } from './bedSense'

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

describe('"Going to bed" checks you really stopped (pure)', () => {
  const L = (h: number, m: number, d = 2) => new Date(2030, 0, d, h, m)
  it('still in use more than 30 minutes after the tap: once, then the bedtime is the last use', () => {
    const w = startBedWatch(L(23, 20), '2030-01-03', '2030-01-02')
    let r = bedWatchStep(w, L(23, 21), 0)
    for (let m = 22; m <= 50; m++) r = bedWatchStep(r.watch, L(23, m), 0)
    expect(r.step.kind).toBe('none') // exactly 30 minutes: still fine
    r = bedWatchStep(r.watch, L(23, 51), 0)
    expect(r.step.kind).toBe('stillUp')
    r = bedWatchStep(r.watch, L(23, 52), 0)
    expect(r.step.kind).toBe('none') // said once
    // Left alone from 23:52: a check every minute, the idle time growing.
    for (let m = 53; m <= 59; m++) r = bedWatchStep(r.watch, L(23, m), (m - 52) * 60)
    for (let m = 0; m <= 21; m++) r = bedWatchStep(r.watch, L(0, m, 3), (m + 8) * 60)
    expect(r.step.kind).toBe('none')
    r = bedWatchStep(r.watch, L(0, 22, 3), 30 * 60)
    expect(r.step).toEqual({ kind: 'settle', time: '23:52' })
    expect(r.watch.done).toBe(true)
    expect(bedWatchStep(r.watch, L(0, 30, 3), 0).step.kind).toBe('none')
  })
  it('left alone for 30 minutes: the tap stands; a 10-minute gap in checks (PC asleep) ends it too', () => {
    const w = startBedWatch(L(23, 20), '2030-01-03', '2030-01-02')
    let r = bedWatchStep(w, L(23, 21), 60)
    for (let m = 22; m <= 50; m++) r = bedWatchStep(r.watch, L(23, m), (m - 20) * 60)
    expect(r.step.kind).toBe('end')
    expect(r.watch.log.at(-1)).toBe('The PC was left alone after that: bedtime 23:20 stands.')
    const g = bedWatchStep(bedWatchStep(w, L(23, 21), 0).watch, L(7, 0, 3), 0)
    expect(g.step.kind).toBe('end')
    expect(g.watch.stillUp).toBe(false)
  })
  it('reads only real watches back', () => {
    expect(cleanBedWatch(null)).toBe(null)
    expect(cleanBedWatch({ day: 'x' })).toBe(null)
    const w = startBedWatch(L(23, 0), '2030-01-03', '2030-01-02', '22:58')
    expect(cleanBedWatch(JSON.parse(JSON.stringify(w)))).toEqual(w)
    expect(w.log).toEqual(['22:58: you tapped "Going to bed".'])
  })
})
