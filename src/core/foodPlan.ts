// Plans from the foods you eat: a 7-day shopping list (what and how much to
// buy, from the protein goal and your usual foods, with made-up MDL prices you
// can edit) and a Sunday meal prep for 3 days (boxes, grams per box, macros).
// Both end in plain text you can copy. Meat is bought raw and rice, pasta and
// pulses dry, so the shop amounts are the cooked weights times a factor.
// Pure and tested.
import { cheapProtein } from './foodCheap'
import { FOOD_TABLE, normFood, type OwnFood, type Per100 } from './foodTable'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const r10 = (n: number) => Math.round(n / 10) * 10
const r50 = (n: number) => Math.round(n / 50) * 50

/** Raw or dry weight to buy per gram eaten (cooked meat loses a quarter; rice, pasta and pulses triple). */
const BUY: Record<string, number> = { 'chicken breast': 1.3, 'chicken thigh': 1.3, beef: 1.3, pork: 1.3, salmon: 1.2, rice: 0.4, pasta: 0.45, buckwheat: 0.4, lentils: 0.4, beans: 0.4, chickpeas: 0.4, polenta: 0.3 }
const buyFactor = (name: string) => BUY[normFood(name)] ?? 1

const kgText = (g: number) => {
  const r = r50(g) || 50
  return r >= 1000 ? `${Math.round(r / 100) / 10} kg` : `${r} g`
}

interface Pick extends Per100 {
  own: boolean
  mdlKg: number
  each?: number
  eachWord?: string
}

const tableOf = (name: string) => FOOD_TABLE.find((t) => normFood(t.name) === normFood(name))

/** High-protein foods you eat (own first, most logged), then the best value from the table. */
function proteinFoods(own: OwnFood[], prices: Record<string, number>, n: number): Pick[] {
  const price = (name: string) => {
    const k = normFood(name)
    for (const [key, v] of Object.entries(prices)) if (normFood(key) === k && v > 0) return v
    return tableOf(name)?.mdlKg ?? 0
  }
  const out: Pick[] = []
  const add = (o: Per100, isOwn: boolean) => {
    if (out.length >= n || out.some((x) => normFood(x.name) === normFood(o.name))) return
    const t = tableOf(o.name)
    const eachWord = t?.each && t.units?.[t.each] ? t.each : undefined
    out.push({ ...o, own: isOwn, mdlKg: price(o.name), ...(eachWord ? { each: t!.units![eachWord], eachWord } : {}) })
  }
  for (const o of own) if (o.p >= 10 && !tableOf(o.name)?.carb && !/whey|shake|creatine|vitamin/.test(o.name) && o.k > 0 && (4 * o.p) / o.k >= 0.25 && o.name !== 'whey protein') add(o, true)
  for (const r of cheapProtein(prices)) {
    const t = tableOf(r.name)
    if (!t || t.p < 10 || t.carb || t.name === 'whey protein' || t.name === 'peanuts') continue
    add(t, false)
  }
  return out
}

export interface ShopLine {
  name: string
  /** "1.5 kg", "14 eggs". */
  buy: string
  /** Eaten (cooked) grams for the week. */
  grams: number
  protein: number
  mdl: number | null
  own: boolean
}

export interface ShoppingList {
  days: number
  proteinGoal: number
  lines: ShopLine[]
  mdl: number
  text: string
}

/**
 * What to buy for `days` days: 4 protein foods that cover about 80% of the
 * protein goal (your own foods first, then the best value), and rice and oats
 * for the carbs. Amounts round to 50 g; eggs are counted.
 */
export function shoppingList(o: { proteinGoal: number; carbsGoal: number; days?: number; own?: OwnFood[]; prices?: Record<string, number> }): ShoppingList {
  const days = o.days ?? 7
  const weekly = Math.max(0, Math.round(o.proteinGoal)) * days
  const prices = o.prices ?? {}
  const foods = proteinFoods(o.own ?? [], prices, 4)
  const each = foods.length ? (weekly * 0.8) / foods.length : 0
  const lines: ShopLine[] = []
  for (const f of foods) {
    const g = Math.max(50, r50((each / f.p) * 100))
    const buyG = g * buyFactor(f.name)
    const mdl = f.mdlKg ? Math.round((buyG / 1000) * f.mdlKg) : null
    const buy = f.eachWord && f.each ? `${Math.max(1, Math.round(g / f.each))} ${f.eachWord === 'egg' ? 'eggs' : f.eachWord}` : kgText(buyG)
    lines.push({ name: f.eachWord === 'egg' ? 'eggs' : f.name, buy, grams: g, protein: Math.round((g * f.p) / 100), mdl, own: f.own })
  }
  // Carbs: rice and oats share half of the week's carbs (the rest comes from fruit, bread and the other foods).
  const carbWeek = Math.max(0, Math.round(o.carbsGoal)) * days * 0.5
  for (const name of ['rice', 'oats']) {
    const t = tableOf(name)!
    const g = Math.max(100, r50(carbWeek / 2 / (t.c / 100)))
    const buyG = g * buyFactor(name)
    lines.push({ name: name === 'rice' ? 'rice (dry)' : t.name, buy: kgText(buyG), grams: g, protein: Math.round((g * t.p) / 100), mdl: t.mdlKg ? Math.round((buyG / 1000) * t.mdlKg) : null, own: false })
  }
  const mdl = lines.reduce((t, l) => t + (l.mdl ?? 0), 0)
  const text = [
    `Shopping list for ${days} days`,
    `Protein goal ${fmt(o.proteinGoal)} g a day, ${fmt(weekly)} g for the week. Meat raw, rice dry.`,
    ...lines.map((l) => `- ${l.name.charAt(0).toUpperCase()}${l.name.slice(1)}: ${l.buy}${l.mdl != null ? ` (about ${fmt(l.mdl)} MDL)` : ''}`),
    `About ${fmt(mdl)} MDL in all. Prices are estimates you can edit.`
  ].join('\n')
  return { days, proteinGoal: o.proteinGoal, lines, mdl, text }
}

export interface PrepBox {
  protein: { name: string; grams: number }
  carb: { name: string; grams: number }
  veg: { name: string; grams: number }
  macros: { protein: number; carbs: number; fat: number; kcal: number }
}

export interface PrepPlan {
  days: number
  boxes: number
  box: PrepBox
  /** Cooked grams to make for all boxes, and what to buy raw / dry. */
  total: { name: string; cooked: number; buy: string }[]
  text: string
}

/**
 * A Sunday prep for `days` days, two boxes a day. Each box is a quarter of
 * the day's protein and kcal: your most-logged protein food, your usual carb
 * (rice when you have none) and 100 g of vegetables. Cooked weights.
 */
export function prepPlan(o: { proteinGoal: number; kcalGoal: number; days?: number; own?: OwnFood[]; prices?: Record<string, number> }): PrepPlan {
  const days = o.days ?? 3
  const boxes = days * 2
  const own = o.own ?? []
  const prot = proteinFoods(own, o.prices ?? {}, 1)[0] ?? { ...tableOf('chicken breast')!, own: false, mdlKg: 95 }
  const ownCarb = own.find((x) => x.c >= 15 && x.p < 12 && x.f < 12 && x.k < 400 && !tableOf(x.name)?.units?.banana)
  const carb: Per100 = ownCarb ?? tableOf('rice')!
  const veg = tableOf('vegetables')!
  const pGrams = Math.max(50, r10(((o.proteinGoal * 0.25) / Math.max(1, prot.p)) * 100))
  const proteinKcal = (pGrams * prot.k) / 100
  const vegG = 100
  const boxKcal = o.kcalGoal * 0.25
  const cGrams = Math.max(50, Math.min(350, r10(((boxKcal - proteinKcal - (vegG * veg.k) / 100) / Math.max(1, carb.k)) * 100)))
  const m = (g: number, f: Per100) => ({ p: (g * f.p) / 100, c: (g * f.c) / 100, f: (g * f.f) / 100, k: (g * f.k) / 100 })
  const a = m(pGrams, prot)
  const b = m(cGrams, carb)
  const c = m(vegG, veg)
  const box: PrepBox = {
    protein: { name: prot.name, grams: pGrams },
    carb: { name: carb.name, grams: cGrams },
    veg: { name: veg.name, grams: vegG },
    macros: { protein: Math.round(a.p + b.p + c.p), carbs: Math.round(a.c + b.c + c.c), fat: Math.round(a.f + b.f + c.f), kcal: Math.round(a.k + b.k + c.k) }
  }
  const total = [box.protein, box.carb, box.veg].map((x) => ({ name: x.name, cooked: x.grams * boxes, buy: kgText(x.grams * boxes * buyFactor(x.name)) }))
  const text = [
    `Sunday meal prep: ${days} days, ${boxes} boxes (2 a day)`,
    `Each box: ${pGrams} g ${prot.name} + ${cGrams} g ${carb.name} + ${vegG} g vegetables (cooked weights).`,
    `One box: ${box.macros.protein} g protein, ${fmt(box.macros.kcal)} kcal, carbs ${box.macros.carbs} g, fat ${box.macros.fat} g.`,
    `Cook in all: ${total.map((t) => `${fmt(t.cooked)} g ${t.name}`).join(', ')}.`,
    `Buy raw or dry: ${total.map((t) => `${t.name} ${t.buy}`).join(', ')}.`,
    `Two boxes a day cover about half of your ${fmt(o.proteinGoal)} g protein. Eat the rest as normal meals.`
  ].join('\n')
  return { days, boxes, box, total, text }
}

