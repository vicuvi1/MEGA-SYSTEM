// The food counter in Ben and on Telegram (pure, tested). Nothing here pays
// points and every number comes from the data handed in (benGround rule).
// - a pasted AI reply becomes a draft (preview, -/+25 g, "chicken 175", Save);
// - "what should I eat now?" is answered from the food log, no model;
// - the evening protein nudge and the dinner reminder: one food push a day,
//   one key (`food:evening:<day>` / `food:dinner:<day>`), one channel;
// - the Sunday food report (average protein and kcal vs goal, weight, days on goal, one tip).
// The database side is web/bots/foodBot.ts.
import { scaleItem, sumItems, type FoodItem } from './food'
import type { FoodWeek } from './food'
import { channelFor, type PushButton, type PushLog, type PushOut } from './benPushes'

// ---- the setting `food_ben`: the open Telegram draft and the mute ----

export interface FoodDraft {
  /** Short id, in the buttons (a tap on an older preview does nothing). */
  id: string
  at: number
  items: FoodItem[]
  question: string | null
}
export interface FoodBen {
  draft: FoodDraft | null
  /** "Mute food nudges for 7 days": no evening nudge or dinner reminder before this time. */
  muteUntil: number | null
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
      ? { id: d.id, at: d.at, items: d.items.slice(0, 12) as FoodItem[], question: typeof d.question === 'string' ? d.question.slice(0, 200) : null }
      : null
  return { draft, muteUntil: typeof o.muteUntil === 'number' && Number.isFinite(o.muteUntil) ? o.muteUntil : null }
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
  if (!i.lateMeal && m >= w.dinner[0] && m < w.dinner[1]) {
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
