// Reads an AI app's reply to the food prompt (core/foodPrompt.ts) with plain
// code: no network, no AI. Tolerant on purpose, because every app answers a
// little differently:
// - the JSON with or without ``` fences, with extra text before or after;
// - "items" at the top, a bare list of items, or one item;
// - other field names (protein, proteins, carbohydrates, calories, weight…);
// - numbers as text ("12,5 g", "about 150"), decimal commas, trailing commas,
//   single or curly quotes, unquoted keys;
// - kcal missing: worked out as 4 × protein + 4 × carbs + 9 × fat;
// - as a last try, plain lines like "Chicken breast 150 g, 46 g protein, 230 kcal".
import { cleanItem, type FoodItem } from './food'

export type FoodReply = { ok: true; items: FoodItem[]; question: string | null } | { ok: false; why: string }

const KEYS: Record<string, string[]> = {
  name: ['name', 'food', 'item', 'title', 'dish'],
  grams: ['grams', 'gram', 'g', 'weight_g', 'weight', 'amount_g', 'portion_g', 'portion', 'serving_g', 'quantity_g', 'qty_g', 'amount'],
  protein: ['protein_g', 'protein', 'proteins', 'protein_grams', 'prot'],
  carbs: ['carbs_g', 'carbs', 'carb', 'carbohydrates', 'carbohydrate', 'carbs_grams', 'carbohydrates_g'],
  fat: ['fat_g', 'fat', 'fats', 'fat_grams', 'total_fat'],
  kcal: ['kcal', 'calories', 'calorie', 'energy', 'energy_kcal', 'cal', 'kcals'],
  confidence: ['confidence', 'certainty', 'sure']
}

/** A number from 12, "12,5", "about 150 g", "~46g"; null when there is none. */
export function numberOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const m = /-?\d+(?:[.,]\d+)?/.exec(v.replace(/(\d)\s(?=\d{3}\b)/g, '$1'))
  if (!m) return null
  const n = Number(m[0].replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

const lowerKeys = (o: Record<string, unknown>) => {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) out[k.toLowerCase().replace(/[\s-]+/g, '_').replace(/[()]/g, '')] = v
  return out
}
const pick = (o: Record<string, unknown>, field: string) => {
  for (const k of KEYS[field]) if (o[k] != null && o[k] !== '') return o[k]
  return undefined
}

const confOf = (v: unknown): FoodItem['confidence'] => {
  const s = String(v ?? '').toLowerCase()
  if (/sure|high|certain|confident/.test(s)) return 'sure'
  if (/guess|low|unsure|not sure/.test(s)) return 'guess'
  return 'roughly'
}

/** One raw item (any of the field names) as a clean FoodItem, or null. */
export function itemOf(raw: unknown): FoodItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = lowerKeys(raw as Record<string, unknown>)
  const name = pick(o, 'name')
  const grams = numberOf(pick(o, 'grams'))
  const kcal = numberOf(pick(o, 'kcal'))
  return cleanItem({
    name: typeof name === 'string' ? name : '',
    grams: grams ?? NaN,
    protein: numberOf(pick(o, 'protein')) ?? 0,
    carbs: numberOf(pick(o, 'carbs')) ?? 0,
    fat: numberOf(pick(o, 'fat')) ?? 0,
    kcal: kcal ?? NaN,
    confidence: confOf(pick(o, 'confidence'))
  })
}

/** The first balanced {…} or […] block in the text (quotes respected), or null. */
function firstBlock(text: string, from = 0): { s: string; end: number } | null {
  const start = text.slice(from).search(/[{[]/)
  if (start < 0) return null
  const i0 = from + start
  const stack: string[] = []
  let q: string | null = null
  for (let i = i0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '\\') i++
      else if (c === q) q = null
      continue
    }
    if (c === '"') q = c
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']')
    else if (c === '}' || c === ']') {
      if (stack.pop() !== c) return null
      if (!stack.length) return { s: text.slice(i0, i + 1), end: i + 1 }
    }
  }
  // Cut off at the end (a reply that stopped early): close what is open.
  return stack.length ? { s: text.slice(i0) + stack.reverse().join(''), end: text.length } : null
}

/** Small fixes that turn "almost JSON" into JSON. */
export function repairJson(s: string): string {
  return s
    .replace(/[“”„«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\/\/[^\n"]*$/gm, '')
    .replace(/'([^'"\n]*)'/g, '"$1"')
    .replace(/([{,]\s*)([A-Za-z_][\w ]*?)\s*:/g, '$1"$2":')
    .replace(/(:\s*-?\d+),(\d+)(\s*[,}\]\n])/g, '$1.$2$3')
    .replace(/(:\s*)(~|about |approx\.? )(\d)/gi, '$1$3')
    .replace(/(:\s*-?\d+(?:\.\d+)?)\s*(?:g|gr|grams|kcal|cal)\b/gi, '$1')
    .replace(/,\s*([}\]])/g, '$1')
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    try {
      return JSON.parse(repairJson(s))
    } catch {
      return undefined
    }
  }
}

function fromValue(v: unknown): { items: FoodItem[]; question: string | null } | null {
  if (Array.isArray(v)) {
    const items = v.map(itemOf).filter((x): x is FoodItem => !!x)
    return items.length ? { items, question: null } : null
  }
  if (!v || typeof v !== 'object') return null
  const o = lowerKeys(v as Record<string, unknown>)
  const list = o.items ?? o.foods ?? o.food_items ?? o.meal ?? o.ingredients
  const qRaw = o.question ?? o.questions
  const question = typeof qRaw === 'string' && qRaw.trim() ? qRaw.trim().slice(0, 200) : Array.isArray(qRaw) && typeof qRaw[0] === 'string' ? String(qRaw[0]).slice(0, 200) : null
  if (Array.isArray(list)) {
    const items = list.map(itemOf).filter((x): x is FoodItem => !!x)
    return items.length ? { items, question } : null
  }
  const one = itemOf(v)
  return one ? { items: [one], question } : null
}

const LINE = /^\s*(?:[-*•\d.)]+\s*)?([A-Za-zÀ-ɏЀ-ӿ][^:\d]{1,50}?)\s*[:\-–—,(]?\s*(\d+(?:[.,]\d+)?)\s*(?:g|gr|grams)\b(.*)$/i

/** Last try: "Chicken breast: 150 g, 46 g protein, 5 g fat, 230 kcal". */
function fromLines(text: string): FoodItem[] {
  const out: FoodItem[] = []
  for (const line of text.split(/\n+/)) {
    const m = LINE.exec(line)
    if (!m) continue
    const rest = m[3]
    const val = (re: RegExp) => {
      const x = re.exec(rest)
      return x ? Number(x[1].replace(',', '.')) : 0
    }
    const protein = val(/(\d+(?:[.,]\d+)?)\s*g?\s*(?:of\s+)?protein/i) || val(/protein\D{0,3}(\d+(?:[.,]\d+)?)/i) || val(/\bP\s*:?\s*(\d+(?:[.,]\d+)?)/)
    const carbs = val(/(\d+(?:[.,]\d+)?)\s*g?\s*(?:of\s+)?carb/i) || val(/carbs?\D{0,3}(\d+(?:[.,]\d+)?)/i) || val(/\bC\s*:?\s*(\d+(?:[.,]\d+)?)/)
    const fat = val(/(\d+(?:[.,]\d+)?)\s*g?\s*(?:of\s+)?fat/i) || val(/fat\D{0,3}(\d+(?:[.,]\d+)?)/i) || val(/\bF\s*:?\s*(\d+(?:[.,]\d+)?)/)
    const kcal = val(/(\d+(?:[.,]\d+)?)\s*(?:kcal|calories|cal)\b/i)
    if (!protein && !carbs && !fat && !kcal) continue
    const it = cleanItem({ name: m[1].trim(), grams: Number(m[2].replace(',', '.')), protein, carbs, fat, kcal: kcal || NaN, confidence: 'roughly' })
    if (it) out.push(it)
  }
  return out
}

/** Reads the reply. Never throws; `ok: false` says why in plain words. */
export function parseFoodReply(text: string): FoodReply {
  const t = String(text ?? '').trim()
  if (!t) return { ok: false, why: 'Paste the reply from the AI app first.' }
  if (t.length > 20000) return { ok: false, why: 'That reply is too long. Paste only the block the AI app wrote.' }
  // Fenced blocks first (```json … ```), then any {…} or […] in the text.
  const fenced = [...t.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)(?:```|$)/g)].map((m) => m[1])
  for (const chunk of [...fenced, t]) {
    let from = 0
    for (let n = 0; n < 6; n++) {
      const b = firstBlock(chunk, from)
      if (!b) break
      const got = fromValue(tryJson(b.s))
      if (got) return { ok: true, items: got.items.slice(0, 20), question: got.question }
      from = b.end > from ? b.end : from + 1
      if (b.s.startsWith('{') && b.s.length > 1) {
        // A broken outer block may still hold a good inner list.
        const inner = firstBlock(b.s, 1)
        const got2 = inner ? fromValue(tryJson(inner.s)) : null
        if (got2) return { ok: true, items: got2.items.slice(0, 20), question: got2.question }
      }
    }
  }
  const lines = fromLines(t)
  if (lines.length) return { ok: true, items: lines.slice(0, 20), question: null }
  return { ok: false, why: "Couldn't read that reply. Copy the prompt again, send it with the photo, and paste the whole answer." }
}
