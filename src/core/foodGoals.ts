// Daily protein and kcal goals for SLOW MUSCLE GAIN (the owner's pick,
// 2026-11-09: he was eating far too little to grow; the old plan was "lean").
// Protein: 1.8 g per kg (editable 1.6–2.2) of the latest logged weight: the
// same number the protein ring uses (core/protein.ts proteinGoal, g/kg from
// body_plus; GAIN_GPK is set there once, see main/food.ts gainDefaultOnce).
// kcal: maintenance (Mifflin–St Jeor from weight, height, age and sex, times
// an activity factor) +350, once a weight is logged and you entered your
// height and age in Goals; until then a fixed 2,700 kcal (and 125 g protein
// with no weight). Expected gain: +0.25–0.5 kg a week. Everything is editable
// in the Goals sheet (synced setting `food_goals`). Pure and tested.
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
  /** kcal over maintenance on a training day (slow gain: 350). */
  trainSurplus: number
  /** kcal over maintenance on a rest day (slow gain: 350). */
  restSurplus: number
  /** Your own kcal goal (null: worked out). */
  kcalOwn: number | null
  /** Your own protein goal in g (null: g/kg × weight). */
  proteinOwn: number | null
  /** 1 once the protein g/kg was moved from the old 1.8 default to the lean 2.0 (once, main/food.ts). */
  leanV: number
  /** 1 once the goals were moved to slow muscle gain (once, main/food.ts gainDefaultOnce). */
  gainV: number
  /** 1 once you entered your own height and age (then kcal = maintenance + surplus, else the fixed 2,700). */
  bodySet: number
  /** kcal added by "Apply" on the weekly weight check (−600…+600), on top of everything else but your own kcal goal. */
  kcalAdj: number
  /** The day the weekly check was last answered (applied or "not now"), '' when never. */
  adjAt: string
  /** Accepted calorie changes, newest first (date, change, reason), shown in Goals. */
  adjLog: AdjLogEntry[]
  /** Your own prices in MDL per kg, by food name (the cheap protein list). */
  prices: Record<string, number>
}

export const DEFAULT_GOALS: FoodGoals = { heightCm: 178, age: 30, sex: 'm', activity: 'moderate', trainSurplus: 350, restSurplus: 350, kcalOwn: null, proteinOwn: null, leanV: 0, gainV: 0, bodySet: 0, kcalAdj: 0, adjAt: '', adjLog: [], prices: {} }
/** The plan's name in the Goals sheet. */
export const GOAL_LABEL = 'Slow muscle gain'
/** What to expect, in the Goals sheet. */
export const GAIN_TEXT = 'Expect about +0.25–0.5 kg a week.'
/** The old lean protein default in g per kg (kept for the one-time move, main/food.ts). */
export const LEAN_GPK = 2.0
/** The slow-gain protein default in g per kg (editable 1.6–2.2). */
export const GAIN_GPK = 1.8
/** The slow-gain surplus over maintenance, kcal a day. */
export const GAIN_SURPLUS = 350
/** Until a weight and your height and age are known: fixed goals. */
export const FIXED_KCAL = 2700
export const FIXED_PROTEIN = 125
/** Used for kcal until a weight is logged. */
export const FALLBACK_KG = 75

/** The most the weight check can move the kcal goal, either way. */
export const ADJ_MAX = 600
/** Fat in g per kg of body weight (lean plan; carbs are the rest of the kcal). */
export const FAT_GPK = 0.8

/** Lines kept in the calorie-change history. */
export const ADJ_LOG_MAX = 20

/** One accepted change, newest first in the goals' history. */
export interface AdjLogEntry {
  day: string
  delta: number
  /** kcalAdj after the change. */
  after: number
  reason: string
}

/** The history, cleaned: newest first, at most 20, only real lines. */
export function cleanAdjLog(raw: unknown): AdjLogEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e) => e && typeof e === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(String((e as any).day)) && Number.isFinite(Number((e as any).delta)) && Number((e as any).delta) !== 0)
    .map((e: any) => ({
      day: String(e.day),
      delta: Math.round(Math.max(-ADJ_MAX, Math.min(ADJ_MAX, Number(e.delta)))),
      after: Number.isFinite(Number(e.after)) ? Math.round(Math.max(-ADJ_MAX, Math.min(ADJ_MAX, Number(e.after)))) : 0,
      reason: String(e.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
    }))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .slice(0, ADJ_LOG_MAX)
}

/** Adds an accepted change to the history (newest first, capped). */
export const addAdjLog = (log: AdjLogEntry[], entry: AdjLogEntry): AdjLogEntry[] => cleanAdjLog([entry, ...log])

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
    gainV: o.gainV === 1 ? 1 : 0,
    bodySet: o.bodySet === 1 ? 1 : 0,
    kcalAdj: Number.isFinite(Number(o.kcalAdj)) ? Math.round(Math.max(-ADJ_MAX, Math.min(ADJ_MAX, Number(o.kcalAdj)))) : 0,
    adjAt: /^\d{4}-\d{2}-\d{2}$/.test(String(o.adjAt ?? '')) ? String(o.adjAt) : '',
    adjLog: cleanAdjLog(o.adjLog),
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
  /** kcal is the fixed 2,700 (no weight logged, or height and age not entered yet). */
  fixed: boolean
  /** How the goals were made, in one line. */
  why: string
}

export function foodTargets(weightKg: number | null | undefined, gPerKg: number, goals: FoodGoals, training = false): FoodTargets {
  const w = saneWeight(weightKg)
  const pg = proteinGoal(w, gPerKg)
  const maint = maintenance(w ?? FALLBACK_KG, goals)
  const surplus = training ? goals.trainSurplus : goals.restSurplus
  // Maintenance needs a weight and your own height and age; until then a fixed goal.
  const fixed = !w || goals.bodySet !== 1
  const kcal = goals.kcalOwn ?? (fixed ? FIXED_KCAL : maint + surplus) + goals.kcalAdj
  const protein = goals.proteinOwn ?? (w ? pg.g : FIXED_PROTEIN)
  const fat = Math.round(FAT_GPK * (w ?? FALLBACK_KG))
  const carbs = Math.max(0, Math.round((kcal - 4 * protein - 9 * fat) / 4))
  const sur = surplus >= 0 ? `+${surplus}` : String(surplus)
  const adj = goals.kcalAdj ? `, ${goals.kcalAdj > 0 ? '+' : ''}${goals.kcalAdj} from your weight check` : ''
  const kcalWhy = goals.kcalOwn
    ? `kcal: your own ${kcal}`
    : fixed
      ? `kcal: ${FIXED_KCAL.toLocaleString('en-US')} to start${adj} (${w ? 'enter your height and age' : 'log your weight and enter your height and age'} for a personal goal)`
      : `kcal: about ${maint} to stay the same, ${sur} to grow${adj}`
  const why = [goals.proteinOwn ? `Protein: your own ${protein} g` : w ? `Protein: ${pg.gPerKg} g × ${w} kg` : `Protein: ${FIXED_PROTEIN} g (log your weight for a personal goal)`, kcalWhy].join(' · ')
  return { protein, kcal, fat, carbs, maintenance: maint, weight: w, gPerKg: pg.gPerKg, training, fixed, why }
}
