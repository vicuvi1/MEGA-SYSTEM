// Food photo logging: the checks on the AI's answer, and the numbers the review
// screen shows. Pure (no network, no database), so the website, the server
// tests and later the Telegram bot all read the AI's answer the same way.
//
// The AI looks at a meal photo (api/ai.mjs op "foodPhoto", provider code in
// api/_vision.mjs) and answers with JSON. Nothing here trusts that answer:
// - numbers are clamped to sane ranges, negatives become 0;
// - totals are always added up again from the items (the AI's own totals are ignored);
// - an item matched to one of your saved foods uses YOUR numbers × qty, not the AI's;
// - an answer with no usable item is refused with a plain message.
// Nothing is saved from here: the owner checks the review screen and taps Save.
import { kcalOf, mealTypeAt, type FoodItem, type MealType } from './food'
import { totalsOf, type FoodSaved } from './foodSaved'

/** One of the owner's saved foods or meals, as the AI sees it (numbers per portion). */
export interface SavedFoodRef {
  id: string
  name: string
  /** "1 container (350 g)", "2 eggs", "100 g". */
  portion: string
  kcal: number
  protein: number
  carbs?: number
  fat?: number
}

export type VisionConfidence = 'high' | 'medium' | 'low'

export interface VisionItem {
  name: string
  /** The saved food it is, or null. */
  matchedSavedFoodId: string | null
  qty: number
  unit: string
  grams: number
  kcal: number
  protein: number
  carbs: number
  fat: number
  confidence: VisionConfidence
  /** Which photo it was seen in (1…n), when several photos of one meal were read together. */
  photo?: number
  /** The likely range of grams (lo ≤ grams ≤ hi). */
  lo?: number
  hi?: number
  /** Where the numbers come from: a label in the photo, a saved food, his usual portion, or the AI's estimate. */
  src?: VisionSource
}

export type VisionSource = 'label' | 'saved' | 'memory' | 'estimate'

export interface VisionTotals {
  kcal: number
  protein: number
  carbs: number
  fat: number
}

export interface VisionResult {
  items: VisionItem[]
  totals: VisionTotals
  /** The AI's short summary (plain text, at most 200 characters), or ''. */
  message: string
  /** One short question instead of a guess, when a food's amount is hard to see ("About how many grams of rice?"). */
  question?: { index: number; text: string } | null
  /** A hidden fat or sugar that could add 100+ kcal and can't be seen (oil, butter, sauce, sugar): one tap adds it. */
  hidden?: HiddenKind | null
}

export type HiddenKind = 'oil' | 'butter' | 'sauce' | 'sugar'
/** What one tap adds for a hidden fat or sugar (standard amounts). */
export const HIDDEN: Record<HiddenKind, { label: string; ask: string; item: VisionItem }> = {
  oil: { label: '1 tbsp oil', ask: 'Cooked with oil?', item: { name: 'cooking oil', matchedSavedFoodId: null, qty: 1, unit: 'tbsp', grams: 14, kcal: 124, protein: 0, carbs: 0, fat: 14, confidence: 'medium', src: 'estimate' } },
  butter: { label: '1 tbsp butter', ask: 'Butter on it?', item: { name: 'butter', matchedSavedFoodId: null, qty: 1, unit: 'tbsp', grams: 14, kcal: 100, protein: 0.1, carbs: 0, fat: 11.4, confidence: 'medium', src: 'estimate' } },
  sauce: { label: '2 tbsp sauce', ask: 'Any sauce or dressing?', item: { name: 'sauce', matchedSavedFoodId: null, qty: 2, unit: 'tbsp', grams: 30, kcal: 90, protein: 0.5, carbs: 6, fat: 7, confidence: 'medium', src: 'estimate' } },
  sugar: { label: '2 tsp sugar', ask: 'Sugar in it?', item: { name: 'sugar', matchedSavedFoodId: null, qty: 2, unit: 'tsp', grams: 8, kcal: 32, protein: 0, carbs: 8, fat: 0, confidence: 'medium', src: 'estimate' } }
}
/** Said when the photo is too dark or blurry to read: a better photo beats a guess. */
export const UNCLEAR_PHOTO = 'The photo is too dark or blurry to read well. Send a clearer one in good light (the whole plate, from above).'

export type VisionCheck = { ok: true; result: VisionResult } | { ok: false; error: string }

export const MAX_ITEMS = 12
const r1 = (n: number) => Math.round(n * 10) / 10
const clamp = (v: unknown, lo: number, hi: number, dflt = lo) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.').replace(/[^\d.\-]/g, '')) : Number(v)
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt
}
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')

/**
 * The JSON object in a model's answer: an object as is, or the first {...} in a
 * string (inside ``` fences or with chatter around it). null when there is none.
 */
export function readVisionJson(raw: unknown): unknown {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw !== 'string') return null
  const s = raw.replace(/```(?:json)?/gi, '')
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try {
    return JSON.parse(s.slice(a, b + 1))
  } catch {
    return null
  }
}

/** Grams in a portion text ("1 container (350 g)" → 350), or 0. */
export const gramsOfPortion = (portion: string) => {
  const m = /(\d+(?:[.,]\d+)?)\s*g\b/i.exec(String(portion ?? ''))
  return m ? Math.round(Number(m[1].replace(',', '.'))) : 0
}

/** A saved food's numbers × qty (its portion is qty 1). */
export function fromSaved(s: SavedFoodRef, qty: number, grams?: number): VisionItem {
  const q = clamp(qty, 0.25, 20, 1)
  const per = gramsOfPortion(s.portion)
  const carbs = r1((Number(s.carbs) || 0) * q)
  const fat = r1((Number(s.fat) || 0) * q)
  const protein = r1((Number(s.protein) || 0) * q)
  const kcal = Math.round((Number(s.kcal) || kcalOf(s.protein, s.carbs ?? 0, s.fat ?? 0)) * q)
  const g = per ? Math.round(per * q) : Math.round(grams ?? 0)
  return { name: text(s.name, 60) || 'Saved food', matchedSavedFoodId: s.id, qty: q, unit: 'portion', grams: g, kcal, protein, carbs, fat, confidence: 'high', src: 'saved', ...rangeOf(g, 'high') }
}

/** How wide the range is when the AI gave none: ±10 % sure, ±25 % fair guess, ±40 % hard to see. */
const SPREAD: Record<VisionConfidence, number> = { high: 0.1, medium: 0.25, low: 0.4 }
/** A grams range around `g`: the AI's own when it holds `g` and stays within 3× either way, else from the confidence. */
export function rangeOf(g: number, confidence: VisionConfidence, lo?: unknown, hi?: unknown): { lo?: number; hi?: number } {
  if (!(g > 0)) return {}
  let a = Math.round(clamp(lo, 0, 3000, 0))
  let b = Math.round(clamp(hi, 0, 3000, 0))
  if (!(a > 0 && b > 0 && a <= g && b >= g && a >= g / 3 && b <= g * 3)) {
    a = Math.round(g * (1 - SPREAD[confidence]))
    b = Math.round(g * (1 + SPREAD[confidence]))
  }
  return { lo: Math.max(1, a), hi: Math.max(1, b) }
}

/** The photo number (1…photos) an item was seen in; only kept when there are several photos. */
const photoOf = (raw: any, photos: number): { photo?: number } => {
  const p = Math.round(Number(raw?.photo))
  return photos > 1 && Number.isFinite(p) && p >= 1 && p <= photos ? { photo: p } : {}
}

/** One clean item, or null when it has no name or no amount. `photos`: how many photos were read together. */
export function cleanVisionItem(raw: any, saved: SavedFoodRef[] = [], photos = 1): VisionItem | null {
  if (!raw || typeof raw !== 'object') return null
  const name = text(raw.name, 60)
  if (!name) return null
  const qty = clamp(raw.qty, 0, 20, 1) || 1
  const grams = Math.round(clamp(raw.grams, 0, 3000))
  const confidence: VisionConfidence = raw.confidence === 'high' || raw.confidence === 'low' ? raw.confidence : 'medium'
  const match = typeof raw.matchedSavedFoodId === 'string' ? saved.find((s) => s.id === raw.matchedSavedFoodId) : undefined
  if (match) {
    // Your saved numbers win over the AI's guess; the AI only says how many.
    const it = fromSaved(match, qty, grams)
    return { ...it, unit: text(raw.unit, 20) || it.unit, confidence, ...photoOf(raw, photos) }
  }
  // Numbers read off a label or package are exact: sure.
  const label = raw.fromLabel === true || raw.source === 'label'
  const conf: VisionConfidence = label ? 'high' : confidence
  const protein = r1(clamp(raw.protein, 0, 400))
  const carbs = r1(clamp(raw.carbs, 0, 800))
  const fat = r1(clamp(raw.fat, 0, 400))
  const k = clamp(raw.kcal, 0, 8000)
  const kcal = Math.round(k > 0 ? k : kcalOf(protein, carbs, fat))
  if (grams < 1 && kcal < 1) return null
  return { name, matchedSavedFoodId: null, qty: r1(qty), unit: text(raw.unit, 20) || 'serving', grams, kcal, protein, carbs, fat, confidence: conf, ...photoOf(raw, photos), src: label ? 'label' : 'estimate', ...rangeOf(grams, conf, raw.gramsLow, raw.gramsHigh) }
}

/** The meal's totals, always added up from the items. */
export function visionTotals(items: VisionItem[]): VisionTotals {
  const t = items.reduce((a, i) => ({ kcal: a.kcal + i.kcal, protein: a.protein + i.protein, carbs: a.carbs + i.carbs, fat: a.fat + i.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 })
  return { kcal: Math.round(t.kcal), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat) }
}

/**
 * Checks the AI's answer (an object, or text holding one). Refuses an answer it
 * can't read, or one with no food in it, with a plain message.
 */
export function validateVision(raw: unknown, saved: SavedFoodRef[] = [], photos = 1, memory: PortionMemory | null = null): VisionCheck {
  const o: any = readVisionJson(raw)
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: "The AI's answer could not be read. Try again, or copy the prompt instead." }
  if (o.unclear === true) return { ok: false, error: UNCLEAR_PHOTO }
  if (!Array.isArray(o.items)) return { ok: false, error: "The AI's answer had no list of foods. Try again, or copy the prompt instead." }
  const read = o.items.map((x: unknown) => cleanVisionItem(x, saved, photos)).filter((x: VisionItem | null): x is VisionItem => !!x).slice(0, MAX_ITEMS)
  if (!read.length) return { ok: false, error: photos > 1 ? 'No food was found in the photos. Try clearer photos, or add the foods by hand.' : 'No food was found in the photo. Try a clearer photo, or add the foods by hand.' }
  // His own portions (learned from his corrections) beat a guess.
  const items = memory ? applyPortions(read, memory, saved) : read
  const hidden = (['oil', 'butter', 'sauce', 'sugar'] as HiddenKind[]).includes(o.hidden) && !items.some((i: VisionItem) => foodKey(i.name).includes(o.hidden)) ? (o.hidden as HiddenKind) : null
  return { ok: true, result: { items, totals: visionTotals(items), message: text(o.message, 200), question: questionFor(items), hidden } }
}

/** The item at a new amount: grams and macros scale together (qty from the AI's base). A saved food uses its own numbers × qty. */
export function scaleVisionItem(base: VisionItem, factor: number, saved: SavedFoodRef[] = []): VisionItem {
  const f = clamp(factor, 0.05, 20, 1)
  const match = base.matchedSavedFoodId ? saved.find((s) => s.id === base.matchedSavedFoodId) : undefined
  if (match) return { ...fromSaved(match, base.qty * f, base.grams * f), unit: base.unit, confidence: base.confidence, ...(base.photo ? { photo: base.photo } : {}) }
  const out: VisionItem = { ...base, qty: r1(base.qty * f), grams: Math.round(base.grams * f), kcal: Math.round(base.kcal * f), protein: r1(base.protein * f), carbs: r1(base.carbs * f), fat: r1(base.fat * f) }
  if (base.lo != null && base.hi != null) (out.lo = Math.max(1, Math.round(base.lo * f))), (out.hi = Math.max(1, Math.round(base.hi * f)))
  return out
}

/** The qty stepper: whole steps, or halves under 1. */
export function stepQty(qty: number, dir: 1 | -1): number {
  const q = Number(qty) || 1
  if (dir > 0) return q < 1 ? 1 : Math.min(20, Math.floor(q) + 1)
  return q <= 1 ? 0.5 : Math.ceil(q) - 1 || 0.5
}

const CONF: Record<VisionConfidence, FoodItem['confidence']> = { high: 'sure', medium: 'roughly', low: 'guess' }
/** The food counter's items (the same `addFoodMeal` data as every other meal). */
export const toFoodItems = (items: VisionItem[]): FoodItem[] =>
  items
    .filter((i) => i.grams >= 1 || i.kcal >= 1)
    .map((i) => ({
      name: i.name,
      grams: Math.max(1, Math.round(i.grams || 1)),
      protein: r1(i.protein),
      carbs: r1(i.carbs),
      fat: r1(i.fat),
      kcal: Math.round(i.kcal),
      confidence: CONF[i.confidence],
      // The likely range, so the meal row can show "180–260 g".
      ...(i.lo != null && i.hi != null && i.lo < i.hi ? { lo: Math.round(i.lo), hi: Math.round(i.hi) } : {}),
      // A saved food keeps how many portions (like a one-tap log).
      ...(i.matchedSavedFoodId ? { qty: r1(i.qty), unit: i.unit } : {})
    }))

/** The owner's starred meals as saved foods (one portion = the whole meal). */
export function savedFromFavs(favs: { id: string; name: string; items: FoodItem[] }[]): SavedFoodRef[] {
  return (favs ?? []).slice(0, 30).map((f) => {
    const grams = f.items.reduce((a, i) => a + i.grams, 0)
    const sum = (k: 'kcal' | 'protein' | 'carbs' | 'fat') => r1(f.items.reduce((a, i) => a + (Number(i[k]) || 0), 0))
    return { id: `fav:${f.id}`, name: f.name, portion: `1 portion (${Math.round(grams)} g)`, kcal: Math.round(sum('kcal')), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat') }
  })
}

/**
 * The owner's real saved foods (food_saved) for the AI and the swap list:
 * each saved food (one portion, "1 container (300 g)"), then each saved meal
 * (one portion = the whole meal), then starred meals not already there. Ids
 * are the saved ids (sf-…, sm-…), so a match uses his own numbers × qty.
 */
export function savedRefs(saved: FoodSaved | null | undefined, favs: { id: string; name: string; items: FoodItem[] }[] = [], max = 60): SavedFoodRef[] {
  const out: SavedFoodRef[] = []
  if (saved) {
    for (const f of saved.foods) {
      const label = text(f.portionLabel, 30) || '1 portion'
      const portion = f.grams && !/\d\s*g\b/i.test(label) ? `${label} (${Math.round(f.grams)} g)` : label
      out.push({ id: f.id, name: f.name, portion, kcal: Math.round(f.kcal), protein: r1(f.protein), carbs: r1(f.carbs ?? 0), fat: r1(f.fat ?? 0) })
    }
    for (const m of saved.meals) {
      const t = totalsOf(saved, m.items)
      const grams = m.items.reduce((a, i) => a + (saved.foods.find((f) => f.id === i.foodId)?.grams ?? 0) * i.qty, 0)
      out.push({ id: m.id, name: m.name, portion: grams ? `1 meal (${Math.round(grams)} g)` : '1 meal', kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat })
    }
  }
  const names = new Set(out.map((x) => x.name.toLowerCase()))
  for (const f of savedFromFavs(favs)) if (!names.has(f.name.toLowerCase())) out.push(f)
  return out.slice(0, max)
}

/** The meal slot from the local time (breakfast / lunch / dinner / snack). */
export const slotNow = (now = new Date()): MealType => mealTypeAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const qtyName = (i: { name: string; qty: number; unit: string }) => {
  const q = Math.round(i.qty * 10) / 10
  return q !== 1 && i.unit !== 'g' ? `${q} ${i.name}` : i.name
}

/**
 * The line after Save, every number from data:
 * "3 eggs + 2 bread: ~375 kcal, 24 g protein. Today: 1,400 / 2,700 kcal, 60 / 130 g. ~1,300 kcal left, 70 g protein; next: <idea from what to eat next>."
 */
export function photoReplyLine(o: { items: { name: string; qty: number; unit: string }[]; meal: { kcal: number; protein: number }; day: { kcal: number; protein: number; kcalGoal: number; proteinGoal: number }; idea?: string }): string {
  const names = o.items.slice(0, 3).map(qtyName).join(' + ') + (o.items.length > 3 ? ` +${o.items.length - 3}` : '')
  const head = `${names || 'Meal'}: ~${fmt(o.meal.kcal)} kcal, ${fmt(o.meal.protein)} g protein.`
  const d = o.day
  const today = `Today: ${fmt(d.kcal)} / ${fmt(d.kcalGoal)} kcal, ${fmt(d.protein)} / ${fmt(d.proteinGoal)} g.`
  const kLeft = Math.round(d.kcalGoal - d.kcal)
  const pLeft = Math.round(d.proteinGoal - d.protein)
  let left: string
  if (kLeft <= 0 && pLeft <= 0) left = 'Both goals done for today.'
  else if (kLeft <= 0) left = `Over the kcal goal by ${fmt(-kLeft)}; ${fmt(pLeft)} g protein left.`
  else left = `~${fmt(kLeft)} kcal left${pLeft > 0 ? `, ${fmt(pLeft)} g protein` : ''}${o.idea ? `; next: ${o.idea.replace(/\.$/, '')}` : ''}.`
  return `${head} ${today} ${left}`
}

/** Photos a day, counted on the server (the owner's day, LIFE_TZ). Each photo of a request counts. */
export const PHOTO_DAILY_LIMIT = 15
/** At most this many photos of one meal are read together (api/_vision.mjs MAX_PHOTOS). */
export const MAX_PHOTOS = 6

// ---- his usual portions (learned from his corrections) ----

/** One food's usual portion: grams, how many corrections taught it, when last. */
export interface PortionMemo {
  g: number
  n: number
  at: number
}
/** Food key → his usual grams. Kept in the synced setting `food_ben` (`portions`). */
export type PortionMemory = Record<string, PortionMemo>
export const PORTIONS_MAX = 60

const COOK_WORDS = new Set(['cooked', 'boiled', 'grilled', 'fried', 'baked', 'roasted', 'steamed', 'raw', 'fresh', 'plain', 'some', 'with', 'and', 'the', 'portion', 'serving', 'bowl', 'plate'])
/** A food's key: lower-case words without accents or cooking words, singular, sorted ("Boiled white rice" → "rice white"). */
export function foodKey(name: string): string {
  const words = String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !COOK_WORDS.has(w))
    .map((w) => (w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.endsWith('oes') ? w.slice(0, -2) : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
  return [...new Set(words)].sort().join(' ').slice(0, 40)
}

/** His portion for a food: the same key, else the longest remembered key whose words are all in the name. */
export function portionFor(mem: PortionMemory | null | undefined, name: string): PortionMemo | null {
  if (!mem) return null
  const k = foodKey(name)
  if (!k) return null
  if (mem[k]) return mem[k]
  const words = new Set(k.split(' '))
  let best: [string, PortionMemo] | null = null
  for (const [key, m] of Object.entries(mem)) {
    if (key.split(' ').every((w) => words.has(w)) && (!best || key.length > best[0].length)) best = [key, m]
  }
  return best ? best[1] : null
}

/** A clean memory: bad rows dropped, at most 60, the newest kept. */
export function cleanPortions(raw: unknown): PortionMemory {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const rows = Object.entries(raw as Record<string, any>)
    .filter(([k, v]) => /^[a-z ]{3,40}$/.test(k) && v && Number(v.g) >= 5 && Number(v.g) <= 3000)
    .map(([k, v]): [string, PortionMemo] => [k, { g: Math.round(Number(v.g)), n: Math.max(1, Math.min(99, Math.round(Number(v.n) || 1))), at: Number(v.at) || 0 }])
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, PORTIONS_MAX)
  return Object.fromEntries(rows)
}

/**
 * Learns from a saved photo meal: every food whose grams he changed (typed,
 * ½× / 1.5× / 2×) teaches his portion. Saved foods (his own numbers) and label
 * reads teach nothing. A new correction counts most (60 %).
 */
export function learnPortions(mem: PortionMemory | null | undefined, base: VisionItem[], now: VisionItem[], at: number): PortionMemory {
  const out: PortionMemory = { ...cleanPortions(mem) }
  now.forEach((it, i) => {
    const b = base[i]
    if (!b || it.matchedSavedFoodId || it.src === 'label' || !(it.grams >= 5)) return
    if (Math.abs(it.grams - b.grams) < Math.max(5, b.grams * 0.05)) return
    const k = foodKey(it.name)
    if (!k) return
    const old = out[k]
    out[k] = { g: old ? Math.round(old.g * 0.4 + it.grams * 0.6) : Math.round(it.grams), n: Math.min(99, (old?.n ?? 0) + 1), at }
  })
  return cleanPortions(out)
}

/**
 * His portion instead of a guess: a food the AI only estimated (not a label,
 * not a saved food, not marked sure) that he corrected before is set to his
 * usual grams; the macros scale with it.
 */
export function applyPortions(items: VisionItem[], mem: PortionMemory, saved: SavedFoodRef[] = []): VisionItem[] {
  return items.map((it) => {
    if (it.matchedSavedFoodId || it.src === 'label' || it.confidence === 'high' || !(it.grams > 0)) return it
    const p = portionFor(mem, it.name)
    if (!p || Math.abs(p.g - it.grams) < 5) return it
    const scaled = scaleVisionItem(it, p.g / it.grams, saved)
    return { ...scaled, grams: p.g, src: 'memory' as const, confidence: 'medium' as const, ...rangeOf(p.g, 'high') }
  })
}

/** His usual portions worth telling the AI (the ones his note names first), at most `max`. */
export function portionHints(mem: PortionMemory | null | undefined, note = '', max = 8): { name: string; g: number }[] {
  const words = new Set(foodKey(note).split(' ').filter(Boolean))
  return Object.entries(cleanPortions(mem))
    .map(([k, m]) => ({ name: k, g: m.g, hit: k.split(' ').some((w) => words.has(w)) ? 1 : 0, n: m.n, at: m.at }))
    .sort((a, b) => b.hit - a.hit || b.n - a.n || b.at - a.at)
    .slice(0, max)
    .map(({ name, g }) => ({ name, g }))
}

/**
 * The few saved foods worth sending (a short prompt is a cheap one): the ones
 * his note names first, then the order he keeps them in. At most `max`.
 */
export function pickSaved<T extends { name: string }>(saved: T[], note = '', max = 8): T[] {
  const words = new Set(foodKey(note).split(' ').filter(Boolean))
  if (!words.size) return saved.slice(0, max)
  return saved
    .map((s, i) => ({ s, i, hit: foodKey(s.name).split(' ').filter((w) => words.has(w)).length }))
    .sort((a, b) => b.hit - a.hit || a.i - b.i)
    .slice(0, max)
    .map((x) => x.s)
}

/** One short question instead of a guess: the first food the AI could not see well (not a label, saved food or his portion). */
export function questionFor(items: VisionItem[]): { index: number; text: string } | null {
  const i = items.findIndex((it) => it.confidence === 'low' && !it.matchedSavedFoodId && it.src !== 'label' && it.src !== 'memory')
  if (i < 0) return null
  return { index: i, text: `About how many grams of ${items[i].name.toLowerCase()}?` }
}

/** The quick fixes on Telegram: ½×, 1.5×, 2× (index = the button's code). */
export const FACTORS = [0.5, 1.5, 2] as const
