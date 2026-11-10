// The meal score (pure, tested): A–D from three plain parts, with one tip.
// - protein: enough for a meal (30 g+, or 20 g+ that is a fair share of the kcal);
// - fibre: vegetables, beans, whole grains, fruit (8 g+ is great);
// - how processed: the share of the kcal from ultra-processed food (sausage,
//   chips, sweets, soda…).
// Fibre and "ultra-processed" come from the photo read when the AI gave them
// (`fiber`, `upf` on an item); otherwise a small table of food words estimates
// them. Information only: nothing here pays points.
import type { FoodItem } from './food'

export type Grade = 'A' | 'B' | 'C' | 'D'
export type Part = 0 | 1 | 2
export interface MealScore {
  grade: Grade
  /** 0–6: the three parts added up. */
  points: number
  parts: { protein: Part; fiber: Part; whole: Part }
  protein: number
  /** Grams of fibre (estimated when the read gave none). */
  fiber: number
  /** Share of the kcal from ultra-processed food, 0–1. */
  upf: number
  /** One short tip for the weakest part. */
  tip: string
}

const norm = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** Fibre per 100 g by food word (as eaten), first match wins: the longer words come first. */
const FIBER: [RegExp, number][] = [
  [/\b(chia|flax|linseed)/, 30],
  [/\b(bran)\b/, 40],
  [/\b(oat ?meal|porridge)\b/, 1.7],
  [/\b(oats?|muesli|granola)\b/, 10],
  [/\b(almond|walnut|hazelnut|peanut|cashew|nuts?|seeds?)\b/, 8],
  [/\b(lentils?|beans?|chickpeas?|peas|hummus|linte|fasole|naut)\b/, 6.5],
  [/\b(rye|wholegrain|whole grain|whole wheat|wholemeal|integral)\b/, 6],
  [/\b(bulgur)\b/, 4.5],
  [/\b(raspberr|blackberr|berries|berry)/, 5],
  [/\b(buckwheat|hrisca|hriscă|grechka)\b/, 2.7],
  [/\b(broccoli|brussels|cabbage|varza|carrots?|morcov|spinach|kale|cauliflower|peppers?|ardei|zucchini|eggplant|vinete|beets?|sfecla|green beans|salad|salata|vegetables?|veggies?|legume|cucumbers?|castraveti|tomato(es)?|rosii|onions?|ceapa|mushrooms?|ciuperci|lettuce)\b/, 2.5],
  [/\b(apple|pear|orange|banana|kiwi|plum|prune|mar|para|portocala|fruit)s?\b/, 2.4],
  [/\b(potato(es)?|cartofi|sweet potato)\b/, 2],
  [/\b(pasta|spaghetti|macaroni|paste)\b/, 1.8],
  [/\b(brown rice)\b/, 1.8],
  [/\b(bread|paine|toast|bun|roll)\b/, 2.7],
  [/\b(rice|orez)\b/, 0.4]
]

/** Ultra-processed by food word (NOVA group 4, the common ones). */
const UPF = /\b(sausages?|carnati|crenvursti|salami|hot ?dogs?|nuggets?|bacon|ham|sunca|chips|crisps|fries|cartofi prajiti|soda|cola|pepsi|fanta|energy drink|lemonade|candy|candies|sweets|bomboane|chocolate bar|snickers|mars bar|cookies?|biscuits?|biscuiti|wafers?|napolitane|cake|croissant|donut|doughnut|muffin|ice cream|inghetata|pizza|burger|shawarma|instant noodles|ramen|mayonnaise|maioneza|ketchup|processed cheese|cascaval topit|protein bar|cereal bar|sweetened yogh?urt|margarine)\b/

/** Fibre in an item (the read's own number, else the table × grams). */
export function fiberOf(it: Pick<FoodItem, 'name' | 'grams'> & { fiber?: number }): number {
  if (typeof it.fiber === 'number' && Number.isFinite(it.fiber) && it.fiber >= 0) return it.fiber
  const n = norm(it.name)
  const hit = FIBER.find(([re]) => re.test(n))
  return hit ? Math.round(((hit[1] * (Number(it.grams) || 0)) / 100) * 10) / 10 : 0
}
/** Whether an item is ultra-processed (the read's own flag, else the word list). */
export const isUpf = (it: Pick<FoodItem, 'name'> & { upf?: boolean }): boolean => (typeof it.upf === 'boolean' ? it.upf : UPF.test(norm(it.name)))

const GRADE: Grade[] = ['D', 'D', 'C', 'C', 'B', 'A', 'A']

/** The meal's score from its foods, or null when there is nothing to score. */
export function mealScore(items: (FoodItem & { fiber?: number; upf?: boolean })[]): MealScore | null {
  const list = (items ?? []).filter((i) => i && (i.kcal > 0 || i.grams > 0))
  if (!list.length) return null
  const kcal = list.reduce((a, i) => a + (Number(i.kcal) || 0), 0)
  const protein = Math.round(list.reduce((a, i) => a + (Number(i.protein) || 0), 0))
  const fiber = Math.round(list.reduce((a, i) => a + fiberOf(i), 0) * 10) / 10
  const upfK = list.filter(isUpf).reduce((a, i) => a + (Number(i.kcal) || 0), 0)
  const upf = kcal > 0 ? Math.round((upfK / kcal) * 100) / 100 : 0
  // A snack (under 300 kcal) is judged as a snack: smaller numbers are fine.
  const snack = kcal < 300
  const share = kcal > 0 ? (4 * protein) / kcal : 0
  const p: Part = snack ? (share >= 0.25 || protein >= 15 ? 2 : protein >= 8 ? 1 : 0) : protein >= 30 || (protein >= 20 && share >= 0.2) ? 2 : protein >= 15 ? 1 : 0
  const f: Part = snack ? (fiber >= 4 ? 2 : fiber >= 2 ? 1 : 0) : fiber >= 8 ? 2 : fiber >= 4 ? 1 : 0
  const w: Part = upf <= 0.15 ? 2 : upf <= 0.5 ? 1 : 0
  const points = p + f + w
  return { grade: GRADE[points], points, parts: { protein: p, fiber: f, whole: w }, protein, fiber, upf, tip: tipFor({ protein: p, fiber: f, whole: w }, list) }
}

/** One tip for the weakest part (protein first, then fibre, then processing on a tie). */
function tipFor(parts: MealScore['parts'], items: FoodItem[]): string {
  const low = Math.min(parts.protein, parts.fiber, parts.whole)
  if (low === 2) return 'Great balance: keep meals like this.'
  if (parts.protein === low) return 'Add 20–30 g protein next time: 150 g chicken, 3 eggs or 250 g brânză de vaci.'
  if (parts.fiber === low) return 'Add fibre: a handful of vegetables, beans or a slice of rye bread.'
  const worst = items.filter(isUpf).sort((a, b) => b.kcal - a.kcal)[0]
  return worst ? `Swap the ${worst.name.toLowerCase()} for something less processed (eggs, meat, cheese or fruit).` : 'Pick less processed food next time.'
}

/** "B · 34 g protein, 6 g fibre" for a list line. */
export const scoreLine = (s: MealScore) => `${s.grade} · ${s.protein} g protein, ${Math.round(s.fiber)} g fibre${s.upf > 0.15 ? `, ${Math.round(s.upf * 100)}% processed` : ''}`
