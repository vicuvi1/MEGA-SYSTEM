// One-tap logging from your saved foods, saved meals and standard day, on any
// database. Every tap is a normal food-counter meal made by addFoodMeal (the
// two body-log rows + its details in `food_log`, source 'saved'), so Undo is
// the usual toggleFoodMeal and nothing pays points. Pure parts:
// core/foodSaved.ts.
import type { DB } from './db'
import { sportToday } from '../core/sportShared'
import { mealTypeAt, type MealType, type Totals } from '../core/food'
import { foodOf, itemOf, itemsOf, itemsText, savedMealFrom, slotItems, withQty, type FoodSaved, type SlotChoice } from '../core/foodSaved'
import { addFoodMeal, readFoodLog, readFoodSaved, saveFoodSaved } from './food'

export interface Logged {
  /** The new meal ids (Undo = toggleFoodMeal on each). */
  ids: string[]
  totals: Totals
}

const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const add = (a: Totals, b: Totals): Totals => ({ protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat, kcal: a.kcal + b.kcal })
const ZERO: Totals = { protein: 0, carbs: 0, fat: 0, kcal: 0 }

/** One saved food × qty ("+1 egg") as a meal now. Null for an unknown food. */
export function logSavedFood(db: DB, foodId: string, qty = 1, source = 'app', now = new Date()): Logged | null {
  const f = foodOf(readFoodSaved(db), foodId)
  if (!f) return null
  const item = itemOf(f, qty)
  const r = addFoodMeal(db, { items: [item], name: item.qty === 1 ? f.name : `${item.qty} × ${f.name}`, type: mealTypeAt(hm(now)), source: 'saved' }, source, now)
  return r ? { ids: [r.id], totals: r.totals } : null
}

/** A saved meal as a meal now; `qty` changes some foods first (by food id: { 'sf-egg': 2 }). */
export function logSavedMeal(db: DB, mealId: string, qty?: Record<string, number> | null, source = 'app', now = new Date()): Logged | null {
  const s = readFoodSaved(db)
  const m = s.meals.find((x) => x.id === mealId)
  if (!m) return null
  const items = withQty(m.items, qty)
  const changed = items.some((x, i) => x.qty !== m.items[i].qty)
  const r = addFoodMeal(db, { items: itemsOf(s, items), name: changed ? itemsText(s, items).slice(0, 60) : m.name, type: m.slot, source: 'saved' }, source, now)
  return r ? { ids: [r.id], totals: r.totals } : null
}

/**
 * "Log my standard day": every slot as its own meal (Morning, Lunch, …), the
 * usual items or the alternative per slot (`choices`: { 'ds-evening': 'alt' },
 * 'skip' leaves one out). Each meal remembers its slot, for the checklist.
 */
export function logStandardDay(db: DB, choices: Record<string, SlotChoice> = {}, source = 'app', now = new Date()): Logged {
  const s = readFoodSaved(db)
  const out: Logged = { ids: [], totals: { ...ZERO } }
  s.day.slots.forEach((slot, i) => {
    const items = slotItems(slot, choices[slot.id])
    if (!items.length) return
    // One millisecond apart, so the slots keep their order in the day.
    const at = new Date(now.getTime() + i)
    const r = addFoodMeal(db, { items: itemsOf(s, items), name: `${slot.label}: ${itemsText(s, items)}`.slice(0, 60), type: slot.slot, source: 'saved', slot: slot.id, at: at.toISOString() }, source, now)
    if (r) {
      out.ids.push(r.id)
      out.totals = add(out.totals, r.totals)
    }
  })
  return out
}

/** "Save as meal": a logged meal (today's or one of the last 45 days) becomes a saved meal. */
export function saveLoggedAsMeal(db: DB, loggedMealId: string, name?: string, type?: MealType): FoodSaved | null {
  const m = readFoodLog(db, sportToday()).meals.find((x) => x.id === loggedMealId)
  if (!m) return null
  return saveFoodSaved(db, savedMealFrom(readFoodSaved(db), { name: String(name ?? '').trim().slice(0, 60) || m.name, type: type ?? m.type, items: m.items }))
}
