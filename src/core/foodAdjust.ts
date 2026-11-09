// The ONE calorie suggestion (food and body agree). Pure and tested.
//
// Slow muscle gain aims at +0.25 to +0.5 kg a week (TARGET_BAND, the same band
// Progress draws). The numbers are WEEKLY AVERAGES (Monday–Sunday) of the
// day's first morning weigh-in, from body_comp with body_metrics as fallback
// (core/bodyComp.ts dailyPoints / weeklyAverages). A week counts from 3
// weigh-ins; with fewer the card says "Not enough data yet".
//  - gain under 0.1 kg a week for 2 weeks in a row → suggest +200 kcal
//    ("add a glass of milk + 1 spoon of peanut butter");
//  - gain over 0.6 kg a week AND the waist up more than 1 cm in 2 weeks →
//    suggest −150 kcal (−200 over 0.8 kg a week);
//  - else "On track 👍".
// Only a suggestion: one tap Accept changes kcalAdj (kept within ±600) and
// adds a line to the history (date, change, reason); "Not now" waits a week.
import { addDays } from './dates'
import { MIN_WEEK, TARGET_BAND, weeklyAverages, type DayPoint, type WeekRow } from './bodyComp'
import { ADJ_MAX, cleanAdjLog, addAdjLog, ADJ_LOG_MAX, type AdjLogEntry } from './foodGoals'

export { cleanAdjLog, addAdjLog, ADJ_LOG_MAX, type AdjLogEntry }

export const ADD_KCAL = 200
export const CUT_KCAL = 150
export const CUT_KCAL_FAST = 200
/** Under this (kg a week) the weight is "not rising". */
export const FLAT_BELOW = 0.1
/** Over this (kg a week) the gain is too fast, if the waist grows too. */
export const GAIN_MAX = 0.6
/** Over this the cut is the bigger one. */
export const GAIN_FAST = 0.8
/** The waist counts as growing above this many cm in 2 weeks. */
export const WAIST_UP = 1
/** Days to wait after an answer (Accept or Not now). */
export const WAIT_DAYS = 7

export const BAND_TEXT = `+${TARGET_BAND.lo}–${TARGET_BAND.hi} kg a week`

export interface AdjustSuggestion {
  /** +200, −150 or −200. */
  delta: number
  /** kg a week: the latest full week's average minus the week before. */
  perWeek: number
  /** The kcal adjustment after Accept. */
  after: number
  title: string
  why: string
  /** One plain idea for the change. */
  tip: string
  /** The short reason kept in the history ("Weight flat for 2 weeks"). */
  reason: string
}

export type AdjustKind = 'nodata' | 'ontrack' | 'wait' | 'checked' | 'waist' | 'limit'

export type AdjustCheck =
  | { state: 'suggest'; suggestion: AdjustSuggestion; title: string; why: string; perWeek: number }
  | { state: 'none'; kind: AdjustKind; title: string; why: string; perWeek: number | null }

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const kgText = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(r2(n))} kg`

/**
 * The waist change in cm over about 2 weeks: the latest waist up to `refDay`
 * (in its last 7 days) minus the latest one 10–21 days before that. null when
 * either is missing.
 */
export function waistChange(points: { day: string; waist: number | null }[], refDay: string): number | null {
  const ok = points.filter((p) => p.waist != null && Number.isFinite(p.waist) && p.waist >= 40 && p.waist <= 200 && p.day <= refDay).sort((a, b) => (a.day < b.day ? -1 : 1))
  const now = ok.filter((p) => p.day > addDays(refDay, -7)).pop()
  if (!now) return null
  const before = ok.filter((p) => p.day <= addDays(now.day, -10) && p.day >= addDays(now.day, -21)).pop()
  return before ? r1((now.waist as number) - (before.waist as number)) : null
}

/** The three weeks the check uses: the latest full week (this one once it has 3 weigh-ins, else last week) and the two before. */
export function checkWeeks(points: DayPoint[], today: string): { w0: WeekRow; w1: WeekRow; w2: WeekRow; thisWeek: WeekRow } {
  const weeks = weeklyAverages(points, today, 4)
  const thisWeek = weeks[3]
  const i = thisWeek.enough ? 3 : 2
  return { w0: weeks[i], w1: weeks[i - 1], w2: weeks[Math.max(0, i - 2)], thisWeek }
}

/** The weekly check. `adj` = the kcal adjustment now, `adjAt` the day it was last answered. */
export function adjustCheck(o: { points: DayPoint[]; today: string; adj: number; adjAt: string; goal?: 'gain' | 'maintain' }): AdjustCheck {
  const goal = o.goal ?? 'gain'
  const none = (kind: AdjustKind, title: string, why: string, perWeek: number | null = null): AdjustCheck => ({ state: 'none', kind, title, why, perWeek })
  if (o.adjAt && o.adjAt > addDays(o.today, -WAIT_DAYS)) return none('checked', 'Checked this week', `The next check is on ${addDays(o.adjAt, WAIT_DAYS)}.`)
  const { w0, w1, w2, thisWeek } = checkWeeks(o.points, o.today)
  if (!w0.enough || !w1.enough || w0.avg == null || w1.avg == null)
    return none('nodata', 'Not enough data yet', `Weigh in ${MIN_WEEK}+ mornings a week (this week: ${Math.min(thisWeek.n, MIN_WEEK)} of ${MIN_WEEK}). After 2 full weeks this card can tell you if you need more or less food.`)
  const perWeek = r2(w0.avg - w1.avg)
  const kg = kgText(perWeek)

  // Too fast: only when the waist grows too (else it is likely muscle and water).
  if (perWeek > GAIN_MAX) {
    const waist = waistChange(o.points, addDays(w0.week, 6) < o.today ? addDays(w0.week, 6) : o.today)
    if (waist == null) return none('waist', 'Measure your waist', `Your weight is rising fast (${kg} a week). Measure your waist this week: if it grows more than ${WAIST_UP} cm in 2 weeks, this card will suggest a little less food.`, perWeek)
    if (waist <= WAIST_UP) return none('ontrack', 'On track 👍', `${kg} a week and your waist is steady (${waist >= 0 ? '+' : '−'}${Math.abs(waist)} cm), so it is mostly muscle and water.`, perWeek)
    const cut = perWeek > GAIN_FAST ? CUT_KCAL_FAST : CUT_KCAL
    if (o.adj - cut < -ADJ_MAX) return none('limit', 'On the lowest goal', `Your weight is rising fast (${kg} a week) and the goal is already ${-o.adj} kcal under the plan, the most this card takes off.`, perWeek)
    const suggestion: AdjustSuggestion = {
      delta: -cut,
      perWeek,
      after: o.adj - cut,
      title: `Eat ${cut} kcal less a day`,
      why: `Your weekly average is ${kg} a week and your waist grew ${waist} cm in 2 weeks. Over ${GAIN_MAX} kg a week is partly fat.`,
      tip: 'Drop one slice of bread and one banana, or half a container of bulgur.',
      reason: `Gaining ${kg} a week, waist +${waist} cm`
    }
    return { state: 'suggest', suggestion, title: suggestion.title, why: suggestion.why, perWeek }
  }

  if (goal === 'gain' && perWeek < FLAT_BELOW) {
    if (!w2.enough || w2.avg == null || w2 === w1) return none('wait', 'Not enough data yet', `Your weight did not rise this week (${kg}). One more week with ${MIN_WEEK}+ weigh-ins and this card can suggest more food.`, perWeek)
    const before = r2(w1.avg - w2.avg)
    if (before >= FLAT_BELOW) return none('wait', 'On track 👍', `Your weight did not rise this week (${kg}), but it did the week before. Keep eating your standard day and check again next week.`, perWeek)
    if (o.adj + ADD_KCAL > ADJ_MAX) return none('limit', 'On the highest goal', `Your weight is not rising (${kg} a week) but your goal is already ${o.adj} kcal over the plan, the most this card adds. Check that you eat the whole standard day, sleep and train.`, perWeek)
    const suggestion: AdjustSuggestion = {
      delta: ADD_KCAL,
      perWeek,
      after: o.adj + ADD_KCAL,
      title: `Eat ${ADD_KCAL} kcal more a day`,
      why: `Your weekly average has not risen for 2 weeks (${kgText(before)}, then ${kg}). To grow it should go up ${BAND_TEXT}.`,
      tip: 'Add a glass of milk + 1 spoon of peanut butter.',
      reason: 'Weight flat for 2 weeks'
    }
    return { state: 'suggest', suggestion, title: suggestion.title, why: suggestion.why, perWeek }
  }
  return none('ontrack', 'On track 👍', `${kg} a week (the target is ${BAND_TEXT}). No change needed.`, perWeek)
}

/** The goal's new adjustment after Accept (kept within ±600). */
export const applyDelta = (adj: number, delta: number) => Math.max(-ADJ_MAX, Math.min(ADJ_MAX, adj + delta))

/** One history line: "2026-11-09 · +200 kcal · Weight flat for 2 weeks". */
export const adjLogLine = (e: AdjLogEntry) => `${e.day} · ${e.delta > 0 ? '+' : '−'}${Math.abs(e.delta)} kcal · ${e.reason || 'weekly check'}`
