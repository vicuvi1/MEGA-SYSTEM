// "What to eat next": how to cover the protein still left today, from your own
// most-logged high-protein foods first, then a small built-in list, within the
// kcal still left. "58 g protein left: 250 g chicken breast, or 3 eggs + 300 g
// skyr, or a shake". Pure and tested. Values are approximate.
import { addDays } from './dates'
import type { FoodMeal } from './food'
import { normFood } from './foodTable'

export interface NextFood {
  name: string
  /** Protein per gram and kcal per gram. */
  pPerG: number
  kPerG: number
  /** Counted in pieces (eggs, shakes): grams of one piece and its words. */
  piece?: { grams: number; one: string; many: string; single: string }
  own?: boolean
}

/** Built-in foods (approximate, generic values). */
export const BUILTIN: NextFood[] = [
  { name: 'chicken breast', pPerG: 0.31, kPerG: 1.65 },
  { name: 'skyr', pPerG: 0.11, kPerG: 0.63 },
  { name: 'eggs', pPerG: 0.125, kPerG: 1.43, piece: { grams: 50, one: 'egg', many: 'eggs', single: '1 egg' } },
  { name: 'cottage cheese', pPerG: 0.12, kPerG: 0.98 },
  { name: 'tuna', pPerG: 0.26, kPerG: 1.16 },
  { name: 'greek yogurt', pPerG: 0.1, kPerG: 0.97 },
  { name: 'shake', pPerG: 0.8, kPerG: 4, piece: { grams: 30, one: 'shake', many: 'shakes', single: 'a shake' } }
]

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Your own high-protein foods from the last 30 days, most logged first: at
 * least 10 g protein per 100 g and at least 25% of kcal from protein.
 */
export function ownFoods(meals: FoodMeal[], today: string, n = 4): NextFood[] {
  const from = addDays(today, -30)
  const by = new Map<string, { name: string; count: number; p: number; k: number; g: number }>()
  for (const m of meals) {
    if (m.day < from || m.day > today) continue
    for (const it of m.items) {
      const key = norm(it.name)
      if (!key || it.grams <= 0) continue
      const x = by.get(key) ?? { name: key, count: 0, p: 0, k: 0, g: 0 }
      x.count++
      x.p += it.protein
      x.k += it.kcal
      x.g += it.grams
      by.set(key, x)
    }
  }
  return [...by.values()]
    .filter((x) => x.g > 0 && x.p / x.g >= 0.1 && (x.k <= 0 || (4 * x.p) / x.k >= 0.25))
    .sort((a, b) => b.count - a.count || b.p / b.g - a.p / a.g)
    .slice(0, n)
    .map((x) => {
      const builtin = BUILTIN.find((b) => b.piece && norm(b.name) === x.name)
      return { name: x.name, pPerG: x.p / x.g, kPerG: x.k / x.g, own: true, ...(builtin?.piece ? { piece: builtin.piece } : {}) }
    })
}

export interface Portion {
  food: NextFood
  grams: number
  protein: number
  kcal: number
  text: string
}

/** A portion that gives about `protein` g (max 400 g, pieces 1–6). */
export function portionFor(food: NextFood, protein: number, maxGrams = 400): Portion {
  if (food.piece) {
    const per = food.piece.grams * food.pPerG
    const n = Math.max(1, Math.min(6, Math.round(protein / per)))
    const grams = n * food.piece.grams
    return { food, grams, protein: Math.round(grams * food.pPerG), kcal: Math.round(grams * food.kPerG), text: n === 1 ? food.piece.single : `${n} ${food.piece.many}` }
  }
  const raw = protein / food.pPerG
  const grams = Math.max(50, Math.min(maxGrams, Math.round(raw / 50) * 50))
  return { food, grams, protein: Math.round(grams * food.pPerG), kcal: Math.round(grams * food.kPerG), text: `${grams} g ${food.name}` }
}

export interface NextIdea {
  text: string
  protein: number
  kcal: number
}

export interface WhatNext {
  line: string
  ideas: NextIdea[]
  proteinLeft: number
  kcalLeft: number
}

/**
 * Up to 3 ideas: one food that covers it, two foods together, and a shake.
 * Ideas over the kcal left (+100) are dropped while leaner ones remain.
 */
export function whatToEatNext(o: { proteinLeft: number; kcalLeft: number; own?: NextFood[]; cheap?: Record<string, number> }): WhatNext {
  const left = Math.max(0, Math.round(o.proteinLeft))
  const kLeft = Math.round(o.kcalLeft)
  if (left <= 0) {
    const line = kLeft > 150 ? `Protein done for today. About ${kLeft.toLocaleString('en-US')} kcal left today: rice, oats, fruit or bread.` : 'Protein and kcal done for today. Nice.'
    return { line, ideas: [], proteinLeft: 0, kcalLeft: kLeft }
  }
  const pool: NextFood[] = []
  for (const f of [...(o.own ?? []), ...BUILTIN]) if (!pool.some((p) => norm(p.name) === norm(f.name) || (p.piece && f.piece && p.piece.one === f.piece.one))) pool.push(f)
  // Tie-breaker: your own foods keep their place; the built-in ones go cheapest protein first (grams per leu).
  if (o.cheap) {
    const per = (f: NextFood) => o.cheap![normFood(f.name)] ?? 0
    const ownPart = pool.filter((f) => f.own)
    const rest = pool.filter((f) => !f.own).sort((a, b) => per(b) - per(a))
    pool.splice(0, pool.length, ...ownPart, ...rest)
  }
  const solid = pool.filter((f) => f.name !== 'shake')
  // A lot left: plan the next meal (about 50 g), not the whole day in one go.
  const aim = left > 60 ? 50 : left
  const fits = (kcal: number) => kLeft <= 0 || kcal <= kLeft + 100
  const ideas: NextIdea[] = []
  // 1) One food that covers it (most-logged first; else the leanest).
  const singles = solid.map((f) => portionFor(f, aim)).filter((p) => p.protein >= aim * 0.85)
  const lean = (a: Portion, b: Portion) => a.kcal / Math.max(1, a.protein) - b.kcal / Math.max(1, b.protein)
  const single = singles.find((p) => fits(p.kcal)) ?? (kLeft <= 0 ? singles.slice().sort(lean)[0] : undefined)
  if (single) ideas.push({ text: single.text, protein: single.protein, kcal: single.kcal })
  // 2) Two foods together (a piece food + a weighed one, or two weighed).
  const used = new Set(single ? [single.food.name] : [])
  // Piece foods first ("3 eggs + 300 g skyr"); the order is otherwise kept (your own foods first).
  const rest = solid.filter((f) => !used.has(f.name)).sort((x, y) => (y.piece ? 1 : 0) - (x.piece ? 1 : 0))
  let combo: { text: string; protein: number; kcal: number } | null = null
  for (const a of rest) {
    for (const b of rest) {
      if (a === b || (a.piece && b.piece)) continue
      if (b.piece && !a.piece) continue
      const pa = portionFor(a, Math.min(aim / 2, a.piece ? 18 : aim / 2))
      const pb = portionFor(b, aim - pa.protein)
      const p = pa.protein + pb.protein
      const k = pa.kcal + pb.kcal
      if (p >= aim * 0.85 && fits(k)) {
        combo = { text: `${pa.text} + ${pb.text}`, protein: p, kcal: k }
        break
      }
    }
    if (combo) break
  }
  if (combo) ideas.push(combo)
  // 3) One shake, topped up with the leanest food if still short.
  const shake = pool.find((f) => f.name === 'shake')!
  const sh = portionFor(shake, Math.min(aim, 24))
  if (sh.protein >= aim * 0.85) {
    if (fits(sh.kcal)) ideas.push({ text: sh.text, protein: sh.protein, kcal: sh.kcal })
  } else {
    const top = solid.slice().sort((a, b) => a.kPerG / a.pPerG - b.kPerG / b.pPerG)[0]
    const pt = portionFor(top, aim - sh.protein)
    if (fits(sh.kcal + pt.kcal)) ideas.push({ text: `${sh.text} + ${pt.text}`, protein: sh.protein + pt.protein, kcal: sh.kcal + pt.kcal })
  }
  const head = aim < left ? `${left} g protein left today. Next meal, about ${aim} g` : `${left} g protein left`
  const line = ideas.length ? `${head}: ${ideas.map((i) => i.text).join(', or ')}` : `${head}, but only ${Math.max(0, kLeft)} kcal: pick something lean, like skyr or chicken breast.`
  return { line, ideas, proteinLeft: left, kcalLeft: kLeft }
}
