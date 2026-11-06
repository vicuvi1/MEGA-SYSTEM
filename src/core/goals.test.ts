import { describe, expect, it } from 'vitest'
import {
  checkinDue,
  checkinStreak,
  currentPerDay,
  etaDay,
  expectedAt,
  firstOfPeriod,
  fmtValue,
  goalCard,
  goalStatus,
  milestonesCrossed,
  milestonesOf,
  needText,
  nextMilestone,
  nextPeriodStart,
  periodKey,
  progressOf,
  requiredPerDay,
  sortCards,
  type CheckIn,
  type MeasureGoal
} from './goals'

// Made-up goals only.
const profit: MeasureGoal = {
  id: 1,
  title: 'Profit 5,000 lei a month',
  unit: 'lei',
  start: 1000,
  target: 5000,
  startDay: '2026-10-01',
  deadline: '2026-12-31',
  why: 'Pay rent without stress',
  area: 'Money',
  cadence: 'weekly',
  source: { kind: 'manual' },
  milestones: [],
  curve: 'line',
  doneDay: null
}
const weight: MeasureGoal = { ...profit, id: 2, title: 'Lose 5 kg', unit: 'kg', start: 80, target: 75, source: { kind: 'body.weight' }, curve: 'line' }
const ci = (day: string, value: number, by: CheckIn['by'] = 'me', goalId = 1): CheckIn => ({ id: `${goalId}-${day}-${value}`, goalId, at: `${day}T10:00:00.000Z`, day, value, by })

describe('pace line', () => {
  it('runs straight from the start to the target', () => {
    expect(expectedAt(profit, '2026-10-01')).toBe(1000)
    expect(expectedAt(profit, '2026-12-31')).toBe(5000)
    // 46 of 91 days
    expect(expectedAt(profit, '2026-11-16')).toBeCloseTo(1000 + 4000 * (46 / 91), 1)
  })
  it('bends for a slow start or a fast start', () => {
    const mid = '2026-11-15'
    const line = expectedAt(profit, mid)
    expect(expectedAt({ ...profit, curve: 'ramp' }, mid)).toBeLessThan(line)
    expect(expectedAt({ ...profit, curve: 'front' }, mid)).toBeGreaterThan(line)
  })
  it('works going down (weight)', () => {
    expect(expectedAt(weight, '2026-12-31')).toBe(75)
    expect(progressOf(weight, 77.5)).toBeCloseTo(0.5)
  })
})

describe('status', () => {
  const day = '2026-11-15' // about half the time
  it('ahead, on track, behind, at risk', () => {
    const e = expectedAt(profit, day)
    expect(goalStatus(profit, e + 400, day)).toBe('ahead')
    expect(goalStatus(profit, e, day)).toBe('on track')
    expect(goalStatus(profit, e - 300, day)).toBe('behind')
    expect(goalStatus(profit, e - 800, day)).toBe('at risk')
  })
  it('behind with a tenth of the time left is at risk', () => {
    const late = '2026-12-25'
    expect(goalStatus(profit, expectedAt(profit, late) - 300, late)).toBe('at risk')
  })
  it('done when reached, missed after the deadline', () => {
    expect(goalStatus(profit, 5200, day)).toBe('done')
    expect(goalStatus(profit, 3000, '2027-01-02')).toBe('missed')
    expect(goalStatus(weight, 74.8, day)).toBe('done')
  })
})

describe('what it takes and when you get there', () => {
  it('required rate per day, and in words', () => {
    expect(requiredPerDay(profit, 3000, '2026-12-01')).toBeCloseTo(2000 / 30)
    expect(requiredPerDay(weight, 78, '2026-12-01')).toBeCloseTo(-3 / 30)
    expect(requiredPerDay(profit, 5000, '2026-12-01')).toBe(0)
    expect(needText(profit, 2000 / 30, 30)).toBe('+467 lei a week')
    expect(needText(profit, 44, 10)).toBe('+44 lei/day')
    expect(needText(weight, -0.1, 30)).toBe('−0.7 kg a week')
  })
  it('current pace from the last weeks, ETA at that pace', () => {
    const list = [ci('2026-10-20', 2000), ci('2026-11-03', 2700)]
    const per = currentPerDay(profit, list, '2026-11-03')
    // the window has 2026-10-20 (14 days old)
    expect(per).toBeCloseTo(700 / 14)
    expect(etaDay(profit, 2700, per, '2026-11-03')).toBe('2026-12-19')
    expect(etaDay(profit, 2700, -5, '2026-11-03')).toBeNull()
    expect(etaDay(profit, 2700, null, '2026-11-03')).toBeNull()
  })
})

describe('milestones', () => {
  it('25/50/75% by default, yours when given', () => {
    expect(milestonesOf(profit).map((m) => m.value)).toEqual([2000, 3000, 4000])
    expect(milestonesOf({ ...profit, milestones: [{ value: 2500, label: 'Half way-ish' }, { value: 9000 }] }).map((m) => m.value)).toEqual([2500])
    expect(milestonesOf(weight).map((m) => m.value)).toEqual([78.8, 77.5, 76.3])
  })
  it('detects the ones you just passed, in order', () => {
    expect(milestonesCrossed(profit, 1800, 3100).map((m) => m.value)).toEqual([2000, 3000])
    expect(milestonesCrossed(profit, 3100, 2900)).toEqual([])
    expect(milestonesCrossed(weight, 79, 77.4).map((m) => m.value)).toEqual([78.8, 77.5])
    expect(nextMilestone(profit, 3100)).toMatchObject({ value: 4000, index: 2 })
    expect(nextMilestone(profit, 4100)).toMatchObject({ value: 5000, label: 'Goal' })
  })
})

describe('check-in rhythm', () => {
  it('period keys', () => {
    expect(periodKey('daily', '2026-11-06')).toBe('2026-11-06')
    expect(periodKey('weekly', '2026-11-06')).toBe('w2026-11-02')
    expect(periodKey('monthly', '2026-11-06')).toBe('m2026-11')
    expect(periodKey('biweekly', '2026-11-06', '2026-10-01')).toBe(periodKey('biweekly', '2026-10-30', '2026-10-01'))
    expect(periodKey('biweekly', '2026-11-10', '2026-10-01')).not.toBe(periodKey('biweekly', '2026-11-06', '2026-10-01'))
    expect(nextPeriodStart('weekly', '2026-11-06')).toBe('2026-11-09')
    expect(nextPeriodStart('monthly', '2026-12-06')).toBe('2027-01-01')
  })
  it('due once per period for manual goals, never for auto ones or on day one', () => {
    expect(checkinDue(profit, [], '2026-11-06')).toBe(true)
    expect(checkinDue(profit, [ci('2026-11-03', 2000)], '2026-11-06')).toBe(false)
    expect(checkinDue(profit, [ci('2026-11-03', 2000, 'skip')], '2026-11-06')).toBe(false)
    expect(checkinDue(profit, [ci('2026-10-30', 2000)], '2026-11-06')).toBe(true)
    expect(checkinDue(profit, [], '2026-10-01')).toBe(false)
    expect(checkinDue(weight, [], '2026-11-06')).toBe(false)
    expect(checkinDue({ ...profit, doneDay: '2026-11-01' }, [], '2026-11-06')).toBe(false)
  })
  it('first of period (what may pay) and the streak', () => {
    expect(firstOfPeriod(profit, [ci('2026-11-03', 2000)], '2026-11-06')).toBe(false)
    expect(firstOfPeriod(profit, [ci('2026-11-03', 2000, 'auto')], '2026-11-06')).toBe(true)
    const list = [ci('2026-10-14', 1500), ci('2026-10-21', 1700), ci('2026-10-28', 1900), ci('2026-11-04', 2100)]
    expect(checkinStreak(profit, list, '2026-11-06')).toBe(4)
    // this week still open: last week's streak still counts
    expect(checkinStreak(profit, list.slice(0, 3), '2026-11-06')).toBe(3)
    expect(checkinStreak(profit, [ci('2026-10-14', 1500), ci('2026-11-04', 2100)], '2026-11-06')).toBe(1)
  })
})

describe('the card', () => {
  it('puts it all together', () => {
    const c = goalCard(profit, [ci('2026-10-20', 2000), ci('2026-11-03', 2700), ci('2026-11-04', 2600, 'skip')], '2026-11-06')
    expect(c.value).toBe(2700)
    expect(c.pct).toBe(43)
    expect(c.daysLeft).toBe(55)
    expect(c.status).toBe('on track')
    expect(c.need).toMatch(/^\+\d+ lei a week$/)
    expect(c.due).toBe(false)
    expect(c.series.map((p) => p.day)).toEqual(['2026-10-01', '2026-10-20', '2026-11-03'])
    expect(c.next.value).toBe(3000)
  })
  it('sorts the ones that need you first', () => {
    const a = goalCard(profit, [ci('2026-11-03', 4000)], '2026-11-06')
    const b = goalCard({ ...profit, id: 3 }, [ci('2026-11-03', 1100, 'me', 3)], '2026-11-06')
    expect(sortCards([a, b]).map((c) => c.goal.id)).toEqual([3, 1])
  })
  it('formats units', () => {
    expect(fmtValue('lei', 3200)).toBe('3,200 lei')
    expect(fmtValue('eur', 3200)).toBe('€3,200')
    expect(fmtValue('kg', 72.46)).toBe('72.5 kg')
    expect(fmtValue('pct', 40)).toBe('40%')
    expect(fmtValue('hours', 12)).toBe('12h')
    expect(fmtValue('custom', 12, 'stars')).toBe('12 stars')
  })
})
