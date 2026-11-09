// The food counter (pure and tested). A meal is a list of foods with grams and
// macros, read from an AI app's reply (core/foodParse.ts) or added again from
// yesterday or a favourite.
//
// Storage (see docs/areas/sport.md, "Food counter"):
// - The NUMBERS live in the one body log (body_log, append-only, merges by
//   row id): each meal is a `protein:food` row (grams of protein) and a
//   `kcal:food` row (kcal). So protein has ONE number: proteinOfDay() adds the
//   quick protein logs and the food counter's meals, each counted once.
//   Removing a meal is a cancel row for both rows; nothing is deleted.
// - The DETAILS (food names, grams, carbs, fat) live in the synced setting
//   `food_log`, capped (45 days, 400 meals; favourites kept apart, at most 20).
//   If two devices save at the same instant and one setting copy loses a meal's
//   details, the day's totals are still right (they come from the log).
//
// Nothing here pays points: food is information, not a habit reward.
import { addDays } from './dates'
import { liveIds, type BodyEvent } from './bodyLog'
import { isProteinKind } from './protein'

export type Confidence = 'sure' | 'roughly' | 'guess'

export interface FoodItem {
  name: string
  grams: number
  protein: number
  carbs: number
  fat: number
  kcal: number
  confidence: Confidence
  /** Portions, for a food from your saved foods ("3" eggs). */
  qty?: number
  /** What one portion is ("1 large"), for a saved food. */
  unit?: string
}

export interface Totals {
  protein: number
  carbs: number
  fat: number
  kcal: number
}

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack']

/** A meal type from the local time it was eaten (05–10 breakfast, 11–15 lunch, 17–21 dinner, else snack). */
export function mealTypeAt(hm: string): MealType {
  const h = Number(String(hm).slice(0, 2))
  if (!Number.isFinite(h)) return 'snack'
  if (h >= 5 && h < 11) return 'breakfast'
  if (h >= 11 && h < 16) return 'lunch'
  if (h >= 17 && h < 22) return 'dinner'
  return 'snack'
}

export interface FoodMeal {
  /** `fd-…`; its rows in the body log are `<id>-p` (protein) and `<id>-k` (kcal). */
  id: string
  /** When it was logged (ISO). */
  at: string
  /** The app day it counts on. */
  day: string
  name: string
  /** Breakfast, lunch, dinner or snack (from the time when not given). */
  type: MealType
  items: FoodItem[]
  /** Logged later for a past day (shown as "added later"). */
  late?: boolean
  /** A supplement (creatine, a shake, vitamins): listed apart, with macros if any. */
  supp?: boolean
  /** How it was logged (old meals have none and read as 'manual': see mealSource). */
  source?: MealSource
  /** The standard-day slot it came from (`ds-…`), for the day's checklist. */
  slot?: string
}

/** How a meal was logged: a saved meal or food, a photo, typed or pasted, or quick add. */
export type MealSource = 'saved' | 'photo' | 'manual' | 'quick-add'
export const MEAL_SOURCES: MealSource[] = ['saved', 'photo', 'manual', 'quick-add']
/** A meal's source; old meals (saved before sources existed) read as 'manual'. Old data is never rewritten. */
export const mealSource = (m: { source?: unknown }): MealSource => (MEAL_SOURCES.includes(m.source as MealSource) ? (m.source as MealSource) : 'manual')

export interface FoodFav {
  id: string
  name: string
  items: FoodItem[]
}

export interface FoodLog {
  meals: FoodMeal[]
  favs: FoodFav[]
}

export const FOOD_KIND = 'protein:food'
export const KCAL_KIND = 'kcal:food'
export const isKcalKind = (kind: string) => typeof kind === 'string' && kind.startsWith('kcal:')
export const proteinRowId = (mealId: string) => `${mealId}-p`
export const kcalRowId = (mealId: string) => `${mealId}-k`
/** The meal a body-log row belongs to ("fd-abc-p" → "fd-abc"), or ''. */
export const mealOfRow = (rowId: string) => (/^fd-[a-z0-9]{1,24}-[pk]$/.test(String(rowId)) ? String(rowId).slice(0, -2) : '')

export const LOG_DAYS = 45
export const LOG_MAX = 400
export const FAV_MAX = 20
/** How far back a meal may be added for a past day. */
export const PAST_DAYS = 14

const r1 = (n: number) => Math.round(n * 10) / 10
const num = (v: unknown, lo: number, hi: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo
}

/** kcal from macros (4 / 4 / 9 per gram). */
export const kcalOf = (p: number, c: number, f: number) => Math.round(4 * (p || 0) + 4 * (c || 0) + 9 * (f || 0))

/** A clean item (names trimmed, numbers in range, kcal from macros when missing). */
export function cleanItem(raw: any): FoodItem | null {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  const grams = Math.round(num(raw.grams, 0, 3000))
  if (!name || grams < 1) return null
  const protein = r1(num(raw.protein, 0, 400))
  const carbs = r1(num(raw.carbs, 0, 800))
  const fat = r1(num(raw.fat, 0, 400))
  const k = Number(raw.kcal)
  const kcal = Number.isFinite(k) && k > 0 ? Math.round(Math.min(k, 8000)) : kcalOf(protein, carbs, fat)
  const confidence: Confidence = raw.confidence === 'sure' || raw.confidence === 'guess' ? raw.confidence : 'roughly'
  const out: FoodItem = { name, grams, protein, carbs, fat, kcal, confidence }
  const qty = Number(raw.qty)
  if (Number.isFinite(qty) && qty > 0 && qty <= 50) out.qty = Math.round(qty * 2) / 2
  const unit = String(raw.unit ?? '').trim().slice(0, 30)
  if (unit) out.unit = unit
  return out
}

/** The item at a new weight: macros scale with the grams (5–3000 g). */
export function scaleItem(item: FoodItem, grams: number): FoodItem {
  const n = Number(grams)
  const g = Math.round(Math.max(5, Math.min(3000, Number.isFinite(n) ? n : item.grams)))
  const f = item.grams > 0 ? g / item.grams : 1
  return { ...item, grams: g, protein: r1(item.protein * f), carbs: r1(item.carbs * f), fat: r1(item.fat * f), kcal: Math.round(item.kcal * f) }
}

/** The −/+ step: 10 g under 100 g, 25 g under 300 g, else 50 g. */
export function stepGrams(grams: number, dir: 1 | -1): number {
  const g = Math.round(Number(grams) || 0)
  const step = (dir > 0 ? g : g - 1) < 100 ? 10 : (dir > 0 ? g : g - 1) < 300 ? 25 : 50
  const next = dir > 0 ? Math.floor(g / step) * step + step : Math.ceil(g / step) * step - step
  return Math.max(5, Math.min(3000, next))
}

export function sumItems(items: FoodItem[]): Totals {
  const t = items.reduce((a, it) => ({ protein: a.protein + it.protein, carbs: a.carbs + it.carbs, fat: a.fat + it.fat, kcal: a.kcal + it.kcal }), { protein: 0, carbs: 0, fat: 0, kcal: 0 })
  return { protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat), kcal: Math.round(t.kcal) }
}

/** "Chicken breast, rice" / "Chicken breast, rice +2". */
export function mealName(items: FoodItem[]): string {
  const names = items.map((i) => i.name.charAt(0).toUpperCase() + i.name.slice(1))
  if (!names.length) return 'Meal'
  return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
}

const localHm = (iso: string) => {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''
}
const cleanItems = (raw: unknown) => (Array.isArray(raw) ? raw : []).map(cleanItem).filter((x): x is FoodItem => !!x).slice(0, 20)
const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A clean food log: meals with a valid id, day and items, newest first, the
 * last LOG_DAYS days before `today` and at most LOG_MAX; favourites apart
 * (at most FAV_MAX).
 */
export function cleanFoodLog(raw: any, today?: string): FoodLog {
  const o = raw && typeof raw === 'object' ? raw : {}
  const from = today && DAY.test(today) ? addDays(today, -LOG_DAYS) : ''
  const seen = new Set<string>()
  const meals: FoodMeal[] = []
  for (const m of Array.isArray(o.meals) ? o.meals : []) {
    if (!m || typeof m !== 'object') continue
    const id = String(m.id ?? '')
    if (!/^fd-[a-z0-9]{1,24}$/.test(id) || seen.has(id) || !DAY.test(String(m.day)) || String(m.day) < from) continue
    const items = cleanItems(m.items)
    if (!items.length) continue
    seen.add(id)
    const at = String(m.at ?? '')
    const type: MealType = MEAL_TYPES.includes(m.type) ? m.type : mealTypeAt(localHm(at))
    const slot = /^ds-[a-z0-9-]{1,24}$/.test(String(m.slot ?? '')) ? String(m.slot) : ''
    meals.push({
      id, at, day: String(m.day), name: String(m.name ?? '').trim().slice(0, 60) || mealName(items), type, items,
      ...(m.late ? { late: true } : {}),
      ...(m.supp ? { supp: true } : {}),
      ...(MEAL_SOURCES.includes(m.source) ? { source: m.source as MealSource } : {}),
      ...(slot ? { slot } : {})
    })
  }
  meals.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const favs: FoodFav[] = []
  for (const f of Array.isArray(o.favs) ? o.favs : []) {
    if (!f || typeof f !== 'object') continue
    const id = String(f.id ?? '')
    const items = cleanItems(f.items)
    if (!/^fv-[a-z0-9]{1,24}$/.test(id) || !items.length || favs.some((x) => x.id === id)) continue
    favs.push({ id, name: String(f.name ?? '').trim().slice(0, 60) || mealName(items), items })
    if (favs.length >= FAV_MAX) break
  }
  return { meals: meals.slice(0, LOG_MAX), favs }
}

/** The log with a new meal (newest first, capped). */
export function addMeal(log: FoodLog, meal: FoodMeal, today?: string): FoodLog {
  return cleanFoodLog({ meals: [meal, ...log.meals.filter((m) => m.id !== meal.id)], favs: log.favs }, today)
}

/** Which meals still count: their body-log rows are live (a meal with no rows yet counts). */
export function liveMealIds(events: BodyEvent[]): { live: Set<string>; removed: Set<string> } {
  const mine = events.filter((e) => e.kind === FOOD_KIND || e.kind === KCAL_KIND)
  const live = liveIds(mine)
  const out = { live: new Set<string>(), removed: new Set<string>() }
  for (const e of mine) {
    const m = mealOfRow(e.id)
    if (!m || e.undoes) continue
    if (live.has(e.id)) out.live.add(m)
    else out.removed.add(m)
  }
  for (const m of out.live) out.removed.delete(m)
  return out
}

export interface DayMeal extends FoodMeal {
  totals: Totals
  removed: boolean
}

/** A day's meals, oldest first, with totals and removed ones marked. */
export function mealsOfDay(log: FoodLog, events: BodyEvent[], day: string): DayMeal[] {
  const { removed } = liveMealIds(events.filter((e) => e.day === day))
  return log.meals
    .filter((m) => m.day === day)
    .slice()
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
    .map((m) => ({ ...m, totals: sumItems(m.items), removed: removed.has(m.id) }))
}

/** kcal on a day from the log (food counter meals; quick protein logs have no kcal). */
export function kcalOfDay(events: BodyEvent[], day: string): number {
  const mine = events.filter((e) => e.day === day && isKcalKind(e.kind))
  const live = liveIds(mine)
  let k = 0
  for (const e of mine) if (!e.undoes && live.has(e.id)) k += Math.round(Number(e.amount) || 0)
  return Math.max(0, k)
}

/** Grams of protein logged on `day` at or after `sinceIso` (e.g. after a workout). */
export function proteinSince(events: BodyEvent[], day: string, sinceIso: string): number {
  const mine = events.filter((e) => e.day === day && isProteinKind(e.kind))
  const live = liveIds(mine)
  let g = 0
  for (const e of mine) if (!e.undoes && live.has(e.id) && e.at >= sinceIso) g += Math.round(Number(e.amount) || 0)
  return Math.max(0, g)
}

/** Yesterday's meals that still count (for "Same as yesterday"). */
export function yesterdayMeals(log: FoodLog, events: BodyEvent[], today: string): DayMeal[] {
  return mealsOfDay(log, events, addDays(today, -1)).filter((m) => !m.removed)
}

/** The log with a meal starred (a copy of its foods) or unstarred. */
export function toggleFav(log: FoodLog, meal: { name: string; items: FoodItem[] }, favId: string): FoodLog {
  const key = favKey(meal.items)
  const had = log.favs.find((f) => f.id === favId || favKey(f.items) === key)
  const favs = had ? log.favs.filter((f) => f !== had) : [{ id: favId, name: meal.name, items: meal.items }, ...log.favs]
  return { meals: log.meals, favs: favs.slice(0, FAV_MAX) }
}

/** Same foods and grams = the same favourite. */
export const favKey = (items: FoodItem[]) =>
  items
    .map((i) => `${i.name.toLowerCase()}:${i.grams}`)
    .sort()
    .join('|')

export const isFav = (log: FoodLog, items: FoodItem[]) => log.favs.some((f) => favKey(f.items) === favKey(items))

// ---- lines ----

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

/** "Protein 92 / 150 g · 1,850 / 2,700 kcal today". */
export function dayLine(o: { protein: number; proteinGoal: number; kcal: number; kcalGoal: number }, when = 'today'): string {
  return `Protein ${fmt(o.protein)} / ${fmt(o.proteinGoal)} g · ${fmt(o.kcal)} / ${fmt(o.kcalGoal)} kcal ${when}`.trim()
}

/**
 * Sport Track's one line: "Protein 92 / 150 g today · trained: +30 g" (after-workout protein, only on a training day).
 * With kcal: "Protein 92 / 130 g · 1,900 / 2,700 kcal today · …" (the same numbers as the food bars).
 */
export function sportFoodLine(o: { protein: number; proteinGoal: number; trainedAt: string | null; afterTrain: number; kcal?: number; kcalGoal?: number }): string {
  const kcal = o.kcal != null && o.kcalGoal ? ` · ${fmt(o.kcal)} / ${fmt(o.kcalGoal)} kcal` : ''
  const base = `Protein ${fmt(o.protein)} / ${fmt(o.proteinGoal)} g${kcal} today`
  return o.trainedAt ? `${base} · trained: +${fmt(o.afterTrain)} g` : base
}

// ---- the week ----

export interface FoodWeek {
  /** Days with any food counter meal (of the last 7). */
  days: number
  avgProtein: number
  avgKcal: number
  /** Days the protein goal was reached. */
  proteinHit: number
  /** Days within ±10% of the kcal goal. */
  kcalOnTarget: number
  perDay: { day: string; protein: number; kcal: number }[]
  line: string
}

/**
 * The last 7 days ending `today` (for the weekly food report and Ben's
 * evening nudge). `proteinOf(day)` is the day's one protein number.
 */
export function foodWeek(events: BodyEvent[], today: string, goals: { protein: number; kcal: number }, proteinOf: (day: string) => number): FoodWeek {
  const perDay = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i - 6)
    return { day, protein: proteinOf(day), kcal: kcalOfDay(events, day) }
  })
  const logged = perDay.filter((d) => d.kcal > 0)
  const pDays = perDay.filter((d) => d.protein > 0)
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((t, x) => t + x, 0) / xs.length) : 0)
  const avgProtein = avg(pDays.map((d) => d.protein))
  const avgKcal = avg(logged.map((d) => d.kcal))
  const proteinHit = perDay.filter((d) => goals.protein > 0 && d.protein >= goals.protein).length
  const kcalOnTarget = logged.filter((d) => goals.kcal > 0 && Math.abs(d.kcal - goals.kcal) <= goals.kcal * 0.1).length
  let line: string
  if (!logged.length && !pDays.length) line = 'No food logged this week. Log a meal to see your week.'
  else {
    const parts = [`Protein ${avgProtein} g a day on average (goal ${goals.protein} g), reached on ${proteinHit} of 7 days`]
    if (logged.length) parts.push(`${fmt(avgKcal)} kcal a day on the ${logged.length} ${logged.length === 1 ? 'day' : 'days'} you logged meals (goal ${fmt(goals.kcal)})`)
    line = `${parts.join('; ')}.`
  }
  return { days: logged.length, avgProtein, avgKcal, proteinHit, kcalOnTarget, perDay, line }
}
