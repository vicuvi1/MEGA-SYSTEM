import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MIGRATIONS } from './schema'
// @ts-expect-error plain JS module without types
import { SCHEMA_VERSION } from '../../api/_schema.mjs'
import { bandOf, cleanMeasurement, compId, compView, dailyPoints, dedupeKey, firstMorning, headline, metricsFor, monthComp, monthSummaryDay, mondayOf, smoothed, waistReminder, weeklyAverages, type CompRow, type DayPoint } from './bodyComp'

// Made-up numbers only. Local times are built with new Date(y, m, d, h, min), so the tests hold in any time zone.
const NOW = new Date(2026, 10, 9, 9, 0) // Mon 9 Nov 2026, 09:00
const at = (d: number, h = 7, min = 0, m = 10) => new Date(2026, m, d, h, min).toISOString()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

const row = (d: number, w: number, extra: Partial<CompRow> = {}, h = 7, m = 10): CompRow => {
  const c = cleanMeasurement({ at: at(d, h, 0, m), weight_kg: w, ...(extra as any) }, 'manual', new Date(2026, 11, 31))
  if (!c.ok) throw new Error(c.error)
  return { ...c.row, ...extra }
}
const pt = (day: string, weight: number | null, more: Partial<DayPoint> = {}): DayPoint => ({ day, weight, fat: null, muscle: null, waist: null, ...more })

describe('checking a measurement', () => {
  it('keeps good numbers, rounds them, and fills day, id and dedupe key', () => {
    const c = cleanMeasurement({ at: at(9, 7, 12), weight_kg: '72,43', body_fat_pct: 15.2, muscle_kg: 58.1, waist_cm: 80 }, 'manual', NOW)
    expect(c.ok).toBe(true)
    if (!c.ok) return
    expect(c.row.weight_kg).toBe(72.43)
    expect(c.row.day).toBe('2026-11-09')
    expect(c.row.body_fat_pct).toBe(15.2)
    expect(c.row.water_pct).toBeNull()
    expect(c.row.dedupe).toBe(dedupeKey(at(9, 7, 12), 72.43))
    expect(c.row.id).toBe(compId(c.row.dedupe))
  })
  it('refuses numbers out of range with a plain message', () => {
    expect(cleanMeasurement({ weight_kg: 29 }, 'manual', NOW)).toMatchObject({ ok: false, error: 'Weight must be between 30 and 250 kg' })
    expect(cleanMeasurement({ weight_kg: 251 }, 'manual', NOW)).toMatchObject({ ok: false })
    expect(cleanMeasurement({ weight_kg: null }, 'manual', NOW)).toMatchObject({ ok: false, error: 'Enter your weight' })
    expect(cleanMeasurement({ weight_kg: 70, body_fat_pct: 101 }, 'manual', NOW)).toMatchObject({ ok: false, error: 'Body fat must be between 0 and 100 %' })
    expect(cleanMeasurement({ weight_kg: 70, water_pct: -3 }, 'manual', NOW)).toMatchObject({ ok: false })
    expect(cleanMeasurement({ weight_kg: 70, waist_cm: 20 }, 'manual', NOW)).toMatchObject({ ok: false, error: 'Waist must be between 40 and 200 cm' })
    expect(cleanMeasurement({ weight_kg: 70, muscle_kg: 75 }, 'manual', NOW)).toMatchObject({ ok: false, error: 'Muscle must be less than your weight' })
    expect(cleanMeasurement({ weight_kg: 70, at: new Date(NOW.getTime() + 3600_000).toISOString() }, 'manual', NOW)).toMatchObject({ ok: false, error: 'That time is in the future' })
    expect(cleanMeasurement({ weight_kg: 'abc' }, 'manual', NOW)).toMatchObject({ ok: false })
  })
  it('reads a 0 from the scale as "not measured"', () => {
    const c = cleanMeasurement({ weight_kg: 70, body_fat_pct: 0, heart_rate: 0 }, 'sync', NOW)
    expect(c.ok && c.row.body_fat_pct).toBeNull()
    expect(c.ok && c.row.heart_rate).toBeNull()
    expect(c.ok && c.row.source).toBe('sync')
  })
})

describe('dedupe key', () => {
  it('is the time to the minute plus the weight to 0.1 kg', () => {
    const a = new Date(Date.UTC(2026, 10, 9, 6, 30, 5)).toISOString()
    const b = new Date(Date.UTC(2026, 10, 9, 6, 30, 55)).toISOString()
    expect(dedupeKey(a, 72.4)).toBe('2026-11-09T06:30|72.4')
    expect(dedupeKey(a, 72.4)).toBe(dedupeKey(b, 72.43))
    expect(dedupeKey(a, 72.4)).not.toBe(dedupeKey(a, 72.5))
    expect(dedupeKey(a, 72.4)).not.toBe(dedupeKey(new Date(Date.UTC(2026, 10, 9, 6, 31)).toISOString(), 72.4))
  })
})

describe('first morning weight', () => {
  it('takes the first weigh-in between 04:00 and 12:00, else the first of the day', () => {
    const rows = [row(9, 73.1, {}, 20), row(9, 72.4, {}, 7), row(9, 72.9, {}, 10)]
    expect(firstMorning(rows, '2026-11-09')?.weight_kg).toBe(72.4)
    expect(firstMorning([row(8, 73.5, {}, 19), row(8, 73.2, {}, 15)], '2026-11-08')?.weight_kg).toBe(73.2)
    expect(firstMorning(rows, '2026-11-07')).toBeNull()
  })
})

describe('weekly averages', () => {
  const pts = [pt('2026-10-26', 71), pt('2026-10-28', 71.2), pt('2026-10-30', 71.1), pt('2026-11-02', 71.4), pt('2026-11-04', 71.5), pt('2026-11-06', 71.6), pt('2026-11-07', 71.5), pt('2026-11-09', 71.8)]
  it('averages Monday–Sunday with the count, and a week needs 3 weigh-ins', () => {
    const w = weeklyAverages(pts, '2026-11-09', 3, 'weight', { '2026-11-02': 2600, '2026-11-03': 2800, '2026-11-04': 0 })
    expect(w.map((x) => x.week)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09'])
    expect(w.map((x) => x.n)).toEqual([3, 4, 1])
    expect(w.map((x) => x.enough)).toEqual([true, true, false])
    expect(w[0].avg).toBe(71.1)
    expect(w[1].avg).toBe(71.5)
    expect(w[1].kcal).toBe(2700)
    expect(w[1].kcalDays).toBe(2)
    expect(w[2].kcal).toBeNull()
    expect(mondayOf('2026-11-08')).toBe('2026-11-02')
    expect(mondayOf('2026-11-09')).toBe('2026-11-09')
  })
  it('the headline is last week while this one has under 3 weigh-ins, with the change and band', () => {
    const h = headline(weeklyAverages(pts, '2026-11-09', 8))
    expect(h).toEqual({ avg: 71.5, which: 'last week', n: 4, delta: 0.4, band: 'in' })
  })
  it('says nothing (not enough data) with under 3 weigh-ins in both weeks', () => {
    expect(headline(weeklyAverages([pt('2026-11-02', 70), pt('2026-11-03', 70.2), pt('2026-11-09', 70.4)], '2026-11-09', 8))).toBeNull()
    const v = compView([], [{ day: '2026-11-09', weight: 70 }], {}, '2026-11-09')
    expect(v.head).toBeNull()
    expect(v.verdict).toMatch(/Not enough data yet: 1 of 3 weigh-ins this week/)
  })
})

describe('smoothing and the band', () => {
  it('7-day moving average over the days that have a value', () => {
    const s = smoothed([pt('2026-11-01', 70), pt('2026-11-03', 71), pt('2026-11-07', 72), pt('2026-11-08', 73), pt('2026-11-09', null)], 'weight')
    expect(s).toEqual([
      { day: '2026-11-01', value: 70 },
      { day: '2026-11-03', value: 70.5 },
      { day: '2026-11-07', value: 71 },
      { day: '2026-11-08', value: 72 }
    ])
  })
  it('under / in / over the +0.25 to +0.5 kg a week band', () => {
    expect(bandOf(0.1)).toBe('under')
    expect(bandOf(-0.3)).toBe('under')
    expect(bandOf(0.25)).toBe('in')
    expect(bandOf(0.5)).toBe('in')
    expect(bandOf(0.6)).toBe('over')
  })
  it('week-over-week change and the verdict line', () => {
    const rows: CompRow[] = []
    // Two full weeks: ~71.0 then ~71.7 (+0.7: over the band).
    for (const d of [26, 27, 28, 29]) rows.push(row(d, 71, {}, 7, 9))
    for (const d of [2, 3, 4, 5]) rows.push(row(d, 71.7))
    for (const d of [9]) rows.push(row(d, 71.9, {}, 7))
    const v = compView(rows, [], {}, '2026-11-09')
    expect(v.head).toMatchObject({ which: 'last week', avg: 71.7, delta: 0.7, band: 'over' })
    expect(v.thisWeek).toBe(1)
    expect(v.verdict).toMatch(/^Over the target band: \+0\.7 kg vs the week before/)
  })
})

describe('daily points', () => {
  it('one point a day from the first morning weigh-in; body_metrics-only days count too', () => {
    const rows = [row(9, 72.4, { body_fat_pct: 15, waist_cm: null } as any, 7), row(9, 73, { muscle_kg: 58, waist_cm: 81 } as any, 18)]
    const p = dailyPoints(rows, [{ day: '2026-11-08', weight: 72.1, waist: 80.5 }, { day: '2026-11-09', weight: 99, waist: null }])
    expect(p).toEqual([
      { day: '2026-11-08', weight: 72.1, fat: null, muscle: null, waist: 80.5 },
      { day: '2026-11-09', weight: 72.4, fat: 15, muscle: 58, waist: 81 }
    ])
  })
})

describe('keeping body_metrics in step', () => {
  it('fills an empty day with the first morning weight and the given waist', () => {
    const rows = [row(9, 72.4, {}, 7), row(9, 73, { waist_cm: 81 } as any, 18)]
    expect(metricsFor(rows, '2026-11-09', null)).toEqual({ weight: 72.4, waist: 81 })
  })
  it('re-picks a weight it set itself, but keeps a weight from elsewhere', () => {
    const rows = [row(9, 72.4, {}, 7), row(9, 72.9, {}, 9)]
    expect(metricsFor(rows, '2026-11-09', { weight: 72.9, waist: null })).toEqual({ weight: 72.4, waist: null })
    expect(metricsFor(rows, '2026-11-09', { weight: 71.8, waist: 80 })).toEqual({ weight: 71.8, waist: 80 })
  })
})

describe('monthly numbers', () => {
  it('smoothed fat and muscle change and average kcal over the month', () => {
    const rows = [row(28, 70, { body_fat_pct: 16, muscle_kg: 56 } as any, 7, 9), row(2, 70.5, { body_fat_pct: 16, muscle_kg: 56.4 } as any), row(25, 71, { body_fat_pct: 15.6, muscle_kg: 57 } as any), row(27, 71.2, { body_fat_pct: 15.4, muscle_kg: 57.2 } as any)]
    const m = monthComp(rows, { '2026-11-02': 2600, '2026-11-03': 2800, '2026-10-30': 3000 }, '2026-11-01', '2026-11-30')
    // Start: the 7-day average before the month (Oct 28: 16 / 56); end: Nov 27's (15.5 / 57.1).
    expect(m.fatPct).toBe(-0.5)
    expect(m.muscleKg).toBe(1.1)
    expect(m.kcalAvg).toBe(2700)
    expect(m.kcalDays).toBe(2)
    expect(monthSummaryDay('2026-12-01')).toBe(true)
    expect(monthSummaryDay('2026-12-03')).toBe(true)
    expect(monthSummaryDay('2026-12-04')).toBe(false)
  })
})

describe('waist reminder', () => {
  it('is the coming Sunday at 10:00, skipped for a week that already has a waist', () => {
    const r = waistReminder(NOW, null)
    expect(r.id).toBe('waist:2026-11-15')
    expect(new Date(r.at).getHours()).toBe(10)
    expect(new Date(r.at).getDay()).toBe(0)
    expect(waistReminder(NOW, '2026-11-10').id).toBe('waist:2026-11-22')
    expect(waistReminder(new Date(2026, 10, 15, 8, 0), null).id).toBe('waist:2026-11-15')
    expect(waistReminder(new Date(2026, 10, 15, 11, 0), null).id).toBe('waist:2026-11-22')
  })
})

describe('migration', () => {
  it('adds body_comp in a new migration and bumps the schema version', () => {
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length)
    expect(MIGRATIONS[MIGRATIONS.length - 1]).toMatch(/CREATE TABLE IF NOT EXISTS body_comp/)
    expect(MIGRATIONS[MIGRATIONS.length - 1]).toMatch(/UNIQUE INDEX IF NOT EXISTS body_comp_dedupe ON body_comp\(dedupe\)/)
  })
})
