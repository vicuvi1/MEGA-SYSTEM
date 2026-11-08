// A small built-in food table for "quick add in words" ("200g chicken, 2 eggs"),
// the protein-per-lei list and the shopping / prep plans. Values are per 100 g
// as eaten (cooked weights for meat, rice, pasta and pulses; dry for oats,
// bread and nuts), rounded, generic and approximate. Prices are made-up but
// realistic Moldovan lei (MDL) per kg; the owner can edit them. Pure and tested.
import { addDays } from './dates'
import type { FoodMeal } from './food'

export interface Per100 {
  name: string
  p: number
  c: number
  f: number
  k: number
}

export interface TableFood extends Per100 {
  /** Other words for it (lower case). */
  alias: string[]
  /** Grams in one unit ("egg": 50, "slice": 30). */
  units?: Record<string, number>
  /** The unit a bare count means ("2 eggs", "a banana"). */
  each?: string
  /** Made-up price in MDL per kg (omit: not priced). */
  mdlKg?: number
  /** A protein food worth listing by protein per lei. */
  protein?: boolean
  /** A carb staple the shopping list and prep plan can use. */
  carb?: boolean
}

const F = (name: string, p: number, c: number, f: number, k: number, more: Partial<TableFood> = {}): TableFood => ({ name, p, c, f, k, alias: [], ...more })

export const FOOD_TABLE: TableFood[] = [
  F('chicken breast', 31, 0, 3.6, 165, { alias: ['chicken', 'chicken fillet', 'fillet'], mdlKg: 95, protein: true }),
  F('chicken thigh', 26, 0, 9, 190, { alias: ['chicken leg', 'chicken drumstick', 'drumstick'], mdlKg: 55, protein: true }),
  F('beef', 26, 0, 15, 250, { alias: ['minced beef', 'steak', 'mince'], mdlKg: 170, protein: true }),
  F('pork', 27, 0, 9, 195, { alias: ['pork loin'], mdlKg: 120, protein: true }),
  F('salmon', 22, 0, 12, 208, { alias: ['fish'], mdlKg: 260, protein: true }),
  F('tuna', 26, 0, 1, 116, { alias: ['canned tuna', 'tuna can'], units: { can: 120, tin: 120 }, mdlKg: 180, protein: true }),
  F('egg', 12.5, 1, 10, 143, { alias: ['boiled egg', 'fried egg'], units: { egg: 50 }, each: 'egg', mdlKg: 55, protein: true }),
  F('skyr', 11, 4, 0.2, 63, { alias: ['icelandic yogurt'], units: { pot: 150, cup: 150 }, mdlKg: 120, protein: true }),
  F('cottage cheese', 12, 3, 4, 98, { alias: ['branza de vaci', 'curd'], units: { pot: 200 }, mdlKg: 70, protein: true }),
  F('greek yogurt', 10, 4, 5, 97, { alias: ['greek yoghurt'], units: { pot: 150, cup: 200 }, mdlKg: 75, protein: true }),
  F('yogurt', 4, 5, 3, 60, { alias: ['yoghurt'], units: { pot: 150, cup: 200 }, mdlKg: 40 }),
  F('milk', 3.4, 5, 1.8, 50, { units: { cup: 250, glass: 250 }, mdlKg: 22, protein: true }),
  F('kefir', 3.3, 4, 2.5, 52, { units: { cup: 250, glass: 250 }, mdlKg: 25, protein: true }),
  F('cheese', 25, 1, 30, 400, { units: { slice: 20 }, mdlKg: 150 }),
  F('brinza', 14, 4, 21, 264, { alias: ['feta', 'sheep cheese'], mdlKg: 130 }),
  F('sour cream', 2.5, 3, 20, 200, { alias: ['smetana'], units: { tbsp: 20 }, mdlKg: 70 }),
  F('rice', 2.7, 28, 0.3, 130, { alias: ['cooked rice', 'white rice'], units: { cup: 160, bowl: 200 }, mdlKg: 28, carb: true }),
  F('pasta', 5, 25, 1, 131, { alias: ['spaghetti', 'macaroni'], units: { cup: 140, bowl: 200 }, mdlKg: 30, carb: true }),
  F('potato', 2, 17, 0.1, 77, { alias: ['boiled potato'], units: { potato: 150 }, each: 'potato', mdlKg: 14, carb: true }),
  F('buckwheat', 3.4, 20, 0.6, 92, { alias: ['grechka'], units: { cup: 170, bowl: 200 }, mdlKg: 35, carb: true }),
  F('polenta', 1.5, 12, 0.4, 62, { alias: ['mamaliga'], units: { bowl: 250 }, mdlKg: 12, carb: true }),
  F('oats', 13, 66, 7, 380, { alias: ['oatmeal', 'porridge oats'], units: { cup: 90 }, mdlKg: 30, carb: true }),
  F('bread', 9, 49, 3, 265, { alias: ['toast'], units: { slice: 30 }, each: 'slice', mdlKg: 24, carb: true }),
  F('lentils', 9, 20, 0.4, 116, { mdlKg: 40, protein: true }),
  F('beans', 8, 21, 0.5, 127, { alias: ['white beans'], mdlKg: 45, protein: true }),
  F('chickpeas', 9, 27, 3, 164, { mdlKg: 50, protein: true }),
  F('banana', 1, 23, 0.3, 89, { units: { banana: 120 }, each: 'banana', mdlKg: 35 }),
  F('apple', 0.3, 14, 0.2, 52, { units: { apple: 180 }, each: 'apple', mdlKg: 18 }),
  F('orange', 0.9, 12, 0.1, 47, { units: { orange: 150 }, each: 'orange', mdlKg: 25 }),
  F('tomato', 0.9, 3.9, 0.2, 18, { units: { tomato: 120 }, each: 'tomato', mdlKg: 30 }),
  F('cucumber', 0.7, 3.6, 0.1, 15, { units: { cucumber: 200 }, each: 'cucumber', mdlKg: 25 }),
  F('vegetables', 2, 5, 0.3, 30, { alias: ['veg', 'salad', 'broccoli', 'carrot'], mdlKg: 30 }),
  F('peanut butter', 25, 20, 50, 588, { alias: ['peanut paste'], units: { tbsp: 16, spoon: 16 }, mdlKg: 150 }),
  F('peanuts', 26, 16, 49, 567, { units: { handful: 30 }, mdlKg: 80, protein: true }),
  F('nuts', 21, 22, 50, 579, { alias: ['almonds', 'walnuts'], units: { handful: 30 }, mdlKg: 200 }),
  F('olive oil', 0, 0, 100, 884, { alias: ['oil', 'sunflower oil'], units: { tbsp: 14, tsp: 5 }, mdlKg: 120 }),
  F('butter', 0.9, 0.1, 81, 717, { units: { tbsp: 14, tsp: 5 }, mdlKg: 160 }),
  F('honey', 0.3, 82, 0, 304, { units: { tbsp: 21, tsp: 7 }, mdlKg: 150 }),
  F('chocolate', 5, 60, 30, 540, { units: { square: 10 }, mdlKg: 200 }),
  F('whey protein', 80, 8, 6, 390, { alias: ['whey', 'protein powder', 'protein shake', 'shake'], units: { scoop: 30, shake: 30 }, each: 'scoop', mdlKg: 380, protein: true })
]

/** Grams of one unit when the food has no own value for it. */
export const GENERIC_UNITS: Record<string, number> = { tbsp: 15, spoon: 15, tsp: 5, cup: 240, glass: 250, bowl: 200, handful: 30, slice: 30, can: 120, pot: 150 }

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
/** "eggs" → "egg", "potatoes" → "potato" (a light singular). */
export const singular = (w: string) => (w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 4 && w.endsWith('oes') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
export const normFood = (s: string) => norm(s).split(' ').map(singular).join(' ')

export interface OwnFood extends Per100 {
  count: number
}

/** The owner's own foods (last 45 days of meals) as per-100 g values, most logged first. */
export function ownPer100(meals: FoodMeal[], today: string, max = 40): OwnFood[] {
  const from = addDays(today, -45)
  const by = new Map<string, { name: string; count: number; p: number; c: number; f: number; k: number; g: number }>()
  for (const m of meals) {
    if (m.day < from || m.day > today || m.supp) continue
    for (const it of m.items) {
      const key = normFood(it.name)
      if (!key || it.grams <= 0) continue
      const x = by.get(key) ?? { name: norm(it.name), count: 0, p: 0, c: 0, f: 0, k: 0, g: 0 }
      x.count++
      x.p += it.protein
      x.c += it.carbs
      x.f += it.fat
      x.k += it.kcal
      x.g += it.grams
      by.set(key, x)
    }
  }
  const r1 = (n: number) => Math.round(n * 10) / 10
  return [...by.values()]
    .filter((x) => x.g > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, max)
    .map((x) => ({ name: x.name, count: x.count, p: r1((x.p / x.g) * 100), c: r1((x.c / x.g) * 100), f: r1((x.f / x.g) * 100), k: Math.round((x.k / x.g) * 100) }))
}
