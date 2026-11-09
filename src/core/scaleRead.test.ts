import { describe, expect, it } from 'vitest'
import { cleanMeasuredAt, scaleNum, validateScale } from './scaleRead'

const NOW = new Date('2026-11-09T09:00:00Z')

// A made-up Mi Fitness result screen, as the AI might read it.
const good = { weightKg: 71.8, bodyFatPct: 15.4, muscleKg: 57.2, waterPct: 58.9, proteinPct: 18.1, boneKg: 3.0, visceralFat: 5, bmr: 1690, bmi: 22.4, heartRate: 64, bodyScore: 86, measuredAt: '2026-11-09T07:32' }

describe('scale screenshot check', () => {
  it('a good screen: every number kept, all listed as read', () => {
    const r = validateScale(good, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.read).toMatchObject({ weightKg: 71.8, bodyFatPct: 15.4, muscleKg: 57.2, visceralFat: 5, bmr: 1690, bodyScore: 86 })
    expect(r.found).toHaveLength(11)
    expect(r.dropped).toEqual([])
    expect(r.read.measuredAt).toBe(new Date('2026-11-09T07:32').toISOString())
  })

  it('reads text numbers and JSON in chatter', () => {
    const r = validateScale('Here you go:\n```json\n{"weightKg": "72,4 kg", "bodyFatPct": "16.0%"}\n```', NOW)
    expect(r.ok && r.read.weightKg).toBe(72.4)
    expect(r.ok && r.read.bodyFatPct).toBe(16)
    expect(scaleNum('abc')).toBeNull()
  })

  it('missing fields are empty, 0 means not measured, and only the weight is needed', () => {
    const r = validateScale({ weightKg: 70.2, bodyFatPct: 0, muscleKg: null }, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.read.bodyFatPct).toBeNull()
    expect(r.read.muscleKg).toBeNull()
    expect(r.found).toEqual(['weightKg'])
    expect(validateScale({ bodyFatPct: 15 }, NOW)).toEqual({ ok: false, error: expect.stringMatching(/No weight was found/) })
    expect(validateScale('no json here', NOW).ok).toBe(false)
  })

  it('wrong ranges are dropped and listed, never stored', () => {
    const r = validateScale({ ...good, visceralFat: 99, heartRate: 400, bmr: 20 }, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.read).toMatchObject({ visceralFat: null, heartRate: null, bmr: null })
    expect(r.dropped.map((d) => d.key)).toEqual(['visceralFat', 'bmr', 'heartRate'])
    expect(r.dropped[0].why).toMatch(/Visceral fat 99 is not possible \(1–60\)/)
    const bad = validateScale({ weightKg: 900 }, NOW)
    expect(bad.ok === false && bad.error).toMatch(/did not look right/)
  })

  it('a % over 100 is dropped; muscle must be less than the weight', () => {
    const r = validateScale({ weightKg: 70, bodyFatPct: 115, waterPct: 101, proteinPct: 100, muscleKg: 75 }, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.read).toMatchObject({ bodyFatPct: null, waterPct: null, proteinPct: 100, muscleKg: null })
    expect(r.dropped.map((d) => d.key)).toEqual(['bodyFatPct', 'waterPct', 'muscleKg'])
    expect(r.found).not.toContain('muscleKg')
  })

  it('measuredAt: kept only when real, not in the future, within 60 days', () => {
    expect(cleanMeasuredAt('2026-11-09 07:32', NOW)).toBe(new Date('2026-11-09T07:32').toISOString())
    expect(cleanMeasuredAt('2026-11-10T07:32', NOW)).toBeNull()
    expect(cleanMeasuredAt('2026-01-01T07:32', NOW)).toBeNull()
    expect(cleanMeasuredAt('yesterday', NOW)).toBeNull()
    expect(cleanMeasuredAt(null, NOW)).toBeNull()
  })
})
