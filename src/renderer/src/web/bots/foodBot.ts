// The food counter on Telegram and in Ben's pushes (the database side of
// core/foodBen.ts). Uses the food counter's own functions (src/main/food.ts),
// so a meal saved here is the same data as one saved in Body → Food. Nothing
// here pays points.
// - "/food" sends the copy prompt, "/food label" the label prompt (when there is one);
// - a pasted AI reply → a preview with −/+25 g per food, Save / Edit grams / Cancel;
//   "chicken 175" while it is open sets that food's grams;
// - the buttons under the evening nudge and the dinner reminder (the prompt,
//   Same as yesterday, Mute food nudges for 7 days);
// - the facts the nudges and the Sunday report are decided from.
import * as foodPrompts from '@core/foodPrompt'
import { FOOD_PROMPT } from '@core/foodPrompt'
import { parseFoodReply } from '@core/foodParse'
import { addDays } from '@core/dates'
import { sportToday } from '@core/sportShared'
import { yesterdayMeals, cleanFoodLog, sumItems, mealName, type FoodItem } from '@core/food'
import { liveIds } from '@core/bodyLog'
import { FOOD_BEN_KEY, MUTE_DAYS, cleanFoodBen, draftKeyboard, draftText, foodReport, gramEditShape, isMuted, liveDraft, looksLikeFoodReply, readGramEdit, setGrams, stepDraft, weekWeight, type FoodBen, type FoodDraft, type FoodReport } from '@core/foodBen'
import { addFoodMeal, foodDayTotals, foodTargetsNow, foodWeekNow, toggleFoodMeal, whatNextNow } from '../../../../main/food'
import { bodyEvents } from '../../../../main/bodyLog'
import { weighIns } from '../../../../main/bodyPlus'
import { readSetting, writeSetting } from '../../../../main/settings'
import { answerPushIn } from '../benPushStore'
import { esc, tg } from './telegram'
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

/** Whether a Telegram message is for the food counter (a cheap read only for a "chicken 175" shape). */
export function foodWants(db: any, text: string, now = Date.now()): boolean {
  const t = String(text ?? '').trim()
  if (/^\/food(@\w+)?(\s|$)/i.test(t) || looksLikeFoodReply(t)) return true
  if (!gramEditShape(t)) return false
  const d = liveDraft(readFoodBen(db), now)
  return !!d && !!readGramEdit(t, d)
}

/** One food message (inside mirror.write): /food, a pasted reply, or a gram edit. Null: not food. */
export function foodMessage(db: any, text: string, now = Date.now()): FoodOut | null {
  const t = String(text ?? '').trim()
  const cmd = /^\/food(?:@\w+)?(?:\s+(.*))?$/i.exec(t)
  if (cmd) {
    const arg = (cmd[1] ?? '').trim().toLowerCase()
    if (/^label/.test(arg)) {
      const p = labelPrompt()
      return { reply: p ? promptMessage(p, 'a photo of the label') : 'No label prompt yet. Send /food for the meal prompt.' }
    }
    return { reply: promptMessage(FOOD_PROMPT) }
  }
  const fb = readFoodBen(db)
  const open = liveDraft(fb, now)
  if (open && gramEditShape(t)) {
    const e = readGramEdit(t, open)
    if (e) {
      const d = setGrams(open, e.index, e.grams)
      writeFoodBen(db, { ...fb, draft: d })
      return { reply: draftText(d), keyboard: draftKeyboard(d) }
    }
  }
  if (!looksLikeFoodReply(t)) return null
  const r = parseFoodReply(t)
  if (!r.ok) return { reply: COULD_NOT(r.why) }
  const d: FoodDraft = { id: shortId(), at: now, items: r.items, question: r.question }
  writeFoodBen(db, { ...fb, draft: d })
  return { reply: draftText(d), keyboard: draftKeyboard(d) }
}

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
 * "Mute" mutes the food nudges for 7 days. Returns the line to show.
 */
export function foodPushAct(db: any, op: 'yesterday' | 'mute', now = new Date()): string {
  if (op === 'mute') {
    writeFoodBen(db, { ...readFoodBen(db), muteUntil: now.getTime() + MUTE_DAYS * 86400_000 })
    return `🔕 Food nudges muted for ${MUTE_DAYS} days.`
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
 * fd|s|<draft> Save · fd|x|<draft> Cancel · fd|+|<draft>|<i> / fd|-|<draft>|<i> ±25 g ·
 * fd|e|<draft> how to type grams · fd|u|<meal> Undo a save · fd|p|<push key> the prompt ·
 * fd|y|<push key> Same as yesterday (a preview) · fd|m|<push key> mute food nudges for 7 days.
 */
export const FOOD_CALLBACK: CallbackHandler = {
  prefixes: ['fd'],
  match: (data) => data.startsWith('fd|'),
  run: async (c, t) => {
    const { mirror, services, markSeen } = c
    const { data, chat, key, update, cq, answer, edit } = t
    if (!(await markSeen(key))) return null
    const m = /^fd\|([sx+\-eupym])\|([\w:.-]{1,48})(?:\|(\d{1,2}))?$/.exec(data)
    if (!m) return null
    const [, op, ref, idx] = m
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
      if (op === '+' || op === '-') {
        const next = stepDraft(d, Number(idx ?? -1), op === '+' ? 1 : -1)
        writeFoodBen(db, { ...fb, draft: next })
        return { kind: 'draft' as const, d: next }
      }
      const saved = addFoodMeal(db as any, { items: d.items }, 'telegram', now)
      writeFoodBen(db, { ...fb, draft: null })
      if (!saved) return { kind: 'gone' as const }
      return { kind: 'saved' as const, id: saved.id, text: savedText(db, d.items, now) }
    })
    if (res.kind === 'gone') {
      await answer('That preview is closed. Paste the reply again.')
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
    if (res.kind === 'draft') {
      await answer(`${op === '+' ? '+' : '−'}25 g`)
      await edit(draftText(res.d), draftKeyboard(res.d))
      return 'draft'
    }
    await answer('Saved')
    await edit(res.text, { inline_keyboard: [[{ text: '↩ Undo', callback_data: `fd|u|${res.id}`.slice(0, 64) }]] })
    return res.text
  }
}

