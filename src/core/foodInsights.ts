// What the food log says over time (pure, tested; made-up data in tests):
// - the weekly accuracy check: logged kcal vs the weight trend ("your logs seem low");
// - the food gallery: meals by day with totals (photo meals show their pictures);
// - charts from the log: protein and kcal per meal type, when you eat, most eaten foods;
// - the night summary: totals, the best meal, one change for tomorrow.
// Every number comes from the log. Nothing here pays points.
import { addDays } from './dates'
import { MEAL_TYPES, sumItems, type DayMeal, type FoodItem, type MealType, type Totals } from './food'
import { foodKey } from './foodVision'
import { mealScore, type MealScore } from './foodScore'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Tue 10 Nov" for an app day (YYYY-MM-DD). */
export const dayLabel = (day: string) => {
  const d = new Date(`${day}T12:00:00`)
  return Number.isFinite(d.getTime()) ? `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` : day
}
/** "13:05" local time of an ISO moment. */
export const hmOf = (iso: string) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''
}
export const TYPE_WORD: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }

// ---- the weekly accuracy check ----

/** kcal in a kg of body weight, roughly (the usual 7,700). */
export const KCAL_PER_KG = 7700
export interface AccuracyIn {
  today: string
  /** kcal logged per day (days with at least one meal). */
  days: { day: string; kcal: number }[]
  /** Weigh-ins (first morning weight per day), any order. */
  weights: { day: string; weight: number }[]
  /** Maintenance kcal (Mifflin–St Jeor × activity), and whether it is only a rough one (no height and age yet). */
  maintenance: number
  rough: boolean
}
export type Accuracy =
  | { state: 'none'; why: string }
  | { state: 'ok' | 'low' | 'high'; avgLogged: number; implied: number; perWeek: number; loggedDays: number; line: string; rough: boolean }

/** The weight's trend in kg a week (least squares over the days), or null with fewer than 4 weigh-ins over 10+ days. */
export function weightTrend(points: { day: string; weight: number }[]): number | null {
  const ps = points.filter((p) => p.weight > 0).sort((a, b) => (a.day < b.day ? -1 : 1))
  if (ps.length < 4) return null
  const t0 = Date.parse(`${ps[0].day}T12:00:00Z`)
  const xs = ps.map((p) => (Date.parse(`${p.day}T12:00:00Z`) - t0) / 86400_000)
  if (xs[xs.length - 1] - xs[0] < 10) return null
  const n = ps.length
  const mx = xs.reduce((a, x) => a + x, 0) / n
  const my = ps.reduce((a, p) => a + p.weight, 0) / n
  let num = 0
  let den = 0
  ps.forEach((p, i) => ((num += (xs[i] - mx) * (p.weight - my)), (den += (xs[i] - mx) ** 2)))
  return den > 0 ? Math.round((num / den) * 7 * 100) / 100 : null
}

/**
 * The last 14 days: logged kcal vs what the weight trend says was eaten
 * (maintenance + trend × 7,700 / 7). Logs more than 300 kcal (and 12 %) under
 * that → "your logs seem low"; more than 500 over → "high"; else they match.
 * Needs 8+ logged days and 4+ weigh-ins over 10+ days of the last 21.
 */
export function accuracyCheck(i: AccuracyIn): Accuracy {
  const from = addDays(i.today, -14)
  const days = i.days.filter((d) => d.day > from && d.day < i.today && d.kcal > 0)
  if (days.length < 8) return { state: 'none', why: `Log meals on 8 of the last 14 days to check them against your weight (${days.length} so far).` }
  const trend = weightTrend(i.weights.filter((w) => w.day > addDays(i.today, -21) && w.day <= i.today))
  if (trend == null) return { state: 'none', why: 'Weigh in at least 4 times over 2 weeks to check your logs against your weight.' }
  if (!(i.maintenance > 0)) return { state: 'none', why: 'Enter your height and age in Goals to check your logs against your weight.' }
  const avg = Math.round(days.reduce((a, d) => a + d.kcal, 0) / days.length)
  const implied = Math.round(i.maintenance + (trend * KCAL_PER_KG) / 7)
  const sign = trend > 0 ? `+${trend}` : `${trend}`
  const base = { avgLogged: avg, implied, perWeek: trend, loggedDays: days.length, rough: i.rough }
  if (avg < implied - 300 && avg < implied * 0.88)
    return { state: 'low', ...base, line: `Your logs seem low: about ${fmt(avg)} kcal a day logged, but your weight (${sign} kg a week) fits about ${fmt(implied)}. Oil, drinks, snacks or bigger portions may be missing.` }
  if (avg > implied + 500) return { state: 'high', ...base, line: `Your logs are higher than your weight suggests: ${fmt(avg)} kcal a day logged, the weight (${sign} kg a week) fits about ${fmt(implied)}. Portions may be smaller than logged.` }
  return { state: 'ok', ...base, line: `Your logs match your weight: about ${fmt(avg)} kcal a day logged, the weight (${sign} kg a week) fits about ${fmt(implied)}.` }
}

// ---- the gallery ----

export interface GalleryMeal {
  id: string
  at: string
  hm: string
  name: string
  type: MealType
  totals: Totals
  items: FoodItem[]
  photos: string[]
  score: MealScore | null
  source: string
}
export interface GalleryDay {
  day: string
  label: string
  totals: Totals
  meals: GalleryMeal[]
  photoCount: number
}

/** Meals by day (newest day first, meals in time order), live ones only, supplements left out; days with no meal left out. */
export function galleryDays(meals: DayMeal[], today: string, days = 14): GalleryDay[] {
  const from = addDays(today, -(days - 1))
  const by = new Map<string, GalleryMeal[]>()
  for (const m of meals) {
    if (m.removed || m.supp || m.day < from || m.day > today) continue
    const list = by.get(m.day) ?? []
    list.push({ id: m.id, at: m.at, hm: hmOf(m.at), name: m.name, type: m.type, totals: m.totals, items: m.items, photos: m.photos ?? [], score: mealScore(m.items), source: m.source ?? 'manual' })
    by.set(m.day, list)
  }
  return [...by.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, list]) => {
      list.sort((a, b) => (a.at < b.at ? -1 : 1))
      return { day, label: day === today ? `Today, ${dayLabel(day)}` : dayLabel(day), totals: sumItems(list.flatMap((m) => m.items)), meals: list, photoCount: list.filter((m) => m.photos.length).length }
    })
}

// ---- charts ----

export interface FoodCharts {
  days: number
  /** Per meal type: how many meals, and the average kcal and protein of one. */
  byType: { type: MealType; meals: number; kcal: number; protein: number }[]
  /** When you eat: meals per hour of the day (05 … 04), and their kcal. */
  byHour: { hour: number; meals: number; kcal: number }[]
  /** Most eaten foods: how often, the usual grams, protein per time. */
  top: { name: string; times: number; grams: number; protein: number; kcal: number }[]
  /** Meals counted (with a photo). */
  meals: number
  photoMeals: number
}

/** The charts from the last `days` days of live meals (supplements left out). */
export function foodCharts(meals: DayMeal[], today: string, days = 14): FoodCharts {
  const from = addDays(today, -(days - 1))
  const list = meals.filter((m) => !m.removed && !m.supp && m.day >= from && m.day <= today)
  const byType = MEAL_TYPES.map((type) => {
    const ms = list.filter((m) => m.type === type)
    const t = sumItems(ms.flatMap((m) => m.items))
    return { type, meals: ms.length, kcal: ms.length ? Math.round(t.kcal / ms.length) : 0, protein: ms.length ? Math.round(t.protein / ms.length) : 0 }
  })
  const hours = Array.from({ length: 24 }, (_, k) => (k + 5) % 24)
  const byHour = hours.map((hour) => {
    const ms = list.filter((m) => new Date(m.at).getHours() === hour)
    return { hour, meals: ms.length, kcal: Math.round(sumItems(ms.flatMap((m) => m.items)).kcal) }
  })
  const foods = new Map<string, { name: string; names: Map<string, number>; times: number; grams: number; protein: number; kcal: number }>()
  for (const m of list)
    for (const it of m.items) {
      const k = foodKey(it.name) || it.name.toLowerCase()
      const f = foods.get(k) ?? { name: it.name, names: new Map(), times: 0, grams: 0, protein: 0, kcal: 0 }
      f.times++
      f.grams += it.grams
      f.protein += it.protein
      f.kcal += it.kcal
      f.names.set(it.name, (f.names.get(it.name) ?? 0) + 1)
      foods.set(k, f)
    }
  const top = [...foods.values()]
    .sort((a, b) => b.times - a.times || b.protein - a.protein)
    .slice(0, 8)
    .map((f) => ({ name: [...f.names.entries()].sort((a, b) => b[1] - a[1])[0][0], times: f.times, grams: Math.round(f.grams / f.times), protein: Math.round(f.protein / f.times), kcal: Math.round(f.kcal / f.times) }))
  return { days, byType, byHour, top, meals: list.length, photoMeals: list.filter((m) => m.photos?.length).length }
}

// ---- the night summary ----

export interface DaySummary {
  lines: string[]
  best: { name: string; type: MealType; hm: string; score: MealScore } | null
  change: string
  html: string
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * The day's food at night: totals vs goals, the best meal (highest score, then
 * most protein) and ONE change for tomorrow (protein short, kcal short or over,
 * else the weakest meal's tip). Null when nothing was logged today.
 */
export function daySummary(o: { meals: DayMeal[]; day: string; protein: number; kcal: number; goals: { protein: number; kcal: number }; ideas?: string[] }): DaySummary | null {
  const live = o.meals.filter((m) => !m.removed && !m.supp && m.day === o.day)
  if (!live.length && o.kcal <= 0) return null
  const scored = live.map((m) => ({ m, s: mealScore(m.items) })).filter((x): x is { m: DayMeal; s: MealScore } => !!x.s)
  const bestOne = [...scored].sort((a, b) => b.s.points - a.s.points || b.s.protein - a.s.protein)[0]
  const worst = [...scored].sort((a, b) => a.s.points - b.s.points)[0]
  const pShort = Math.round(o.goals.protein - o.protein)
  const kDiff = Math.round(o.goals.kcal - o.kcal)
  let change: string
  if (pShort >= 20) change = `Protein was ${pShort} g short: add one protein snack in the afternoon${o.ideas?.[0] ? ` (${o.ideas[0].replace(/\.$/, '')})` : ' (250 g brânză de vaci or a shake)'}.`
  else if (kDiff >= 300) change = `About ${fmt(kDiff)} kcal short: add a bigger lunch portion or a glass of milk with a spoon of peanut butter.`
  else if (kDiff <= -400) change = `About ${fmt(-kDiff)} kcal over: make tomorrow's dinner a little smaller.`
  else if (worst && worst.s.points <= 3) change = `${TYPE_WORD[worst.m.type]} scored ${worst.s.grade}: ${worst.s.tip}`
  else change = 'Keep the same plan: today worked.'
  const lines = [`${fmt(o.kcal)} / ${fmt(o.goals.kcal)} kcal · ${fmt(o.protein)} / ${fmt(o.goals.protein)} g protein · ${live.length} ${live.length === 1 ? 'meal' : 'meals'}`]
  const best = bestOne ? { name: bestOne.m.name, type: bestOne.m.type, hm: hmOf(bestOne.m.at), score: bestOne.s } : null
  if (best) lines.push(`Best meal: ${TYPE_WORD[best.type]} at ${best.hm}, ${best.name} (${best.score.grade}, ${best.score.protein} g protein)`)
  const html = ['🌙 <b>Food today</b>', ...lines.map((l) => `• ${esc(l)}`), `💡 <b>Tomorrow:</b> ${esc(change)}`].join('\n')
  return { lines, best, change, html }
}
