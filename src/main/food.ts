// The food counter on any database (this device's copy, later the bot
// server's). A meal's numbers are rows in the one body log (body_log:
// `protein:food` + `kcal:food`), its details are in the synced setting
// `food_log`, the goals in `food_goals`. Pure logic: core/food*.ts.
// These are the functions the Telegram / Ben builder calls (see
// docs/areas/sport.md, "Food counter"). Nothing here pays points.
import type { DB } from './db'
import { readSetting, writeSetting } from './settings'
import { addDays } from '../core/dates'
import { sharedView, sportToday } from '../core/sportShared'
import { bodyEvents, logWater, sportBlob, sportNow, toggleEntry } from './bodyLog'
import { defaultSport } from '../core/sportCards'
import { readPrefs, savePrefs, tickSupp, weighIns } from './bodyPlus'
import { proteinOfDay } from '../core/protein'
import {
  FOOD_KIND, KCAL_KIND, MEAL_TYPES, PAST_DAYS, mealTypeAt, addMeal, cleanFoodLog, cleanItem, dayLine, foodWeek, isFav, kcalOfDay, kcalRowId, mealName, mealsOfDay, proteinRowId, proteinSince, sportFoodLine, sumItems, toggleFav, yesterdayMeals,
  type DayMeal, type FoodFav, type FoodItem, type FoodLog, type FoodWeek, type MealType, type Totals
} from '../core/food'
import { LEAN_GPK, cleanGoals, cleanPrices, foodTargets, type FoodGoals, type FoodTargets } from '../core/foodGoals'
import { adjustCheck, applyDelta, type AdjustCheck } from '../core/foodAdjust'
import { cheapMap, cheapProtein, unpricedOwn, type CheapRow } from '../core/foodCheap'
import { ownPer100, type OwnFood } from '../core/foodTable'
import { prepPlan, shoppingList, type PrepPlan, type ShoppingList } from '../core/foodPlan'
import { weekChart, type WeekChart } from '../core/foodDisplay'
import { SUPP_PRESETS } from '../core/foodSupps'
import { ownFoods, whatToEatNext, type WhatNext } from '../core/foodNext'

const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

export const readFoodLog = (db: DB, today = sportToday()): FoodLog => cleanFoodLog(readSetting(db, 'food_log'), today)
export const readFoodGoals = (db: DB): FoodGoals => cleanGoals(readSetting(db, 'food_goals'))

export function saveFoodGoals(db: DB, patch: Partial<FoodGoals>): FoodGoals {
  const next = cleanGoals({ ...readFoodGoals(db), ...patch })
  writeSetting(db, 'food_goals', next as any)
  return next
}

function insertRow(db: DB, id: string, at: string, day: string, kind: string, amount: number, source: string) {
  db.prepare('INSERT OR IGNORE INTO body_log (id, at, day, kind, amount, source, undoes) VALUES (?, ?, ?, ?, ?, ?, NULL)').run(id, at, day, kind, Math.max(0, Math.round(amount)), String(source || 'app').slice(0, 20))
}

/**
 * Saves a meal: its two rows in the body log and its foods in `food_log`.
 * `day` may be a past day (up to 14 days back); it is then marked "added later".
 * Returns the meal, or null when there is nothing to save.
 */
export function addFoodMeal(db: DB, input: { items: unknown[]; name?: string; day?: string; type?: MealType; supp?: boolean; at?: string }, source: string, now = new Date()): { id: string; day: string; totals: Totals } | null {
  const items = (Array.isArray(input.items) ? input.items : []).map(cleanItem).filter((x): x is FoodItem => !!x).slice(0, 20)
  if (!items.length) return null
  const today = sportToday(now)
  const day = input.day && /^\d{4}-\d{2}-\d{2}$/.test(input.day) && input.day <= today && input.day >= addDays(today, -PAST_DAYS) ? input.day : today
  const id = `fd-${rid()}`
  const at = input.at && Number.isFinite(new Date(input.at).getTime()) ? new Date(input.at).toISOString() : now.toISOString()
  const totals = sumItems(items)
  insertRow(db, proteinRowId(id), at, day, FOOD_KIND, totals.protein, source)
  insertRow(db, kcalRowId(id), at, day, KCAL_KIND, totals.kcal, source)
  const name = String(input.name ?? '').trim().slice(0, 60) || mealName(items)
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const type: MealType = input.type && MEAL_TYPES.includes(input.type) ? input.type : mealTypeAt(hm)
  writeSetting(db, 'food_log', addMeal(readFoodLog(db, today), { id, at, day, name, type, items, ...(day !== today ? { late: true } : {}), ...(input.supp ? { supp: true } : {}) }, today) as any)
  return { id, day, totals }
}

/** Removes a meal, or brings a removed one back (cancel rows for both its rows). */
export function toggleFoodMeal(db: DB, mealId: string, source: string, now = new Date()): boolean {
  if (!/^fd-[a-z0-9]{1,24}$/.test(String(mealId))) return false
  const a = toggleEntry(db, proteinRowId(mealId), source, now)
  const b = toggleEntry(db, kcalRowId(mealId), source, now)
  return !!(a || b)
}

/**
 * Fixes a saved meal: the new foods replace it on the same day and time (its
 * old rows are cancelled, the new ones added). Null when it is not a live meal
 * on a day that can still be changed.
 */
export function editFoodMeal(db: DB, mealId: string, input: { items: unknown[]; name?: string; type?: MealType }, source: string, now = new Date()): { id: string; totals: Totals } | null {
  const today = sportToday(now)
  const log = readFoodLog(db, today)
  const old = log.meals.find((m) => m.id === mealId)
  if (!old || old.day < addDays(today, -PAST_DAYS)) return null
  if (mealsOfDay(log, bodyEvents(db, addDays(old.day, -1), old.day), old.day).find((m) => m.id === mealId)?.removed) return null
  const made = addFoodMeal(db, { items: input.items, name: input.name, day: old.day, type: input.type ?? old.type, at: old.at, supp: old.supp }, source, now)
  if (!made) return null
  toggleFoodMeal(db, mealId, source, now)
  const cur = readFoodLog(db, today)
  writeSetting(db, 'food_log', { meals: cur.meals.filter((m) => m.id !== mealId), favs: cur.favs } as any)
  return { id: made.id, totals: made.totals }
}

/** Today's water from the one water log (the same number Sport Track and the island show). */
export function waterNow(db: DB, now = new Date()): { ml: number; target: number; glass: number } {
  const day = sportToday(now)
  return sharedView(sportNow(db, now) ?? defaultSport(day), day).water
}

/** Adds water to the one water log (no second counter). */
export function addFoodWater(db: DB, ml: number, source: string, now = new Date()): { ml: number; target: number; glass: number } {
  const n = Math.round(Number(ml))
  if (!Number.isFinite(n) || n < 1 || n > 1500) return waterNow(db, now)
  return logWater(db, n, source, { now })
}

/** A supplement button (creatine, a shake, vitamins) as a small entry in today's log; creatine also ticks its streak. */
export function addFoodSupp(db: DB, id: string, source: string, now = new Date()): { id: string; totals: Totals } | null {
  const preset = SUPP_PRESETS.find((p) => p.id === id)
  if (!preset) return null
  const r = addFoodMeal(db, { items: preset.items, name: mealName(preset.items), type: 'snack', supp: true }, source, now)
  if (r && preset.tick) tickSupp(db, preset.tick, source, now)
  return r ? { id: r.id, totals: r.totals } : null
}

/** The weekly weight check (14-day trend vs the goal). */
export function adjustNow(db: DB, now = new Date()): AdjustCheck {
  const today = sportToday(now)
  const g = readFoodGoals(db)
  return adjustCheck({ weights: weighIns(db, 30), today, adj: g.kcalAdj, adjAt: g.adjAt })
}

/** Answers the weekly check: Apply changes the kcal goal by the suggestion (±100, within ±300), "Not now" only marks the week. Re-checked here, never trusted from the page. */
export function answerAdjust(db: DB, accept: boolean, now = new Date()): FoodGoals {
  const g = readFoodGoals(db)
  const chk = adjustNow(db, now)
  if (chk.state !== 'suggest') return g
  return saveFoodGoals(db, { adjAt: sportToday(now), kcalAdj: accept ? applyDelta(g.kcalAdj, chk.suggestion.delta) : g.kcalAdj })
}

/** Your own prices (MDL per kg) by food name; a null removes one. */
export function saveFoodPrices(db: DB, patch: Record<string, number | null>): FoodGoals {
  const cur = { ...readFoodGoals(db).prices }
  for (const [k, v] of Object.entries(patch ?? {})) {
    const key = k.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40)
    if (!key) continue
    if (v == null || !(Number(v) > 0)) delete cur[key]
    else cur[key] = Number(v)
  }
  return saveFoodGoals(db, { prices: cleanPrices(cur) })
}

/** Stars a meal's foods as a favourite, or unstars it. */
export function toggleFoodFav(db: DB, meal: { name: string; items: unknown[] }, today = sportToday()): FoodLog {
  const items = (Array.isArray(meal.items) ? meal.items : []).map(cleanItem).filter((x): x is FoodItem => !!x)
  const log = readFoodLog(db, today)
  if (!items.length) return log
  const next = toggleFav(log, { name: String(meal.name ?? '').slice(0, 60) || mealName(items), items }, `fv-${rid()}`)
  writeSetting(db, 'food_log', next as any)
  return next
}

/**
 * The owner's lean plan (2026-11-08): protein 2.0 g/kg. The g/kg lives in
 * body_plus (one protein number for the ring and the counter), whose old
 * default was 1.8: move a 1.8 to 2.0 ONCE (food_goals.leanV), so a later
 * pick of 1.8 stays. Same result on every device, so two at once is fine.
 * Returns true when it changed something.
 */
export function leanDefaultOnce(db: DB): boolean {
  const g = readFoodGoals(db)
  if (g.leanV === 1) return false
  if (Math.abs(readPrefs(db).gPerKg - 1.8) < 0.05) savePrefs(db, { gPerKg: LEAN_GPK })
  saveFoodGoals(db, { leanV: 1 })
  return true
}
export const needsLeanDefault = (db: DB) => readFoodGoals(db).leanV !== 1

/** A training day: a workout or a Sport Track set logged on it. */
export function isTrainingDay(db: DB, day: string): boolean {
  if (trainedAt(db, day)) return true
  try {
    return !!db.prepare('SELECT 1 FROM workouts WHERE day = ? LIMIT 1').get(day)
  } catch {
    return false
  }
}

/** The day's goals from the latest weight, your g/kg (body_plus), the Goals sheet and whether you trained. */
export function foodTargetsNow(db: DB, day = sportToday()): FoodTargets {
  const ins = weighIns(db)
  return foodTargets(ins.length ? ins[ins.length - 1].weight : null, readPrefs(db).gPerKg, readFoodGoals(db), isTrainingDay(db, day))
}

/** When today's training started (the first set logged in Sport Track today), or null. */
export function trainedAt(db: DB, day: string): string | null {
  try {
    const sets = sportBlob(db)?.sets?.[day]
    if (!sets || typeof sets !== 'object') return null
    let first: string | null = null
    for (const list of Object.values(sets) as any[]) for (const s of Array.isArray(list) ? list : []) if (typeof s?.at === 'string' && (!first || s.at < first)) first = s.at
    return first
  } catch {
    return null
  }
}

export interface FoodDayTotals {
  day: string
  /** The one protein number (quick logs + food counter meals). */
  protein: number
  kcal: number
  targets: FoodTargets
  line: string
}

/** Today's (or a day's) totals and the live line. */
export function foodDayTotals(db: DB, now = new Date(), day?: string): FoodDayTotals {
  const today = sportToday(now)
  const d = day ?? today
  const events = bodyEvents(db, d)
  const targets = foodTargetsNow(db, d)
  const protein = proteinOfDay(events, d)
  const kcal = kcalOfDay(events, d)
  return { day: d, protein, kcal, targets, line: dayLine({ protein, proteinGoal: targets.protein, kcal, kcalGoal: targets.kcal }, d === today ? 'today' : `on ${d}`) }
}

/** "58 g protein left: 250 g chicken breast, or …" for today. */
export function whatNextNow(db: DB, now = new Date()): WhatNext {
  const today = sportToday(now)
  const t = foodDayTotals(db, now)
  const meals = readFoodLog(db, today).meals
  const cheap = cheapMap(cheapProtein(readFoodGoals(db).prices, ownPer100(meals, today)))
  return whatToEatNext({ proteinLeft: t.targets.protein - t.protein, kcalLeft: t.targets.kcal - t.kcal, own: ownFoods(meals.filter((m) => !m.supp), today), cheap })
}

/** Sport Track's line: "Protein 92 / 150 g today · trained: +30 g". */
export function sportFoodLineNow(db: DB, now = new Date()): string {
  const today = sportToday(now)
  const t = foodDayTotals(db, now)
  const at = trainedAt(db, today)
  return sportFoodLine({ protein: t.protein, proteinGoal: t.targets.protein, trainedAt: at, afterTrain: at ? proteinSince(bodyEvents(db, today), today, at) : 0 })
}

/** The last 7 days (weekly food report, Ben's evening nudge). */
export function foodWeekNow(db: DB, now = new Date()): FoodWeek {
  const today = sportToday(now)
  const events = bodyEvents(db, addDays(today, -6), today)
  const t = foodTargetsNow(db, today)
  return foodWeek(events, today, { protein: t.protein, kcal: t.kcal }, (d) => proteinOfDay(events, d))
}

export interface FoodView {
  today: string
  /** The day shown (today, or a past day you are editing). */
  day: string
  totals: FoodDayTotals
  carbs: number
  fat: number
  meals: (DayMeal & { fav: boolean })[]
  yesterday: DayMeal[]
  favs: FoodFav[]
  next: WhatNext
  goals: FoodGoals
  sport: string
  week: FoodWeek
  /** Today's water from the one water log (null when a past day is shown). */
  water: { ml: number; target: number; glass: number } | null
  /** Your own foods as per-100 g values (for words like "200g chicken"). */
  own: OwnFood[]
  adjust: AdjustCheck
  chart: WeekChart
  cheap: CheapRow[]
  /** Own foods without a price yet (offer to set one). */
  unpriced: OwnFood[]
  shopping: ShoppingList
  prep: PrepPlan
}

export function foodView(db: DB, now = new Date(), day?: string): FoodView {
  const today = sportToday(now)
  const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today && day >= addDays(today, -PAST_DAYS) ? day : today
  const log = readFoodLog(db, today)
  const events = bodyEvents(db, addDays(d, -1), d)
  const meals = mealsOfDay(log, events, d).map((m) => ({ ...m, fav: isFav(log, m.items) }))
  const live = meals.filter((m) => !m.removed)
  const totals = foodDayTotals(db, now, d)
  const goals = readFoodGoals(db)
  const own = ownPer100(log.meals, today)
  const week = foodWeekNow(db, now)
  const wk = weighIns(db, 30)
  const t = totals.targets
  return {
    today,
    day: d,
    totals,
    carbs: Math.round(live.reduce((t, m) => t + m.totals.carbs, 0)),
    fat: Math.round(live.reduce((t, m) => t + m.totals.fat, 0)),
    meals,
    yesterday: yesterdayMeals(log, bodyEvents(db, addDays(today, -1)), today),
    favs: log.favs,
    next: whatNextNow(db, now),
    goals,
    sport: sportFoodLineNow(db, now),
    week,
    water: d === today ? waterNow(db, now) : null,
    own,
    adjust: adjustNow(db, now),
    chart: weekChart(week.perDay, { protein: t.protein, kcal: t.kcal }, wk),
    cheap: cheapProtein(goals.prices, own),
    unpriced: unpricedOwn(goals.prices, own),
    shopping: shoppingList({ proteinGoal: t.protein, carbsGoal: t.carbs, own, prices: goals.prices }),
    prep: prepPlan({ proteinGoal: t.protein, kcalGoal: t.kcal, own, prices: goals.prices })
  }
}
