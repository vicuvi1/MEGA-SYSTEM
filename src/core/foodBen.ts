// The food counter in Ben and on Telegram (pure, tested). Nothing here pays
// points and every number comes from the data handed in (benGround rule).
// - a pasted AI reply becomes a draft (preview, -/+25 g, "chicken 175", Save);
// - "what should I eat now?" is answered from the food log, no model;
// - the evening protein nudge and the dinner reminder: one food push a day,
//   one key (`food:evening:<day>` / `food:dinner:<day>`), one channel;
// - the Sunday food report (average protein and kcal vs goal, weight, days on goal, one tip);
// - a meal photo sent on Telegram → the same vision check as the website → a
//   preview (how many of each, 🔁 swap for a saved food, Save);
// - meal reminders at the slots of the standard day (morning, lunch, afternoon,
//   evening): one gentle nudge when nothing was logged since the slot before.
// The database side is web/bots/foodBot.ts.
import { scaleItem, sumItems, type FoodItem, type MealType } from './food'
import type { FoodWeek } from './food'
import { channelFor, type PushButton, type PushLog, type PushOut } from './benPushes'
import { scaleVisionItem, stepQty, toFoodItems, visionTotals, type SavedFoodRef, type VisionItem } from './foodVision'

// ---- the setting `food_ben`: the open Telegram draft and the mute ----

export interface FoodDraft {
  /** Short id, in the buttons (a tap on an older preview does nothing). */
  id: string
  at: number
  items: FoodItem[]
  question: string | null
  /**
   * A meal photo's draft: the foods as the AI read them (`base`) and as they are
   * now (`now`, after −/+, a swap or "eggs 2"). `items` follows `now`. The photo
   * itself is never kept.
   */
  photo?: { base: VisionItem[]; now: VisionItem[]; message: string }
}
export interface FoodBen {
  draft: FoodDraft | null
  /** "Mute food nudges for 7 days": no evening nudge, dinner reminder or meal reminder before this time. */
  muteUntil: number | null
  /** The meals a one-tap log made (the standard day makes several), for its ↩ Undo. */
  undo?: { id: string; ids: string[]; at: number } | null
}
export const FOOD_BEN_KEY = 'food_ben'
/** A draft stays open this long (then a "chicken 175" is a normal message again). */
export const DRAFT_MS = 2 * 3600_000
export const MUTE_DAYS = 7
export const STEP_G = 25

export function cleanFoodBen(raw: unknown): FoodBen {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<FoodBen>
  const d = o.draft as Partial<FoodDraft> | null | undefined
  const draft =
    d && typeof d === 'object' && typeof d.id === 'string' && /^[a-z0-9]{1,12}$/.test(d.id) && typeof d.at === 'number' && Array.isArray(d.items) && d.items.length
      ? { id: d.id, at: d.at, items: d.items.slice(0, 12) as FoodItem[], question: typeof d.question === 'string' ? d.question.slice(0, 200) : null, ...photoOf(d.photo) }
      : null
  const u = o.undo
  const undo = u && typeof u === 'object' && typeof u.id === 'string' && /^[a-z0-9]{1,12}$/.test(u.id) && Array.isArray(u.ids) && typeof u.at === 'number' ? { id: u.id, ids: u.ids.filter((x) => typeof x === 'string' && /^fd-[a-z0-9]{1,24}$/.test(x)).slice(0, 10), at: u.at } : null
  return { draft, muteUntil: typeof o.muteUntil === 'number' && Number.isFinite(o.muteUntil) ? o.muteUntil : null, ...(undo ? { undo } : {}) }
}
const visionList = (raw: unknown): VisionItem[] | null => {
  if (!Array.isArray(raw) || !raw.length) return null
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const out = raw.slice(0, 12).filter((x) => x && typeof x === 'object' && typeof x.name === 'string').map(
    (x: any): VisionItem => ({ name: String(x.name).slice(0, 60), matchedSavedFoodId: typeof x.matchedSavedFoodId === 'string' ? x.matchedSavedFoodId.slice(0, 40) : null, qty: n(x.qty) || 1, unit: String(x.unit ?? '').slice(0, 20), grams: n(x.grams), kcal: n(x.kcal), protein: n(x.protein), carbs: n(x.carbs), fat: n(x.fat), confidence: x.confidence === 'high' || x.confidence === 'low' ? x.confidence : 'medium' })
  )
  return out.length ? out : null
}
function photoOf(raw: unknown): { photo?: FoodDraft['photo'] } {
  const p = raw as { base?: unknown; now?: unknown; message?: unknown } | null | undefined
  if (!p || typeof p !== 'object') return {}
  const base = visionList(p.base)
  const now = visionList(p.now)
  return base && now && base.length === now.length ? { photo: { base, now, message: typeof p.message === 'string' ? p.message.slice(0, 200) : '' } } : {}
}
export const liveDraft = (fb: FoodBen, now: number): FoodDraft | null => (fb.draft && now - fb.draft.at < DRAFT_MS && now >= fb.draft.at - 60_000 ? fb.draft : null)
export const isMuted = (fb: FoodBen, now: number) => fb.muteUntil != null && now < fb.muteUntil

// ---- a pasted reply ----

/**
 * Looks like an AI app's reply to the food prompt: a JSON block (fenced or
 * not) that talks about food numbers, or plain lines with grams, protein and kcal.
 * A quick log ("protein 30", "chicken 150g") is not one.
 */
export function looksLikeFoodReply(text: string): boolean {
  const t = String(text ?? '')
  if (t.length < 20 || t.length > 12_000 || t.trim().startsWith('/')) return false
  const words = /\b(protein|proteins|kcal|calories|carbs|carbohydrates|fat|grams)\b/i
  if ((/```/.test(t) || /[{[][\s\S]*[}\]]/.test(t)) && words.test(t) && /\d/.test(t)) return true
  // Plain lines: "Chicken breast 150 g, 46 g protein, 230 kcal".
  return /\bprotein\b/i.test(t) && /\b(kcal|calories)\b/i.test(t) && (t.match(/\d+/g) ?? []).length >= 3
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The preview on Telegram (HTML): each food, the total and the AI's question. */
export function draftText(d: FoodDraft): string {
  const t = sumItems(d.items)
  return [
    '🍽 <b>Check the meal, then Save</b>',
    ...d.items.map((it, i) => `${i + 1}. ${escHtml(cap(it.name))} · ${fmt(it.grams)} g · ${fmt(it.protein)} g protein · ${fmt(it.kcal)} kcal`),
    `<b>Total: ${fmt(t.protein)} g protein · ${fmt(t.kcal)} kcal</b> (carbs ${fmt(t.carbs)} g · fat ${fmt(t.fat)} g)`,
    ...(d.question ? [`❓ ${escHtml(d.question)}`] : []),
    `Tap −/+ for ${STEP_G} g, or type the food and the grams, e.g. <code>${escHtml(d.items[0].name.split(' ')[0].toLowerCase())} 175</code>.`
  ].join('\n')
}

/** The preview's buttons: −/+25 g per food, then Save / Edit grams / Cancel. */
export function draftKeyboard(d: FoodDraft): { inline_keyboard: { text: string; callback_data: string }[][] } {
  const rows = d.items.slice(0, 8).map((it, i) => [
    { text: `− ${i + 1}. ${cap(it.name).slice(0, 18)}`, callback_data: `fd|-|${d.id}|${i}` },
    { text: `+${STEP_G} g`, callback_data: `fd|+|${d.id}|${i}` }
  ])
  rows.push([
    { text: '✅ Save', callback_data: `fd|s|${d.id}` },
    { text: '✏️ Edit grams', callback_data: `fd|e|${d.id}` },
    { text: '✗ Cancel', callback_data: `fd|x|${d.id}` }
  ])
  return { inline_keyboard: rows }
}

/** −/+25 g on one food (macros scale with the grams). */
export function stepDraft(d: FoodDraft, index: number, dir: 1 | -1): FoodDraft {
  const it = d.items[index]
  if (!it) return d
  return { ...d, items: d.items.map((x, i) => (i === index ? scaleItem(x, Math.max(5, x.grams + dir * STEP_G)) : x)) }
}

/**
 * "type: chicken 175", "chicken 175g", "2 175" while a draft is open → which
 * food and its new grams. Null when it names none of the draft's foods (or two).
 */
export function readGramEdit(text: string, d: FoodDraft): { index: number; grams: number } | null {
  const m = /^\s*(?:type\s*:?\s*)?(.{1,40}?)\s*[:=]?\s+(\d{1,4})\s*(?:g|gr|grams?)?\s*\.?\s*$/i.exec(String(text ?? ''))
  if (!m) return null
  const grams = Number(m[2])
  if (!(grams >= 5 && grams <= 3000)) return null
  const who = m[1].trim().toLowerCase()
  if (/^\d{1,2}$/.test(who)) {
    const i = Number(who) - 1
    return d.items[i] ? { index: i, grams } : null
  }
  const names = d.items.map((it) => it.name.toLowerCase())
  const exact = names.indexOf(who)
  if (exact >= 0) return { index: exact, grams }
  const hits = names.map((n, i) => ({ n, i })).filter(({ n }) => n.includes(who) || who.includes(n) || n.split(/\s+/)[0] === who.split(/\s+/)[0])
  return hits.length === 1 ? { index: hits[0].i, grams } : null
}
export const setGrams = (d: FoodDraft, index: number, grams: number): FoodDraft => ({ ...d, items: d.items.map((x, i) => (i === index ? scaleItem(x, grams) : x)) })

/** Shape of a gram edit, checked before reading the draft (keeps other messages free of a database read). */
export const gramEditShape = (text: string) => /^\s*(?:type\s*:?\s*)?.{1,40}?\s+\d{1,4}\s*(?:g|gr|grams?)?\s*\.?\s*$/i.test(String(text ?? '')) && String(text).length <= 60

// ---- Ask Ben: "what should I eat now?" ----

const plainText = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/** "What should I eat now?", "what to eat", "how much protein left", "ce sa mananc", "что съесть". */
export function asksFood(text: string): boolean {
  const t = plainText(String(text ?? '')).replace(/[?!.…]+$/g, '').trim()
  if (!t || t.length > 90 || t.split(' ').length > 12) return false
  if (/\b(recipe|cook|cooking|recipes)\b/.test(t)) return false
  if (/\bwhat (should|shall|can|could|do) i eat\b|\bwhat to eat\b|\bwhat (should|can) i have to eat\b|\bwhat('s| is) (good|best) to eat\b/.test(t)) return true
  if (/\bhow much protein\b.*\b(left|to go|remaining|more|still|need|missing)\b|\bprotein (left|to go|remaining)\b|\bhow much more protein\b/.test(t)) return true
  if (/\bce (sa |să )?(mai )?(mananc|maninc)\b/.test(t)) return true
  if (/(^|\s)что (мне )?(съесть|поесть)(\s|$)/.test(t)) return true
  return false
}

/** The answer in code: what to eat next first, then today's totals (both from the food log). */
export function foodAnswer(o: { dayLine: string; next: { line: string } }): { reply: string; chips: string[]; read: string } {
  const end = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`)
  return { reply: `${end(o.next.line)}\nSo far: ${end(o.dayLine)}`, chips: [], read: "Read today's food log" }
}

// ---- the evening nudge and the dinner reminder ----

export const FOOD_PUSH_PREFIX = 'food:'
export const foodEveningKey = (day: string) => `food:evening:${day}`
export const foodDinnerKey = (day: string) => `food:dinner:${day}`
/** Short by at least this much protein → the evening nudge. */
export const SHORT_G = 25

const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
/** Minutes into the app day (it turns at 04:00, so 00:30 is 24:30). */
export const appMinute = (d: Date) => {
  const m = d.getHours() * 60 + d.getMinutes()
  return m < 240 ? m + 1440 : m
}
const bedMinute = (bed: string | null | undefined) => {
  if (!bed || !/^\d{1,2}:\d{2}$/.test(bed)) return 23 * 60
  const m = toMin(bed.padStart(5, '0'))
  return m < 12 * 60 ? m + 1440 : m
}

/**
 * When the two food pushes may come: the evening nudge from 20:30 (earlier for
 * an early bed) until an hour before bed; the dinner reminder from 21:00
 * (earlier for an early bed) until 30 minutes before bed.
 */
export function foodWindows(bed: string | null | undefined): { evening: [number, number]; dinner: [number, number] } {
  const b = bedMinute(bed)
  return { evening: [Math.min(20 * 60 + 30, b - 90), b - 60], dinner: [Math.min(21 * 60, b - 60), b - 30] }
}
/** Cheap check before reading the food log: inside either window now. */
export function foodNudgeDue(now: Date, bed: string | null | undefined): boolean {
  const m = appMinute(now)
  const w = foodWindows(bed)
  return (m >= w.evening[0] && m < w.evening[1]) || (m >= w.dinner[0] && m < w.dinner[1])
}

export interface FoodNudgeInput {
  now: Date
  /** The push log's day. */
  day: string
  bed: string | null
  protein: number
  proteinGoal: number
  /** Anything logged today (a quick protein log or a meal). */
  loggedToday: boolean
  /** Something logged after 17:00 today (dinner, or a late snack). */
  lateMeal: boolean
  /** Yesterday had a meal to repeat ("Same as yesterday"). */
  yesterday: boolean
  /** whatNextNow(): the line and its ideas. */
  next: { line: string; ideas: { text: string }[] }
  log: PushLog
  here: boolean
  meeting: boolean
  /** Quiet hours, a paused day, or bed already logged. */
  quiet: boolean
  muted: boolean
}

const MUTE_BTN: PushButton = { label: `🔕 Mute food nudges for ${MUTE_DAYS} days`, op: 'mute' }

/**
 * One food push a day at most, never in a meeting, quiet hours, after bed or while muted:
 * - something eaten after 17:00 and protein short by 25 g+ → the evening nudge
 *   ("40 g protein short today: a shake + 100 g skyr fixes it.");
 * - nothing logged after 17:00 → the dinner reminder (it also covers a day with nothing logged).
 */
export function decideFoodNudge(i: FoodNudgeInput): PushOut | null {
  if (i.muted || i.meeting || i.quiet) return null
  if (Object.keys(i.log.recs).some((k) => k.startsWith(FOOD_PUSH_PREFIX))) return null
  const m = appMinute(i.now)
  const w = foodWindows(i.bed)
  const channel = channelFor(i.here)
  const short = Math.round(i.proteinGoal - i.protein)
  if (i.loggedToday && i.lateMeal && short >= SHORT_G && i.proteinGoal > 0 && m >= w.evening[0] && m < w.evening[1]) {
    const fix = i.next.ideas.slice(0, 2).map((x) => x.text)
    const text = fix.length ? `${short} g protein short today: ${fix.join(' or ')} fixes it.` : `${short} g protein short today. ${i.next.line}.`
    return { key: foodEveningKey(i.day), type: 'food', area: 'body', level: 'normal', title: 'Protein today', text, face: '🍗', channel, buttons: [{ label: '👍 OK', op: 'ok', primary: true }, MUTE_BTN] }
  }
  // The evening meal reminder already asked about dinner today: no second ask.
  if (!i.lateMeal && m >= w.dinner[0] && m < w.dinner[1] && !i.log.recs[mealKey(i.day, 'evening')]) {
    const text = i.yesterday ? 'Log dinner? Copy the prompt or Same as yesterday.' : "Log dinner? Copy the prompt, then paste the AI's reply here."
    const buttons: PushButton[] = [{ label: '📋 Copy the prompt', op: 'prompt', primary: true }, ...(i.yesterday ? [{ label: '🔁 Same as yesterday', op: 'yesterday' as const }] : []), MUTE_BTN]
    return { key: foodDinnerKey(i.day), type: 'food', area: 'body', level: 'normal', title: 'Dinner', text, face: '🍽', channel, buttons }
  }
  return null
}

// ---- the Sunday food report ----

/** The weight over the week: the first and last weigh-in of the last 7 days (or the last one before it). */
export function weekWeight(ins: { day: string; weight: number }[], today: string, weekStart: string): { from: number; to: number; delta: number; fromDay: string; toDay: string } | null {
  const list = ins.filter((x) => x.weight > 0 && x.day <= today).sort((a, b) => (a.day < b.day ? -1 : 1))
  const inWeek = list.filter((x) => x.day >= weekStart)
  if (!inWeek.length) return null
  const last = inWeek[inWeek.length - 1]
  const before = list.filter((x) => x.day < weekStart).pop()
  const first = inWeek.length >= 2 ? inWeek[0] : before && before.day >= addDaysLite(weekStart, -7) ? before : null
  if (!first || first === last) return null
  const r1 = (n: number) => Math.round(n * 10) / 10
  return { from: r1(first.weight), to: r1(last.weight), delta: r1(last.weight - first.weight), fromDay: first.day, toDay: last.day }
}
function addDaysLite(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export interface FoodReport {
  lines: string[]
  tip: string
  html: string
}

/** The Sunday food report, or null when nothing was logged all week. */
export function foodReport(o: { week: FoodWeek; goals: { protein: number; kcal: number }; weight: ReturnType<typeof weekWeight> }): FoodReport | null {
  const w = o.week
  const pDays = w.perDay.filter((d) => d.protein > 0).length
  if (!w.days && !pDays) return null
  const lines = [`Protein: ${fmt(w.avgProtein)} g a day on average (goal ${fmt(o.goals.protein)} g), on the ${pDays} ${pDays === 1 ? 'day' : 'days'} you logged it`]
  lines.push(w.days ? `Calories: ${fmt(w.avgKcal)} kcal a day on the ${w.days} ${w.days === 1 ? 'day' : 'days'} you logged meals (goal ${fmt(o.goals.kcal)})` : 'Calories: no meals logged with the food counter this week')
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`)
  lines.push(o.weight ? `Weight: ${o.weight.from} → ${o.weight.to} kg (${sign(o.weight.delta)} kg this week)` : 'Weight: not enough weigh-ins this week')
  lines.push(`Days on the protein goal: ${w.proteinHit} of 7`)
  const pShort = o.goals.protein - w.avgProtein
  const kOver = w.days ? w.avgKcal - o.goals.kcal : 0
  let tip: string
  if (pDays < 4) tip = 'Log protein on more days next week, so the averages tell the truth.'
  else if (pShort >= 10) tip = `Protein is ${fmt(pShort)} g a day short on average: add one protein snack a day (a shake or skyr).`
  else if (w.days >= 3 && kOver > o.goals.kcal * 0.1 && (o.weight?.delta ?? 0) > 0.2) tip = `Calories are ${fmt(kOver)} kcal a day over the goal and your weight went up: drop one snack a day.`
  else if (w.days >= 3 && -kOver > o.goals.kcal * 0.1 && (o.weight?.delta ?? 0) <= 0) tip = `Calories are ${fmt(-kOver)} kcal a day under the goal and your weight is not going up: eat a bit more on training days.`
  else tip = 'Good week: keep the same plan.'
  const html = ['🍽 <b>Food this week</b>', ...lines.map((l) => `• ${escHtml(l)}`), `💡 ${escHtml(tip)}`].join('\n')
  return { lines, tip, html }
}

// ---- a meal photo on Telegram ----

export interface PhotoSize {
  file_id: string
  width?: number
  height?: number
  file_size?: number
}
/** Biggest side of the photo we send to the AI (Telegram keeps ready sizes: 90, 320, 800, 1280 px). */
export const PHOTO_MAX_SIDE = 1280
/** About 1 MB of photo at most (the vision request takes 1.1 MB). */
export const PHOTO_MAX_BYTES = 1_000_000

/** The size to download: the largest one up to 1280 px and 1 MB, else the smallest one. No resizing needed. */
export function pickPhotoSize(sizes: PhotoSize[] | null | undefined): PhotoSize | null {
  const list = (Array.isArray(sizes) ? sizes : []).filter((x) => x && typeof x.file_id === 'string')
  if (!list.length) return null
  const side = (x: PhotoSize) => Math.max(Number(x.width) || 0, Number(x.height) || 0)
  const fits = list.filter((x) => side(x) <= PHOTO_MAX_SIDE && (Number(x.file_size) || 0) <= PHOTO_MAX_BYTES)
  if (fits.length) return fits.reduce((a, b) => (side(b) > side(a) ? b : a))
  return list.reduce((a, b) => (side(b) < side(a) ? b : a))
}

/**
 * Whether a photo is a meal to log (most are). A caption that asks the coach
 * something ("?" in it, or it starts with "Ben") keeps going to the coach's brain.
 */
export function photoIsMeal(caption: string): boolean {
  const t = String(caption ?? '').trim()
  if (!t) return true
  return !t.includes('?') && !/^(ben|coach)\b/i.test(t)
}

/** A photo draft from the checked AI answer (core/foodVision.ts validateVision). */
export function photoDraft(id: string, at: number, items: VisionItem[], message: string): FoodDraft {
  return { id, at, items: toFoodItems(items), question: null, photo: { base: items, now: items, message } }
}
const withNow = (d: FoodDraft, now: VisionItem[]): FoodDraft => ({ ...d, items: toFoodItems(now), photo: { ...d.photo!, now } })

/** How many and the unit: "3 eggs", "1 container", "×2". */
const qtyText = (it: VisionItem) => {
  const q = Math.round(it.qty * 10) / 10
  return it.unit && it.unit !== 'g' && it.unit !== 'serving' && it.unit !== 'portion' ? `${q} ${it.unit}` : q !== 1 ? `×${q}` : ''
}

/** The photo preview on Telegram (HTML): each food with how many, kcal and protein; low-confidence foods marked. */
export function photoDraftText(d: FoodDraft): string {
  const list = d.photo?.now ?? []
  const t = visionTotals(list)
  return [
    '📸 <b>Check the meal, then Save</b>',
    ...list.map((it, i) => {
      const q = qtyText(it)
      return `${i + 1}. ${escHtml(cap(it.name))}${q ? ` · ${escHtml(q)}` : ''}${it.grams ? ` · ${fmt(it.grams)} g` : ''} · ${fmt(it.kcal)} kcal · ${fmt(it.protein)} g protein${it.confidence === 'low' ? '\n   ⚠️ not sure, check the portion' : ''}`
    }),
    `<b>Total: ~${fmt(t.kcal)} kcal · ${fmt(t.protein)} g protein</b>`,
    ...(d.photo?.message ? [`💬 ${escHtml(d.photo.message)}`] : []),
    `Tap −/+ for how many, 🔁 to swap for one of your saved foods, or type e.g. <code>${escHtml((list[0]?.name ?? 'eggs').split(' ')[0].toLowerCase())} 2</code>.`
  ].join('\n')
}

/** The photo preview's buttons: −/+/🔁 per food, then Save / Cancel. */
export function photoDraftKeyboard(d: FoodDraft): { inline_keyboard: { text: string; callback_data: string }[][] } {
  const rows = (d.photo?.now ?? []).slice(0, 8).map((it, i) => [
    { text: `− ${i + 1}. ${cap(it.name).slice(0, 16)}`, callback_data: `fd|-|${d.id}|${i}` },
    { text: '+', callback_data: `fd|+|${d.id}|${i}` },
    { text: '🔁 Swap', callback_data: `fd|w|${d.id}|${i}` }
  ])
  rows.push([
    { text: '✅ Save', callback_data: `fd|s|${d.id}` },
    { text: '✗ Cancel', callback_data: `fd|x|${d.id}` }
  ])
  return { inline_keyboard: rows }
}

/** −/+ on one food of a photo draft: whole steps (halves under 1); a saved food keeps its own numbers. */
export function stepPhoto(d: FoodDraft, index: number, dir: 1 | -1, saved: SavedFoodRef[]): FoodDraft {
  const it = d.photo?.now[index]
  if (!it) return d
  return setPhotoQty(d, index, stepQty(it.qty, dir), saved)
}
/** A new "how many" for one food of a photo draft (grams and macros follow). */
export function setPhotoQty(d: FoodDraft, index: number, qty: number, saved: SavedFoodRef[]): FoodDraft {
  const p = d.photo
  const base = p?.base[index]
  if (!p || !base) return d
  const next = { ...scaleVisionItem(base, qty / (base.qty || 1), saved), name: p.now[index].name }
  return withNow(d, p.now.map((x, i) => (i === index ? next : x)))
}
/** New grams for one food of a photo draft. */
export function setPhotoGrams(d: FoodDraft, index: number, grams: number, saved: SavedFoodRef[]): FoodDraft {
  const p = d.photo
  const base = p?.base[index]
  if (!p || !base) return d
  if (!base.grams) return withNow(d, p.now.map((x, i) => (i === index ? { ...x, grams } : x)))
  const next = { ...scaleVisionItem(base, grams / base.grams, saved), name: p.now[index].name }
  return withNow(d, p.now.map((x, i) => (i === index ? next : x)))
}
/** One food swapped for a saved food (its own numbers, one portion; −/+ then counts portions). */
export function swapPhoto(d: FoodDraft, index: number, item: VisionItem): FoodDraft {
  const p = d.photo
  if (!p || !p.now[index]) return d
  const put = (list: VisionItem[]) => list.map((x, i) => (i === index ? item : x))
  return { ...d, items: toFoodItems(put(p.now)), photo: { ...p, base: put(p.base), now: put(p.now) } }
}

/**
 * "eggs 2", "type: rice 150", "2 3" on a photo draft: up to 20 is how many,
 * more (or "150 g") is grams. Null when it names none of the foods (or two).
 */
export function readPhotoEdit(text: string, d: FoodDraft): { index: number; qty?: number; grams?: number } | null {
  const list = d.photo?.now
  if (!list) return null
  const m = /^\s*(?:type\s*:?\s*)?(.{1,40}?)\s*[:=]?\s+(\d{1,4}(?:[.,]5)?)\s*(g|gr|grams?|x|pcs)?\s*\.?\s*$/i.exec(String(text ?? ''))
  if (!m) return null
  const v = Number(m[2].replace(',', '.'))
  const isGrams = /^g/i.test(m[3] ?? '') || v > 20
  if (!(v > 0) || (isGrams && (v < 5 || v > 3000))) return null
  const who = m[1].trim().toLowerCase()
  let index = -1
  if (/^\d{1,2}$/.test(who)) index = list[Number(who) - 1] ? Number(who) - 1 : -1
  else {
    const one = (w: string) => w.replace(/(ies)$/, 'y').replace(/s$/, '')
    const names = list.map((it) => it.name.toLowerCase())
    const exact = names.indexOf(who)
    if (exact >= 0) index = exact
    else {
      const w = one(who.split(/\s+/)[0])
      const hits = names.map((n, i) => ({ n, i })).filter(({ n }) => n.includes(who) || who.includes(n) || n.split(/\s+/).map(one).includes(w))
      index = hits.length === 1 ? hits[0].i : -1
    }
  }
  if (index < 0) return null
  return isGrams ? { index, grams: Math.round(v) } : { index, qty: v }
}

/** The saved foods to swap one food for: the closest names first, at most 6. */
export function swapChoices(item: { name: string }, saved: SavedFoodRef[], max = 6): { ref: SavedFoodRef; n: number }[] {
  const words = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3)
      .map((w) => w.replace(/s$/, ''))
  const mine = new Set(words(item.name))
  return saved
    .map((ref, n) => ({ ref, n, score: words(ref.name).filter((w) => mine.has(w)).length }))
    .sort((a, b) => b.score - a.score || a.n - b.n)
    .slice(0, max)
    .map(({ ref, n }) => ({ ref, n }))
}
/** The swap list's buttons: one per saved food, then Back. */
export function swapKeyboard(d: FoodDraft, index: number, saved: SavedFoodRef[]): { inline_keyboard: { text: string; callback_data: string }[][] } {
  const it = d.photo?.now[index]
  const rows = it ? swapChoices(it, saved).map(({ ref, n }) => [{ text: `${ref.name.slice(0, 30)} · ${fmt(ref.kcal)} kcal`, callback_data: `fd|W|${d.id}|${index}|${n}` }]) : []
  rows.push([{ text: '← Back', callback_data: `fd|b|${d.id}` }])
  return { inline_keyboard: rows }
}

// ---- meal reminders at the standard day's slots ----

export type MealKind = 'morning' | 'lunch' | 'afternoon' | 'evening'
export const MEAL_KINDS: MealKind[] = ['morning', 'lunch', 'afternoon', 'evening']
export const MEAL_LABEL: Record<MealKind, string> = { morning: 'Breakfast', lunch: 'Lunch', afternoon: 'Afternoon snack', evening: 'Dinner' }
/** At most this many meal reminders a day (a snoozed one asked again counts). */
export const MEALS_PER_DAY = 3
/** A reminder may come this long after its slot's time (and before the next slot). */
export const MEAL_WINDOW_MIN = 90
export const MEAL_SNOOZE_MIN = 30
export const mealKey = (day: string, kind: MealKind) => `meal:${day}:${kind}`
export const mealAgainKey = (day: string, kind: MealKind) => `${mealKey(day, kind)}:again`
/** The meal kind in a meal reminder's key ("meal:2030-03-12:lunch" → lunch). */
export function mealKindOfKey(key: string): MealKind | null {
  const m = /^meal:\d{4}-\d{2}-\d{2}:(morning|lunch|afternoon|evening)(?::again)?$/.exec(String(key ?? ''))
  return m ? (m[1] as MealKind) : null
}

/** Which reminder a slot of the standard day is: by its name first ("Afternoon"), then its meal type. "Anytime" gets none. */
export function mealKindOf(slot: { label: string; slot: MealType }): MealKind | null {
  const l = String(slot.label ?? '').toLowerCase()
  if (/\b(morning|breakfast)\b/.test(l)) return 'morning'
  if (/\blunch\b/.test(l)) return 'lunch'
  if (/\bafternoon\b/.test(l)) return 'afternoon'
  if (/\b(evening|dinner|supper)\b/.test(l)) return 'evening'
  if (/\banytime\b/.test(l)) return null
  return slot.slot === 'breakfast' ? 'morning' : slot.slot === 'lunch' ? 'lunch' : slot.slot === 'dinner' ? 'evening' : null
}

/**
 * The time of each meal reminder, in minutes into the app day: breakfast 45
 * minutes after you wake (between 06:00 and 11:00; 08:30 without a wake time),
 * lunch 13:00, the afternoon snack 16:30, dinner 19:30.
 */
export function mealTimes(wake: string | null | undefined): Record<MealKind, number> {
  const w = wake && /^\d{1,2}:\d{2}$/.test(wake) ? toMin(wake.padStart(5, '0')) + 45 : 8 * 60 + 30
  return { morning: Math.max(6 * 60, Math.min(11 * 60, w)), lunch: 13 * 60, afternoon: 16 * 60 + 30, evening: 19 * 60 + 30 }
}

export interface MealSlotIn {
  kind: MealKind
  /** The slot's own name ("Lunch") and what you usually eat then ("Bulgur salad + Rye bread"). */
  label: string
  items: string
  /** The swap you sometimes make, if any ("Buckwheat + 2 × Egg"). */
  alt: string | null
  /** Already logged as this slot today (the standard day's checklist). */
  logged: boolean
}
export interface MealReminderIn {
  now: Date
  day: string
  /** Settings → Ben → Pushes → "Meal reminders" (default on). */
  on: boolean
  wake: string | null
  bed: string | null
  slots: MealSlotIn[]
  /** When food was last logged today (ms), or null. */
  lastLogAt: number | null
  log: PushLog
  here: boolean
  meeting: boolean
  /** Quiet hours, a paused day, or bed already logged. */
  quiet: boolean
  muted: boolean
}

/** A minute of today's app day as a time (ms). */
const appMinuteToMs = (now: Date, m: number) => now.getTime() + (m - appMinute(now)) * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds()

/**
 * One gentle meal reminder at a slot's time, when nothing was logged for that
 * meal yet (nothing since halfway from the slot before) ("Lunch time: log your bulgur salad + bread?" with Log it /
 * 30 min / Skip). Once per slot a day (a snoozed one comes back once), at most
 * 3 a day, never in a meeting, quiet hours, after bed or while food nudges are muted.
 */
export function decideMealReminder(i: MealReminderIn): PushOut | null {
  if (!i.on || i.muted || i.meeting || i.quiet || !i.slots.length) return null
  const recs = i.log.recs
  if (Object.keys(recs).filter((k) => k.startsWith('meal:')).length >= MEALS_PER_DAY) return null
  const m = appMinute(i.now)
  const bed = bedMinute(i.bed)
  if (m >= bed - 30) return null
  const times = mealTimes(i.wake)
  const slots = [...i.slots].sort((a, b) => times[a.kind] - times[b.kind])
  const channel = channelFor(i.here)
  const make = (s: MealSlotIn, again: boolean): PushOut => {
    const title = MEAL_LABEL[s.kind]
    const usual = `${s.items.charAt(0).toLowerCase()}${s.items.slice(1)}`
    const text = again ? `Still time to log ${title.toLowerCase()}: your ${usual}?` : `${title} time: log your ${usual}?`
    const buttons: PushButton[] = [
      { label: '✅ Log it', op: 'log', primary: true, arg: 'main' },
      ...(s.alt ? [{ label: `🔁 ${s.alt.slice(0, 28)}`, op: 'log' as const, arg: 'alt' }] : []),
      ...(again ? [] : [{ label: `⏰ ${MEAL_SNOOZE_MIN} min`, op: 'later' as const, minutes: MEAL_SNOOZE_MIN }]),
      { label: 'Skip', op: 'skip' }
    ]
    return { key: again ? mealAgainKey(i.day, s.kind) : mealKey(i.day, s.kind), type: 'food', area: 'body', level: 'soft', title, text, face: '🍽', channel, buttons }
  }
  // A snoozed reminder comes back once, when its time is up (unless you logged since).
  for (const s of slots) {
    const r = recs[mealKey(i.day, s.kind)]
    if (!r || r.ans !== 'later' || recs[mealAgainKey(i.day, s.kind)] || s.logged) continue
    const until = r.until ?? r.at + MEAL_SNOOZE_MIN * 60_000
    if (i.now.getTime() < until || i.now.getTime() > until + 60 * 60_000) continue
    if (i.lastLogAt != null && i.lastLogAt >= r.at) continue
    return make(s, true)
  }
  for (let k = 0; k < slots.length; k++) {
    const s = slots[k]
    const at = times[s.kind]
    const next = slots[k + 1] ? times[slots[k + 1].kind] : Infinity
    if (m < at || m >= Math.min(at + MEAL_WINDOW_MIN, next) || at >= bed - 30) continue
    if (recs[mealKey(i.day, s.kind)] || s.logged) continue
    // Nothing logged for this meal yet: since halfway from the slot before (a late breakfast still
    // counts as breakfast; something at 12:40 counts as lunch). The first slot counts from 04:00.
    const since = appMinuteToMs(i.now, k ? Math.round((times[slots[k - 1].kind] + at) / 2) : 240)
    if (i.lastLogAt != null && i.lastLogAt >= since) continue
    return make(s, false)
  }
  return null
}

/** Cheap check before reading the food log: inside a meal reminder's window, or a snoozed one may be due. */
export function mealDue(now: Date, wake: string | null | undefined, log: PushLog): boolean {
  const m = appMinute(now)
  const t = mealTimes(wake)
  if (MEAL_KINDS.some((k) => m >= t[k] && m < t[k] + MEAL_WINDOW_MIN)) return true
  return Object.entries(log.recs).some(([k, r]) => k.startsWith('meal:') && r.ans === 'later')
}
