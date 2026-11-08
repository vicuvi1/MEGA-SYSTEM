// What the food counter shows, as plain numbers (pure and tested, so the page
// only draws): one basis for the header, the macros and "Next" (SAVED meals;
// an unsaved preview is shown apart as "+59 g if you save"), the four day
// rings, and the week chart (protein and kcal per day against the goal, with
// the weight line from the Body weight logs).
import { addDays } from './dates'
import type { Totals } from './food'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

export interface Basis {
  protein: number
  kcal: number
  carbs: number
  fat: number
}
export interface Goals {
  protein: number
  kcal: number
  carbs: number
  fat: number
}

export interface Header {
  /** "Protein 92 / 150 g · 1,850 / 2,700 kcal today" (saved meals). */
  line: string
  /** "Carbs 120 / 300 g · Fat 40 / 90 g" (saved meals, same basis). */
  macros: string
  /** "+59 g protein · 522 kcal · carbs 56 g · fat 6 g if you save", or ''. */
  preview: string
}

/** The header lines. `saved` is the day as saved; `preview` the unsaved draft (or null). */
export function foodHeader(saved: Basis, goals: Goals, preview: Totals | null, when = 'today'): Header {
  return {
    line: `Protein ${fmt(saved.protein)} / ${fmt(goals.protein)} g · ${fmt(saved.kcal)} / ${fmt(goals.kcal)} kcal ${when}`.trim(),
    macros: `Carbs ${fmt(saved.carbs)} / ${fmt(goals.carbs)} g · Fat ${fmt(saved.fat)} / ${fmt(goals.fat)} g`,
    preview: preview && (preview.protein || preview.kcal) ? `+${fmt(preview.protein)} g protein · ${fmt(preview.kcal)} kcal · carbs ${fmt(preview.carbs)} g · fat ${fmt(preview.fat)} g if you save` : ''
  }
}

export interface Ring {
  id: 'protein' | 'kcal' | 'carbs' | 'fat'
  label: string
  unit: string
  value: number
  goal: number
  /** 0–1 of the ring filled. */
  frac: number
  over: boolean
}

export function dayRings(saved: Basis, goals: Goals): Ring[] {
  const one = (id: Ring['id'], label: string, unit: string, value: number, goal: number): Ring => ({ id, label, unit, value: Math.round(value), goal: Math.round(goal), frac: goal > 0 ? Math.max(0, Math.min(1, value / goal)) : 0, over: goal > 0 && value > goal * 1.1 })
  return [one('protein', 'Protein', 'g', saved.protein, goals.protein), one('kcal', 'kcal', '', saved.kcal, goals.kcal), one('carbs', 'Carbs', 'g', saved.carbs, goals.carbs), one('fat', 'Fat', 'g', saved.fat, goals.fat)]
}

export interface ChartDay {
  day: string
  /** "Mon". */
  label: string
  protein: number
  kcal: number
  /** Bar heights as 0–1 of the chart height (same scale for both, in % of the goal). */
  pH: number
  kH: number
  weight: number | null
  /** Weight position, 0 (lowest) – 1 (highest) of the weight range, or null. */
  wY: number | null
}

export interface WeekChart {
  days: ChartDay[]
  proteinGoal: number
  kcalGoal: number
  /** Where the goal line sits, 0–1 of the chart height (100% of the goal). */
  goalY: number
  /** The percent of the goal at the top of the chart. */
  topPct: number
  weightMin: number | null
  weightMax: number | null
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const dayLabel = (day: string) => DAYS[new Date(`${day}T12:00:00Z`).getUTCDay()]

/**
 * The last 7 days. Protein and kcal are drawn as % of their own goal on ONE
 * scale (so a bar at the goal line has hit the goal); the top is the highest
 * bar rounded up to 25%, at least 125%. The weight line has its own range.
 */
export function weekChart(perDay: { day: string; protein: number; kcal: number }[], goals: { protein: number; kcal: number }, weights: { day: string; weight: number }[]): WeekChart {
  const pct = (v: number, g: number) => (g > 0 ? (v / g) * 100 : 0)
  const hi = Math.max(125, ...perDay.map((d) => Math.max(pct(d.protein, goals.protein), pct(d.kcal, goals.kcal))))
  const topPct = Math.ceil(hi / 25) * 25
  const byDay = new Map(weights.map((w) => [w.day, w.weight]))
  const ws = perDay.map((d) => byDay.get(d.day)).filter((x): x is number => typeof x === 'number')
  const wMin = ws.length ? Math.min(...ws) : null
  const wMax = ws.length ? Math.max(...ws) : null
  const span = wMin != null && wMax != null ? Math.max(0.6, wMax - wMin) : 0
  const days = perDay.map((d) => {
    const w = byDay.get(d.day)
    return {
      day: d.day,
      label: dayLabel(d.day),
      protein: d.protein,
      kcal: d.kcal,
      pH: pct(d.protein, goals.protein) / topPct,
      kH: pct(d.kcal, goals.kcal) / topPct,
      weight: typeof w === 'number' ? w : null,
      wY: typeof w === 'number' && wMin != null ? Math.round(((w - wMin) / span) * 10000) / 10000 : null
    }
  })
  return { days, proteinGoal: goals.protein, kcalGoal: goals.kcal, goalY: 100 / topPct, topPct, weightMin: wMin, weightMax: wMax }
}

/** Days from `today − 6` to `today` (for tests and the page). */
export const lastWeek = (today: string) => Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
