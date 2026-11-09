// The food counter on Telegram and in Ben's pushes (the database side of
// core/foodBen.ts). Uses the food counter's own functions (src/main/food.ts),
// so a meal saved here is the same data as one saved in Body → Food. Nothing
// here pays points.
// - "/food" sends the copy prompt, "/food label" the label prompt (when there is one);
// - a pasted AI reply → a preview with −/+25 g per food, Save / Edit grams / Cancel;
//   "chicken 175" while it is open sets that food's grams;
// - a meal photo → the same vision read as the website (api/ai.mjs foodPhoto,
//   its 50-a-day count and the AI budget) → a preview with −/+ how many,
//   🔁 swap for a saved food, Save / Cancel; "eggs 2" sets how many. The photo
//   is never stored or logged;
// - "/meals", "standard day", "breakfast" or a saved meal's name → one tap logs it;
// - the buttons under the evening nudge, the dinner reminder and the meal
//   reminders (the prompt, Same as yesterday, Mute, Log it, 30 min, Skip);
// - the facts the nudges and the Sunday report are decided from.
import * as foodPrompts from '@core/foodPrompt'
import { FOOD_PROMPT } from '@core/foodPrompt'
import { parseFoodReply } from '@core/foodParse'
import { addDays } from '@core/dates'
import { sportToday } from '@core/sportShared'
import { targetForDay } from '@core/sleep'
import { yesterdayMeals, cleanFoodLog, sumItems, mealName, type FoodItem } from '@core/food'
import { liveIds } from '@core/bodyLog'
import { fromSaved, photoReplyLine, slotNow, toFoodItems, validateVision, visionTotals, type SavedFoodRef } from '@core/foodVision'
import { dayTotals, itemsOf, itemsText, matchSaved, slotItems, totalsOf, type FoodSaved, type SavedMatch } from '@core/foodSaved'
import type { PushLog, PushOut } from '@core/benPushes'
import {
  FOOD_BEN_KEY,
  MUTE_DAYS,
  appMinute,
  cleanFoodBen,
  decideFoodNudge,
  decideMealReminder,
  draftKeyboard,
  draftText,
  foodNudgeDue,
  foodReport,
  gramEditShape,
  isMuted,
  liveDraft,
  looksLikeFoodReply,
  mealDue,
  mealKindOf,
  mealKindOfKey,
  mealKey,
  mealTimes,
  photoDraft,
  photoDraftKeyboard,
  photoDraftText,
  photoIsMeal,
  pickPhotoSize,
  readGramEdit,
  readPhotoEdit,
  setGrams,
  setPhotoGrams,
  setPhotoQty,
  stepDraft,
  stepPhoto,
  swapKeyboard,
  swapPhoto,
  weekWeight,
  type FoodBen,
  type FoodDraft,
  type FoodReport,
  type MealKind,
  type PhotoSize
} from '@core/foodBen'
import { addFoodMeal, foodDayTotals, foodTargetsNow, foodWeekNow, readFoodLog, readFoodSaved, toggleFoodMeal, whatNextNow } from '../../../../main/food'
import { logSavedMeal, logStandardDay } from '../../../../main/foodSaved'
import { bodyEvents } from '../../../../main/bodyLog'
import { weighIns } from '../../../../main/bodyPlus'
import { readSetting, writeSetting } from '../../../../main/settings'
import { answerPushIn, readPushLog } from '../benPushStore'
import { readLifeFit, sleepWindow } from '../lifeFitStore'
import { downloadFile, esc, tg } from './telegram'
import type { CallbackHandler } from './callbacks'

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const shortId = () => Math.random().toString(36).slice(2, 8) || 'd'

export const readFoodBen = (db: any): FoodBen => cleanFoodBen(readSetting(db, FOOD_BEN_KEY))
export const writeFoodBen = (db: any, fb: FoodBen) => writeSetting(db, FOOD_BEN_KEY, fb as any)

/** The label prompt, if the food counter has one (skipped gracefully when not). */
export function labelPrompt(): string | null {
  const all = foodPrompts as unknown as Record<string, unknown>
  const p = all.FOOD_LABEL_PROMPT ?? all.LABEL_PROMPT
  return typeof p === 'string' && p.trim() ? p : null
}

/** A prompt as a Telegram message you can copy (one tap on the block copies it). */
export const promptMessage = (p: string, what = 'a meal photo') => `📋 <b>Copy this, paste it with ${what} into any AI app (ChatGPT, Gemini, Claude), then paste the AI's whole reply here.</b>\n\n<pre>${esc(p)}</pre>`

const COULD_NOT = (why: string) => `⚠️ I couldn't read that reply (${esc(why)}).\nSend /food for the prompt, ask the AI again, and paste its whole reply here.`

export type FoodOut = { reply: string; keyboard?: any }

/** The preview of a draft (a photo's or a pasted reply's). */
const previewOf = (d: FoodDraft): FoodOut => (d.photo ? { reply: photoDraftText(d), keyboard: photoDraftKeyboard(d) } : { reply: draftText(d), keyboard: draftKeyboard(d) })

// ---- saved foods and meals ----

/** Your saved foods and meals as the vision read sees them (one portion each; meals = the whole meal). */
export function savedRefs(s: FoodSaved): SavedFoodRef[] {
  const foods = s.foods.map((f): SavedFoodRef => ({ id: f.id, name: f.name, portion: f.grams ? `${f.portionLabel} (${f.grams} g)` : f.portionLabel, kcal: f.kcal, protein: f.protein, carbs: f.carbs ?? 0, fat: f.fat ?? 0 }))
  const meals = s.meals.map((m): SavedFoodRef => {
    const t = totalsOf(s, m.items)
    const g = Math.round(itemsOf(s, m.items).reduce((a, i) => a + i.grams, 0))
    return { id: m.id, name: m.name, portion: `1 meal (${g} g)`, kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat }
  })
  return [...foods, ...meals].slice(0, 60)
}

/** A short line that names a saved meal or the standard day ("breakfast", "standard day", "had lunch"). */
const savedShape = (t: string) => t.length >= 3 && t.length <= 48 && !/[?!]/.test(t) && !t.startsWith('/') && t.split(/\s+/).length <= 7
function savedHit(db: any, t: string): { s: FoodSaved; hit: Extract<SavedMatch, { kind: 'day' | 'meal' }> } | null {
  if (!savedShape(t)) return null
  const s = readFoodSaved(db)
  const hit = matchSaved(t, s)
  return hit && (hit.kind === 'day' || hit.kind === 'meal') ? { s, hit } : null
}

/** "Log it now?" under a saved meal (or the standard day) you named. */
function savedOffer(s: FoodSaved, hit: Extract<SavedMatch, { kind: 'day' | 'meal' }>): FoodOut {
  if (hit.kind === 'day') {
    const t = dayTotals(s)
    return { reply: `🍽 <b>Your standard day</b>: ${s.day.slots.length} meals · ${fmt(t.kcal)} kcal · ${fmt(t.protein)} g protein\nLog all of it now?`, keyboard: { inline_keyboard: [[{ text: '✅ Log my standard day', callback_data: 'fd|g|day' }, { text: '✗ No', callback_data: 'fd|n|x' }]] } }
  }
  const t = totalsOf(s, hit.meal.items)
  return { reply: `🍽 <b>${esc(hit.meal.name)}</b> · ${fmt(t.kcal)} kcal · ${fmt(t.protein)} g protein\nLog it now?`, keyboard: { inline_keyboard: [[{ text: '✅ Log it', callback_data: `fd|g|${hit.meal.id}` }, { text: '✗ No', callback_data: 'fd|n|x' }]] } }
}

export const MEALS_HEAD = '🍽 <b>Your saved meals</b>'
/** /meals: your saved meals as buttons (one tap logs it now). */
export function mealsMenu(s: FoodSaved): FoodOut {
  if (!s.meals.length && !s.day.slots.length) return { reply: 'No saved meals yet. Save one in Body → Food, then send /meals again.' }
  const rows: { text: string; callback_data: string }[][] = []
  if (s.day.slots.length) rows.push([{ text: `📅 Standard day · ${fmt(dayTotals(s).kcal)} kcal`, callback_data: 'fd|g|day' }])
  for (const m of s.meals.slice(0, 12)) rows.push([{ text: `${m.name.slice(0, 40)} · ${fmt(totalsOf(s, m.items).kcal)} kcal`, callback_data: `fd|g|${m.id}`.slice(0, 64) }])
  return { reply: `${MEALS_HEAD}\nTap one to log it now (↩ Undo comes after).`, keyboard: { inline_keyboard: rows } }
}

// ---- messages ----

/** Whether a Telegram message is for the food counter (a cheap read only for short shapes). */
export function foodWants(db: any, text: string, now = Date.now()): boolean {
  const t = String(text ?? '').trim()
  if (/^\/(food|meals)(@\w+)?(\s|$)/i.test(t) || looksLikeFoodReply(t)) return true
  if (gramEditShape(t)) {
    const d = liveDraft(readFoodBen(db), now)
    if (d && (d.photo ? readPhotoEdit(t, d) : readGramEdit(t, d))) return true
  }
  return !!savedHit(db, t)
}

/** One food message (inside mirror.write): /food, /meals, a pasted reply, an edit on the open preview, a saved meal's name. Null: not food. */
export function foodMessage(db: any, text: string, now = Date.now()): FoodOut | null {
  const t = String(text ?? '').trim()
  const cmd = /^\/food(?:@\w+)?(?:\s+(.*))?$/i.exec(t)
  if (cmd) {
    const arg = (cmd[1] ?? '').trim().toLowerCase()
    if (/^label/.test(arg)) {
      const p = labelPrompt()
      return { reply: p ? promptMessage(p, 'a photo of the label') : 'No label prompt yet. Send /food for the meal prompt.' }
    }
    return { reply: `${promptMessage(FOOD_PROMPT)}\n\n📸 Or just send the meal photo here (add a note like "2 containers, one buckwheat").` }
  }
  if (/^\/meals(?:@\w+)?(\s|$)/i.test(t)) return mealsMenu(readFoodSaved(db))
  const fb = readFoodBen(db)
  const open = liveDraft(fb, now)
  if (open && gramEditShape(t)) {
    if (open.photo) {
      const e = readPhotoEdit(t, open)
      if (e) {
        const saved = savedRefs(readFoodSaved(db))
        const d = e.qty != null ? setPhotoQty(open, e.index, e.qty, saved) : setPhotoGrams(open, e.index, e.grams!, saved)
        writeFoodBen(db, { ...fb, draft: d })
        return previewOf(d)
      }
    } else {
      const e = readGramEdit(t, open)
      if (e) {
        const d = setGrams(open, e.index, e.grams)
        writeFoodBen(db, { ...fb, draft: d })
        return previewOf(d)
      }
    }
  }
  if (!looksLikeFoodReply(t)) {
    const h = savedHit(db, t)
    return h ? savedOffer(h.s, h.hit) : null
  }
  const r = parseFoodReply(t)
  if (!r.ok) return { reply: COULD_NOT(r.why) }
  const d: FoodDraft = { id: shortId(), at: now, items: r.items, question: r.question }
  writeFoodBen(db, { ...fb, draft: d })
  return previewOf(d)
}

// ---- a meal photo ----

/** The vision read behind /api/ai {op:'foodPhoto'} (api/ai.mjs foodPhoto), handed in by the server. */
export type FoodPhotoFn = (body: unknown) => Promise<{ ok: boolean; result?: unknown; error?: string; limit?: string }>
/** The vision request takes about 1.1 MB of photo. */
const MAX_B64 = 1_500_000

/** Whether a Telegram message is a meal photo to read (a caption with a question still goes to the coach). */
export function photoWanted(message: any): boolean {
  return Array.isArray(message?.photo) && message.photo.length > 0 && photoIsMeal(String(message?.caption ?? ''))
}

/**
 * A meal photo from the owner's chat (checked before): download one size up to
 * 1280 px, read it with the same vision call as the website (its 50-a-day
 * count and AI budget), check the answer with core/foodVision.ts, and reply
 * with the preview. The photo lives only in this function's memory: it is
 * never written to the database or a log.
 */
export async function foodPhotoMessage(o: { token: string; chat: string; photos: PhotoSize[]; caption: string; mirror: { read<T>(fn: (db: any) => T): Promise<T>; write<T>(fn: (db: any) => T): Promise<T> }; foodPhoto: FoodPhotoFn; now?: Date }): Promise<string> {
  const now = o.now ?? new Date()
  const status = await tg(o.token, 'sendMessage', { chat_id: o.chat, text: '📸 Reading the photo…' }).catch(() => null)
  const statusId = status?.result?.message_id
  const say = async (text: string, keyboard?: any) => {
    const body = { chat_id: o.chat, text, parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard } : {}) }
    const r = statusId ? await tg(o.token, 'editMessageText', { ...body, message_id: statusId }).catch(() => null) : null
    if (!r?.ok) await tg(o.token, 'sendMessage', body).catch(() => null)
    return text
  }
  const size = pickPhotoSize(o.photos)
  let file = size ? await downloadFile(o.token, size.file_id, 'photo') : null
  if (!file || file.data.length > MAX_B64) return say("⚠️ I couldn't open that photo. Try again, or send /food for the copy prompt.")
  const ctx = await o.mirror.read((db) => {
    const saved = savedRefs(readFoodSaved(db))
    const t = foodDayTotals(db, now)
    const live = liveIds(bodyEvents(db, t.day))
    const items = readFoodLog(db, t.day)
      .meals.filter((m) => m.day === t.day && !m.supp && live.has(`${m.id}-p`))
      .map((m) => m.name)
      .slice(0, 20)
    return { saved, today: { kcal: t.kcal, protein: t.protein, items }, targets: { kcal: t.targets.kcal, protein: t.targets.protein } }
  })
  let ans: Awaited<ReturnType<FoodPhotoFn>>
  try {
    ans = await o.foodPhoto({ image: { mime: file.mime, data: file.data }, note: o.caption, saved: ctx.saved, today: ctx.today, targets: ctx.targets })
  } catch {
    ans = { ok: false, error: "The photo couldn't be read right now. Try again in a moment." }
  }
  // Done with the photo: nothing below sees it.
  file = null
  if (!ans.ok) return say(`⚠️ ${esc(String(ans.error || "The photo couldn't be read."))}\nOr send /food for the copy prompt.`)
  const check = validateVision(ans.result, ctx.saved)
  if (!check.ok) return say(`⚠️ ${esc(check.error)}`)
  const d = photoDraft(shortId(), now.getTime(), check.result.items, check.result.message)
  await o.mirror.write((db) => writeFoodBen(db, { ...readFoodBen(db), draft: d }))
  return say(photoDraftText(d), photoDraftKeyboard(d))
}

/**
 * "your evening and anytime meals cover it (~1,250 kcal)": the standard day's
 * slots not logged yet today (and not past), when they fill what's left.
 */
export function coverIdea(db: any, now: Date, kcalLeft: number): string | null {
  if (kcalLeft <= 100) return null
  const s = readFoodSaved(db)
  const today = sportToday(now)
  const live = liveIds(bodyEvents(db, today))
  const meals = readFoodLog(db, today).meals.filter((m) => m.day === today && live.has(`${m.id}-p`))
  const done = new Set(meals.map((m) => m.slot).filter(Boolean))
  // A breakfast, lunch or dinner already logged (any way) covers its slot; snacks don't.
  const types = new Set<string>(meals.map((m) => m.type).filter((t) => t !== 'snack'))
  const m = appMinute(now)
  const times = mealTimes(null)
  const left = s.day.slots.filter((sl) => {
    const k = mealKindOf(sl)
    return !done.has(sl.id) && !types.has(sl.slot) && (!k || times[k] + 30 > m)
  })
  if (!left.length) return null
  const kcal = totalsOf(s, left.flatMap((sl) => sl.items)).kcal
  if (kcal < kcalLeft * 0.8 || kcal > kcalLeft * 1.15) return null
  const names = left.map((sl) => sl.label.toLowerCase())
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `your ${list} ${left.length === 1 ? 'meal covers' : 'meals cover'} it (~${fmt(kcal)} kcal)`
}

// ---- meal reminders ----

/** Logs a slot of the standard day (its usual items, or its swap) as a meal now. */
export function logMealSlot(db: any, kind: MealKind, alt: boolean, source: string, now = new Date()): { id: string; name: string; protein: number; kcal: number } | null {
  const s = readFoodSaved(db)
  const slot = s.day.slots.find((x) => mealKindOf(x) === kind)
  if (!slot) return null
  const items = slotItems(slot, alt && slot.alternative ? 'alt' : 'main')
  if (!items.length) return null
  const name = `${slot.label}: ${itemsText(s, items)}`.slice(0, 60)
  const r = addFoodMeal(db, { items: itemsOf(s, items), name, type: slot.slot, source: 'saved', slot: slot.id }, source, now)
  return r ? { id: r.id, name, protein: r.totals.protein, kcal: r.totals.kcal } : null
}

/** The meal reminder due now (decided from the logs, the standard day and the push log), or null. */
export function mealPushFor(db: any, o: { now: Date; day: string; wake: string | null; bed: string | null; on: boolean; log: PushLog; here: boolean; meeting: boolean; quiet: boolean }): PushOut | null {
  if (!o.on || o.meeting || o.quiet || !mealDue(o.now, o.wake, o.log)) return null
  const s = readFoodSaved(db)
  const today = sportToday(o.now)
  const events = bodyEvents(db, today).filter((e) => e.day === today && (e.kind.startsWith('protein:') || e.kind.startsWith('kcal:')))
  const live = liveIds(events)
  const times = events.filter((e) => !e.undoes && live.has(e.id) && e.amount > 0).map((e) => Date.parse(e.at)).filter(Number.isFinite)
  const meals = readFoodLog(db, today).meals.filter((m) => m.day === today && live.has(`${m.id}-p`))
  const seen = new Set<MealKind>()
  const slots = s.day.slots.flatMap((sl) => {
    const kind = mealKindOf(sl)
    if (!kind || seen.has(kind) || !sl.items.length) return []
    seen.add(kind)
    return [{ kind, label: sl.label, items: itemsText(s, sl.items), alt: sl.alternative?.length ? itemsText(s, sl.alternative) : null, logged: meals.some((m) => m.slot === sl.id) }]
  })
  return decideMealReminder({ ...o, slots, lastLogAt: times.length ? Math.max(...times) : null, muted: isMuted(readFoodBen(db), o.now.getTime()) })
}

/**
 * The island's food push now (the app window decides while you're at the PC):
 * a meal reminder first, else the evening protein nudge or the dinner reminder.
 */
export function foodPushNow(db: any, svc: any, o: { now: Date; meeting: boolean; quiet: boolean; here?: boolean }): PushOut | null {
  if (o.meeting || o.quiet) return null
  const now = o.now
  const here = o.here ?? true
  const sl = svc.sleep
  const bed = (sl?.bedtimeTarget?.() as string | undefined) ?? null
  const day: string = svc.wallet.today(now)
  const log = readPushLog(db, day)
  const wake = (sl?.weekdayTarget ? targetForDay(day, sl.weekdayTarget(), sl.weekendTarget()) : null) || sleepWindow(db).wake
  const meal = mealPushFor(db, { now, day, wake, bed, on: readLifeFit(db).pushes?.meals !== false, log, here, meeting: o.meeting, quiet: o.quiet })
  if (meal) return meal
  if (!foodNudgeDue(now, bed)) return null
  return decideFoodNudge({ ...foodFacts(db, now), now, day, bed, log, here, meeting: o.meeting, quiet: o.quiet })
}

// ---- saved lines ----

/** "Saved: Chicken breast, rice · 51 g protein · 490 kcal" and today's line. */
function savedText(db: any, items: FoodItem[], now: Date): string {
  const t = sumItems(items)
  const day = foodDayTotals(db, now)
  return `✅ <b>Saved:</b> ${esc(mealName(items))} · ${fmt(t.protein)} g protein · ${fmt(t.kcal)} kcal\n${esc(day.line)}`
}

/** The meal to repeat for "Same as yesterday": yesterday's dinner, else its last meal. */
export function yesterdayMeal(db: any, now = new Date()): { name: string; items: FoodItem[] } | null {
  const today = sportToday(now)
  const log = cleanFoodLog(readSetting(db, 'food_log'), today)
  const meals = yesterdayMeals(log, bodyEvents(db, addDays(today, -1)), today)
  const m = meals.filter((x) => x.type === 'dinner').pop() ?? meals[meals.length - 1]
  return m ? { name: m.name, items: m.items } : null
}

/**
 * Ben's island card: "Same as yesterday" saves yesterday's dinner now (removable in Body → Food);
 * "Mute" mutes the food nudges for 7 days; "Log it" logs the meal reminder's usual meal
 * (`arg` 'alt': its swap). Returns the line to show.
 */
export function foodPushAct(db: any, op: 'yesterday' | 'mute' | 'log', now = new Date(), key = '', arg?: string): string {
  if (op === 'mute') {
    writeFoodBen(db, { ...readFoodBen(db), muteUntil: now.getTime() + MUTE_DAYS * 86400_000 })
    return `🔕 Food nudges muted for ${MUTE_DAYS} days.`
  }
  if (op === 'log') {
    const kind = mealKindOfKey(key)
    const r = kind ? logMealSlot(db, kind, arg === 'alt', 'island', now) : null
    if (!r) return 'That meal is not in your standard day any more.'
    return `✅ Logged: ${r.name} · ${fmt(r.kcal)} kcal · ${fmt(r.protein)} g protein. Fix it in Body → Food.`
  }
  const m = yesterdayMeal(db, now)
  if (!m) return 'Nothing from yesterday to repeat.'
  const saved = addFoodMeal(db, { items: m.items, name: m.name }, 'island', now)
  if (!saved) return 'Nothing from yesterday to repeat.'
  return `✅ Saved: ${m.name} · ${fmt(saved.totals.protein)} g protein · ${fmt(saved.totals.kcal)} kcal. Fix it in Body → Food.`
}

export interface FoodFacts {
  protein: number
  proteinGoal: number
  loggedToday: boolean
  lateMeal: boolean
  yesterday: boolean
  next: { line: string; ideas: { text: string }[] }
  muted: boolean
}

/** What the evening nudge and the dinner reminder are decided from (all from the logs). */
export function foodFacts(db: any, now = new Date()): FoodFacts {
  const today = sportToday(now)
  const t = foodDayTotals(db, now)
  const events = bodyEvents(db, today).filter((e) => e.day === today && (e.kind.startsWith('protein:') || e.kind.startsWith('kcal:')))
  const live = liveIds(events)
  const at17 = new Date(now)
  at17.setHours(17, 0, 0, 0)
  const since = at17.toISOString()
  const lateMeal = events.some((e) => !e.undoes && live.has(e.id) && e.amount > 0 && e.at >= since)
  const next = whatNextNow(db, now)
  return { protein: t.protein, proteinGoal: t.targets.protein, loggedToday: t.protein > 0 || t.kcal > 0, lateMeal, yesterday: !!yesterdayMeal(db, now), next: { line: next.line, ideas: next.ideas }, muted: isMuted(readFoodBen(db), now.getTime()) }
}

/** The Sunday food report (null when nothing was logged all week). */
export function foodSundayNow(db: any, now = new Date()): FoodReport | null {
  const today = sportToday(now)
  const t = foodTargetsNow(db, today)
  return foodReport({ week: foodWeekNow(db, now), goals: { protein: t.protein, kcal: t.kcal }, weight: weekWeight(weighIns(db), today, addDays(today, -6)) })
}

// ---- the buttons: "fd|…" ----

/**
 * The preview: fd|s|<draft> Save · fd|x|<draft> Cancel · fd|+|<draft>|<i> / fd|-|<draft>|<i>
 * (±25 g, or how many on a photo) · fd|e|<draft> how to type grams · fd|w|<draft>|<i> the swap
 * list · fd|W|<draft>|<i>|<n> swap for saved food n · fd|b|<draft> back to the preview.
 * After: fd|u|<meal> Undo a save · fd|v|<undo id> Undo a one-tap log of several meals.
 * Pushes: fd|p|<key> the prompt · fd|y|<key> Same as yesterday (a preview) · fd|m|<key> mute
 * food nudges for 7 days · fd|l|<key>|<0 or 1> Log it (the usual meal or its swap) ·
 * fd|z|<key> 30 min later · fd|k|<key> Skip.
 * Saved meals: fd|g|<meal id or "day"> log it now · fd|n|x No.
 */
export const FOOD_CALLBACK: CallbackHandler = {
  prefixes: ['fd'],
  match: (data) => data.startsWith('fd|'),
  run: async (c, t) => {
    const { services, markSeen } = c
    // The food counter's functions take any database (sql.js here).
    const mirror = c.mirror as unknown as { write<T>(fn: (db: any) => T): Promise<T> }
    const { data, chat, key, update, cq, answer, edit } = t
    if (!(await markSeen(key))) return null
    const m = /^fd\|([sx+\-eupymlzkgnvwWb])\|([\w:.-]{1,56})(?:\|(\d{1,2}))?(?:\|(\d{1,2}))?$/.exec(data)
    if (!m) return null
    const [, op, ref, idx, idx2] = m
    const now = new Date()
    const send = (text: string, keyboard?: any) => tg(update.__token, 'sendMessage', { chat_id: chat, text, parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard } : {}) }).catch(() => null)
    const clearButtons = () => tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => null)
    const answerPush = (pushOp: 'prompt' | 'yesterday' | 'mute') => mirror.write((db) => answerPushIn(db, services.services(db).wallet.today(now), ref, pushOp, now.getTime())).catch(() => null)

    if (op === 'p') {
      await answerPush('prompt')
      await answer('📋 The prompt is below')
      await send(promptMessage(FOOD_PROMPT))
      return 'prompt'
    }
    if (op === 'm') {
      await answerPush('mute')
      const line = await mirror.write((db) => foodPushAct(db, 'mute', now))
      await answer(line)
      await clearButtons()
      await send(esc(line))
      return line
    }
    if (op === 'y') {
      await answerPush('yesterday')
      const out = await mirror.write((db) => {
        const meal = yesterdayMeal(db, now)
        if (!meal) return null
        const d: FoodDraft = { id: shortId(), at: now.getTime(), items: meal.items, question: null }
        writeFoodBen(db, { ...readFoodBen(db), draft: d })
        return d
      })
      if (!out) {
        await answer('Nothing from yesterday to repeat')
        return null
      }
      await answer('🔁 Yesterday’s meal: check it, then Save')
      await send(draftText(out), draftKeyboard(out))
      return 'yesterday'
    }
    if (op === 'u') {
      const ok = await mirror.write((db) => toggleFoodMeal(db as any, ref, 'telegram', now))
      const line = ok ? '↩ Removed. Nothing counts from that meal.' : 'That meal is already gone.'
      await answer(line)
      await clearButtons()
      return line
    }
    if (op === 'v') {
      const ok = await mirror.write((db) => {
        const fb = readFoodBen(db)
        if (!fb.undo || fb.undo.id !== ref) return false
        for (const id of fb.undo.ids) toggleFoodMeal(db as any, id, 'telegram', now)
        writeFoodBen(db, { ...fb, undo: null })
        return true
      })
      const line = ok ? '↩ Removed. Nothing counts from those meals.' : 'Those meals are already gone.'
      await answer(line)
      await clearButtons()
      return line
    }
    if (op === 'n') {
      await answer('OK, not logged')
      await clearButtons()
      return 'no'
    }
    // A saved meal or the standard day, now (one log per button on a message, even on a double tap).
    if (op === 'g') {
      if (!(await markSeen(`fdg:${chat}:${cq.message?.message_id}:${ref}`))) {
        await answer('Already logged')
        return null
      }
      const r = await mirror.write((db) => {
        const s = readFoodSaved(db)
        const name = ref === 'day' ? 'Standard day' : s.meals.find((x) => x.id === ref)?.name
        const got = ref === 'day' ? logStandardDay(db, {}, 'telegram', now) : logSavedMeal(db, ref, null, 'telegram', now)
        if (!got || !got.ids.length || !name) return null
        const undoId = shortId()
        writeFoodBen(db, { ...readFoodBen(db), undo: { id: undoId, ids: got.ids, at: now.getTime() } })
        return { name, totals: got.totals, undoId, line: foodDayTotals(db, now).line }
      })
      if (!r) {
        await answer('That meal is not saved any more')
        return null
      }
      const text = `✅ <b>Logged:</b> ${esc(r.name)} · ${fmt(r.totals.kcal)} kcal · ${fmt(r.totals.protein)} g protein\n${esc(r.line)}`
      await answer('Logged')
      // The /meals list stays for the next tap; a "Log it now?" question is answered.
      if (!String(cq.message?.text ?? '').startsWith('🍽 Your saved meals')) await clearButtons()
      await send(text, { inline_keyboard: [[{ text: '↩ Undo', callback_data: `fd|v|${r.undoId}` }]] })
      return text
    }
    // A meal reminder: Log it / 30 min / Skip (the answer lands in the push log, like the island's).
    if (op === 'l' || op === 'z' || op === 'k') {
      const kind = mealKindOfKey(ref)
      if (!kind) return null
      const res = await mirror.write((db) => {
        const day: string = services.services(db).wallet.today(now)
        const base = mealKey(ref.slice(5, 15), kind)
        const log = readPushLog(db, day)
        if (log.recs[ref]?.ans === 'log' || log.recs[base]?.ans === 'log') return { kind: 'done' as const }
        if (op === 'z') {
          answerPushIn(db, day, ref, 'later', now.getTime(), 30)
          return { kind: 'later' as const }
        }
        if (op === 'k') {
          answerPushIn(db, day, ref, 'skip', now.getTime())
          return { kind: 'skip' as const }
        }
        const r = logMealSlot(db, kind, idx === '1', 'telegram', now)
        if (!r) return { kind: 'none' as const }
        answerPushIn(db, day, ref, 'log', now.getTime())
        return { kind: 'logged' as const, r, line: foodDayTotals(db, now).line }
      })
      if (res.kind === 'done') {
        await answer('Already logged')
        await clearButtons()
        return null
      }
      if (res.kind === 'none') {
        await answer('That meal is not in your standard day any more')
        await clearButtons()
        return null
      }
      if (res.kind === 'later') {
        await answer('⏰ Again in 30 min')
        await edit('⏰ OK, I’ll ask again in 30 min.')
        return 'later'
      }
      if (res.kind === 'skip') {
        await answer('Skipped')
        await edit('Skipped. Log it any time with /meals.')
        return 'skip'
      }
      const text = `✅ <b>Logged:</b> ${esc(res.r.name)} · ${fmt(res.r.kcal)} kcal · ${fmt(res.r.protein)} g protein\n${esc(res.line)}`
      await answer('Logged')
      await edit(text, { inline_keyboard: [[{ text: '↩ Undo', callback_data: `fd|u|${res.r.id}`.slice(0, 64) }]] })
      return text
    }
    // The preview's buttons: only on the open draft.
    const res = await mirror.write((db) => {
      const fb = readFoodBen(db)
      const d = liveDraft(fb, now.getTime())
      if (!d || d.id !== ref) return { kind: 'gone' as const }
      if (op === 'x') {
        writeFoodBen(db, { ...fb, draft: null })
        return { kind: 'cancel' as const }
      }
      if (op === 'e') return { kind: 'hint' as const, d }
      const i = Number(idx ?? -1)
      if (d.photo && (op === 'w' || op === 'W' || op === 'b')) {
        const saved = savedRefs(readFoodSaved(db))
        if (op === 'b' || !d.photo.now[i]) return { kind: 'draft' as const, d }
        if (op === 'w') return { kind: 'swap' as const, d, keyboard: swapKeyboard(d, i, saved) }
        const pick = saved[Number(idx2 ?? -1)]
        if (!pick) return { kind: 'draft' as const, d }
        const next = swapPhoto(d, i, fromSaved(pick, 1, d.photo.now[i].grams))
        writeFoodBen(db, { ...fb, draft: next })
        return { kind: 'draft' as const, d: next }
      }
      if (op === '+' || op === '-') {
        const next = d.photo ? stepPhoto(d, i, op === '+' ? 1 : -1, savedRefs(readFoodSaved(db))) : stepDraft(d, i, op === '+' ? 1 : -1)
        writeFoodBen(db, { ...fb, draft: next })
        return { kind: 'draft' as const, d: next }
      }
      if (op !== 's') return { kind: 'gone' as const }
      if (d.photo) {
        // The meal's id comes from the draft: a second Save (a double tap, a retry) can't log it twice.
        const items = d.photo.now
        const saved = addFoodMeal(db as any, { items: toFoodItems(items), id: `fd-p${d.id}`, type: slotNow(now), source: 'photo' }, 'telegram', now)
        writeFoodBen(db, { ...fb, draft: null })
        if (!saved) return { kind: 'gone' as const }
        const day = foodDayTotals(db, now)
        const idea = coverIdea(db, now, day.targets.kcal - day.kcal) ?? whatNextNow(db, now).ideas[0]?.text
        const line = photoReplyLine({ items, meal: visionTotals(items), day: { kcal: day.kcal, protein: day.protein, kcalGoal: day.targets.kcal, proteinGoal: day.targets.protein }, idea })
        return { kind: 'saved' as const, id: saved.id, text: `✅ <b>Saved.</b> ${esc(line)}` }
      }
      const saved = addFoodMeal(db as any, { items: d.items }, 'telegram', now)
      writeFoodBen(db, { ...fb, draft: null })
      if (!saved) return { kind: 'gone' as const }
      return { kind: 'saved' as const, id: saved.id, text: savedText(db, d.items, now) }
    })
    if (res.kind === 'gone') {
      await answer('That preview is closed. Send the photo or paste the reply again.')
      await clearButtons()
      return null
    }
    if (res.kind === 'cancel') {
      await answer('Cancelled')
      await edit('✗ Cancelled. Nothing saved.')
      return 'cancel'
    }
    if (res.kind === 'hint') {
      const first = res.d.items[0].name.split(' ')[0].toLowerCase()
      await answer('Type the food and the grams')
      await send(`✏️ Type the food and its grams, e.g. <code>${esc(first)} 175</code> or <code>1 175</code> (the number in the list).`)
      return 'hint'
    }
    if (res.kind === 'swap') {
      await answer('Pick the saved food')
      await tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: res.keyboard }).catch(() => null)
      return 'swap'
    }
    if (res.kind === 'draft') {
      await answer(op === '+' || op === '-' ? (res.d.photo ? (op === '+' ? '+1' : '−1') : `${op === '+' ? '+' : '−'}25 g`) : op === 'W' ? 'Swapped' : 'OK')
      const p = previewOf(res.d)
      await edit(p.reply, p.keyboard)
      return 'draft'
    }
    await answer('Saved')
    await edit(res.text, { inline_keyboard: [[{ text: '↩ Undo', callback_data: `fd|u|${res.id}`.slice(0, 64) }]] })
    return res.text
  }
}
