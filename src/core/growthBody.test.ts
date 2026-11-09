import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { corridor, growthPoints, leanChecks, loggedOnTime, monthlyRows, periodFrom, periodStats, rowsCsv, strengthIndex, trainingDays, weeklySeries, whatsMissing } from './growthBody'
import { at, compRow, fixture, iso, TODAY } from './growthFixture.test-helpers'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 9, 9, 0))
})
afterEach(() => vi.useRealTimers())

describe('on time', () => {
  it('counts a log saved on its day or the day after, not later', () => {
    expect(loggedOnTime('2026-11-01', iso('2026-11-01'))).toBe(true)
    expect(loggedOnTime('2026-11-01', iso('2026-11-02', 20))).toBe(true)
    expect(loggedOnTime('2026-11-01', iso('2026-11-03'))).toBe(false)
    expect(loggedOnTime('2026-11-01', null)).toBe(false)
    expect(loggedOnTime('2026-11-01', at('2026-11-01'))).toBe(true)
  })
  it('keeps back-dated weigh-ins out of the honest points only', () => {
    const { points, honest } = growthPoints([compRow('2026-11-01', 70), compRow('2026-10-20', 69, {}, '2026-11-01')], [{ day: '2026-10-10', weight: 68, updated_at: iso('2026-10-10') }])
    expect(points.map((p) => p.day)).toEqual(['2026-10-10', '2026-10-20', '2026-11-01'])
    expect(honest.map((p) => p.day)).toEqual(['2026-10-10', '2026-11-01'])
  })
})

describe('periods and the hero', () => {
  const g = fixture()
  it('starts a period at your first data, never before it', () => {
    expect(periodFrom(g, '4w')).toBe('2026-10-13')
    expect(periodFrom(g, '1y')).toBe('2026-07-20')
    expect(periodFrom(g, 'all')).toBe('2026-07-20')
  })
  it('shows weight, waist, lean mass, strength, unlocked moves, sessions and protein days', () => {
    const s = periodStats(g, 'all')
    expect(s.weight!.change).toBeGreaterThan(5)
    expect(s.weight!.change).toBeLessThan(6)
    expect(s.waist!.change).toBeCloseTo(0.8, 0)
    expect(s.lean).toEqual({ change: expect.any(Number), how: 'fat' })
    expect(s.lean!.change).toBeCloseTo(s.weight!.change * 0.85, 0)
    expect(s.strengthPct).toBeGreaterThan(10)
    expect(s.unlocked).toBe(1) // diamond push-ups
    expect(s.sessions).toBe(16 * 4)
    expect(s.proteinDays).toBe(112) // 150 g ≥ 1.8 g/kg up to ~83 kg
  })
  it('a 4-week period counts only its own weeks', () => {
    const s = periodStats(g, '4w')
    expect(s.sessions).toBe(16)
    expect(s.weight!.change).toBeGreaterThan(1)
    expect(s.weight!.change).toBeLessThan(1.6)
    expect(s.unlocked).toBe(0)
  })
  it('is calm with no data', () => {
    const empty = { ...fixture({ weeks: 0 }), points: [], honestPoints: [], food: [], sleep: [], sport: {} }
    const s = periodStats(empty, 'all')
    expect(s.weight).toBeNull()
    expect(s.strengthPct).toBeNull()
    expect(s.sessions).toBe(0)
  })
})

describe('weekly charts', () => {
  const g = fixture()
  it('has one point per week with averages, sessions and strength per group', () => {
    const w = weeklySeries(g, periodFrom(g, 'all'))
    expect(w).toHaveLength(17)
    expect(w[0]).toMatchObject({ week: '2026-07-20', weightN: 5, sessions: 4, protein: 150, kcal: 2900, sleepH: 7.5, fat: 15 })
    expect(w[16].strength.push).toBeGreaterThan(0)
    expect(w[16].strength.legs).toBeGreaterThan(w[0].strength.legs)
  })
  it('draws the corridor from the first full week: +0.25 to +0.5 kg a week', () => {
    const w = weeklySeries(g, periodFrom(g, 'all'))
    const c = corridor(w)
    expect(c.start!.week).toBe('2026-07-20')
    expect(c.lo[4]! - c.start!.value).toBeCloseTo(1, 5)
    expect(c.hi[4]! - c.start!.value).toBeCloseTo(2, 5)
  })
  it('training days leave Telegram-imported day totals out', () => {
    const t = trainingDays({ reps: [], sport: { days: { '2026-11-01': { e1: 20 }, '2026-11-02': { e1: 30 } }, imported: { '2026-11-02': ['e1'] } } })
    expect(t).toEqual([{ day: '2026-11-01', onTime: false }])
  })
})

describe('lean gain check', () => {
  it('says growing lean when weight is up, waist flat and strength up', () => {
    const c = leanChecks(fixture())
    expect(c[0]).toMatchObject({ month: '2026-07', kind: 'first' })
    const sep = c.find((x) => x.month === '2026-09')!
    expect(sep.kind).toBe('lean')
    expect(sep.text).toMatch(/^Growing lean ✅ Weight \+1\.\d kg, waist \+0\.\d cm, strength \+\d+%\.$/)
  })
  it('says slow down when the waist rises faster than the weight', () => {
    const c = leanChecks(fixture({ gainPerWeek: 0.3, waistPerWeek: 0.6 }))
    const sep = c.find((x) => x.month === '2026-09')!
    expect(sep.kind).toBe('slow')
    expect(sep.text).toMatch(/slow down the surplus/)
  })
  it('says eat more when the weight is flat', () => {
    const c = leanChecks(fixture({ gainPerWeek: 0, waistPerWeek: 0 }))
    expect(c.find((x) => x.month === '2026-10')!.kind).toBe('eat')
  })
})

describe('monthly rows and CSV', () => {
  it('one row per month with the level at its end, as CSV', () => {
    const g = fixture()
    const rows = monthlyRows(g, (d) => (d >= '2026-09-30' ? 'Builder' : 'Seedling'), strengthIndex(g.sport.sets, g.sport.exercises))
    expect(rows.map((r) => r.month)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11'])
    expect(rows[2]).toMatchObject({ sessions: 17, proteinDays: 30, level: 'Builder' })
    expect(rows[0].level).toBe('Seedling')
    const csv = rowsCsv(rows).split('\n')
    expect(csv[0]).toBe('month,weight_kg,waist_cm,strength_pct,sessions,protein_goal_days,growth_level')
    expect(csv).toHaveLength(6)
    expect(csv[3]).toMatch(/^2026-09,\d+\.\d,\d+\.\d,\d+,17,30,Builder$/)
  })
})

describe("what's missing", () => {
  it('asks for weigh-ins, a waist, a photo, food and sleep only when missing', () => {
    const g = fixture()
    const m = whatsMissing(g).map((x) => x.id)
    // Monday: one weigh-in so far this week.
    expect(m).toContain('weigh')
    expect(whatsMissing(g).find((x) => x.id === 'weigh')!.text).toBe('Log weight 2 more times this week for an accurate trend.')
    expect(m).toContain('photo')
    expect(m).not.toContain('waist')
    expect(m).not.toContain('food')
    expect(m).not.toContain('sleep')
    expect(whatsMissing({ ...g, lastPhotoDay: '2026-11-01' }).map((x) => x.id)).not.toContain('photo')
    expect(TODAY).toBe('2026-11-09')
  })
})
