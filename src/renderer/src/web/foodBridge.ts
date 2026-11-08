// life.coach.food: the food counter on this device's copy of the database
// (src/main/food.ts). Writes go through the services' write (synced like
// everything else). No network and no AI here: the reply from your AI app is
// read by core/foodParse.ts in the page.
import { addFoodMeal, addFoodSupp, addFoodWater, answerAdjust, editFoodMeal, foodView, leanDefaultOnce, needsLeanDefault, saveFoodGoals, saveFoodPrices, toggleFoodFav, toggleFoodMeal, type FoodView } from '../../../main/food'
import type { FoodGoals } from '@core/foodGoals'
import type { FoodItem, MealType } from '@core/food'

export interface FoodApi {
  /** Today, or a past day (up to 14 days back) you are editing. */
  view(day?: string): Promise<FoodView>
  add(meal: { items: FoodItem[]; name?: string; day?: string; type?: MealType }, day?: string): Promise<FoodView>
  /** Removes a meal, or brings a removed one back. */
  toggle(mealId: string, day?: string): Promise<FoodView>
  fav(meal: { name: string; items: FoodItem[] }, day?: string): Promise<FoodView>
  goals(patch: Partial<FoodGoals>, day?: string): Promise<FoodView>
  /** Fixes a saved meal (new foods, name or type; same day and time). */
  edit(mealId: string, meal: { items: FoodItem[]; name?: string; type?: MealType }, day?: string): Promise<FoodView>
  /** Water into the one water log (no second counter). */
  water(ml: number, day?: string): Promise<FoodView>
  /** A supplement button: creatine, shake or vitamins. */
  supp(id: string, day?: string): Promise<FoodView>
  /** The weekly weight check: Apply (+/−100 kcal, bounded) or "Not now". */
  adjust(accept: boolean, day?: string): Promise<FoodView>
  /** Your prices in MDL per kg by food name (null removes one). */
  prices(patch: Record<string, number | null>, day?: string): Promise<FoodView>
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
    // The lean protein default (2.0 g/kg), once for this database.
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
    prices: async (patch, day) => write((db) => (saveFoodPrices(db, patch), foodView(db, new Date(), day)))
  }
}
