// BD5 after-shift wind-down: a made-up evening job 17:00–24:00, bed target 23:30.
import { describe, expect, it } from 'vitest'
import { afterShiftAlert, afterShiftLine, afterShiftPlan, effectiveBed, shiftPhase, shutdownFor, windModeTonight } from './afterShift'
import { cleanLifeFit, setTonight } from './lifeFit'

const at = (day: string, hm: string) => new Date(`${day}T${hm}:00`).getTime()
const THU = '2026-11-05'
const FRI = '2026-11-06'
const fit = cleanLifeFit({ latestBed: '00:00', work: { on: true, days: [1, 2, 3, 4, 5], from: '17:00', to: '24:00', minH: 2, maxH: 4 } })

describe('after-shift plan', () => {
  it('a shift that ends at midnight: wind-down from 00:00, lights out 00:20', () => {
    expect(afterShiftPlan(fit, THU, '23:30')).toEqual({ start: '00:00', lightsOut: '00:20', bed: '23:30' })
    expect(effectiveBed(afterShiftPlan(fit, THU, '23:30'), '23:30')).toBe('00:20')
  })
  it('none on a day without work, with "no work tonight", or when the shift ends early in the evening', () => {
    expect(afterShiftPlan(fit, '2026-11-07', '23:30')).toBeNull() // Saturday
    expect(afterShiftPlan(setTonight(fit, THU, 'off'), THU, '23:30')).toBeNull()
    const early = cleanLifeFit({ work: { on: true, days: [4], from: '14:00', to: '18:00' } })
    expect(afterShiftPlan(early, THU, '23:30')).toBeNull()
    expect(afterShiftPlan(null, THU, '23:30')).toBeNull()
  })
  it('"short shift tonight" ends it at the short shift end (and that is a normal evening when it is early)', () => {
    const shortLate = cleanLifeFit({ work: { on: true, days: [4], from: '21:00', to: '24:00', minH: 2, maxH: 3 } })
    expect(afterShiftPlan(setTonight(shortLate, THU, 'short'), THU, '23:30')).toEqual({ start: '23:00', lightsOut: '23:20', bed: '23:30' })
    expect(afterShiftPlan(setTonight(fit, THU, 'short'), THU, '23:30')).toBeNull() // 17:00–19:00
    expect(effectiveBed({ start: '23:00', lightsOut: '23:20', bed: '23:30' }, '23:30')).toBe('23:30')
  })
})

describe('tonight, minute by minute', () => {
  const plan = afterShiftPlan(fit, THU, '23:30')
  it('in the shift: no bedtime wind-down; after it: 20 warm minutes; then past bedtime', () => {
    expect(shiftPhase(plan, at(THU, '22:00'), false)).toBeNull()
    expect(shiftPhase(plan, at(THU, '22:45'), false)).toEqual({ phase: 'shift', minutesLeft: 75 })
    expect(shiftPhase(plan, at(FRI, '00:05'), false)).toEqual({ phase: 'wind', minutesLeft: 15 })
    expect(shiftPhase(plan, at(FRI, '00:25'), false)).toBeNull()
    expect(shiftPhase(plan, at(FRI, '00:05'), true)).toBeNull()
    expect(windModeTonight(plan, at(THU, '23:10'), '23:30', false)).toBeNull()
    expect(windModeTonight(null, at(THU, '23:10'), '23:30', false)?.phase).toBe('wind')
    expect(windModeTonight(plan, at(FRI, '00:10'), '23:30', false)).toMatchObject({ phase: 'wind', minutes: 10, bedAt: '00:20' })
    expect(windModeTonight(plan, at(FRI, '00:40'), '23:30', false)).toMatchObject({ phase: 'late', minutes: 20 })
  })
  it('the card: checklist and minutes to lights out; "no new CTF tabs" first when the PC sees one', () => {
    const o = { plan, day: THU, bedLogged: false, done: ['teeth'], ctf: false, dismissed: {} }
    expect(afterShiftAlert({ ...o, now: at(THU, '23:50') })).toBeNull()
    const a = afterShiftAlert({ ...o, now: at(FRI, '00:02') })!
    expect(a.title).toBe('After the shift · lights out 00:20')
    expect(a.text).toBe('18 min: screens dim, 3 left. No new tabs.')
    expect(a.nudge).toMatchObject({ type: 'checklist', kind: 'bed', minutesLeft: 18 })
    expect(a.nudge?.type === 'checklist' && a.nudge.steps.map((s) => `${s.id}:${s.done}`)).toEqual(['teeth:true', 'skin:false', 'alarm:false', 'phone:false'])
    const c = afterShiftAlert({ ...o, now: at(FRI, '00:02'), ctf: true })!
    expect(c.title).toBe('No new CTF tabs')
    expect(afterShiftAlert({ ...o, now: at(FRI, '00:02'), ctf: true, dismissed: { [c.id]: at(FRI, '01:00') } })!.title).toContain('After the shift')
    const all = afterShiftAlert({ ...o, now: at(FRI, '00:10'), done: ['teeth', 'skin', 'alarm', 'phone'] })!
    expect(all.text).toBe('All done. Phone away, lights out.')
    expect(all.actions[0]).toMatchObject({ label: '🌙 Going to bed', primary: true })
  })
  it('the evening shutdown comes at the shift end, not in the middle of it', () => {
    const prefs = { shutdownBefore: 30, shutdown: true }
    expect(shutdownFor(plan, '23:30', prefs)).toEqual({ bed: '00:20', prefs: { shutdownBefore: 20, shutdown: true } })
    expect(shutdownFor(null, '23:30', prefs)).toEqual({ bed: '23:30', prefs })
    expect(afterShiftLine(plan)).toContain('shift ends 00:00')
    expect(afterShiftLine(null)).toBe('')
  })
})
