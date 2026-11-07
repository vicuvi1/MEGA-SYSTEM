// BD4 morning light and caffeine curfew, BD6 sleep debt: made-up days, local clock times.
import { describe, expect, it } from 'vitest'
import { addCoffee, caffeineAlert, caffeineCurfew, caffeineView, cleanCare, coffeeReply, debtAdvice, debtLine, DEFAULT_CARE, lightCard, lightMinutes, markLight, parseCoffee, setCarePrefs, sleepDebt, toggleShiftStep, undoCoffee } from './sleepCare'

const at = (day: string, hm: string) => new Date(`${day}T${hm}:00`).getTime()
const DAY = '2026-11-05' // a Thursday

describe('morning light (BD4)', () => {
  const base = { day: DAY, wakeTime: '06:35', wakeTarget: '06:30', done: false, dismissed: {} }
  it('asks after the wake-up for 3 hours, then stops', () => {
    expect(lightCard({ ...base, now: at(DAY, '06:20') })).toBeNull()
    const a = lightCard({ ...base, now: at(DAY, '06:50') })!
    expect(a.title).toBe('Morning light · 10 min outside')
    expect(a.actions[0].action).toEqual({ kind: 'care', op: { op: 'light' }, alertId: `light:${DAY}` })
    expect(lightCard({ ...base, now: at(DAY, '09:40') })).toBeNull()
  })
  it('waits for sunrise when it comes after the wake-up', () => {
    const w = { rain: [], sunrise: '07:10' }
    expect(lightCard({ ...base, now: at(DAY, '06:50'), weather: w })).toBeNull()
    expect(lightCard({ ...base, now: at(DAY, '07:15'), weather: w })).not.toBeNull()
  })
  it('never once you said you got it, or while snoozed', () => {
    expect(lightCard({ ...base, now: at(DAY, '07:00'), done: true })).toBeNull()
    expect(lightCard({ ...base, now: at(DAY, '07:00'), dismissed: { [`light:${DAY}`]: at(DAY, '07:30') } })).toBeNull()
  })
  it('asks for longer on a cloudy or rainy morning', () => {
    expect(lightMinutes(null).min).toBe(10)
    expect(lightMinutes({ rain: [], sunrise: null, cloud: 60 })).toEqual({ min: 15, why: 'cloudy' })
    expect(lightMinutes({ rain: [], sunrise: null, cloud: 90 })).toEqual({ min: 20, why: 'overcast' })
    expect(lightMinutes({ rain: [{ from: '08:00', to: '10:00', prob: 70 }], sunrise: null })).toEqual({ min: 20, why: 'rainy morning' })
    expect(lightMinutes({ rain: [{ from: '18:00', to: '19:00', prob: 90 }], sunrise: null }).min).toBe(10)
    expect(lightCard({ ...base, now: at(DAY, '07:00'), weather: { rain: [], sunrise: '06:40', cloud: 85 } })!.title).toContain('20 min')
  })
  it('marks it done in the day', () => {
    const c = markLight(DEFAULT_CARE, DAY, 123)
    expect(c.days[DAY].light).toBe(123)
  })
})

describe('caffeine curfew (BD4)', () => {
  it('is 9.5 h before bed by default (23:30 → 14:00), 8–10 h when you change it', () => {
    expect(caffeineCurfew('23:30')).toBe('14:00')
    expect(caffeineCurfew('23:30', 8)).toBe('15:30')
    expect(caffeineCurfew('00:00', 10)).toBe('14:00')
    expect(setCarePrefs(DEFAULT_CARE, { curfewH: 12 }).curfewH).toBe(10)
    expect(setCarePrefs(DEFAULT_CARE, { needH: 7.4 }).needH).toBe(7.5)
  })
  it('reads a coffee message, and leaves everything else alone', () => {
    expect(parseCoffee('coffee')).toBe(1)
    expect(parseCoffee('Had a coffee')).toBe(1)
    expect(parseCoffee('2 coffees')).toBe(2)
    expect(parseCoffee('just had an espresso')).toBe(1)
    expect(parseCoffee('☕☕')).toBe(2)
    expect(parseCoffee('o cafea')).toBe(1)
    expect(parseCoffee('кофе')).toBe(1)
    expect(parseCoffee('no coffee today')).toBeNull()
    expect(parseCoffee('coffee with Ana at 5?')).toBeNull()
    expect(parseCoffee('decaf coffee')).toBeNull()
    expect(parseCoffee('coffee 45')).toBeNull()
  })
  it('counts cups and late cups, and says so plainly', () => {
    let c = addCoffee(DEFAULT_CARE, DAY, at(DAY, '08:10'))
    let v = caffeineView(c, DAY, at(DAY, '09:00'), '23:30')
    expect(v).toMatchObject({ curfew: '14:00', cups: 1, last: '08:10', late: 0, left: 300 })
    expect(coffeeReply(v, '23:30')).toBe('☕ Logged (first today). Last caffeine by 14:00 (bed 23:30).')
    c = addCoffee(c, DAY, at(DAY, '15:20'))
    v = caffeineView(c, DAY, at(DAY, '15:21'), '23:30')
    expect(v.late).toBe(1)
    expect(v.left).toBe(-81)
    expect(coffeeReply(v, '23:30')).toContain('after your 14:00 curfew')
    expect(caffeineView(undoCoffee(c, DAY), DAY, at(DAY, '15:22'), '23:30').cups).toBe(1)
  })
  it('warns softly: right after a late cup, or once at the curfew on a coffee day', () => {
    const one = addCoffee(DEFAULT_CARE, DAY, at(DAY, '08:10'))
    expect(caffeineAlert({ now: at(DAY, '13:30'), day: DAY, care: one, bed: '23:30', dismissed: {} })).toBeNull()
    const a = caffeineAlert({ now: at(DAY, '14:05'), day: DAY, care: one, bed: '23:30', dismissed: {} })!
    expect(a.id).toBe(`caffeine:curfew:${DAY}`)
    expect(a.title).toBe('Caffeine curfew · 14:00')
    expect(caffeineAlert({ now: at(DAY, '15:00'), day: DAY, care: one, bed: '23:30', dismissed: {} })).toBeNull()
    // No coffee today: nothing to say.
    expect(caffeineAlert({ now: at(DAY, '14:05'), day: DAY, care: DEFAULT_CARE, bed: '23:30', dismissed: {} })).toBeNull()
    const late = addCoffee(one, DAY, at(DAY, '16:00'))
    expect(caffeineAlert({ now: at(DAY, '16:05'), day: DAY, care: late, bed: '23:30', dismissed: {} })!.title).toBe('That coffee is after your curfew')
    expect(caffeineAlert({ now: at(DAY, '16:30'), day: DAY, care: late, bed: '23:30', dismissed: {} })).toBeNull()
  })
  it('cleans what was saved', () => {
    const c = cleanCare({ needH: 'x', days: { [DAY]: { coffee: [1, 'a', 2], shift: ['teeth', 3, 'teeth'] }, bad: {} } })
    expect(c.needH).toBe(8)
    expect(c.days[DAY]).toEqual({ coffee: [1, 2], shift: ['teeth'] })
    expect(Object.keys(c.days)).toEqual([DAY])
    expect(toggleShiftStep(c, DAY, 'alarm', true).days[DAY].shift).toEqual(['teeth', 'alarm'])
    expect(toggleShiftStep(c, DAY, 'teeth', false).days[DAY].shift).toEqual([])
  })
})

describe('sleep debt (BD6)', () => {
  const night = (day: string, bedTime: string | null, wakeTime: string) => ({ day, bedTime, wakeTime })
  const logs = [
    night('2026-10-30', '23:00', '06:30'), // outside the 7 nights
    night('2026-10-31', '23:30', '07:30'), // 8h
    night('2026-11-01', '00:30', '06:30'), // 6h
    night('2026-11-02', '23:45', '06:30'), // 6h45
    night('2026-11-03', null, '06:30'), // not logged
    night('2026-11-04', '01:00', '06:30'), // 5h30
    night('2026-11-05', '23:30', '06:30') // 7h
  ]
  it('adds up the last 7 nights against the need, skipping nights without a bedtime', () => {
    const d = sleepDebt(logs, DAY, 8)
    expect(d.nights.map((n) => n.day)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'])
    expect(d.logged).toBe(6)
    // 0.5 + 0 + 2 + 1.25 + 2.5 + 1 = 7h15 behind
    expect(d.debtMin).toBe(435)
    expect(d.level).toBe('high')
    expect(sleepDebt(logs, DAY, 7).debtMin).toBe(75)
  })
  it('a long sleep pays it back, never below zero', () => {
    const d = sleepDebt([night(DAY, '22:00', '08:00')], DAY, 8)
    expect(d.debtMin).toBe(0)
    expect(d.level).toBe('ok')
  })
  it('suggests one nap before 15:00 and an earlier night on the next free evening', () => {
    const d = sleepDebt(logs, DAY, 8)
    const free = (day: string) => day === '2026-11-07' // Saturday: no shift
    const a = debtAdvice(d, { now: at(DAY, '11:00'), today: DAY, bed: '23:30', free })
    expect(a.napOk).toBe(true)
    expect(a.nap).toContain('20-minute nap before 15:00')
    expect(a.early).toEqual({ day: '2026-11-07', label: 'Saturday', bed: '22:30', minutes: 60 })
    expect(a.line).toBe('7h 15 behind over the last 6 nights. Bed at 22:30 on Saturday (60 min earlier).')
    const late = debtAdvice(d, { now: at(DAY, '16:00'), today: DAY, bed: '23:30', free: () => true })
    expect(late.napOk).toBe(false)
    expect(late.nap).toContain('Too late for a nap')
    expect(late.early?.label).toBe('tonight')
    expect(debtLine(d, a)).toContain('Suggest bed at 22:30 on Saturday')
  })
  it('says nothing to fix when on track', () => {
    const d = sleepDebt([night(DAY, '22:30', '06:30')], DAY, 8)
    const a = debtAdvice(d, { now: at(DAY, '11:00'), today: DAY, bed: '23:30', free: () => true })
    expect(a.nap).toBeNull()
    expect(debtLine(d, a)).toContain("Don't bring it up")
    expect(debtLine(sleepDebt([], DAY), a)).toBe('')
  })
})
