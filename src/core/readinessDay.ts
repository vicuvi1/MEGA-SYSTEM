// Body → Today: what the readiness score means today, in plain words, and the
// smart rest day. The score itself is core/trainReadiness.ts (sleep against
// your need, how sore you are, yesterday's hard sets; the same number sets
// Full / Lighter 70% / Short 50% in Sport Track). This file only turns it into
// a verdict ("Ready: go full" / "Go lighter (70%)" / "Rest or mobility") and
// decides when the page may say "Rest day": only when you tapped it, the week
// plan has no session today, or the score says rest, and never after you
// trained today unless you tapped it yourself. Pure and tested; no points.
import type { DoseMode } from './trainReadiness'

export type Verdict = 'go' | 'lighter' | 'rest'

export const VERDICT_TITLE: Record<Verdict, string> = {
  go: 'Ready: go full',
  lighter: 'Go lighter (70%)',
  rest: 'Rest or mobility'
}

/** The same steps as trainReadiness: 80+ full, 50–79 lighter, under 50 rest (Short 50% if you train anyway). */
export function verdictOf(score: number): Verdict {
  const s = Math.max(0, Math.min(100, Math.round(Number(score) || 0)))
  return s >= 80 ? 'go' : s >= 50 ? 'lighter' : 'rest'
}

/** The Sport Track dose a verdict sets (you can still pick another one). */
export const DOSE_OF: Record<Verdict, DoseMode> = { go: 'full', lighter: 'light', rest: 'short' }

export type PartTone = 'good' | 'ok' | 'low' | 'none'

export interface ReadyPart {
  id: 'sleep' | 'sore' | 'load'
  label: string
  /** "6.5 of 8 h", "2 of 5", "14 hard sets". */
  value: string
  tone: PartTone
}

const h1 = (min: number) => (Math.round((min / 60) * 10) / 10).toString()

/** The three things the score is made of, for the card. */
export function readinessParts(i: { sleptMin: number | null; needMin?: number | null; soreness: number | null; ydaySets?: number | null }): ReadyPart[] {
  const need = Number(i.needMin) >= 300 && Number(i.needMin) <= 720 ? Number(i.needMin) : 480
  const sleep: ReadyPart =
    i.sleptMin == null
      ? { id: 'sleep', label: 'Sleep', value: 'not logged', tone: 'none' }
      : { id: 'sleep', label: 'Sleep', value: `${h1(i.sleptMin)} of ${h1(need)} h`, tone: need - i.sleptMin <= 60 ? 'good' : need - i.sleptMin <= 150 ? 'ok' : 'low' }
  const sore: ReadyPart =
    i.soreness == null
      ? { id: 'sore', label: 'Soreness', value: 'tap 1–5', tone: 'none' }
      : { id: 'sore', label: 'Soreness', value: i.soreness <= 2 ? 'fresh' : i.soreness === 3 ? 'a bit sore' : i.soreness === 4 ? 'sore' : 'very sore', tone: i.soreness <= 2 ? 'good' : i.soreness === 3 ? 'ok' : 'low' }
  const y = Math.max(0, Math.round(Number(i.ydaySets) || 0))
  const load: ReadyPart = { id: 'load', label: 'Yesterday', value: y ? `${y} hard set${y === 1 ? '' : 's'}` : 'no hard sets', tone: y >= 25 ? 'low' : y >= 15 ? 'ok' : 'good' }
  return [sleep, sore, load]
}

export type DayKind = 'train' | 'rest' | 'done'
export type RestReason = 'tapped' | 'plan' | 'readiness'

export interface DayState {
  kind: DayKind
  reason: RestReason | null
  /** The card's title: "Today's workout", "Rest day", "Done for today". */
  title: string
  /** One plain line under it. */
  line: string
}

/**
 * The smart rest day.
 * - You tapped "Rest today": rest (your pick wins, even after a workout).
 * - You trained today (a workout or Sport Track sets): done, never "rest".
 * - The week plan has no session today, or the score is under 50: rest, with
 *   mobility (you can still train).
 * - Otherwise: train.
 */
export function dayState(i: { trainedToday: boolean; restTapped: boolean; plannedRest?: boolean; verdict: Verdict }): DayState {
  if (i.restTapped) return { kind: 'rest', reason: 'tapped', title: 'Rest day', line: 'Your pick. Your streak stays. A short mobility routine helps you recover.' }
  if (i.trainedToday) return { kind: 'done', reason: null, title: 'Done for today', line: 'You trained today. Eat your protein and sleep well: that is when muscle grows.' }
  if (i.plannedRest) return { kind: 'rest', reason: 'plan', title: 'Rest day', line: 'No session in your plan today. Do 8 minutes of mobility, or train anyway.' }
  if (i.verdict === 'rest') return { kind: 'rest', reason: 'readiness', title: 'Rest day', line: 'Your body needs a break today (sleep, soreness or yesterday). Mobility is better than a hard workout.' }
  return { kind: 'train', reason: null, title: "Today's workout", line: '' }
}
