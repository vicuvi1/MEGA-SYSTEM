// BD11 desk drill, BD12 eye care, BD15 grooming: pure parts, fixed dates and clocks.
import { describe, expect, it } from 'vitest'
import { DRILL, DRILL_SECONDS, drillAt } from './deskMobility'
import { BONES, dist, loopLength } from './sportFigure'
import { afterSunset, eyeIntervalMin, eyeTip, sunsetOf } from './eyeCare'
import { cleanGrooming, EMPTY_GROOMING, groomDay, groomDays, groomLine, groomPay, markWeekly, setPaid, stepsFor, sunnyDay, toggleStep, weeklyItems } from './grooming'
import { EMPTY_NUDGES, eyesNudge, postureNudge, tally, dayOf } from './islandNudges'

const at = (day: string, hm: string) => new Date(`${day}T${hm}:00`).getTime()
const DAY = '2026-11-05'

describe('desk drill (BD11)', () => {
  it('four moves of 15 s make one minute, in order', () => {
    expect(DRILL.map((m) => m.id)).toEqual(['chin_tuck', 'door_chest', 'hip_flexor', 'wall_angel'])
    expect(DRILL_SECONDS).toBe(60)
    expect(drillAt(0)).toMatchObject({ index: 0, left: 15, total: 60, done: false })
    expect(drillAt(16)).toMatchObject({ index: 1, left: 14, total: 44 })
    expect(drillAt(45.5)).toMatchObject({ index: 3, left: 15, total: 15 })
    expect(drillAt(61)).toMatchObject({ index: 3, done: true, total: 0 })
  })
  it('every figure keeps its limb lengths through its whole loop (the shared figure engine)', () => {
    for (const m of DRILL) {
      const total = loopLength(m.anim)
      expect(total).toBeGreaterThan(0)
      for (let i = 0; i < 24; i++) {
        const f = drillAt(DRILL.slice(0, DRILL.indexOf(m)).reduce((t, x) => t + x.seconds, 0) + (total * i) / 24).frame
        for (const arm of f.arms) {
          expect(dist(arm[0], arm[1])).toBeCloseTo(BONES.upperArm, 0)
          expect(dist(arm[1], arm[2])).toBeLessThanOrEqual(BONES.foreArm + 0.6)
        }
        for (const leg of f.legs) expect(dist(leg[0], leg[1])).toBeCloseTo(BONES.thigh, 0)
        expect(Number.isFinite(f.head[0]) && Number.isFinite(f.head[1])).toBe(true)
      }
    }
  })
  it('the posture nudge offers the drill, and a done drill counts once on your tap', () => {
    const c = { now: at(DAY, '15:00'), day: DAY, busy: false, idleSec: 5, activeSince: at(DAY, '14:00'), store: EMPTY_NUDGES(), dismissed: {}, snooze: { now: 0 } as any }
    const a = postureNudge({ ...c, drill: true })!
    expect(a.title).toBe('Desk mobility · 60 s')
    expect(a.nudge).toEqual({ type: 'drill', kind: 'posture', seconds: 60 })
    expect(postureNudge(c)!.title).toBe('Posture check')
    const s = tally(EMPTY_NUDGES(), DAY, 'drill', at(DAY, '15:01'))
    expect(dayOf(s, DAY).mobility).toBe(1)
    expect(dayOf(s, DAY).minutes).toBe(1)
    expect(dayOf(s, DAY).lastAt.posture).toBe(at(DAY, '15:01'))
  })
})

describe('eye care (BD12)', () => {
  it('more screen time today means more frequent breaks', () => {
    expect(eyeIntervalMin(null)).toBe(20)
    expect(eyeIntervalMin(120)).toBe(25)
    expect(eyeIntervalMin(240)).toBe(20)
    expect(eyeIntervalMin(400)).toBe(15)
    expect(eyeIntervalMin(600)).toBe(12)
  })
  it('the eye break follows the interval and carries its tip', () => {
    const c = { now: at(DAY, '15:00'), day: DAY, busy: false, idleSec: 5, activeSince: at(DAY, '14:30'), store: EMPTY_NUDGES(), dismissed: {}, snooze: { now: 0 } as any, eyeBreaks: true }
    // 30 min at the PC, last break 14 min ago: not yet at 15, yes at 12.
    expect(eyesNudge({ ...c, lastEyesAt: at(DAY, '14:46'), everyMin: 15 })).toBeNull()
    const tip = eyeTip({ now: c.now, n: 0, warmDone: false, sunset: '16:40', screenMin: 400 })
    const a = eyesNudge({ ...c, lastEyesAt: at(DAY, '14:46'), everyMin: 12, tip })!
    expect(a.title).toBe('Eyes · blink and look far')
    expect(a.text).toBe('10 slow, full blinks, then look 6 m away for 20 s. 6h40 on screens today.')
    expect(a.nudge).toMatchObject({ type: 'timer', kind: 'eyes', seconds: 20, tip: 'blink' })
  })
  it('a screen check every third break, the warm screen after sunset until it is on', () => {
    expect(eyeTip({ now: at(DAY, '15:00'), n: 2, warmDone: false, sunset: '16:40' }).kind).toBe('distance')
    expect(eyeTip({ now: at(DAY, '17:00'), n: 2, warmDone: false, sunset: '16:40' }).kind).toBe('warm')
    expect(eyeTip({ now: at(DAY, '17:00'), n: 4, warmDone: true, sunset: '16:40' }).kind).toBe('blink')
    expect(afterSunset(at(DAY, '01:00'), '16:40')).toBe(true)
    expect(sunsetOf(at(DAY, '12:00'))).toBe('16:40')
  })
})

describe('grooming (BD15)', () => {
  it('a morning and a night checklist; SPF only on sunny days', () => {
    expect(stepsFor(false).map((s) => s.id)).not.toContain('spf')
    expect(stepsFor(true).find((s) => s.id === 'spf')?.optional).toBe(false)
    expect(stepsFor(null).find((s) => s.id === 'spf')?.optional).toBe(true)
    const d = groomDay(EMPTY_GROOMING, DAY, true)
    expect(d.morning.map((s) => s.label)).toEqual(['Wash face', 'Moisturiser', 'SPF', 'Teeth', 'Hair / beard'])
    expect(d.night.map((s) => s.label)).toEqual(['Wash face', 'Moisturiser', 'Teeth'])
    expect(d.total).toBe(8)
    expect(groomDay(EMPTY_GROOMING, DAY, null).total).toBe(7)
  })
  it('pays once when every step is ticked, takes it back on an untick', () => {
    let g = EMPTY_GROOMING
    for (const s of stepsFor(false)) g = toggleStep(g, DAY, s.id, true)
    const d = groomDay(g, DAY, false)
    expect(d.complete).toBe(true)
    expect(d.hint).toBe('all done')
    expect(groomPay(d, null)).toBe('pay')
    g = setPaid(g, DAY, 42)
    expect(groomPay(groomDay(g, DAY, false), 42)).toBeNull()
    g = toggleStep(g, DAY, 'teeth_pm', false)
    expect(groomPay(groomDay(g, DAY, false), 42)).toBe('undo')
    expect(groomDay(g, DAY, false).hint).toBe('6 of 7')
    expect(groomDays(setPaid(g, DAY, null))).toEqual([])
    // Half done pays nothing.
    expect(groomPay(groomDay(toggleStep(EMPTY_GROOMING, DAY, 'wash_am', true), DAY, false), null)).toBeNull()
  })
  it('nails weekly, a haircut every 3–5 weeks', () => {
    let g = markWeekly(EMPTY_GROOMING, 'nails', '2026-10-27')
    g = markWeekly(g, 'haircut', '2026-10-01')
    const [nails, hair] = weeklyItems(g, DAY)
    expect(nails).toMatchObject({ state: 'due', text: '9 days ago' })
    expect(hair).toMatchObject({ state: 'due', text: '5 weeks: book one' })
    const soon = weeklyItems({ ...g, haircut: '2026-10-12', haircutWeeks: 4 }, DAY)[1]
    expect(soon).toMatchObject({ state: 'soon', text: '3 of 4 weeks · next by 11-09' })
    expect(weeklyItems({ ...g, haircut: '2026-10-29' }, DAY)[1].state).toBe('ok')
    expect(groomLine(g, DAY, false)).toBe('Grooming today: 0 of 7; due: nails, haircut.')
  })
  it('a sunny day from the weather, and clean saves', () => {
    expect(sunnyDay(null)).toBeNull()
    expect(sunnyDay({ rain: [{ from: '12:00', to: '14:00', prob: 80 }] })).toBe(false)
    expect(sunnyDay({ rain: [], cloud: 85 })).toBe(false)
    expect(sunnyDay({ rain: [] })).toBe(true)
    const g = cleanGrooming({ days: { [DAY]: ['wash_am', 'nope', 'wash_am'] }, haircutWeeks: 9, paid: { [DAY]: 'x' }, nails: 'soon' })
    expect(g).toEqual({ days: { [DAY]: ['wash_am'] }, nails: null, haircut: null, haircutWeeks: 5, paid: {} })
  })
})
