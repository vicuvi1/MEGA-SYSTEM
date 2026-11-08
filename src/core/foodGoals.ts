// Daily protein and kcal goals for LEAN muscle (no fat gain; the owner's pick,
// 2026-11-08). Protein: 2.0 g per kg (editable 1.6–2.2) of the latest logged
// weight: the same number the protein ring uses (core/protein.ts proteinGoal,
// g/kg from body_plus; LEAN_GPK is set there once, see main/food.ts).
// kcal: maintenance (Mifflin–St Jeor from weight, height, age and sex, times
// an activity factor) +150 on a training day, +0 on a rest day. A day is a
// training day once a workout or a set is logged that day. Everything is
// editable in the Goals sheet (synced setting `food_goals`). Pure and tested.
import { proteinGoal, saneWeight } from './protein'

export type Activity = 'low' | 'light' | 'moderate' | 'high'
export const ACTIVITY: Record<Activity, { factor: number; label: string }> = {
  low: { factor: 1.2, label: 'Low (desk, little walking)' },
  light: { factor: 1.375, label: 'Light (some walking, 1–2 workouts)' },
  moderate: { factor: 1.55, label: 'Moderate (on your feet or 3–5 workouts)' },
  high: { factor: 1.725, label: 'High (physical job and training)' }
}

export interface FoodGoals {
  heightCm: number
  age: number
  sex: 'm' | 'f'
  activity: Activity
  /** kcal over maintenance on a training day (lean: 150). */
  trainSurplus: number
  /** kcal over maintenance on a rest day (lean: 0). */
  restSurplus: number
  /** Your own kcal goal (null: worked out). */
  kcalOwn: number | null
  /** Your own protein goal in g (null: g/kg × weight). */
  proteinOwn: number | null
  /** 1 once the protein g/kg was moved from the old 1.8 default to the lean 2.0 (once, main/food.ts). */
  leanV: number
  /** kcal added by "Apply" on the weekly weight check (−300…+300), on top of everything else but your own kcal goal. */
  kcalAdj: number
  /** The day the weekly check was last answered (applied or "not now"), '' when never. */
  adjAt: string
  /** Your own prices in MDL per kg, by food name (the cheap protein list). */
  prices: Record<string, number>
}

export const DEFAULT_GOALS: FoodGoals = { heightCm: 178, age: 30, sex: 'm', activity: 'moderate', trainSurplus: 150, restSurplus: 0, kcalOwn: null, proteinOwn: null, leanV: 0, kcalAdj: 0, adjAt: '', prices: {} }
/** The plan's name in the Goals sheet. */
export const GOAL_LABEL = 'Lean muscle (no fat gain)'
/** The lean protein default in g per kg (editable 1.6–2.2). */
export const LEAN_GPK = 2.0
/** Used for kcal until a weight is logged. */
export const FALLBACK_KG = 75

/** The most the weight check can move the kcal goal, either way. */
export const ADJ_MAX = 300
/** Fat in g per kg of body weight (lean plan; carbs are the rest of the kcal). */
export const FAT_GPK = 0.8

/** Own prices: a name (lower case, ≤ 40 chars) → MDL per kg (1–3000), at most 60. */
export function cleanPrices(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40)
    const n = Number(v)
    if (key && Number.isFinite(n) && n >= 1 && n <= 3000 && Object.keys(out).length < 60) out[key] = Math.round(n * 10) / 10
  }
  return out
}

const clampInt = (v: unknown, lo: number, hi: number, def: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(Math.max(lo, Math.min(hi, n))) : def
}

export function cleanGoals(raw: any): FoodGoals {
  const o = raw && typeof raw === 'object' ? raw : {}
  const sur = (v: unknown, def: number) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Math.round(Math.max(-500, Math.min(600, Number(v)))) : def)
  const own = (v: unknown, lo: number, hi: number) => (v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) <= 0 ? null : Math.round(Math.max(lo, Math.min(hi, Number(v)))))
  return {
    heightCm: clampInt(o.heightCm, 130, 230, DEFAULT_GOALS.heightCm),
    age: clampInt(o.age, 14, 90, DEFAULT_GOALS.age),
    sex: o.sex === 'f' ? 'f' : 'm',
    activity: (Object.keys(ACTIVITY) as Activity[]).includes(o.activity) ? o.activity : DEFAULT_GOALS.activity,
    trainSurplus: sur(o.trainSurplus, DEFAULT_GOALS.trainSurplus),
    restSurplus: sur(o.restSurplus, DEFAULT_GOALS.restSurplus),
    kcalOwn: own(o.kcalOwn, 1200, 5000),
    proteinOwn: own(o.proteinOwn, 40, 350),
    leanV: o.leanV === 1 ? 1 : 0,
    kcalAdj: Number.isFinite(Number(o.kcalAdj)) ? Math.round(Math.max(-ADJ_MAX, Math.min(ADJ_MAX, Number(o.kcalAdj)))) : 0,
    adjAt: /^\d{4}-\d{2}-\d{2}$/.test(String(o.adjAt ?? '')) ? String(o.adjAt) : '',
    prices: cleanPrices(o.prices)
  }
}

/** Maintenance kcal (Mifflin–St Jeor × activity), rounded to 50. */
export function maintenance(weightKg: number, g: FoodGoals): number {
  const bmr = 10 * weightKg + 6.25 * g.heightCm - 5 * g.age + (g.sex === 'f' ? -161 : 5)
  return Math.round((bmr * ACTIVITY[g.activity].factor) / 50) * 50
}

export interface FoodTargets {
  protein: number
  kcal: number
  /** Fat (about 0.8 g/kg) and carbs (the rest of the kcal), in g. */
  fat: number
  carbs: number
  maintenance: number
  /** The weight used (null: none logged; kcal uses FALLBACK_KG). */
  weight: number | null
  gPerKg: number
  /** Today counts as a training day (kcal uses trainSurplus). */
  training: boolean
  /** How the goals were made, in one line. */
  why: string
}

export function foodTargets(weightKg: number | null | undefined, gPerKg: number, goals: FoodGoals, training = false): FoodTargets {
  const w = saneWeight(weightKg)
  const pg = proteinGoal(w, gPerKg)
  const maint = maintenance(w ?? FALLBACK_KG, goals)
  const surplus = training ? goals.trainSurplus : goals.restSurplus
  const kcal = goals.kcalOwn ?? maint + surplus + goals.kcalAdj
  const protein = goals.proteinOwn ?? pg.g
  const fat = Math.round(FAT_GPK * (w ?? FALLBACK_KG))
  const carbs = Math.max(0, Math.round((kcal - 4 * protein - 9 * fat) / 4))
  const sur = surplus >= 0 ? `+${surplus}` : String(surplus)
  const why = [
    goals.proteinOwn ? `Protein: your own ${protein} g` : w ? `Protein: ${pg.gPerKg} g × ${w} kg` : 'Protein: log your weight for a personal goal',
    goals.kcalOwn ? `kcal: your own ${kcal}` : `kcal: about ${maint} to stay the same, ${sur} on a ${training ? 'training' : 'rest'} day${goals.kcalAdj ? `, ${goals.kcalAdj > 0 ? '+' : ''}${goals.kcalAdj} from your weight check` : ''}${w ? '' : ` (until you log a weight, ${FALLBACK_KG} kg is used)`}`
  ].join(' · ')
  return { protein, kcal, fat, carbs, maintenance: maint, weight: w, gPerKg: pg.gPerKg, training, why }
}
