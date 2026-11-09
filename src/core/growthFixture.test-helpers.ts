// Made-up growth data for the growth tests (no real person's numbers).
import { addDays } from './dates'
import type { CompRow } from './bodyComp'
import { growthPoints, type GrowthInput } from './growthBody'

export const TODAY = '2026-11-09' // a Monday
export const START = '2026-07-20' // a Monday, 16 weeks back

/** Local noon on a day, as ms (so the tests hold in any time zone). */
export const at = (day: string, h = 12) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), h).getTime()
export const iso = (day: string, h = 12) => new Date(at(day, h)).toISOString()

export function compRow(day: string, weight: number, extra: Partial<CompRow> = {}, savedDay = day): CompRow {
  return {
    id: `bc_${day}_${weight}`,
    at: iso(day, 7),
    day,
    weight_kg: weight,
    body_fat_pct: null,
    muscle_kg: null,
    water_pct: null,
    protein_pct: null,
    bone_kg: null,
    visceral_fat: null,
    bmr: null,
    bmi: null,
    heart_rate: null,
    body_score: null,
    waist_cm: null,
    source: 'manual',
    raw: null,
    dedupe: `${day}|${weight}`,
    updated_at: iso(savedDay, 8),
    ...extra
  } as CompRow
}

export interface FixtureOpts {
  weeks?: number
  gainPerWeek?: number
  waistPerWeek?: number
  /** Save every row this many days late (0 = on time). */
  late?: number
}

/**
 * 16 weeks: weigh-ins Mon/Wed/Fri/Sat (+0.35 kg a week from 68 kg), waist on
 * Sundays (+0.05 cm a week from 78), body fat 15 %, push-ups and squats on
 * Tue/Thu/Sat/Sun with reps going up and diamond push-ups from week 9,
 * 150 g protein every day, 7.5 h sleep, the default split (5 sessions a week).
 */
export function fixture(o: FixtureOpts = {}): GrowthInput {
  const weeks = o.weeks ?? 16
  const gain = o.gainPerWeek ?? 0.35
  const wpw = o.waistPerWeek ?? 0.05
  const late = o.late ?? 0
  const rows: CompRow[] = []
  const sets: Record<string, Record<string, any[]>> = {}
  const food: GrowthInput['food'] = []
  const sleep: GrowthInput['sleep'] = []
  const from = addDays(TODAY, -7 * weeks)
  for (let d = from, i = 0; d <= TODAY; d = addDays(d, 1), i++) {
    const wk = i / 7
    const dow = i % 7 // 0 = Monday (from is a Monday)
    const saved = addDays(d, late)
    if ([0, 2, 4, 5].includes(dow)) rows.push(compRow(d, Math.round((68 + gain * wk) * 10) / 10, { body_fat_pct: 15 }, saved))
    if (dow === 6) rows.push(compRow(d, Math.round((68 + gain * wk) * 10) / 10, { waist_cm: Math.round((78 + wpw * wk) * 10) / 10, body_fat_pct: 15 }, saved))
    if ([1, 3, 5, 6].includes(dow) && d < TODAY) {
      const reps = 10 + Math.floor(wk)
      const push = wk >= 9 ? 'e3' : 'e1'
      sets[d] = {
        [push]: [{ reps: wk >= 9 ? 6 + Math.floor(wk - 9) : reps, at: at(saved, 18) }],
        e2: [{ reps: 15 + Math.floor(wk), at: at(saved, 18) }]
      }
    }
    if (d < TODAY) food.push({ day: d, kcal: 2900, protein: 150, proteinOnTime: late ? 0 : 150 })
    if (d <= TODAY) sleep.push({ day: d, minutes: 450, onTime: !late })
  }
  const { points, honest } = growthPoints(rows, [])
  return {
    today: TODAY,
    points,
    honestPoints: honest,
    food,
    reps: [],
    sleep,
    gPerKg: 1.8,
    kcalGoal: 2900,
    sport: {
      exercises: [
        { id: 'e1', name: 'Push-ups', target: 50, move: 'pushup' },
        { id: 'e2', name: 'Squats', target: 50, move: 'squat' },
        { id: 'e3', name: 'Diamond push-ups', target: 30, move: 'diamond_pushup' }
      ],
      sets
    },
    lastPhotoDay: null
  }
}
