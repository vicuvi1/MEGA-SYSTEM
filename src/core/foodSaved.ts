// Saved foods, saved meals and the standard day (pure and tested).
//
// The idea: logging should take one tap. You keep a few foods you really eat
// ("Egg, 1 large: 72 kcal, 6.3 g protein"), meals made of them ("Breakfast:
// 3 eggs + 2 bread + banana") and ONE standard day (every slot of a normal
// day, with an alternative where you sometimes swap). A tap turns them into a
// normal food-counter meal (main/foodSaved.ts → addFoodMeal), so the numbers
// land in the one body log like every other meal. Nothing here pays points.
//
// Stored in the synced setting `food_saved` (versioned, capped). When the
// setting is missing, the seed below is used: generic foods, editable.
import { MEAL_TYPES, type FoodItem, type MealType, type Totals } from './food'

export const SAVED_VERSION = 1
export const FOODS_MAX = 60
export const MEALS_MAX = 24
export const SLOTS_MAX = 8
export const ITEMS_MAX = 12
/** Quantity per item: 0.5 … 20 portions. */
export const QTY_MIN = 0.5
export const QTY_MAX = 20
/** The most portions a quick-add line may log ("6 eggs"). */
export const QUICK_MAX = 6

export interface SavedFood {
  /** `sf-…` */
  id: string
  name: string
  /** What one portion is, in words: "1 large", "1 slice", "1 container". */
  portionLabel: string
  /** Grams of one portion (null: not known; 100 g is used for the log). */
  grams: number | null
  kcal: number
  protein: number
  carbs: number | null
  fat: number | null
}

/** A food in a meal or a slot, and how many portions. */
export interface SavedItem {
  foodId: string
  qty: number
}

export interface SavedMeal {
  /** `sm-…` */
  id: string
  name: string
  slot: MealType
  items: SavedItem[]
}

export interface DaySlot {
  /** `ds-…` */
  id: string
  /** The meal type it is logged as. */
  slot: MealType
  /** Its name in the day: "Morning", "Lunch", "Anytime". */
  label: string
  items: SavedItem[]
  /** The swap you sometimes make ("buckwheat + 2 eggs" instead of bulgur). */
  alternative: SavedItem[] | null
}

export interface FoodSaved {
  v: number
  foods: SavedFood[]
  meals: SavedMeal[]
  day: { slots: DaySlot[] }
}

// ---- the seed (generic foods, common table values) ----

const food = (id: string, name: string, portionLabel: string, grams: number | null, kcal: number, protein: number, carbs: number | null, fat: number | null): SavedFood => ({ id, name, portionLabel, grams, kcal, protein, carbs, fat })
const it = (foodId: string, qty: number): SavedItem => ({ foodId, qty })

export const SEED_FOODS: SavedFood[] = [
  food('sf-egg', 'Egg', '1 large', 50, 72, 6.3, 0.4, 4.8),
  food('sf-bread', 'Rye bread', '1 slice', 33, 80, 2.7, 15, 1),
  food('sf-bulgur', 'Bulgur salad with vegetables', '1 container', 300, 400, 10, null, null),
  food('sf-buckwheat', 'Buckwheat, cooked', '1 container', 300, 280, 10, 60, 2),
  food('sf-banana', 'Banana', '1 medium', 118, 105, 1.3, 27, 0.4),
  food('sf-branza', 'Brânză de vaci 5%', '250 g', 250, 300, 40, 7.5, 12.5),
  food('sf-kefir', 'Kefir or milk 2.5%', '500 ml', 500, 270, 15, 20, 12.5),
  food('sf-coffee', 'Coffee, black', '1 cup', 240, 5, 0, 0, 0),
  food('sf-branzica', 'Brânzică glazurată', '1 piece', 45, 150, 4.5, 13, 9)
]

const MORNING = [it('sf-egg', 3), it('sf-bread', 2), it('sf-banana', 1), it('sf-coffee', 1)]
const LUNCH = [it('sf-bulgur', 1), it('sf-bread', 1)]
const AFTERNOON = [it('sf-egg', 3), it('sf-bread', 2), it('sf-banana', 1)]
const EVENING = [it('sf-bulgur', 1), it('sf-bread', 1), it('sf-banana', 1)]
const EVENING_ALT = [it('sf-buckwheat', 1), it('sf-egg', 2), it('sf-bread', 1), it('sf-banana', 1)]
const ANYTIME = [it('sf-branza', 1)]
const ANYTIME_ALT = [it('sf-kefir', 1)]

export const SEED_DAY: DaySlot[] = [
  { id: 'ds-morning', slot: 'breakfast', label: 'Morning', items: MORNING, alternative: null },
  { id: 'ds-lunch', slot: 'lunch', label: 'Lunch', items: LUNCH, alternative: null },
  { id: 'ds-afternoon', slot: 'snack', label: 'Afternoon', items: AFTERNOON, alternative: null },
  { id: 'ds-evening', slot: 'dinner', label: 'Evening', items: EVENING, alternative: EVENING_ALT },
  { id: 'ds-anytime', slot: 'snack', label: 'Anytime', items: ANYTIME, alternative: ANYTIME_ALT }
]

export const SEED_MEALS: SavedMeal[] = [
  { id: 'sm-breakfast', name: 'Breakfast: 3 eggs + 2 bread + banana', slot: 'breakfast', items: MORNING },
  { id: 'sm-lunch', name: 'Lunch: bulgur + bread', slot: 'lunch', items: LUNCH },
  { id: 'sm-afternoon', name: 'Afternoon: 3 eggs + 2 bread + banana', slot: 'snack', items: AFTERNOON },
  { id: 'sm-evening', name: 'Evening: bulgur + bread + banana', slot: 'dinner', items: EVENING },
  { id: 'sm-buckwheat', name: 'Evening: buckwheat + 2 eggs', slot: 'dinner', items: EVENING_ALT },
  { id: 'sm-branza', name: 'Brânză de vaci 250 g', slot: 'snack', items: ANYTIME },
  { id: 'sm-kefir', name: 'Kefir 500 ml', slot: 'snack', items: ANYTIME_ALT }
]

/** A fresh copy of the seed (never share the arrays above). */
export const seedSaved = (): FoodSaved => JSON.parse(JSON.stringify({ v: SAVED_VERSION, foods: SEED_FOODS, meals: SEED_MEALS, day: { slots: SEED_DAY } }))

// ---- cleaning ----

const ID = { food: /^sf-[a-z0-9-]{1,24}$/, meal: /^sm-[a-z0-9-]{1,24}$/, slot: /^ds-[a-z0-9-]{1,24}$/ }
const text = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const r1 = (n: number) => Math.round(n * 10) / 10
const numOr = (v: unknown, lo: number, hi: number, def: number | null) => {
  if (v == null || v === '') return def
  const n = Number(v)
  return Number.isFinite(n) ? r1(Math.max(lo, Math.min(hi, n))) : def
}
/** A quantity in half portions, within 0.5–20. */
export const cleanQty = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(QTY_MIN, Math.min(QTY_MAX, Math.round(n * 2) / 2)) : 1
}

function cleanFood(raw: any): SavedFood | null {
  if (!raw || typeof raw !== 'object' || !ID.food.test(String(raw.id))) return null
  const name = text(raw.name, 40)
  const kcal = numOr(raw.kcal, 0, 3000, null)
  if (!name || kcal == null) return null
  const grams = numOr(raw.grams, 1, 3000, null)
  return {
    id: String(raw.id),
    name,
    portionLabel: text(raw.portionLabel, 30) || (grams ? `${grams} g` : '1 portion'),
    grams: grams == null ? null : Math.round(grams),
    kcal: Math.round(kcal),
    protein: numOr(raw.protein, 0, 300, 0) ?? 0,
    carbs: numOr(raw.carbs, 0, 600, null),
    fat: numOr(raw.fat, 0, 300, null)
  }
}

function cleanItems(raw: unknown, foods: Set<string>): SavedItem[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((x) => x && typeof x === 'object' && foods.has(String(x.foodId)))
    .map((x) => ({ foodId: String(x.foodId), qty: cleanQty(x.qty) }))
    .slice(0, ITEMS_MAX)
}

/**
 * A clean `food_saved`: valid ids, known foods only, numbers in range, capped
 * (60 foods, 24 meals, 8 slots, 12 items each). Missing or unreadable: the seed.
 */
export function cleanSaved(raw: any): FoodSaved {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.foods)) return seedSaved()
  const foods: SavedFood[] = []
  for (const f of raw.foods) {
    const c = cleanFood(f)
    if (c && !foods.some((x) => x.id === c.id) && foods.length < FOODS_MAX) foods.push(c)
  }
  const ids = new Set(foods.map((f) => f.id))
  const meals: SavedMeal[] = []
  for (const m of Array.isArray(raw.meals) ? raw.meals : []) {
    if (!m || !ID.meal.test(String(m.id)) || meals.some((x) => x.id === m.id)) continue
    const items = cleanItems(m.items, ids)
    if (!items.length) continue
    meals.push({ id: String(m.id), name: text(m.name, 60) || 'My meal', slot: MEAL_TYPES.includes(m.slot) ? m.slot : 'snack', items })
    if (meals.length >= MEALS_MAX) break
  }
  const slots: DaySlot[] = []
  for (const s of Array.isArray(raw.day?.slots) ? raw.day.slots : []) {
    if (!s || !ID.slot.test(String(s.id)) || slots.some((x) => x.id === s.id)) continue
    const items = cleanItems(s.items, ids)
    if (!items.length) continue
    const alt = cleanItems(s.alternative, ids)
    slots.push({ id: String(s.id), slot: MEAL_TYPES.includes(s.slot) ? s.slot : 'snack', label: text(s.label, 24) || 'Meal', items, alternative: alt.length ? alt : null })
    if (slots.length >= SLOTS_MAX) break
  }
  return { v: SAVED_VERSION, foods, meals, day: { slots } }
}

// ---- turning saved things into food-counter items ----

export const foodOf = (s: FoodSaved, id: string): SavedFood | null => s.foods.find((f) => f.id === id) ?? null

/** One saved food × qty as a food-counter item (grams, macros and kcal scale with qty). */
export function itemOf(f: SavedFood, qty: number): FoodItem {
  const q = cleanQty(qty)
  return {
    name: f.name,
    grams: Math.max(1, Math.round((f.grams ?? 100) * q)),
    protein: r1(f.protein * q),
    carbs: r1((f.carbs ?? 0) * q),
    fat: r1((f.fat ?? 0) * q),
    kcal: Math.round(f.kcal * q),
    confidence: 'sure',
    qty: q,
    unit: f.portionLabel
  }
}

/** A logged item at a new number of portions (macros scale from its current qty; none = 1). */
export function setQty(item: FoodItem, qty: number): FoodItem {
  const q = cleanQty(qty)
  const f = q / (item.qty && item.qty > 0 ? item.qty : 1)
  return { ...item, qty: q, grams: Math.max(1, Math.round(item.grams * f)), protein: r1(item.protein * f), carbs: r1(item.carbs * f), fat: r1(item.fat * f), kcal: Math.round(item.kcal * f) }
}

/** Saved items as food-counter items (unknown foods are skipped). */
export function itemsOf(s: FoodSaved, items: SavedItem[]): FoodItem[] {
  return items.map((x) => {
    const f = foodOf(s, x.foodId)
    return f ? itemOf(f, x.qty) : null
  }).filter((x): x is FoodItem => !!x)
}

/** kcal and protein (and carbs, fat) of some saved items, rounded. */
export function totalsOf(s: FoodSaved, items: SavedItem[]): Totals {
  const list = itemsOf(s, items)
  const t = list.reduce((a, i) => ({ protein: a.protein + i.protein, carbs: a.carbs + i.carbs, fat: a.fat + i.fat, kcal: a.kcal + i.kcal }), { protein: 0, carbs: 0, fat: 0, kcal: 0 })
  return { protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat), kcal: Math.round(t.kcal) }
}

/** A meal's items with some quantities changed (by food id): "eggs ×2 instead of ×3". */
export function withQty(items: SavedItem[], overrides?: Record<string, number> | null): SavedItem[] {
  if (!overrides) return items
  return items.map((x) => (overrides[x.foodId] != null ? { ...x, qty: cleanQty(overrides[x.foodId]) } : x))
}

/** Which version of each slot to log: the usual items, the alternative, or skip it. */
export type SlotChoice = 'main' | 'alt' | 'skip'

/** The items one slot logs for a choice (the alternative only when it has one). */
export const slotItems = (slot: DaySlot, choice: SlotChoice = 'main'): SavedItem[] => (choice === 'skip' ? [] : choice === 'alt' && slot.alternative ? slot.alternative : slot.items)

/** The whole standard day's totals for the given choices (default: every slot's usual items). */
export function dayTotals(s: FoodSaved, choices: Record<string, SlotChoice> = {}): Totals {
  return totalsOf(s, s.day.slots.flatMap((sl) => slotItems(sl, choices[sl.id])))
}

/** The −/+ step for a quantity: halves under 1, else whole portions. */
export function stepQty(qty: number, dir: 1 | -1): number {
  const q = cleanQty(qty)
  if (dir > 0) return cleanQty(q < 1 ? q + 0.5 : Math.floor(q) + 1)
  return cleanQty(q <= 1 ? q - 0.5 : Math.ceil(q) - 1)
}

/** "3 × Egg" or "Brânză de vaci 5%" (qty 1). */
export const itemLabel = (name: string, qty: number) => (qty === 1 ? name : `${qty} × ${name}`)

/** "3 eggs + 2 bread + banana" style list of a few saved items. */
export function itemsText(s: FoodSaved, items: SavedItem[]): string {
  return items.map((x) => itemLabel(foodOf(s, x.foodId)?.name ?? '?', x.qty)).join(' + ')
}

// ---- making and changing saved things ----

const slug = (name: string) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16) || 'x'
/** A new id that is not used yet: `sf-egg`, `sf-egg-2`, … */
export function newId(prefix: 'sf' | 'sm' | 'ds', name: string, taken: string[]): string {
  const base = `${prefix}-${slug(name)}`
  if (!taken.includes(base)) return base
  for (let n = 2; n < 999; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`
  return `${base}-${Date.now().toString(36).slice(-6)}`
}

/**
 * "Save as meal": a logged meal becomes a saved meal. Each food is matched to
 * a saved food by name (the qty from the grams), or saved as a new food with
 * its own grams as one portion.
 */
export function savedMealFrom(s: FoodSaved, meal: { name: string; type: MealType; items: FoodItem[] }): FoodSaved {
  const foods = [...s.foods]
  const items: SavedItem[] = []
  for (const x of meal.items.slice(0, ITEMS_MAX)) {
    const known = foods.find((f) => f.name.toLowerCase() === x.name.toLowerCase())
    if (known) {
      items.push({ foodId: known.id, qty: cleanQty(x.qty ?? (known.grams ? x.grams / known.grams : 1)) })
      continue
    }
    if (foods.length >= FOODS_MAX) continue
    const id = newId('sf', x.name, foods.map((f) => f.id))
    foods.push({ id, name: x.name.slice(0, 40), portionLabel: `${x.grams} g`, grams: x.grams, kcal: x.kcal, protein: x.protein, carbs: x.carbs, fat: x.fat })
    items.push({ foodId: id, qty: 1 })
  }
  if (!items.length || s.meals.length >= MEALS_MAX) return { ...s, foods }
  const id = newId('sm', meal.name, s.meals.map((m) => m.id))
  return cleanSaved({ ...s, foods, meals: [...s.meals, { id, name: meal.name.slice(0, 60), slot: meal.type, items }] })
}

/** Drops a food, and it from every meal and slot (a meal or slot left empty goes too). */
export function removeFood(s: FoodSaved, foodId: string): FoodSaved {
  return cleanSaved({ ...s, foods: s.foods.filter((f) => f.id !== foodId) })
}

/** Moves an entry one place up (-1) or down (+1) in a list. */
export function moveIn<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const j = index + dir
  if (index < 0 || index >= list.length || j < 0 || j >= list.length) return list
  const out = [...list]
  ;[out[index], out[j]] = [out[j], out[index]]
  return out
}

// ---- quick add: "standard day", "breakfast", "2 eggs" ----

export type SavedMatch =
  | { kind: 'day' }
  | { kind: 'meal'; meal: SavedMeal }
  | { kind: 'food'; food: SavedFood; qty: number }

const words = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
/** "eggs" → "egg", "slices" → "slice" (simple plural). */
const one = (w: string) => w.replace(/(ies)$/, 'y').replace(/(ches|shes|xes)$/, (m) => m.slice(0, -2)).replace(/s$/, '')

/**
 * A quick-add line that names a saved thing: "standard day" / "my day", a
 * saved meal by its name or its slot word ("breakfast"), or "2 eggs" /
 * "egg" / "banana" for a saved food. Null when nothing matches.
 */
export function matchSaved(line: string, s: FoodSaved): SavedMatch | null {
  const t = words(String(line ?? '').replace(/^(?:ate|eat|had|log)\s+/i, ''))
  if (!t) return null
  if (/^(?:my |the )?(?:standard|usual|normal) day$|^my day$/.test(t) && s.day.slots.length) return { kind: 'day' }
  const byName = s.meals.find((m) => words(m.name) === t) ?? s.meals.find((m) => words(m.name.split(':')[0]) === t) ?? s.meals.find((m) => m.slot === t)
  if (byName) return { kind: 'meal', meal: byName }
  const m = /^(\d+(?:\.\d+)?|a|an|one|two|three|four|five|half)?\s*(?:x\s*)?([a-z][a-z0-9 ]*)$/.exec(t)
  if (!m) return null
  const nums: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5 }
  const qty = m[1] ? (nums[m[1]] ?? Number(m[1])) : 1
  const want = m[2].split(' ').map(one).join(' ')
  const norm = (f: SavedFood) => words(f.name).split(' ').map(one).join(' ')
  const hit =
    s.foods.find((f) => norm(f) === want) ??
    s.foods.find((f) => want.length >= 3 && ` ${norm(f)} `.includes(` ${want} `)) ??
    s.foods.find((f) => want.length >= 4 && norm(f).startsWith(want))
  // At most 6 portions from a typed line: "45 coffee" is money, not 45 coffees.
  if (!hit || !(qty > 0) || qty > QUICK_MAX) return null
  return { kind: 'food', food: hit, qty: cleanQty(qty) }
}
