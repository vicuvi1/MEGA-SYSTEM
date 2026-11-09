// Quick add in words: "200g chicken, 150g rice, 2 eggs, 1 banana" → food items,
// from the small built-in table (core/foodTable.ts) and the owner's own logged
// foods (own foods win). Unknown words and missing amounts are listed, never
// guessed. Pure and tested; the draft is edited and saved like a pasted reply.
import { GENERIC_UNITS, FOOD_TABLE, normFood, type Per100, type TableFood } from './foodTable'
import { cleanItem, type FoodItem } from './food'

export interface WordsResult {
  items: FoodItem[]
  /** Words that match no known food (ask for the photo or label prompt). */
  unknown: string[]
  /** Known foods with no amount ("chicken": how many grams?). */
  needGrams: string[]
  /** One plain sentence for the page, or '' when everything was read. */
  say: string
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5, '1/2': 0.5 }
const UNITS = ['kg', 'g', 'gr', 'gram', 'gram', 'ml', 'l', 'egg', 'banana', 'slice', 'scoop', 'shake', 'cup', 'glass', 'bowl', 'tbsp', 'tsp', 'spoon', 'handful', 'can', 'pot', 'square', 'potato', 'apple', 'orange', 'tomato', 'cucumber']
const COUNTABLE = ['egg', 'banana', 'potato', 'apple', 'orange', 'tomato', 'cucumber']

interface Hit {
  name: string
  p: number
  c: number
  f: number
  k: number
  units?: Record<string, number>
  each?: string
}

const num = (s: string) => Number(s.replace(',', '.'))

function findFood(word: string, own: Per100[]): Hit | null {
  const w = normFood(word)
  if (!w) return null
  const hit: TableFood | undefined =
    FOOD_TABLE.find((t) => normFood(t.name) === w || t.alias.some((a) => normFood(a) === w)) ??
    FOOD_TABLE.find((t) => [t.name, ...t.alias].some((a) => normFood(a).split(' ').includes(w)))
  const mine = own.find((o) => normFood(o.name) === w)
  // Your own numbers win; the table's units ("1 egg" = 50 g) still help with counts.
  const same = hit && mine && [hit.name, ...hit.alias].some((a) => normFood(a) === w)
  if (mine) return { name: mine.name, p: mine.p, c: mine.c, f: mine.f, k: mine.k, ...(same ? { units: hit!.units, each: hit!.each } : {}) }
  if (hit) return { name: hit.name, p: hit.p, c: hit.c, f: hit.f, k: hit.k, units: hit.units, each: hit.each }
  const near = own.find((o) => normFood(o.name).split(' ').includes(w) || (w.split(' ').includes(normFood(o.name)) && normFood(o.name).length > 3))
  return near ? { name: near.name, p: near.p, c: near.c, f: near.f, k: near.k } : null
}

const unitKey = (u: string) => {
  const s = normFood(u)
  return s === 'gr' || s === 'gram' ? 'g' : s
}
const isUnit = (u: string) => UNITS.includes(unitKey(u))

const itemFrom = (h: Hit, grams: number): FoodItem | null => {
  const g = Math.max(1, Math.round(grams))
  const f = g / 100
  return cleanItem({ name: h.name, grams: g, protein: h.p * f, carbs: h.c * f, fat: h.f * f, kcal: h.k * f, confidence: 'roughly' })
}

/** Reads a short "what I ate" line. Never throws. */
export function parseFoodWords(text: string, own: Per100[] = []): WordsResult {
  const items: FoodItem[] = []
  const unknown: string[] = []
  const needGrams: string[] = []
  const pieces = String(text ?? '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\band\b/g, ',')
    .split(/[,;\n+&]/)
    .map((s) => s.replace(/^\s*(some|about|around|~)\s+/, '').trim())
    .filter(Boolean)
    .slice(0, 20)
  for (const piece of pieces) {
    let qty: number | null = null
    let unit = ''
    let name = ''
    let m: RegExpMatchArray | null
    if ((m = piece.match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|gr|grams?|ml|l)\b\s*(?:of\s+)?(.+)$/))) {
      qty = num(m[1])
      unit = unitKey(m[2])
      name = m[3]
    } else if ((m = piece.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(kg|g|gr|grams?|ml|l)$/))) {
      name = m[1]
      qty = num(m[2])
      unit = unitKey(m[3])
    } else if ((m = piece.match(/^(\d+(?:[.,]\d+)?|an?|one|two|three|four|five|six|half|1\/2)\s+(?:a\s+)?(.+)$/))) {
      qty = NUMBER_WORDS[m[1]] ?? num(m[1])
      const words = m[2].replace(/^of\s+/, '').split(' ')
      if (isUnit(words[0])) {
        unit = unitKey(words[0])
        name = words.slice(1).join(' ').replace(/^of\s+/, '')
      } else name = words.join(' ')
    } else name = piece
    name = name.replace(/\s+/g, ' ').trim()
    // "2 scoops" / "1 shake" with no food named: the whey. "2 eggs": the unit is the food.
    if (!name && (unit === 'scoop' || unit === 'shake')) name = 'whey protein'
    if (!name && COUNTABLE.includes(unit)) (name = unit), (unit = '')
    const hit = findFood(name, own)
    if (!hit) {
      unknown.push(name || piece)
      continue
    }
    let grams: number | null = null
    if (qty != null && (unit === 'g' || unit === 'ml')) grams = qty
    else if (qty != null && (unit === 'kg' || unit === 'l')) grams = qty * 1000
    else if (qty != null) {
      const per = unit ? hit.units?.[unit] ?? GENERIC_UNITS[unit] : hit.each ? hit.units?.[hit.each] : undefined
      if (per) grams = qty * per
    } else if (hit.each && hit.units?.[hit.each]) grams = hit.units[hit.each]
    if (grams == null || !(grams > 0)) {
      needGrams.push(hit.name)
      continue
    }
    const it = itemFrom(hit, grams)
    if (it) items.push(it)
  }
  const bits: string[] = []
  if (needGrams.length) bits.push(`How many grams of ${needGrams.join(', ')}? Write it like "150g ${needGrams[0]}".`)
  if (unknown.length) bits.push(`I don't know ${unknown.map((u) => `"${u}"`).join(', ')} yet. Use "Copy prompt" with a photo, or "Copy label prompt" for packaged food.`)
  if (!pieces.length) bits.push('Write what you ate, like "200g chicken, 150g rice, 2 eggs".')
  return { items, unknown, needGrams, say: bits.join(' ') }
}
