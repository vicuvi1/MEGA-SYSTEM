// Protein for growing muscle (BD1, BD9): a daily goal from your body weight
// (1.6–2.2 g per kg), a small list of common foods with their protein per
// portion, quick logging ("protein 30", "2 eggs", "chicken 150g"), saved
// meals and the pre-shift fuel card. Every log is a row in the one body log
// (body_log) with kind `protein:<food id>` and the grams of protein as the
// amount, so it syncs, merges and undoes like water. Pure and tested.
//
// The values are APPROXIMATE, generic numbers from common food tables (for
// example USDA FoodData Central); real foods and labels vary. Nothing here
// pays points: logging food is information, not a habit reward.
import { addDays } from './dates'
import { liveIds, type BodyEvent } from './bodyLog'

export const PROTEIN_PREFIX = 'protein:'
export const proteinKind = (foodId: string) => `${PROTEIN_PREFIX}${String(foodId || 'other').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'other'}`
export const isProteinKind = (kind: string) => typeof kind === 'string' && kind.startsWith(PROTEIN_PREFIX)
export const foodIdOfKind = (kind: string) => (isProteinKind(kind) ? kind.slice(PROTEIN_PREFIX.length) : '')

export interface Food {
  id: string
  name: string
  /** One portion in words ("1 egg", "100 g cooked"). */
  portion: string
  /** Grams of protein in one portion (approximate). */
  g: number
  /** Grams of food in one portion, for "chicken 150g" (null: counted in pieces only). */
  grams: number | null
  /** Counted in pieces ("2 eggs", "3 slices"). */
  count?: boolean
  emoji: string
  /** Other words people write for it (English, Romanian, Russian). */
  alias: string[]
  /** Good for the shift snack list. */
  snack?: boolean
}

/** Common foods, generic values (approximate; labels vary). */
export const FOODS: Food[] = [
  { id: 'egg', name: 'Egg', portion: '1 egg', g: 6, grams: 50, count: true, emoji: '🥚', alias: ['eggs', 'ou', 'oua', 'ouă', 'яйцо', 'яйца'], snack: true },
  { id: 'chicken', name: 'Chicken breast', portion: '100 g cooked', g: 31, grams: 100, emoji: '🍗', alias: ['chicken breast', 'pui', 'piept de pui', 'курица'] },
  { id: 'cottage', name: 'Cottage cheese (brânză de vaci)', portion: '100 g', g: 14, grams: 100, emoji: '🧀', alias: ['cottage cheese', 'branza', 'brânză', 'branza de vaci', 'brânză de vaci', 'творог'], snack: true },
  { id: 'greek_yogurt', name: 'Greek yogurt', portion: '150 g', g: 15, grams: 150, emoji: '🥣', alias: ['greek yogurt', 'iaurt grecesc'], snack: true },
  { id: 'yogurt', name: 'Plain yogurt', portion: '150 g', g: 6, grams: 150, emoji: '🥛', alias: ['yogurt', 'yoghurt', 'iaurt', 'йогурт'] },
  { id: 'kefir', name: 'Kefir', portion: '250 ml', g: 8, grams: 250, emoji: '🥛', alias: ['chefir', 'кефир'], snack: true },
  { id: 'milk', name: 'Milk', portion: '250 ml glass', g: 8, grams: 250, emoji: '🥛', alias: ['lapte', 'молоко', 'glass of milk'] },
  { id: 'cheese', name: 'Hard cheese', portion: '30 g', g: 7, grams: 30, emoji: '🧀', alias: ['cheese', 'cascaval', 'cașcaval', 'сыр'], snack: true },
  { id: 'tuna', name: 'Tuna (can)', portion: '1 can, drained (about 120 g)', g: 26, grams: 120, count: true, emoji: '🐟', alias: ['ton', 'тунец', 'can of tuna'], snack: true },
  { id: 'fish', name: 'Fish (salmon, white fish)', portion: '100 g cooked', g: 22, grams: 100, emoji: '🐟', alias: ['salmon', 'peste', 'pește', 'рыба'] },
  { id: 'beef', name: 'Beef or pork', portion: '100 g cooked', g: 26, grams: 100, emoji: '🥩', alias: ['pork', 'meat', 'carne', 'vita', 'porc', 'мясо', 'говядина'] },
  { id: 'beans', name: 'Beans', portion: '200 g cooked', g: 15, grams: 200, emoji: '🫘', alias: ['fasole', 'фасоль'] },
  { id: 'lentils', name: 'Lentils', portion: '200 g cooked', g: 18, grams: 200, emoji: '🫘', alias: ['linte', 'чечевица'] },
  { id: 'chickpeas', name: 'Chickpeas', portion: '200 g cooked', g: 17, grams: 200, emoji: '🫘', alias: ['naut', 'năut', 'hummus', 'нут'] },
  { id: 'tofu', name: 'Tofu', portion: '100 g', g: 12, grams: 100, emoji: '🍢', alias: ['тофу'] },
  { id: 'whey', name: 'Whey protein', portion: '1 scoop (30 g)', g: 24, grams: 30, count: true, emoji: '🥤', alias: ['protein shake', 'shake', 'scoop', 'proteina', 'протеин'], snack: true },
  { id: 'bread', name: 'Bread', portion: '1 slice', g: 3, grams: 35, count: true, emoji: '🍞', alias: ['slice', 'slices', 'paine', 'pâine', 'хлеб', 'toast'] },
  { id: 'rice', name: 'Rice', portion: '200 g cooked', g: 5, grams: 200, emoji: '🍚', alias: ['orez', 'рис'] },
  { id: 'pasta', name: 'Pasta', portion: '200 g cooked', g: 12, grams: 200, emoji: '🍝', alias: ['paste', 'макароны', 'spaghetti'] },
  { id: 'buckwheat', name: 'Buckwheat', portion: '200 g cooked', g: 7, grams: 200, emoji: '🍚', alias: ['hrisca', 'hrișcă', 'гречка'] },
  { id: 'oats', name: 'Oats', portion: '50 g dry', g: 7, grams: 50, emoji: '🥣', alias: ['oatmeal', 'porridge', 'ovaz', 'ovăz', 'овсянка'] },
  { id: 'nuts', name: 'Nuts', portion: '30 g handful', g: 6, grams: 30, emoji: '🥜', alias: ['almonds', 'walnuts', 'nuci', 'орехи'], snack: true },
  { id: 'peanut_butter', name: 'Peanut butter', portion: '2 tablespoons (32 g)', g: 8, grams: 32, emoji: '🥜', alias: ['pb', 'unt de arahide'], snack: true }
]

export const SOURCE_NOTE = 'Protein values are approximate, generic numbers (common food tables such as USDA FoodData Central). Labels vary.'

const norm = (s: string) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

export const foodById = (id: string): Food | null => FOODS.find((f) => f.id === id) ?? null

/** The food a word means ("eggs", "brânză", "курица"), longest match first. */
export function matchFood(word: string): Food | null {
  const w = norm(word).replace(/[.!]+$/, '')
  if (!w) return null
  let best: { f: Food; n: number } | null = null
  for (const f of FOODS) {
    for (const name of [f.id.replace(/_/g, ' '), norm(f.name), ...f.alias.map(norm)]) {
      if (w === name || w === `${name}s` || (name.length >= 4 && w.replace(/s$/, '') === name.replace(/s$/, ''))) {
        if (!best || name.length > best.n) best = { f, n: name.length }
      }
    }
  }
  return best?.f ?? null
}

// ---- The goal ----

export const GPK = { lo: 1.6, hi: 2.2, def: 1.8 }

/** A sane body weight (kg), else null. */
export const saneWeight = (kg: number | null | undefined) => (typeof kg === 'number' && Number.isFinite(kg) && kg >= 35 && kg <= 200 ? kg : null)

export interface ProteinGoal {
  /** Today's goal in grams. */
  g: number
  lo: number
  hi: number
  gPerKg: number
  weight: number | null
}

/** The daily goal: weight × g/kg (1.6–2.2). Without a weight, a plain 120 g. */
export function proteinGoal(weightKg: number | null | undefined, gPerKg: number = GPK.def): ProteinGoal {
  const k = Math.max(GPK.lo, Math.min(GPK.hi, Number(gPerKg) || GPK.def))
  const w = saneWeight(weightKg)
  if (!w) return { g: 120, lo: 100, hi: 150, gPerKg: k, weight: null }
  const r5 = (n: number) => Math.round(n / 5) * 5
  return { g: r5(w * k), lo: r5(w * GPK.lo), hi: r5(w * GPK.hi), gPerKg: k, weight: w }
}

// ---- Quick logging ----

export interface ProteinLog {
  /** Food id, or 'other' for a plain number of grams. */
  food: string
  /** Portions (2 eggs = 2). */
  qty: number
  /** Grams of protein. */
  g: number
  /** "2 eggs", "Chicken breast 150 g", "Protein". */
  label: string
}

const round1 = (n: number) => Math.round(n * 10) / 10
const NUM = '(\\d{1,4}(?:[.,]\\d)?)'
const WORDNUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5 }

/** One food with an amount: a count ("2 eggs"), a weight ("chicken 150g") or one portion. */
export function logOf(food: Food, amount: { count?: number; grams?: number } = {}): ProteinLog {
  if (amount.grams && food.grams) {
    const qty = amount.grams / food.grams
    return { food: food.id, qty: round1(qty), g: Math.max(1, Math.round(food.g * qty)), label: `${food.name} ${Math.round(amount.grams)} g` }
  }
  const n = amount.count && amount.count > 0 ? amount.count : 1
  const unit = COUNT_UNIT[food.id]
  const label = unit ? `${n} ${n === 1 ? unit[0] : unit[1]}` : n === 1 ? food.name : `${n} × ${food.name}`
  return { food: food.id, qty: n, g: Math.max(1, Math.round(food.g * n)), label }
}

/** How counted foods read: "1 egg" / "2 eggs", "1 can of tuna" / "2 cans of tuna". */
const COUNT_UNIT: Record<string, [string, string]> = {
  egg: ['egg', 'eggs'],
  tuna: ['can of tuna', 'cans of tuna'],
  whey: ['scoop of whey', 'scoops of whey'],
  bread: ['slice of bread', 'slices of bread']
}

/**
 * A quick log from a short message, or null: "protein 30", "30g protein",
 * "+25 protein", "2 eggs", "eggs 3", "chicken 150g", "150 g chicken", "whey",
 * "a can of tuna", "ate 2 eggs". Weight foods need the "g" ("chicken 45"
 * stays money); counted foods take at most 12 ("eggs 20" stays money).
 */
export function parseProtein(text: string): ProteinLog | null {
  let t = norm(text).replace(/^\/(protein|p)\b/, 'protein').replace(/^(i\s+)?(ate|had|log|add|eaten|just ate|mancat|am mancat|съел)\s+/, '').replace(/[.!]+$/, '')
  if (!t || t.length > 48 || t.split(' ').length > 6 || /\?/.test(t)) return null
  // "protein 30", "30 g protein", "+30 protein", "protein: 30g"
  let m = new RegExp(`^(?:protein|proteine|proteina|белок|prot)\\s*:?\\s*\\+?${NUM}\\s*g?$`).exec(t) ?? new RegExp(`^\\+?${NUM}\\s*g(?:rams?)?\\s*(?:of\\s+)?(?:protein|proteine|proteina|белка|prot)$`).exec(t)
  if (m) {
    const g = Math.round(Number(m[1].replace(',', '.')))
    return g >= 1 && g <= 300 ? { food: 'other', qty: 1, g, label: 'Protein' } : null
  }
  t = t.replace(/^(a\s+)?(can|cans|tin|scoop|scoops|glass|slice|slices|portion|portions|bowl)\s+of\s+/, (x) => (/^a\s/.test(x) ? 'a ' : '')).replace(/\bof\s+/g, '')
  // "150g chicken", "150 g chicken"
  m = new RegExp(`^${NUM}\\s*(g|gr|grams?|ml)\\s+(.+)$`).exec(t)
  if (m) {
    const f = matchFood(m[3])
    const grams = Number(m[1].replace(',', '.'))
    return f && f.grams && grams >= 10 && grams <= 2000 ? logOf(f, { grams }) : null
  }
  // "chicken 150g"
  m = new RegExp(`^(.+?)\\s+${NUM}\\s*(g|gr|grams?|ml)$`).exec(t)
  if (m) {
    const f = matchFood(m[1])
    const grams = Number(m[2].replace(',', '.'))
    return f && f.grams && grams >= 10 && grams <= 2000 ? logOf(f, { grams }) : null
  }
  // "2 eggs", "two eggs", "a can tuna"
  m = /^(\d{1,2}|a|an|one|two|three|four|five|six|half)\s+(.+)$/.exec(t)
  if (m) {
    const f = matchFood(m[2])
    const n = /^\d/.test(m[1]) ? Number(m[1]) : WORDNUM[m[1]]
    return f && n > 0 && n <= 12 ? logOf(f, { count: n }) : null
  }
  // "eggs 3"
  m = /^(.+?)\s+(\d{1,2})$/.exec(t)
  if (m) {
    const f = matchFood(m[1])
    const n = Number(m[2])
    return f && f.count && n >= 1 && n <= 12 ? logOf(f, { count: n }) : null
  }
  // Just the food: one portion.
  const f = matchFood(t)
  return f ? logOf(f) : null
}

// ---- The day and the week ----

export interface ProteinEntry {
  id: string
  at: string
  food: string
  name: string
  emoji: string
  g: number
  source: string
  removed: boolean
}

/** Today's protein entries (oldest first), with removed ones marked. */
export function proteinEntries(events: BodyEvent[], day: string, meals: Meal[] = []): ProteinEntry[] {
  const mine = events.filter((e) => e.day === day && isProteinKind(e.kind))
  const live = liveIds(mine)
  return mine
    .filter((e) => !e.undoes)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1))
    .map((e) => {
      const id = foodIdOfKind(e.kind)
      const f = foodById(id)
      const meal = id.startsWith('meal-') ? meals.find((x) => x.id === id) : null
      return { id: e.id, at: e.at, food: id, name: f?.name ?? meal?.name ?? (id.startsWith('meal-') ? 'Saved meal' : 'Protein'), emoji: f?.emoji ?? (meal ? '🍽️' : '💪'), g: Math.round(Number(e.amount) || 0), source: e.source, removed: !live.has(e.id) }
    })
}

/** Grams of protein on a day (removed entries don't count, never below 0). */
export function proteinOfDay(events: BodyEvent[], day: string): number {
  const mine = events.filter((e) => e.day === day && isProteinKind(e.kind))
  const live = liveIds(mine)
  let g = 0
  for (const e of mine) if (!e.undoes && live.has(e.id)) g += Math.round(Number(e.amount) || 0)
  return Math.max(0, g)
}

export interface ProteinWeek {
  /** Average grams on the days you logged (of the last 7). */
  avg: number
  /** Days with any protein logged. */
  days: number
  /** Days the goal was reached. */
  hit: number
  perDay: { day: string; g: number }[]
}

/** The last 7 days ending `today`. */
export function proteinWeek(events: BodyEvent[], today: string, goal: number): ProteinWeek {
  const perDay = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i - 6)
    return { day, g: proteinOfDay(events, day) }
  })
  const logged = perDay.filter((d) => d.g > 0)
  return { avg: logged.length ? Math.round(logged.reduce((t, d) => t + d.g, 0) / logged.length) : 0, days: logged.length, hit: perDay.filter((d) => goal > 0 && d.g >= goal).length, perDay }
}

// ---- Saved meals and favourites ----

export interface MealItem {
  food: string
  qty: number
}
export interface Meal {
  id: string
  name: string
  items: MealItem[]
}

/** Grams of protein in a saved meal. */
export const mealGrams = (m: Pick<Meal, 'items'>) => Math.round(m.items.reduce((t, it) => t + (foodById(it.food)?.g ?? 0) * (Number(it.qty) || 0), 0))

/** "2 eggs, Cottage cheese 200 g". */
export const mealText = (m: Pick<Meal, 'items'>) =>
  m.items
    .map((it) => {
      const f = foodById(it.food)
      if (!f) return ''
      return f.count || !f.grams ? logOf(f, { count: it.qty }).label : logOf(f, { grams: f.grams * it.qty }).label
    })
    .filter(Boolean)
    .join(', ')

/** A clean list of saved meals (at most 12, each at most 8 foods). */
export function cleanMeals(raw: unknown): Meal[] {
  if (!Array.isArray(raw)) return []
  const out: Meal[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue
    const name = String((m as any).name ?? '').trim().slice(0, 40)
    const items = (Array.isArray((m as any).items) ? (m as any).items : [])
      .map((it: any) => ({ food: String(it?.food ?? ''), qty: Math.max(0.25, Math.min(20, Number(it?.qty) || 0)) }))
      .filter((it: MealItem) => foodById(it.food))
      .slice(0, 8)
    const id = /^meal-[a-z0-9]{1,20}$/.test(String((m as any).id)) ? String((m as any).id) : `meal-${out.length + 1}`
    if (name && items.length && !out.some((x) => x.id === id)) out.push({ id, name, items })
    if (out.length >= 12) break
  }
  return out
}

/** Your quick picks: favourites first, then what you log most (last 30 days), then a few defaults. */
export function quickPicks(events: BodyEvent[], favs: string[], today: string, n = 6): Food[] {
  const from = addDays(today, -30)
  const count = new Map<string, number>()
  for (const e of events) if (e.day >= from && isProteinKind(e.kind) && !e.undoes && e.amount > 0) count.set(foodIdOfKind(e.kind), (count.get(foodIdOfKind(e.kind)) ?? 0) + 1)
  const ids = [...favs, ...[...count.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k), 'egg', 'chicken', 'cottage', 'whey', 'tuna', 'greek_yogurt', 'milk', 'lentils']
  const out: Food[] = []
  for (const id of ids) {
    const f = foodById(id)
    if (f && !out.includes(f)) out.push(f)
    if (out.length >= n) break
  }
  return out
}

// ---- BD9: pre-shift fuel ----

export interface FuelCard {
  kind: 'before' | 'late'
  title: string
  line: string
  /** Snack ideas for the shift (foods with a lot of protein that travel well). */
  snacks: Food[]
}

const toMin = (hm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm ?? ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}

/** The shift snack list: foods that keep in a bag, most protein first. */
export const SHIFT_SNACKS = (): Food[] => FOODS.filter((f) => f.snack).sort((a, b) => b.g - a.g).slice(0, 5)

/** "No heavy food after" (soft): 22:30. */
export const LATE_FOOD = '22:30'

/**
 * The fuel card at `now` (HH:MM): from about an hour before your shift until
 * it starts, "protein meal before work?" (gone once a meal with 25 g+ is
 * logged within 3 h of the shift); from 22:30, a soft "no heavy food" line.
 */
export function fuelCard(o: { now: string; shiftFrom: string | null; workToday: boolean; logged: { at: string; g: number }[]; leadMin?: number; late?: string }): FuelCard | null {
  const now = toMin(o.now)
  if (!Number.isFinite(now)) return null
  const late = toMin(o.late ?? LATE_FOOD)
  if (now >= late || now < 4 * 60) return { kind: 'late', title: 'Late: keep it light', line: 'No heavy food from now: a glass of milk, kefir or a yogurt is fine, a big meal costs sleep.', snacks: [] }
  if (!o.workToday || !o.shiftFrom) return null
  const shift = toMin(o.shiftFrom)
  const lead = Math.max(30, Math.min(180, o.leadMin ?? 60))
  if (!Number.isFinite(shift) || now < shift - lead || now >= shift) return null
  const ate = o.logged.filter((l) => Number.isFinite(toMin(l.at)) && toMin(l.at) >= shift - 180 && toMin(l.at) <= now).reduce((t, l) => t + l.g, 0)
  if (ate >= 25) return null
  return { kind: 'before', title: 'Protein meal before work?', line: `Your shift starts at ${o.shiftFrom}. Eat a real meal with 30–40 g of protein now, and pack a snack for the break.`, snacks: SHIFT_SNACKS() }
}
