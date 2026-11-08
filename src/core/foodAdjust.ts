// Auto-adjust from weight (never silent): once a week the 14-day weight trend
// is checked against the goal. Lean muscle = a slow gain (0.1–0.25 kg a week).
//  - flat or falling (under +0.1 kg/week) → suggest +100 kcal
//  - gaining more than +0.25 kg/week      → suggest −100 kcal
// The change is a one-tap "Apply" card; the total stays within ±300 kcal, and a
// suggestion shows at most once a week (applied or "Not now"). Pure and tested.
import { addDays } from './dates'
import { cleanWeighIns } from './weightTrend'
import { ADJ_MAX } from './foodGoals'

export const ADJ_STEP = 100
/** Under this (kg a week) the weight counts as flat; over GAIN_MAX it is too fast. */
export const FLAT_BELOW = 0.1
export const GAIN_MAX = 0.25

export interface AdjustSuggestion {
  /** +100 or −100. */
  delta: number
  /** kg a week over the last 14 days (average of the last 7 days minus the 7 before). */
  perWeek: number
  /** The kcal adjustment after Apply. */
  after: number
  title: string
  why: string
}

export type AdjustCheck = { state: 'suggest'; suggestion: AdjustSuggestion } | { state: 'none'; why: string; perWeek: number | null }

const r2 = (n: number) => Math.round(n * 100) / 100
const avg = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length

/** The weekly check. `adj` = the kcal adjustment now, `adjAt` the day it was last answered. */
export function adjustCheck(o: { weights: { day: string; weight: number | null | undefined }[]; today: string; adj: number; adjAt: string; goal?: 'gain' | 'maintain' }): AdjustCheck {
  const goal = o.goal ?? 'gain'
  if (o.adjAt && o.adjAt > addDays(o.today, -7)) return { state: 'none', why: 'Checked this week. The next check is in a few days.', perWeek: null }
  const w = cleanWeighIns(o.weights)
  const last = w.filter((x) => x.day > addDays(o.today, -7) && x.day <= o.today)
  const prev = w.filter((x) => x.day > addDays(o.today, -14) && x.day <= addDays(o.today, -7))
  if (last.length < 2 || prev.length < 2) return { state: 'none', why: 'Weigh yourself at least twice a week for 2 weeks and this card can say if you need more or less food.', perWeek: null }
  const perWeek = r2(avg(last.map((x) => x.weight)) - avg(prev.map((x) => x.weight)))
  const kg = `${perWeek >= 0 ? '+' : '−'}${Math.abs(perWeek)} kg`
  if (goal === 'gain' && perWeek < FLAT_BELOW) {
    if (o.adj + ADJ_STEP > ADJ_MAX) return { state: 'none', why: `Your weight is flat (${kg} a week) but your goal is already ${o.adj} kcal over the plan, the most this card adds. Check sleep, training and that the logged meals are real.`, perWeek }
    return { state: 'suggest', suggestion: { delta: ADJ_STEP, perWeek, after: o.adj + ADJ_STEP, title: `Add ${ADJ_STEP} kcal a day`, why: `Your weight over the last 2 weeks is ${perWeek < 0 ? 'going down' : 'flat'} (${kg} a week). To build muscle it should rise slowly, 0.1–0.25 kg a week.` } }
  }
  if (perWeek > GAIN_MAX) {
    if (o.adj - ADJ_STEP < -ADJ_MAX) return { state: 'none', why: `Your weight is rising fast (${kg} a week) and the goal is already ${-o.adj} kcal under the plan, the most this card takes off.`, perWeek }
    return { state: 'suggest', suggestion: { delta: -ADJ_STEP, perWeek, after: o.adj - ADJ_STEP, title: `Take off ${ADJ_STEP} kcal a day`, why: `Your weight over the last 2 weeks is ${kg} a week, faster than 0.25 kg. Some of that would be fat, so ease off a little.` } }
  }
  return { state: 'none', why: `On track: ${kg} a week. No change needed.`, perWeek }
}

/** The goal's new adjustment after "Apply" (kept within ±300). */
export const applyDelta = (adj: number, delta: number) => Math.max(-ADJ_MAX, Math.min(ADJ_MAX, adj + delta))
