// The coach's hard safety rules. Pure and tested, never left to the AI:
// - never a food goal under 2,200 kcal a day;
// - never a cut while the weekly-average weight isn't rising;
// - low logged intake (< 1,600 kcal on 3+ recent days) → a gentle note with easy add-ons;
// - no negative body talk (daily weight is small, the weekly trend is the number, fat and muscle are estimates);
// - red-flag words (EN + RO) → stop training and see a doctor, no exercise advice;
// - a blood-test reminder once at the start, then monthly, dismissible;
// - supplements: an optional protein shake or creatine 3–5 g only, never fat burners.
import { addDays } from './dates'

export const KCAL_FLOOR = 2200
export const LOW_KCAL = 1600
export const LOW_DAYS = 3
/** Weekly-average change (kg) under which the weight is "not rising". */
export const RISING_MIN = 0.1
export const BLOOD_EVERY = 30

export const floorKcal = (n: number) => Math.max(KCAL_FLOOR, Math.round(n))

/** True when the latest full week's average is up on the week before (≥ +0.1 kg). */
export function weightRising(weeks: { avg: number | null; enough: boolean }[]): boolean {
  const full = weeks.filter((w) => w.enough && w.avg != null)
  if (full.length < 2) return false
  return (full[full.length - 1].avg as number) - (full[full.length - 2].avg as number) >= RISING_MIN
}

/**
 * A calorie change the coach may suggest: a cut only while the weight rises,
 * and never under the floor. Returns the allowed change (0: none) and why.
 */
export function safeKcalChange(o: { delta: number; target: number; rising: boolean }): { delta: number; why: string | null } {
  if (o.delta < 0 && !o.rising) return { delta: 0, why: 'No cut while your weekly weight is not rising.' }
  if (o.delta < 0 && o.target + o.delta < KCAL_FLOOR) return { delta: 0, why: `Your food goal stays at ${KCAL_FLOOR.toLocaleString('en-US')} kcal or more.` }
  return { delta: o.delta, why: null }
}

export const ADD_ONS = [
  { id: 'milk', label: '+1 glass of milk', kcal: 130, protein: 8 },
  { id: 'pb', label: '+1 spoon of peanut butter', kcal: 95, protein: 4 },
  { id: 'banana', label: '+1 banana', kcal: 105, protein: 1 },
  { id: 'oats', label: '+40 g oats', kcal: 150, protein: 5 }
] as const

/** Easy add-ons that cover a kcal gap (at most 3, in order). */
export function addOnsFor(gap: number): (typeof ADD_ONS)[number][] {
  const out: (typeof ADD_ONS)[number][] = []
  let left = gap
  for (const a of ADD_ONS) {
    if (left <= 40 || out.length >= 3) break
    out.push(a)
    left -= a.kcal
  }
  return out
}

/** Logged intake under 1,600 kcal on 3+ of the last 7 days before today (days with food logged). */
export function lowIntake(perDay: { day: string; kcal: number }[], today: string): { days: number; text: string; addOns: string[] } | null {
  const from = addDays(today, -7)
  const low = perDay.filter((p) => p.day >= from && p.day < today && p.kcal > 0 && p.kcal < LOW_KCAL).length
  if (low < LOW_DAYS) return null
  const addOns = ADD_ONS.slice(0, 3).map((a) => a.label)
  return { days: low, text: `You ate under ${LOW_KCAL.toLocaleString('en-US')} kcal on ${low} days this week. Easy wins: ${addOns.join(', ')}.`, addOns }
}

// ---- words ----

/** Lowercase, no diacritics (ă â î ș ț → a a i s t). */
export const plain = (t: string) =>
  String(t ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[şș]/g, 's')
    .replace(/[ţț]/g, 't')

const RED_FLAGS: { re: RegExp; word: string }[] = [
  { re: /\bdizz(y|iness)\b/, word: 'dizziness' },
  { re: /\blight ?headed\b/, word: 'dizziness' },
  { re: /\bchest (pain|hurts?|tight(ness)?)\b|\bpain in (my|the) chest\b/, word: 'chest pain' },
  { re: /\bfaint(ed|ing)?\b|\bpassed out\b|\bblack(ed)? out\b/, word: 'fainting' },
  { re: /\bsharp pain\b|\bstabbing pain\b/, word: 'sharp pain' },
  { re: /\bjoint pain\b|\b(knee|elbow|shoulder|wrist) (pain|hurts)\b/, word: 'joint pain' },
  { re: /\bshort(ness)? of breath\b|\bcan'?t breathe\b/, word: 'breathing' },
  { re: /\bheart (racing|pounding)\b|\bpalpitations?\b/, word: 'heart' },
  // Romanian
  { re: /\bametea(la|li)\b|\bametit\b|\bma ia (cu )?ameteala\b/, word: 'dizziness' },
  { re: /\bdurere (in|de) piept\b|\bma doare (in )?pieptul\b/, word: 'chest pain' },
  { re: /\blesin(at|ul)?\b|\bam lesinat\b|\bm-am lesinat\b/, word: 'fainting' },
  { re: /\bdurere ascutita\b|\bjunghi\b/, word: 'sharp pain' },
  { re: /\bdurere (de|la|in) (articulatii|articulatie|genunchi|cot|umar|incheietura)\b|\bma doare (articulatia|genunchiul|cotul|umarul|incheietura)\b/, word: 'joint pain' },
  { re: /\bnu pot respira\b|\bma sufoc\b/, word: 'breathing' }
]
/** Where the Romanian patterns start in RED_FLAGS. */
const RO_FROM = 8
const NEGATED = /\b(no|not|never|without|fara|nu am|n-am|nici)\s+(\w+\s+)?$/

export interface RedFlag {
  hit: boolean
  words: string[]
  /** What the coach says instead of any exercise advice. */
  reply: string
}

const RED_REPLY = {
  en: 'Stop training for today and see a doctor about this. Not normal muscle soreness: get it checked first, then we go on.',
  ro: 'Oprește antrenamentul azi și mergi la medic pentru asta. Nu e febră musculară normală: verifică întâi, apoi continuăm.'
}

/** Red-flag words (not normal soreness), English and Romanian. A plain "no dizziness" doesn't count. */
export function redFlag(text: string, lang: 'en' | 'ro' = 'en'): RedFlag {
  const t = plain(text)
  const words: string[] = []
  for (const f of RED_FLAGS) {
    const m = f.re.exec(t)
    if (!m) continue
    if (NEGATED.test(t.slice(Math.max(0, m.index - 24), m.index))) continue
    if (!words.includes(f.word)) words.push(f.word)
  }
  // A Romanian message gets the Romanian reply.
  const ro = lang === 'ro' || RED_FLAGS.slice(RO_FROM).some((f) => f.re.test(t))
  return { hit: words.length > 0, words, reply: words.length ? RED_REPLY[ro ? 'ro' : 'en'] : '' }
}

/** Words the coach never uses about your body. */
const BODY_BAD = /\b(fat|fatter|chubby|flabby|skinny|scrawny|ugly|gross|disgusting|weak looking|belly|gras|grasa|slab|slaba|urat|urata|burta|burtica)\b/
const BURNERS = /\b(fat ?burners?|thermogenics?|clenbuterol|ephedrine|dnp|yohimbine|arzatoare? de grasimi|arzator(i)? de grasimi|diet pills?|pastile de slabit)\b/
const CUT_WORDS = /\b(eat less|cut (your )?calories|cut down|mananca mai putin|taie (din )?calorii)\b/

/** A sentence the coach may say: no body put-downs, no fat burners, no cut talk unless a cut is allowed. */
export function sentenceOk(s: string, o: { cutAllowed?: boolean } = {}): boolean {
  const t = plain(s)
  if (BODY_BAD.test(t) && !/\bpeanut|\bbody fat (%|estimate)/.test(t)) return false
  if (BURNERS.test(t)) return false
  if (!o.cutAllowed && CUT_WORDS.test(t)) return false
  // Any kcal goal under the floor.
  for (const m of t.matchAll(/(\d[\d,.]*)\s*kcal/g)) {
    const n = Number(m[1].replace(/[,.](?=\d{3}\b)/g, ''))
    if (n >= 800 && n < KCAL_FLOOR && /\b(eat|aim|goal|target|mananca|tinta)\b/.test(t)) return false
  }
  return true
}

/** The text with every sentence that breaks a rule taken out. */
export function safeText(text: string, o: { cutAllowed?: boolean } = {}): string {
  return String(text ?? '')
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim() && sentenceOk(s, o))
    .join(' ')
    .trim()
}

export const SUPPLEMENTS = [
  { id: 'shake', label: 'Protein shake (optional)', note: 'Only if food is short on protein.' },
  { id: 'creatine', label: 'Creatine 3–5 g a day (optional)', note: 'Plain creatine monohydrate, every day, with water.' }
] as const

/** The blood-test reminder: from the coach's start (or now) until dismissed, then again every 30 days. */
export function bloodTestDue(cfg: { bloodDismissed: string | null; ramp: { start: string | null } }, today: string): boolean {
  if (cfg.bloodDismissed) return today >= addDays(cfg.bloodDismissed, BLOOD_EVERY)
  return !cfg.ramp.start || today >= cfg.ramp.start
}

export const BLOOD_TEXT = 'Blood test: ask for a hemogram, ferritin, vitamin D and B12. It shows if anything holds your growth back.'
