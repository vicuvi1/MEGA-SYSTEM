// The day's food at a glance (pure and tested): the two big bars
// ("1,900 / 2,700 kcal", "90 / 130 g protein", "800 kcal · 40 g left") and a
// gentle flag when protein is behind for the time of day. The same numbers
// show on Body → Food, the Body → Today food card and Sport Track's line.
import type { SavedFood } from './foodSaved'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export interface Bar {
  eaten: number
  goal: number
  /** What is still to eat (never below 0). */
  left: number
  /** 0–1 for the bar (full at the goal). */
  frac: number
}

export interface DayProgress {
  kcal: Bar
  protein: Bar
  /** "1,900 / 2,700 kcal" */
  kcalLine: string
  /** "90 / 130 g protein" */
  proteinLine: string
  /** "800 kcal · 40 g left", or "Goals reached today" */
  leftLine: string
}

const bar = (eaten: number, goal: number): Bar => {
  const e = Math.max(0, Math.round(eaten || 0))
  const g = Math.max(0, Math.round(goal || 0))
  return { eaten: e, goal: g, left: Math.max(0, g - e), frac: g > 0 ? clamp01(e / g) : 0 }
}

/** The big bars from what was eaten and the goals. */
export function dayProgress(eaten: { kcal: number; protein: number }, goals: { kcal: number; protein: number }): DayProgress {
  const kcal = bar(eaten.kcal, goals.kcal)
  const protein = bar(eaten.protein, goals.protein)
  const parts = [kcal.left > 0 ? `${fmt(kcal.left)} kcal` : '', protein.left > 0 ? `${fmt(protein.left)} g` : ''].filter(Boolean)
  const leftLine = !parts.length ? 'Goals reached today' : `${parts.join(' · ')} left${kcal.left === 0 ? ' (kcal done)' : protein.left === 0 ? ' (protein done)' : ''}`
  return { kcal, protein, kcalLine: `${fmt(kcal.eaten)} / ${fmt(kcal.goal)} kcal`, proteinLine: `${fmt(protein.eaten)} / ${fmt(protein.goal)} g protein`, leftLine }
}

/** Protein is spread over the waking day: 0% at 08:00, 100% at 22:00. */
export const DAY_START = 8
export const DAY_END = 22
/** Behind = under this share of where you would be by now. */
export const BEHIND_SHARE = 0.8

export interface ProteinBehind {
  behind: boolean
  /** Grams you would have by now on an even day. */
  expected: number
  /** One plain hint, or '' when not behind. */
  hint: string
}

/** The share of the day's protein you would have by this time (08:00 → 0, 22:00 → 1). */
export function dayShare(now: Date): number {
  const h = now.getHours() + now.getMinutes() / 60
  return clamp01((h - DAY_START) / (DAY_END - DAY_START))
}

/**
 * Is protein behind for the time of day? E.g. at 17:00 an even day is at
 * about 64%; under 80% of that (about half the goal) counts as behind. Not
 * before 10:00 (too early to tell). The hint names your best saved protein
 * food: "Behind on protein: 250 g brânză de vaci 5% = +40 g".
 */
export function proteinBehind(now: Date, eaten: number, target: number, foods: SavedFood[] = []): ProteinBehind {
  const share = dayShare(now)
  const expected = Math.round(target * share)
  const behind = target > 0 && now.getHours() >= 10 && eaten < expected * BEHIND_SHARE
  if (!behind) return { behind: false, expected, hint: '' }
  const best = [...foods].filter((f) => f.protein >= 10).sort((a, b) => b.protein - a.protein)[0]
  const hint = best
    ? `Behind on protein: ${best.portionLabel} ${best.name.charAt(0).toLowerCase()}${best.name.slice(1)} = +${Math.round(best.protein)} g`
    : `Behind on protein: about ${expected} g by now, you have ${Math.round(eaten)} g. Have a protein food next.`
  return { behind: true, expected, hint }
}
