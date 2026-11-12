// "Paste from AI" (pure, tested): he reads his meal photos in his own AI app
// (ChatGPT, Grok, Gemini) with ONE fixed prompt (FOOD_PASTE_PROMPT), pastes the
// answer into Body → Food (or sends it to the bot, starting with LIFE-FOOD), and
// every meal and food in it is logged as a normal food-counter meal.
//
// The block (LIFE-FOOD v1):
//   MEAL | Lunch | 2026-11-10 13:05 | Rice and chicken
//   - rice | 200 g | P 5 | C 56 | F 0.6 | FIB 0.8 | KCAL 260 | CONF high | note
//   TOTAL | P … | C … | F … | KCAL …
//   END
// Read tolerantly: markdown bullets, **bold**, code fences, blank lines, text
// around the block, lower-case keys, "|" or tab separators, "12,5", "~" and
// "≈", "150-200 g" (the middle), missing optional fields. kcal is checked
// against 4P + 4C + 9F (a warning when off by more than 25 %). Nothing is
// dropped silently: every line that looks like data but can't be read, and
// every food without grams, comes back as a warning. No points (like a typed meal).
import { kcalOf, mealTypeAt, type FoodItem, type MealType } from './food'
import { addDays, dayKey, DAY_START_HOUR } from './dates'

/** The exact prompt he copies into his AI app (keep the text as it is). */
export const FOOD_PASTE_PROMPT = `You are a precise nutrition analyst. I will send one or more food photos (and sometimes a note). For EVERY photo, identify each separate food, estimate its weight in grams using the plate, cutlery, hand or packaging for scale, and read any nutrition label or barcode text you can see (label numbers beat estimates). Count hidden oil, butter, sauces and sugar you can reasonably assume, and say so in the note.

Reply with ONLY the block below, no other text, no tables, no markdown. Use one MEAL line per meal (photos of the same meal = one MEAL), then one line per food starting with "-". Numbers only, no units inside the number fields, use a dot for decimals.

LIFE-FOOD v1
MEAL | <Breakfast/Lunch/Dinner/Snack> | <YYYY-MM-DD HH:MM or "now"> | <short meal name>
- <food name> | <grams> g | P <protein g> | C <carbs g> | F <fat g> | FIB <fibre g> | KCAL <kcal> | CONF <high/medium/low> | <short note or ->
TOTAL | P <g> | C <g> | F <g> | KCAL <kcal>
END

Rules: one food per line (split mixed plates into parts, e.g. rice, chicken, sauce); round grams to 5 g and macros to 1 decimal; KCAL must be close to 4×P + 4×C + 9×F; if unsure of a portion give your best single estimate and set CONF low; if I wrote a date, time or meal type, use it, otherwise write "now" and guess the meal type from the food; never skip a food.`

export type PasteConf = 'high' | 'medium' | 'low'
export interface PasteItem {
  name: string
  /** Grams eaten; 0 when the line had none (then `noGrams` and a warning: it must be filled in before logging). */
  grams: number
  protein: number
  carbs: number
  fat: number
  fiber: number | null
  kcal: number
  /** 4P + 4C + 9F, for the check. */
  kcalCalc: number
  confidence: PasteConf
  note: string
  noGrams?: boolean
  /** The line number in the pasted text (1-based). */
  line: number
}
export interface PasteMeal {
  type: MealType | null
  /** Local date and time from the block ("2026-11-10T13:05"), or null for "now" / none. */
  at: string | null
  name: string
  items: PasteItem[]
  /** The block's own TOTAL line, when there was one. */
  total: { protein: number; carbs: number; fat: number; kcal: number } | null
}
export interface PasteResult {
  meals: PasteMeal[]
  warnings: string[]
}

const TYPES: Record<string, MealType> = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snack: 'snack', supper: 'dinner', brunch: 'breakfast' }
const r1 = (n: number) => Math.round(n * 10) / 10

/**
 * One written number as plain digits with a dot: "1,500" and "1.200" are thousands
 * (1–3 digits, then groups of exactly 3), "1,234.5" and "1.234,5" too; otherwise a
 * comma is a decimal ("12,5", "0,125").
 */
function plainNumber(tok: string): string {
  if (/^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$/.test(tok)) return tok.replace(/,/g, '')
  if (/^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d+)?$/.test(tok)) return tok.replace(/\./g, '').replace(',', '.')
  return tok.replace(',', '.')
}

/** A number from "12,5", "1,500", "~150", "≈ 200 g", "150-200" (the middle), or null. */
export function pasteNumber(raw: string): number | null {
  const t = String(raw ?? '')
    .replace(/[~≈]|approx\.?|about|ca\./gi, '')
    .replace(/\d[\d.,]*\d/g, plainNumber)
    .trim()
  const m = /^(\d+(?:\.\d+)?)\s*(?:[-–—]|to)\s*(\d+(?:\.\d+)?)/i.exec(t) ?? /^(\d+(?:\.\d+)?)/.exec(t)
  if (!m) return null
  const a = Number(m[1])
  const b = m[2] != null ? Number(m[2]) : a
  return Number.isFinite(a) && Number.isFinite(b) ? r1((a + b) / 2) : null
}

/** A line cleaned of fences, bullets and **bold**; `bullet` says whether it started with one. */
function cleanLine(raw: string): { text: string; bullet: boolean } {
  let t = raw.replace(/\*\*|__|`/g, '').replace(/ /g, ' ').trim()
  const b = /^(?:[-*•·–—+]|\d{1,2}[.)])\s+/.exec(t)
  if (b) t = t.slice(b[0].length).trim()
  else if (/^[-*•·–—]\S/.test(t) && !/^-\d/.test(t)) t = t.slice(1).trim()
  return { text: t, bullet: !!b }
}
const fieldsOf = (t: string) => t.split(/\s*[|\t]\s*/).map((x) => x.trim()).filter((x, i, a) => x !== '' || (i > 0 && i < a.length - 1))

const KEY = /^(p|prot|protein|c|carb|carbs|carbohydrates?|f|fat|fats|fib|fiber|fibre|kcal|cal|calories|energy|conf|confidence|g|grams?|weight)\b\s*[:=]?\s*(.*)$/i
type Key = 'p' | 'c' | 'f' | 'fib' | 'kcal' | 'conf' | 'g'
const keyOf = (k: string): Key => {
  const x = k.toLowerCase()
  if (/^(p|prot|protein)$/.test(x)) return 'p'
  if (/^(c|carb|carbs|carbohydrates?)$/.test(x)) return 'c'
  if (/^(f|fat|fats)$/.test(x)) return 'f'
  if (/^(fib|fiber|fibre)$/.test(x)) return 'fib'
  if (/^(kcal|cal|calories|energy)$/.test(x)) return 'kcal'
  if (/^(conf|confidence)$/.test(x)) return 'conf'
  return 'g'
}
const GRAMS = /^[~≈]?\s*\d[\d.,]*(?:\s*[-–—]\s*\d[\d.,]*)?\s*(?:g|gr|grams?|ml)\.?$/i
/** A key only counts with its value ("Fat 12", "CONF low"); "Fat added from oil" is a note. */
const keyValue = (k: Key, val: string) => (k === 'conf' ? /^(h|m|l)/i.test(val.trim()) : pasteNumber(val) != null)

/** One food line, or null when it isn't one (then the caller warns). */
function readItem(fields: string[], line: number, warnings: string[]): PasteItem | null {
  const name = fields[0]?.replace(/^[-*•]\s*/, '').trim()
  if (!name || /^\d+([.,]\d+)?$/.test(name)) return null
  const v: Partial<Record<Key, string>> = {}
  const free: string[] = []
  for (const f of fields.slice(1)) {
    if (GRAMS.test(f)) {
      v.g ??= f
      continue
    }
    const m = KEY.exec(f)
    if (m && keyValue(keyOf(m[1]), m[2])) {
      v[keyOf(m[1])] ??= m[2]
      continue
    }
    // "260 kcal", "5 g protein" written the other way round.
    const back = /^([~≈]?\s*\d[\d.,]*(?:\s*[-–—]\s*\d[\d.,]*)?)\s*(kcal|cal|calories)$/i.exec(f)
    if (back) {
      v.kcal ??= back[1]
      continue
    }
    free.push(f)
  }
  const num = (k: Key) => (v[k] != null ? pasteNumber(v[k]!) : null)
  const g = num('g')
  const p = num('p')
  const c = num('c')
  const fa = num('f')
  if (g == null && p == null && c == null && fa == null && num('kcal') == null) return null
  const protein = Math.max(0, Math.min(400, p ?? 0))
  const carbs = Math.max(0, Math.min(800, c ?? 0))
  const fat = Math.max(0, Math.min(400, fa ?? 0))
  const calc = kcalOf(protein, carbs, fat)
  const k = num('kcal')
  const kcal = Math.round(Math.max(0, Math.min(8000, k ?? calc)))
  const fib = num('fib')
  const conf = String(v.conf ?? '').toLowerCase()
  const confidence: PasteConf = /^h/.test(conf) ? 'high' : /^l/.test(conf) ? 'low' : 'medium'
  const note = free.filter((x) => x !== '-' && x !== '—').join(' · ').slice(0, 120)
  const grams = g != null ? Math.round(Math.max(0, Math.min(3000, g))) : 0
  const it: PasteItem = { name: name.slice(0, 60), grams, protein: r1(protein), carbs: r1(carbs), fat: r1(fat), fiber: fib != null ? r1(Math.min(200, fib)) : null, kcal, kcalCalc: calc, confidence, note, line }
  if (!grams) {
    it.noGrams = true
    warnings.push(`Line ${line}: ${it.name} has no grams. Fill them in before logging.`)
  }
  if (k == null && (p != null || c != null || fa != null)) warnings.push(`Line ${line}: ${it.name} had no kcal; worked out from P/C/F (${calc} kcal).`)
  if (k != null && calc > 0 && Math.abs(kcal - calc) / calc > 0.25) warnings.push(`Line ${line}: ${it.name} says ${kcal} kcal but P/C/F give about ${calc}. Check it.`)
  return it
}

/** A MEAL line: the type, the date and time (or "now"), the name, in any order. */
function readMeal(fields: string[], today: string): Pick<PasteMeal, 'type' | 'at' | 'name'> {
  let type: MealType | null = null
  let at: string | null = null
  const rest: string[] = []
  for (const f of fields.slice(1)) {
    const low = f.toLowerCase().replace(/[<>"']/g, '').trim()
    const dt = /^(\d{4})-(\d{2})-(\d{2})(?:[ t]+(\d{1,2})[:.](\d{2}))?$/.exec(low)
    const tm = /^(\d{1,2})[:.](\d{2})$/.exec(low)
    if (!type && TYPES[low]) type = TYPES[low]
    else if (!at && dt) at = `${dt[1]}-${dt[2]}-${dt[3]}T${(dt[4] ?? '12').padStart(2, '0')}:${dt[5] ?? '00'}`
    // A bare time belongs to the app day `today`: 00:00–03:59 is the next calendar date.
    else if (!at && tm && Number(tm[1]) < 24) at = `${Number(tm[1]) < DAY_START_HOUR ? addDays(today, 1) : today}T${tm[1].padStart(2, '0')}:${tm[2]}`
    else if (low === 'now' || low === '-' || low === '') continue
    else rest.push(f)
  }
  return { type, at, name: rest.join(' · ').replace(/[<>]/g, '').slice(0, 60) }
}

/** Reads a pasted LIFE-FOOD block (or something close to it). `today` (YYYY-MM-DD) fills a time given without a date. */
export function parseFoodPaste(text: string, today: string): PasteResult {
  const warnings: string[] = []
  const meals: PasteMeal[] = []
  let cur: PasteMeal | null = null
  let ended = false
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  lines.forEach((raw, k) => {
    const n = k + 1
    if (/^\s*```/.test(raw)) return
    const { text: t, bullet } = cleanLine(raw)
    if (!t) return
    const fields = fieldsOf(t)
    const head = (fields[0] ?? '').toUpperCase().replace(/[:]$/, '')
    if (/^LIFE-?FOOD\b/i.test(t)) {
      ended = false
      return
    }
    if (head === 'END') {
      ended = true
      cur = null
      return
    }
    if (head === 'MEAL') {
      ended = false
      cur = { ...readMeal(fields, today), items: [], total: null }
      meals.push(cur)
      return
    }
    if (head === 'TOTAL' || head === 'TOTALS') {
      const it = readItem(['total', ...fields.slice(1)], n, [])
      if (cur && it) cur.total = { protein: it.protein, carbs: it.carbs, fat: it.fat, kcal: it.kcal }
      return
    }
    const looksData = fields.length >= 2 || bullet
    if (!looksData) return // text around the block (a greeting, a sign-off)
    const it = fields.length >= 2 ? readItem(fields, n, warnings) : null
    if (!it) {
      if (fields.length >= 2) warnings.push(`Line ${n} could not be read: "${t.slice(0, 80)}"`)
      return
    }
    if (ended) warnings.push(`Line ${n} came after END; it was read anyway.`)
    if (!cur) {
      cur = { type: null, at: null, name: '', items: [], total: null }
      meals.push(cur)
    }
    cur.items.push(it)
  })
  const kept = meals.filter((m) => m.items.length)
  meals.filter((m) => !m.items.length).forEach((m) => warnings.push(`The meal "${m.name || m.type || 'without a name'}" has no foods.`))
  for (const m of kept) {
    if (!m.total) continue
    const sum = m.items.reduce((a, i) => a + i.kcal, 0)
    if (m.total.kcal > 0 && Math.abs(sum - m.total.kcal) / m.total.kcal > 0.1) warnings.push(`${m.name || 'A meal'}: its TOTAL says ${m.total.kcal} kcal, the foods add up to ${sum}. The foods are used.`)
  }
  return { meals: kept, warnings }
}

const CONF: Record<PasteConf, FoodItem['confidence']> = { high: 'sure', medium: 'roughly', low: 'guess' }
/** A pasted food as a food-counter item (null when it still has no grams). */
export function pasteFoodItem(it: PasteItem): FoodItem | null {
  if (!(it.grams >= 1)) return null
  return { name: it.name, grams: it.grams, protein: it.protein, carbs: it.carbs, fat: it.fat, kcal: it.kcal, confidence: CONF[it.confidence], ...(it.fiber != null ? { fiber: it.fiber } : {}) }
}

/** How far back a pasted meal may be dated (the food counter's own limit). */
export const PASTE_PAST_DAYS = 14

export interface PasteLog {
  items: FoodItem[]
  name: string
  type: MealType
  day: string
  /** ISO time to log it at. */
  at: string
}
/**
 * A pasted meal ready for the food counter: the block's date and time (else
 * now; never in the future, never more than 14 days back), the block's meal
 * type (else from the time), its foods with grams. `warn` gets why a time was changed.
 */
export function pasteToLog(m: PasteMeal, now: Date, today: string, warn: (s: string) => void = () => {}): PasteLog | null {
  const items = m.items.map(pasteFoodItem).filter((x): x is FoodItem => !!x)
  if (!items.length) return null
  let when = now
  if (m.at) {
    const d = new Date(m.at)
    // The APP day (it turns at 04:00): a meal at 01:30 belongs to the evening before.
    const day = Number.isFinite(d.getTime()) ? dayKey(d) : ''
    if (!Number.isFinite(d.getTime())) warn(`${m.name || 'A meal'}: its time could not be read, so now is used.`)
    else if (d.getTime() > now.getTime() + 5 * 60_000) warn(`${m.name || 'A meal'}: ${m.at.replace('T', ' ')} is in the future, so now is used.`)
    else if (day < addDays(today, -PASTE_PAST_DAYS)) warn(`${m.name || 'A meal'}: ${day} is more than ${PASTE_PAST_DAYS} days ago, so today is used.`)
    else when = d
  }
  const hm = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
  const day = when === now ? today : dayKey(when)
  const name = (m.name || items.map((i) => i.name).slice(0, 3).join(' + ')).slice(0, 60)
  return { items, name, type: m.type ?? mealTypeAt(hm), day, at: when.toISOString() }
}

/** A short id from the pasted text (the same block sent twice logs once). */
export function pasteId(text: string, k: number): string {
  let h = 5381
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return `fd-t${h.toString(36)}${k}`
}

/** Whether a message is a pasted block for the food counter (starts with LIFE-FOOD, maybe inside a code fence). */
export const isPasteBlock = (text: string) => /^\s*(?:```[a-z]*\s*)?(?:\*\*)?LIFE-?FOOD\b/i.test(String(text ?? ''))
