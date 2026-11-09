// Weight and waist → a food suggestion (never silent). Slow muscle gain aims
// at +0.25–0.5 kg a week. Once a week the WEEKLY AVERAGE weight (morning
// weigh-ins, 3–4 a week) is compared week to week:
//  - not rising (under +0.1 kg a week) for 2 weeks in a row → suggest +200 kcal
//    ("add a glass of milk and a spoon of peanut butter");
//  - rising more than 0.5 kg a week AND the waist growing → suggest −150 kcal
//    (−200 when over 0.75 kg a week): that pace is partly fat;
//  - else "on track".
// Only a suggestion: one tap "Apply" changes kcalAdj (kept within ±600),
// "Not now" waits a week. Pure and tested.
import { addDays } from './dates'
import { cleanWeighIns } from './weightTrend'
import { ADJ_MAX } from './foodGoals'

export const ADD_KCAL = 200
export const CUT_KCAL = 150
export const CUT_KCAL_FAST = 200
/** Under this (kg a week) the weight is "not rising". */
export const FLAT_BELOW = 0.1
/** Over this (kg a week) the gain is too fast, if the waist grows too. */
export const GAIN_MAX = 0.5
/** Over this the cut is the bigger one. */
export const GAIN_FAST = 0.75
/** The waist counts as growing from this many cm. */
export const WAIST_UP = 0.5
/** Weigh-ins needed in a week for its average to count. */
export const PER_WEEK = 2

export interface AdjustSuggestion {
  /** +200, −150 or −200. */
  delta: number
  /** kg a week: the last week's average minus the week before. */
  perWeek: number
  /** The kcal adjustment after Apply. */
  after: number
  title: string
  why: string
  /** One plain idea for the change. */
  tip: string
}

export type AdjustCheck = { state: 'suggest'; suggestion: AdjustSuggestion } | { state: 'none'; why: string; perWeek: number | null }

const r2 = (n: number) => Math.round(n * 100) / 100
const avg = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / xs.length
const kgText = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n)} kg`

/** The average weight of week k back (0 = the last 7 days), or null with fewer than 2 weigh-ins. */
export function weekAverage(weights: { day: string; weight: number }[], today: string, k: number): number | null {
  const to = addDays(today, -7 * k)
  const from = addDays(today, -7 * (k + 1))
  const xs = weights.filter((x) => x.day > from && x.day <= to).map((x) => x.weight)
  return xs.length >= PER_WEEK ? avg(xs) : null
}

/** cm the waist changed: the latest in the last 7 days minus the latest one 1–3 weeks before (null: not measured). */
export function waistChange(waists: { day: string; waist: number }[], today: string): number | null {
  const ok = waists.filter((w) => Number.isFinite(w.waist) && w.waist > 30 && w.waist < 250 && w.day <= today).sort((a, b) => (a.day < b.day ? -1 : 1))
  const now = ok.filter((w) => w.day > addDays(today, -7)).pop()
  const before = ok.filter((w) => w.day <= addDays(today, -7) && w.day > addDays(today, -21)).pop()
  return now && before ? Math.round((now.waist - before.waist) * 10) / 10 : null
}

/** The weekly check. `adj` = the kcal adjustment now, `adjAt` the day it was last answered. */
export function adjustCheck(o: {
  weights: { day: string; weight: number | null | undefined }[]
  waists?: { day: string; waist: number }[]
  today: string
  adj: number
  adjAt: string
  goal?: 'gain' | 'maintain'
}): AdjustCheck {
  const goal = o.goal ?? 'gain'
  if (o.adjAt && o.adjAt > addDays(o.today, -7)) return { state: 'none', why: 'Checked this week. The next check is in a few days.', perWeek: null }
  const w = cleanWeighIns(o.weights)
  const w0 = weekAverage(w, o.today, 0)
  const w1 = weekAverage(w, o.today, 1)
  const w2 = weekAverage(w, o.today, 2)
  if (w0 == null || w1 == null) return { state: 'none', why: 'Weigh yourself in the morning 3–4 times a week. After 2 weeks this card can tell you if you need more or less food.', perWeek: null }
  const perWeek = r2(w0 - w1)
  const kg = kgText(perWeek)

  // Too fast: only when the waist grows too (else it is likely muscle and water).
  if (perWeek > GAIN_MAX) {
    const waist = waistChange(o.waists ?? [], o.today)
    if (waist == null) return { state: 'none', why: `Your weight is rising fast (${kg} a week). Measure your waist this week: if it grows too, this card will suggest a little less food.`, perWeek }
    if (waist < WAIST_UP) return { state: 'none', why: `On track: ${kg} a week and your waist is steady, so it is mostly muscle and water.`, perWeek }
    const cut = perWeek > GAIN_FAST ? CUT_KCAL_FAST : CUT_KCAL
    if (o.adj - cut < -ADJ_MAX) return { state: 'none', why: `Your weight is rising fast (${kg} a week) and the goal is already ${-o.adj} kcal under the plan, the most this card takes off.`, perWeek }
    return {
      state: 'suggest',
      suggestion: { delta: -cut, perWeek, after: o.adj - cut, title: `Eat ${cut} kcal less a day`, why: `Your weight is ${kg} a week and your waist grew ${waist} cm. Over 0.5 kg a week is partly fat.`, tip: 'Drop one slice of bread and one banana, or half a container of bulgur.' }
    }
  }

  if (goal === 'gain' && perWeek < FLAT_BELOW) {
    if (w2 == null) return { state: 'none', why: `Your weight did not rise this week (${kg}). One more week of weigh-ins and this card can suggest more food.`, perWeek }
    const before = r2(w1 - w2)
    if (before >= FLAT_BELOW) return { state: 'none', why: `Your weight did not rise this week (${kg}), but it did the week before. Keep eating your standard day and check again next week.`, perWeek }
    if (o.adj + ADD_KCAL > ADJ_MAX) return { state: 'none', why: `Your weight is not rising (${kg} a week) but your goal is already ${o.adj} kcal over the plan, the most this card adds. Check that you eat the whole standard day, sleep and train.`, perWeek }
    return {
      state: 'suggest',
      suggestion: { delta: ADD_KCAL, perWeek, after: o.adj + ADD_KCAL, title: `Eat ${ADD_KCAL} kcal more a day`, why: `Your weekly average weight has not risen for 2 weeks (${kg} this week). To grow it should go up 0.25–0.5 kg a week.`, tip: 'Add a glass of milk and 1 spoon of peanut butter.' }
    }
  }
  return { state: 'none', why: `On track: ${kg} a week (the goal is +0.25–0.5 kg). No change needed.`, perWeek }
}

/** The goal's new adjustment after "Apply" (kept within ±600). */
export const applyDelta = (adj: number, delta: number) => Math.max(-ADJ_MAX, Math.min(ADJ_MAX, adj + delta))
