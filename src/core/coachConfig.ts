// The coach's settings (synced setting `coach_config`): the goal, the food
// ramp-up, the training rules, the morning routine and sleep. Generic
// defaults only: the owner's own numbers (food goal, standard day, split)
// come from his other settings at run time. Pure: no database here.
import { addDays } from './dates'
import { KCAL_FLOOR } from './coachSafety'

export const COACH_CONFIG = 'coach_config'
export const COACH_DAYS = 'coach_days'
export const COACH_WEEKS = 'coach_weeks'

export type CoachLang = 'en' | 'ro'
export type TrainWhen = 'morning' | 'afternoon' | 'evening'

export interface MorningStep {
  id: string
  label: string
  /** Minutes it takes (or waits); null: no time. */
  min: number | null
}

export interface CoachConfig {
  v: 1
  /** Slow gain: the weekly-average weight should rise this much (kg a week). */
  gain: { lo: number; hi: number }
  /** Meals a day (used when there is no standard day). */
  meals: number
  /** First 2 weeks: from what you used to eat toward the goal. */
  ramp: { start: string | null; baseline: number | null }
  train: { place: 'home'; maxMin: number; when: TrainWhen; reps: [number, number]; rir: [number, number] }
  morning: MorningStep[]
  sleep: { bed: string; hours: [number, number] }
  lang: CoachLang
  /** Let the AI write the day's line (a template otherwise). */
  ai: boolean
  /** The day the blood-test reminder was last dismissed. */
  bloodDismissed: string | null
  updatedAt: number
}

/** Steps that only make sense on a training day. */
export const TRAINING_STEPS = ['warmup', 'workout']

export const DEFAULT_MORNING: MorningStep[] = [
  { id: 'snack', label: 'Banana + a glass of milk', min: null },
  { id: 'wait', label: 'Wait 20–30 min', min: 25 },
  { id: 'warmup', label: 'Warm-up', min: 4 },
  { id: 'workout', label: 'Workout', min: 30 },
  { id: 'shower', label: 'Shower', min: 10 },
  { id: 'breakfast', label: 'Big breakfast: 3 eggs + bread', min: null }
]

export const DEFAULT_COACH: CoachConfig = {
  v: 1,
  gain: { lo: 0.25, hi: 0.5 },
  meals: 4,
  ramp: { start: null, baseline: null },
  train: { place: 'home', maxMin: 30, when: 'morning', reps: [6, 12], rir: [1, 3] },
  morning: DEFAULT_MORNING,
  sleep: { bed: '00:00', hours: [7.5, 8] },
  lang: 'en',
  ai: true,
  bloodDismissed: null,
  updatedAt: 0
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d
}
const day = (v: unknown): string | null => (typeof v === 'string' && DAY.test(v) ? v : null)
const txt = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const pair = (v: unknown, lo: number, hi: number, d: [number, number]): [number, number] => {
  if (!Array.isArray(v)) return d
  const a = num(v[0], lo, hi, d[0])
  const b = num(v[1], lo, hi, d[1])
  return a <= b ? [a, b] : [b, a]
}

/** A saved config made safe (anything broken falls back to the default). */
export function cleanCoach(raw: unknown): CoachConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const d = DEFAULT_COACH
  const lo = num(o.gain?.lo, 0.1, 0.75, d.gain.lo)
  const hi = num(o.gain?.hi, lo, 1, Math.max(lo, d.gain.hi))
  const morning = Array.isArray(o.morning)
    ? o.morning
        .filter((s: any) => s && typeof s.id === 'string' && txt(s.label, 60))
        .slice(0, 10)
        .map((s: any) => ({ id: txt(s.id, 24), label: txt(s.label, 60), min: s.min == null || s.min === '' ? null : num(s.min, 0, 120, 0) }))
    : d.morning
  const bed = typeof o.sleep?.bed === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.sleep.bed) ? o.sleep.bed : d.sleep.bed
  return {
    v: 1,
    gain: { lo, hi },
    meals: Math.round(num(o.meals, 3, 6, d.meals)),
    ramp: { start: day(o.ramp?.start), baseline: o.ramp?.baseline == null ? null : Math.round(num(o.ramp.baseline, 500, 5000, 1500)) },
    train: {
      place: 'home',
      maxMin: Math.round(num(o.train?.maxMin, 10, 90, d.train.maxMin)),
      when: o.train?.when === 'afternoon' || o.train?.when === 'evening' ? o.train.when : 'morning',
      reps: pair(o.train?.reps, 1, 30, d.train.reps),
      rir: pair(o.train?.rir, 0, 5, d.train.rir)
    },
    morning: morning.length ? morning : d.morning,
    sleep: { bed, hours: pair(o.sleep?.hours, 5, 11, d.sleep.hours) },
    lang: o.lang === 'ro' ? 'ro' : 'en',
    ai: o.ai !== false,
    bloodDismissed: day(o.bloodDismissed),
    updatedAt: num(o.updatedAt, 0, 1e15, 0)
  }
}

export const RAMP_WEEKS = 2

const round50 = (n: number) => Math.round(n / 50) * 50

/**
 * The kcal to aim for on a date. Week 1 of the ramp-up: the logged baseline +
 * half the gap to the goal; week 2 on: the goal. Never under the 2,200 floor.
 */
export function rampKcal(cfg: Pick<CoachConfig, 'ramp'>, goal: number, date: string): { kcal: number; week: number | null } {
  const target = Math.max(KCAL_FLOOR, Math.round(goal))
  const { start, baseline } = cfg.ramp
  if (!start || baseline == null || date < start) return { kcal: target, week: null }
  const days = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 864e5)
  const week = Math.floor(days / 7) + 1
  if (week > RAMP_WEEKS) return { kcal: target, week: null }
  if (week === 1 && baseline < target) return { kcal: Math.max(KCAL_FLOOR, round50(baseline + (target - baseline) / 2)), week }
  return { kcal: target, week }
}

/** What you usually ate: the average of logged days (kcal > 300) in the 14 days before `start`. null under 3 days. */
export function baselineFrom(perDay: { day: string; kcal: number }[], start: string): number | null {
  const from = addDays(start, -14)
  const ok = perDay.filter((p) => p.day >= from && p.day < start && p.kcal > 300)
  if (ok.length < 3) return null
  return round50(ok.reduce((t, p) => t + p.kcal, 0) / ok.length)
}

/** Weeks since the coach started (1 = the first week), null without a start. */
export function coachWeekNo(cfg: Pick<CoachConfig, 'ramp'>, date: string): number | null {
  if (!cfg.ramp.start || date < cfg.ramp.start) return null
  return Math.floor(Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${cfg.ramp.start}T12:00:00Z`)) / 864e5) / 7) + 1
}
