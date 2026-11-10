// life.coach.food: the food counter on this device's copy of the database
// (src/main/food.ts). Writes go through the services' write (synced like
// everything else). No network and no AI here: the reply from your AI app is
// read by core/foodParse.ts in the page.
import { addFoodMeal, addFoodSupp, addFoodWater, answerAdjust, editFoodMeal, foodView, leanDefaultOnce, readFoodSaved, needsLeanDefault, saveFoodGoals, saveFoodSaved, saveFoodPrices, toggleFoodFav, toggleFoodMeal, type FoodView } from '../../../main/food'
import { logSavedFood, logSavedMeal, logStandardDay, saveLoggedAsMeal } from '../../../main/foodSaved'
import type { PasteLog } from '@core/foodPaste'
import type { FoodGoals } from '@core/foodGoals'
import type { FoodItem, MealSource, MealType } from '@core/food'
import type { FoodSaved, SlotChoice } from '@core/foodSaved'
import { accuracyNow, foodChartsNow, foodGallery, lastLoggedMeal, nextMealNow, workoutNoteNow, type LoggedMeal } from '../../../main/foodInsights'
import { labelFoods } from '@core/foodBarcode'
import { AI_COST_KEY, cleanCostPrefs, type CostPrefs } from '@core/aiCost'
import { readSetting, writeSetting } from '../../../main/settings'
import type { Accuracy, FoodCharts, GalleryDay } from '@core/foodInsights'
import type { NextMeal } from '@core/foodTiming'

/** The food extras for Body → Food: the next meal, the workout note, the accuracy check. */
export interface FoodExtras {
  nextMeal: NextMeal
  workout: string | null
  accuracy: Accuracy
}

export interface FoodApi {
  /** Today, or a past day (up to 14 days back) you are editing. */
  view(day?: string): Promise<FoodView>
  add(meal: { items: FoodItem[]; name?: string; day?: string; type?: MealType; id?: string; source?: MealSource; slot?: string; photos?: string[] }, day?: string): Promise<FoodView>
  /** Removes a meal, or brings a removed one back. */
  toggle(mealId: string, day?: string): Promise<FoodView>
  fav(meal: { name: string; items: FoodItem[] }, day?: string): Promise<FoodView>
  goals(patch: Partial<FoodGoals>, day?: string): Promise<FoodView>
  /** Fixes a saved meal (new foods, name or type; same day and time). */
  edit(mealId: string, meal: { items: FoodItem[]; name?: string; type?: MealType; photos?: string[] }, day?: string): Promise<FoodView>
  /** Water into the one water log (no second counter). */
  water(ml: number, day?: string): Promise<FoodView>
  /** A supplement button: creatine, shake or vitamins. */
  supp(id: string, day?: string): Promise<FoodView>
  /** The weekly weight check: Apply (+/−100 kcal, bounded) or "Not now". */
  adjust(accept: boolean, day?: string): Promise<FoodView>
  /** Your prices in MDL per kg by food name (null removes one). */
  prices(patch: Record<string, number | null>, day?: string): Promise<FoodView>
  /** One tap: a saved food × qty now. `ids` are the new meals (for Undo). */
  logFood(foodId: string, qty?: number): Promise<{ view: FoodView; ids: string[] }>
  /** One tap: a saved meal now, some quantities changed first ({ 'sf-egg': 2 }). */
  logMeal(mealId: string, qty?: Record<string, number> | null): Promise<{ view: FoodView; ids: string[] }>
  /** "Log my standard day": each slot as its own meal (usual, alternative or skip per slot). */
  logDay(choices?: Record<string, SlotChoice>): Promise<{ view: FoodView; ids: string[] }>
  /** Takes several meals back at once (the Undo after a tap). */
  undo(ids: string[]): Promise<FoodView>
  /** Saves your saved foods, meals and standard day (the manage sheet). */
  saved(data: FoodSaved): Promise<FoodView>
  /** "Save as meal": a logged meal becomes a saved meal. */
  saveAsMeal(loggedMealId: string, name?: string): Promise<FoodView>
  /**
   * "Paste from AI": logs each pasted meal as a normal food-counter meal (its own
   * day, time and type; `ids` fixed per paste, so a double tap logs once).
   * Returns the meal ids (for Undo and "Save as repeat meal").
   */
  pasteLog(meals: PasteLog[], ids: string[]): Promise<{ view: FoodView; ids: string[] }>
  /** Just the saved foods, meals and day (for quick add). */
  savedNow(): Promise<FoodSaved>
  /** The next meal, the workout note and the accuracy check (read only). */
  extras(): Promise<FoodExtras>
  /** Meals by day with totals (the gallery), the last `days` days. */
  gallery(days?: number): Promise<GalleryDay[]>
  /** Charts from the log: per meal type, when you eat, most eaten foods. */
  charts(days?: number): Promise<FoodCharts>
  /** The newest meal logged since then (any device), for the island's notice. */
  lastLogged(sinceMs: number): Promise<LoggedMeal | null>
  /** Foods read from a label or barcode become saved foods (not twice); returns the names added. */
  labelFoods(items: { name: string; grams: number; kcal: number; protein: number; carbs: number; fat: number; src?: string }[]): Promise<string[]>
  /** The cost meter's model name and prices (synced setting ai_cost). */
  costPrefs(): Promise<CostPrefs>
  setCostPrefs(p: Partial<CostPrefs>): Promise<CostPrefs>
}

type Svc = { read<T>(f: (s: any) => T): Promise<T>; write<T>(f: (s: any) => T): Promise<T> }

const changed = () => {
  try {
    window.dispatchEvent(new CustomEvent('life-body-changed'))
  } catch {
    /* not in a page */
  }
}

export function foodBridge(svcP: Promise<Svc>, device: () => string): FoodApi {
  const write = async <T>(f: (db: any) => T): Promise<T> => {
    const out = await (await svcP).write((s) => f(s.db))
    changed()
    return out
  }
  const view = async (day?: string) => {
    const svc = await svcP
    // The move to slow muscle gain (1.8 g/kg, +350 kcal), once for this database.
    if (await svc.read((s) => needsLeanDefault(s.db))) await write((db) => leanDefaultOnce(db))
    return svc.read((s) => foodView(s.db, new Date(), day))
  }
  return {
    view,
    add: async (meal, day) => write((db) => (addFoodMeal(db, meal, device()), foodView(db, new Date(), day ?? meal.day))),
    toggle: async (id, day) => write((db) => (toggleFoodMeal(db, id, device()), foodView(db, new Date(), day))),
    fav: async (meal, day) => write((db) => (toggleFoodFav(db, meal), foodView(db, new Date(), day))),
    goals: async (patch, day) => write((db) => (saveFoodGoals(db, patch), foodView(db, new Date(), day))),
    edit: async (id, meal, day) => write((db) => (editFoodMeal(db, id, meal, device()), foodView(db, new Date(), day))),
    water: async (ml, day) => write((db) => (addFoodWater(db, ml, device()), foodView(db, new Date(), day))),
    supp: async (id, day) => write((db) => (addFoodSupp(db, id, device()), foodView(db, new Date(), day))),
    adjust: async (accept, day) => write((db) => (answerAdjust(db, accept), foodView(db, new Date(), day))),
    prices: async (patch, day) => write((db) => (saveFoodPrices(db, patch), foodView(db, new Date(), day))),
    logFood: async (foodId, qty) => write((db) => ({ ids: logSavedFood(db, foodId, qty ?? 1, device())?.ids ?? [], view: foodView(db, new Date()) })),
    logMeal: async (mealId, qty) => write((db) => ({ ids: logSavedMeal(db, mealId, qty, device())?.ids ?? [], view: foodView(db, new Date()) })),
    logDay: async (choices) => write((db) => ({ ids: logStandardDay(db, choices ?? {}, device()).ids, view: foodView(db, new Date()) })),
    undo: async (ids) => write((db) => (ids.forEach((id) => toggleFoodMeal(db, id, device())), foodView(db, new Date()))),
    saved: async (data) => write((db) => (saveFoodSaved(db, data), foodView(db, new Date()))),
    saveAsMeal: async (id, name) => write((db) => (saveLoggedAsMeal(db, id, name), foodView(db, new Date()))),
    pasteLog: async (meals, ids) =>
      write((db) => {
        const made = meals.map((m, k) => addFoodMeal(db, { items: m.items, name: m.name, day: m.day, type: m.type, at: m.at, id: ids[k], source: 'paste' }, device())).filter((x): x is NonNullable<typeof x> => !!x)
        return { ids: made.map((x) => x.id), view: foodView(db, new Date()) }
      }),
    savedNow: async () => (await svcP).read((s) => readFoodSaved(s.db)),
    extras: async () => (await svcP).read((s) => ({ nextMeal: nextMealNow(s.db), workout: workoutNoteNow(s.db), accuracy: accuracyNow(s.db) })),
    gallery: async (days) => (await svcP).read((s) => foodGallery(s.db, new Date(), days ?? 14)),
    charts: async (days) => (await svcP).read((s) => foodChartsNow(s.db, new Date(), days ?? 14)),
    lastLogged: async (since) => (await svcP).read((s) => lastLoggedMeal(s.db, since)),
    costPrefs: async () => (await svcP).read((s) => cleanCostPrefs(readSetting(s.db, AI_COST_KEY))),
    setCostPrefs: async (p) =>
      write((db) => {
        const next = cleanCostPrefs({ ...cleanCostPrefs(readSetting(db, AI_COST_KEY)), ...p })
        writeSetting(db, AI_COST_KEY, next as any)
        return next
      }),
    labelFoods: async (items) => {
      const svc = await svcP
      const pre = await svc.read((s) => labelFoods(readFoodSaved(s.db), items, () => `sf-l${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}`))
      if (!pre.added.length) return []
      await write((db) => saveFoodSaved(db, labelFoods(readFoodSaved(db), items, () => `sf-l${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}`).saved))
      return pre.added
    }
  }
}
