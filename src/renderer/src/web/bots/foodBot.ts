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
// - an album (several photos sent together) → ONE vision call with every photo
//   → ONE preview; "➕ Add another photo" on a preview collects more photos for
//   60 s, then "✅ Done, read them" reads them all together (foodAlbum.ts keeps
//   only Telegram's file ids, server-only, 10 minutes at most);
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
import { FACTORS, fromSaved, learnPortions, photoReplyLine, portionHints, slotNow, toFoodItems, validateVision, visionTotals, type SavedFoodRef } from '@core/foodVision'
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
  addHidden,
  askGrams,
  draftText,
  itemKeyboard,
  lockerPhotoIds,
  multiplyPhoto,
  readAskAnswer,
  removePhotoItem,
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
  photoSavedText,
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
import { logSavedMeal, logStandardDay, saveLoggedAsMeal } from '../../../../main/foodSaved'
import { bodyEvents } from '../../../../main/bodyLog'
import { weighIns } from '../../../../main/bodyPlus'
import { readSetting, writeSetting } from '../../../../main/settings'
import { answerPushIn, readPushLog } from '../benPushStore'
import { readLifeFit, sleepWindow } from '../lifeFitStore'
import { downloadFile, esc, tg } from './telegram'
import { coachNudgeFor, foodCapAllows } from '../../coach/coachTalkStore'
import type { CallbackHandler } from './callbacks'
import { attachMeal, dropHeld, holdPhotos } from './foodLocker'
import { MAX_SET, addPart, addedCount, collectAlbum, dropChatPhotos, joinAlbum, keepDraftPhotos, openAdd, setAddMsg, startAdd, takeAdd, type PhotoKv, type PhotoPart } from './foodAlbum'

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

/** A photo preview's buttons: the foods (tap one to fix it), Save and Add photo, Not this meal. */
export const photoKeyboard = (d: FoodDraft) => photoDraftKeyboard(d)
/** The preview of a draft (a photo's or a pasted reply's). A photo's names the meal from the time it was sent. */
const previewOf = (d: FoodDraft): FoodOut => (d.photo ? { reply: photoDraftText(d, slotNow(new Date(d.at))), keyboard: photoKeyboard(d) } : { reply: draftText(d), keyboard: draftKeyboard(d) })

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
  // Repeat meals first (📷: kept from a photo, logged again with no AI call).
  const meals = [...s.meals.filter((m) => m.photo), ...s.meals.filter((m) => !m.photo)]
  for (const m of meals.slice(0, 12)) rows.push([{ text: `${m.photo ? '📷 ' : ''}${m.name.slice(0, 40)} · ${fmt(totalsOf(s, m.items).kcal)} kcal`, callback_data: `fd|g|${m.id}`.slice(0, 64) }])
  return { reply: `${MEALS_HEAD}\nTap one to log it now (↩ Undo comes after).`, keyboard: { inline_keyboard: rows } }
}

// ---- messages ----

/** Whether a Telegram message is for the food counter (a cheap read only for short shapes). */
export function foodWants(db: any, text: string, now = Date.now()): boolean {
  const t = String(text ?? '').trim()
  if (/^\/(food|meals)(@\w+)?(\s|$)/i.test(t) || looksLikeFoodReply(t)) return true
  if (gramEditShape(t) || /^\s*\d{1,4}\s*(g|gr|grams?)?\s*\.?\s*$/i.test(t)) {
    const d = liveDraft(readFoodBen(db), now)
    if (d && (d.photo ? readAskAnswer(t, d) || readPhotoEdit(t, d) : readGramEdit(t, d))) return true
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
  // The one short question ("About how many grams of rice?") or "Change grams": a bare number answers it.
  const ans = open?.photo ? readAskAnswer(t, open) : null
  if (open && ans) {
    const d0 = setPhotoGrams(open, ans.index, ans.grams, savedRefs(readFoodSaved(db)))
    const d = { ...d0, photo: { ...d0.photo!, ask: null } }
    writeFoodBen(db, { ...fb, draft: d })
    return previewOf(d)
  }
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

/**
 * The vision read behind /api/ai {op:'foodPhoto'} (api/ai.mjs foodPhoto), handed in by the server.
 * `opts.counted`: photos of this meal already counted toward the 50 a day (an "Add another photo" re-read).
 */
export type FoodPhotoFn = (body: unknown, opts?: { counted?: number }) => Promise<{ ok: boolean; result?: unknown; error?: string; limit?: string }>
/** The vision request takes about 1.1 MB of photo. */
const MAX_B64 = 1_500_000

/** Whether a Telegram message is a meal photo to read (a caption with a question still goes to the coach). */
export function photoWanted(message: any): boolean {
  return Array.isArray(message?.photo) && message.photo.length > 0 && photoIsMeal(String(message?.caption ?? ''))
}

type Mirrorish = { read<T>(fn: (db: any) => T): Promise<T>; write<T>(fn: (db: any) => T): Promise<T> }

/** Sends a message, or edits `msgId` into it; returns the message id. */
async function sayIn(token: string, chat: string, msgId: number | null | undefined, text: string, keyboard?: any): Promise<number | null> {
  const body = { chat_id: chat, text, parse_mode: 'HTML', ...(keyboard ? { reply_markup: keyboard } : {}) }
  const r = msgId ? await tg(token, 'editMessageText', { ...body, message_id: msgId }).catch(() => null) : null
  if (r?.ok) return msgId ?? null
  const s = await tg(token, 'sendMessage', body).catch(() => null)
  return s?.result?.message_id ?? null
}

/**
 * Reads the photos of ONE meal (Telegram file ids, 1–6) with ONE vision call
 * (the website's: its 50-a-day count and AI budget), checks the answer with
 * core/foodVision.ts and turns `statusId` into the preview. The photos live
 * only in this function's memory; only their file ids are kept (10 minutes,
 * server-only) so "Add another photo" can read them again with a new one.
 */
export async function readMealPhotos(o: { token: string; chat: string; fileIds: string[]; caption: string; mirror: Mirrorish; foodPhoto: FoodPhotoFn; kv?: PhotoKv | null; counted?: number; statusId?: number | null; now?: Date }): Promise<string> {
  const now = o.now ?? new Date()
  const ids = o.fileIds.slice(0, MAX_SET)
  const say = async (text: string, keyboard?: any) => (await sayIn(o.token, o.chat, o.statusId, text, keyboard), text)
  const many = ids.length > 1
  let files: { mime: string; data: string }[] | null = []
  for (const id of ids) {
    const f = await downloadFile(o.token, id, 'photo')
    if (!f || f.data.length > MAX_B64) return say(many ? "⚠️ I couldn't open one of the photos. Try again, or send /food for the copy prompt." : "⚠️ I couldn't open that photo. Try again, or send /food for the copy prompt.")
    files.push({ mime: f.mime, data: f.data })
  }
  const ctx = await o.mirror.read((db) => {
    const saved = savedRefs(readFoodSaved(db))
    const t = foodDayTotals(db, now)
    const live = liveIds(bodyEvents(db, t.day))
    const items = readFoodLog(db, t.day)
      .meals.filter((m) => m.day === t.day && !m.supp && live.has(`${m.id}-p`))
      .map((m) => m.name)
      .slice(0, 20)
    return { saved, today: { kcal: t.kcal, protein: t.protein, items }, targets: { kcal: t.targets.kcal, protein: t.targets.protein }, portions: readFoodBen(db).portions ?? null }
  })
  let ans: Awaited<ReturnType<FoodPhotoFn>>
  try {
    // His usual portions (learned from his fixes) go along; the server keeps only the few saved foods his note names.
    ans = await o.foodPhoto({ images: files, note: o.caption, saved: ctx.saved, today: ctx.today, targets: ctx.targets, portions: portionHints(ctx.portions, o.caption) }, o.counted ? { counted: o.counted } : undefined)
  } catch {
    ans = { ok: false, error: "The photo couldn't be read right now. Try again in a moment." }
  }
  // Done with the photos: nothing below sees them.
  files = null
  if (!ans.ok) return say(`⚠️ ${esc(String(ans.error || "The photo couldn't be read."))}\nOr send /food for the copy prompt.`)
  const check = validateVision(ans.result, ctx.saved, ids.length, ctx.portions)
  if (!check.ok) return say(`⚠️ ${esc(check.error)}`)
  const msg = many ? `${ids.length} photos read together. ${check.result.message}`.trim().slice(0, 200) : check.result.message
  // A food it could not see well: one short question instead of a guess (a bare number answers it).
  const d = photoDraft(shortId(), now.getTime(), check.result.items, msg, { ask: check.result.question?.index ?? null, n: ids.length, hidden: check.result.hidden ?? null })
  await o.mirror.write((db) => writeFoodBen(db, { ...readFoodBen(db), draft: d }))
  if (o.kv) {
    await keepDraftPhotos(o.kv, o.chat, d.id, ids, o.caption, now.getTime()).catch(() => null)
    // The photos go to Photo Locker (and his Drive) through the app: only their file ids are held, 3 days at most.
    await holdPhotos(o.kv, d.id, ids, now.getTime()).catch(() => null)
  }
  return say(photoDraftText(d, slotNow(now)), photoKeyboard(d))
}

/** The "send the next photo" message while adding photos to a meal. */
const addText = (n: number, before: number) =>
  n
    ? `📸 Got ${n === 1 ? 'one more photo' : `${n} more photos`} (${before + n} for this meal). Send another within a minute, or tap Done.`
    : '📸 Send the next photo of this meal now (within a minute). Then tap Done, and I read all of them together.'
const addKeyboard = (draft: string) => ({ inline_keyboard: [[{ text: '✅ Done, read them', callback_data: `fd|r|${draft}` }], [{ text: '✗ Stop adding', callback_data: `fd|q|${draft}` }]] })

/**
 * A meal photo from the owner's chat (checked before). With `kv` (the server):
 * a photo sent in an open "Add another photo" window joins that meal; a part
 * of an album waits for its other parts (the first one reads them all in ONE
 * vision call, the rest answer nothing). Otherwise: download one size up to
 * 1280 px, read it, and reply with the preview. The photo lives only in
 * memory: never in the database or a log.
 */
export async function foodPhotoMessage(o: { token: string; chat: string; photos: PhotoSize[]; caption: string; mirror: Mirrorish; foodPhoto: FoodPhotoFn; kv?: PhotoKv | null; groupId?: string | null; messageId?: number; now?: Date }): Promise<string> {
  const now = o.now ?? new Date()
  const size = pickPhotoSize(o.photos)
  if (!size) {
    const text = "⚠️ I couldn't open that photo. Try again, or send /food for the copy prompt."
    await sayIn(o.token, o.chat, null, text)
    return text
  }
  const part: PhotoPart = { f: size.file_id, c: o.caption, m: Number(o.messageId) || now.getTime(), at: now.getTime() }
  const kv = o.kv ?? null
  if (kv) {
    // "Add another photo" is open: this photo joins that meal (read on Done).
    const st = await openAdd(kv, o.chat, now.getTime()).catch(() => null)
    if (st) {
      const n = await addPart(kv, o.chat, st, part, now.getTime())
      const text = st.f.length + n > MAX_SET ? `📸 That makes more than ${MAX_SET} photos: tap Done to read the first ${MAX_SET}.` : addText(n, st.f.length)
      await sayIn(o.token, o.chat, st.msg, text, addKeyboard(st.d))
      return text
    }
    // An album: the parts meet in the database; the first one reads them all.
    if (o.groupId) {
      const role = await joinAlbum(kv, o.chat, o.groupId, part, now.getTime())
      if (role === 'wait') return ''
      if (role === 'lead') {
        const status = await tg(o.token, 'sendMessage', { chat_id: o.chat, text: '📸 Reading the photos…' }).catch(() => null)
        const parts = await collectAlbum(kv, o.chat, o.groupId, () => Date.now())
        const list = parts.length ? parts : [part]
        const caption = [...new Set(list.map((p) => p.c.trim()).filter(Boolean))].join(' · ').slice(0, 300)
        const out = await readMealPhotos({ token: o.token, chat: o.chat, fileIds: list.slice(0, MAX_SET).map((p) => p.f), caption, mirror: o.mirror, foodPhoto: o.foodPhoto, kv, statusId: status?.result?.message_id, now })
        if (list.length > MAX_SET) await tg(o.token, 'sendMessage', { chat_id: o.chat, text: `Only the first ${MAX_SET} photos were read.` }).catch(() => null)
        return out
      }
      // 'late': the others were already read; this one is read on its own.
    }
  }
  const status = await tg(o.token, 'sendMessage', { chat_id: o.chat, text: '📸 Reading the photo…' }).catch(() => null)
  return readMealPhotos({ token: o.token, chat: o.chat, fileIds: [size.file_id], caption: o.caption, mirror: o.mirror, foodPhoto: o.foodPhoto, kv, statusId: status?.result?.message_id, now })
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
 * The island's coach and food push now (the app window decides while you're at the PC):
 * a coach nudge first (core/coachTalk.ts), then a meal reminder, else the evening protein
 * nudge or the dinner reminder; all of them inside the one daily cap.
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
  // The coach's nudges first (check-in > protein > morning), then food, all inside one daily cap of 3.
  const coach = coachNudgeFor(db, svc, { now, here, meeting: o.meeting, quiet: o.quiet, wake })
  if (coach) return coach
  if (!foodCapAllows(db, svc, now)) return null
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
 * More photos for a photo preview: fd|a|<draft> Add another photo (60 s) · fd|r|<draft> Done,
 * read them (one vision call with every photo) · fd|q|<draft> Stop adding.
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
    const m = /^fd\|([sx+\-eupymlzkgnvwWbarqihdNGRo])\|([\w:.-]{1,56})(?:\|(\d{1,2}))?(?:\|(\d{1,2}))?$/.exec(data)
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
    // A saved photo meal becomes a saved meal with its picture (/meals and the app log it again for free).
    if (op === 'R') {
      const kept = await mirror.write((db) => {
        const before = readFoodSaved(db).meals.length
        const s = saveLoggedAsMeal(db, ref)
        return s && s.meals.length > before ? s.meals[s.meals.length - 1].name : null
      })
      await answer(kept ? 'Kept as a repeat meal' : 'Already kept, or the meal is gone')
      if (kept) {
        await clearButtons()
        await send(`⭐ <b>${esc(kept)}</b> is a repeat meal now. Next time tap it in /meals (or double-click it in the app): the same numbers, no AI call, no cost.`)
      }
      return kept ? 'kept' : null
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
    // More photos for the open photo preview (the server only: file ids in sys_kv, foodAlbum.ts).
    if (op === 'a' || op === 'r' || op === 'q') {
      const kv = c.photoKv
      const live = await mirror.write((db) => liveDraft(readFoodBen(db), now.getTime()))
      if (!kv || !c.foodPhoto || !live?.photo || live.id !== ref) {
        await answer('That preview is closed. Send all the photos again.')
        return null
      }
      if (op === 'q') {
        await dropChatPhotos(kv, chat).catch(() => null)
        await answer('Stopped')
        await edit('Stopped adding photos. The preview above stays as it was.')
        return 'stop'
      }
      if (op === 'a') {
        const st = await startAdd(kv, chat, ref, now.getTime())
        if (!st) {
          await answer('Those photos are too old to add to. Send all the photos again.')
          return null
        }
        if (st.f.length >= MAX_SET) {
          await answer(`${MAX_SET} photos is the most for one meal`)
          return null
        }
        await answer('Send the next photo')
        const sent = await send(addText(0, st.f.length), addKeyboard(ref))
        const msgId = sent?.result?.message_id
        if (msgId) await setAddMsg(kv, chat, msgId).catch(() => null)
        return 'add'
      }
      // Done: every photo of the meal (the earlier ones and the new ones) in ONE vision call.
      const peek = await addedCount(kv, chat, ref)
      if (!peek.st) {
        await answer('Nothing to read. Tap “Add another photo” first.')
        return null
      }
      if (!peek.n) {
        await answer('No new photo yet. Send one, then tap Done.')
        return null
      }
      const got = await takeAdd(kv, chat, ref)
      if (!got || !got.parts.length) {
        await answer('Already read')
        return null
      }
      await answer('Reading the photos…')
      const fileIds = [...got.st.f, ...got.parts.map((p) => p.f)].slice(0, MAX_SET)
      const caption = [got.st.c, ...got.parts.map((p) => p.c)].map((x) => x.trim()).filter(Boolean).join(' · ').slice(0, 300)
      await edit(`📸 Reading ${fileIds.length} photos…`)
      return readMealPhotos({ token: update.__token, chat, fileIds, caption, mirror: c.mirror as unknown as Mirrorish, foodPhoto: c.foodPhoto, kv, counted: Math.min(got.st.f.length, fileIds.length), statusId: cq.message?.message_id, now })
    }
    // The preview's buttons: only on the open draft.
    const res = await mirror.write((db) => {
      const fb = readFoodBen(db)
      const d = liveDraft(fb, now.getTime())
      if (!d || d.id !== ref) return { kind: 'gone' as const }
      if (op === 'x' || op === 'N') {
        writeFoodBen(db, { ...fb, draft: null })
        return { kind: 'cancel' as const }
      }
      if (op === 'e') return { kind: 'hint' as const, d }
      const i = Number(idx ?? -1)
      // One food's quick fixes: the menu, ½× / 1.5× / 2×, Remove, Change grams.
      if (d.photo && op === 'i') return d.photo.now[i] ? { kind: 'item' as const, d, i } : { kind: 'draft' as const, d }
      if (d.photo && op === 'h') {
        const f = FACTORS[Number(idx2 ?? -1)]
        if (!f) return { kind: 'draft' as const, d }
        const next = multiplyPhoto(d, i, f, savedRefs(readFoodSaved(db)))
        writeFoodBen(db, { ...fb, draft: next })
        return { kind: 'draft' as const, d: next }
      }
      if (d.photo && op === 'd') {
        const next = removePhotoItem(d, i)
        if (!next) {
          writeFoodBen(db, { ...fb, draft: null })
          return { kind: 'cancel' as const }
        }
        writeFoodBen(db, { ...fb, draft: next })
        return { kind: 'draft' as const, d: next }
      }
      if (d.photo && op === 'o') {
        const next = addHidden(d)
        writeFoodBen(db, { ...fb, draft: next })
        return { kind: 'draft' as const, d: next }
      }
      if (d.photo && op === 'G') {
        const next = askGrams(d, i)
        writeFoodBen(db, { ...fb, draft: next })
        return { kind: 'ask' as const, d: next, i }
      }
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
        const type = slotNow(new Date(d.at))
        // Its photos in Photo Locker (the meal row shows the thumbnail); they arrive there through the app.
        const photos = d.photo.n ? lockerPhotoIds(d.id, d.photo.n) : []
        const saved = addFoodMeal(db as any, { items: toFoodItems(items), id: `fd-p${d.id}`, type, source: 'photo', photos }, 'telegram', now)
        // His gram fixes teach his usual portions for next time.
        writeFoodBen(db, { ...fb, draft: null, portions: learnPortions(fb.portions, d.photo.base, items, now.getTime()) })
        if (!saved) return { kind: 'gone' as const }
        const day = foodDayTotals(db, now)
        const idea = coverIdea(db, now, day.targets.kcal - day.kcal) ?? whatNextNow(db, now).ideas[0]?.text
        const line = photoReplyLine({ items, meal: visionTotals(items), day: { kcal: day.kcal, protein: day.protein, kcalGoal: day.targets.kcal, proteinGoal: day.targets.protein }, idea })
        const name = mealName(toFoodItems(items))
        return { kind: 'saved' as const, id: saved.id, text: photoSavedText(items, type, d.at, line), held: photos.length ? { draft: d.id, meal: saved.id, name, type } : null }
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
    // Saved or cancelled: the photos' file ids are not needed any more (a saved meal's stay held for Photo Locker).
    if ((res.kind === 'cancel' || res.kind === 'saved') && c.photoKv) await dropChatPhotos(c.photoKv, chat).catch(() => null)
    if (res.kind === 'cancel' && c.photoKv) await dropHeld(c.photoKv, ref).catch(() => null)
    if (res.kind === 'saved' && 'held' in res && res.held && c.photoKv) await attachMeal(c.photoKv, res.held.draft, { id: res.held.meal, name: res.held.name, type: res.held.type }).catch(() => null)
    if (res.kind === 'item') {
      await answer(`Fix ${res.d.photo!.now[res.i].name}`)
      await tg(update.__token, 'editMessageReplyMarkup', { chat_id: chat, message_id: cq.message.message_id, reply_markup: itemKeyboard(res.d, res.i) }).catch(() => null)
      return 'item'
    }
    if (res.kind === 'ask') {
      const it = res.d.photo!.now[res.i]
      await answer('Type the grams')
      const p = previewOf(res.d)
      await edit(p.reply, p.keyboard)
      await send(`✏️ How many grams of ${esc(it.name.toLowerCase())}? Type the number, e.g. <code>${Math.round(it.grams || 150)}</code>.`)
      return 'ask'
    }
    if (res.kind === 'cancel') {
      await answer('Cancelled')
      await edit(op === 'N' ? '✗ Not a meal. Nothing saved, and the photo is not kept.' : '✗ Cancelled. Nothing saved.')
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
    // A photo meal can be kept as a repeat meal: next time one tap logs the same numbers, with no AI call.
    const keep = res.id.startsWith('fd-p') ? [{ text: '⭐ Keep as repeat meal', callback_data: `fd|R|${res.id}`.slice(0, 64) }] : []
    await edit(res.text, { inline_keyboard: [[{ text: '↩ Undo', callback_data: `fd|u|${res.id}`.slice(0, 64) }, ...keep]] })
    return res.text
  }
}
