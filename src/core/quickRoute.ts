// Quick add from anywhere (pure, tested in quickRoute.test.ts). One typed line
// becomes ONE of the app's existing actions, with a short preview chip:
//   "50 pushups" / "pushups 50" / "+50"     → reps on Sport Track's checklist
//   "500 ml" / "water 2" / "2 glasses"      → water (the one body log)
//   "task lab report tomorrow 2h p1"        → a Todoist task (core/quickAdd.ts)
//   "ate 200g chicken"                      → a meal (core/foodWords.ts)
//   "focus 25" / "focus 25 essay"           → a focus timer
//   "note call the bank about the card"     → a note in Notebook
//   "done read"                             → ticks one of your own habits
//   "45 lunch"                              → money, through the bot's existing rules
// Anything else becomes a task, but only after you confirm it (`confirm`).
//
// Quick add logs only what happens now: words like "yesterday" or "2 hours ago"
// on a log are refused, so it can never back-date anything (honest points).
// Nothing here reads the clock: the caller passes today and the time now.
import { parseFoodWords } from './foodWords'
import type { FoodItem, MealType } from './food'
import { itemOf, itemsOf, itemsText, matchSaved, slotItems, type FoodSaved } from './foodSaved'
import type { Per100 } from './foodTable'
import { parseQuick, type QuickTask } from './quickAdd'

export interface RouteCtx {
  /** Today, YYYY-MM-DD. */
  today: string
  /** The time now, HH:MM. */
  now: string
  /** Sport Track's checklist (id and name). */
  exercises: { id: string; name: string }[]
  /** The exercise "+50" adds to (an id from `exercises`); null = push-ups, else the first one. */
  counter?: string | null
  /** Your own habits (ones you tick yourself; automatic habits never appear here). */
  habits: { id: string; name: string; done?: boolean }[]
  /** Your own logged foods (they win over the built-in table). */
  foods?: Per100[]
  /** One glass, in ml (250 by default). */
  glassMl?: number
  /** Your saved foods, meals and standard day: their names win ("standard day", "breakfast", "2 eggs"). */
  saved?: FoodSaved
}

interface Base {
  /** The preview chip: what will happen, in plain words. */
  chip: string
  /** True when Enter should ask once more first (a guess, like unknown text → task). */
  confirm?: boolean
}
export type Route = Base &
  (
    | { kind: 'reps'; exId: string; name: string; n: number }
    | { kind: 'water'; ml: number }
    | {
        kind: 'food'
        items: FoodItem[]
        name: string
        protein: number
        kcal: number
        /** From your saved foods (logged with source 'saved'). */
        saved?: boolean
        /** The standard day: each slot is its own meal. */
        meals?: { name: string; type: MealType; slot: string; items: FoodItem[] }[]
      }
    | { kind: 'task'; task: QuickTask }
    | { kind: 'focus'; minutes: number; subject: string }
    | { kind: 'note'; text: string }
    | { kind: 'habit'; id: string; name: string }
    | { kind: 'money'; text: string }
    /** Can't be done as typed: one plain line that says why or what to add. */
    | { kind: 'ask'; say: string }
  )

export type RouteKind = Route['kind']

/** Routes that only log something (reps, water, food, habit): these get the < 100 ms promise. */
export const LOG_KINDS: RouteKind[] = ['reps', 'water', 'food', 'habit']

const MAX_REPS = 500
const MAX_ML = 3000
const PAST = /\b(yesterday|last night|ago|earlier today|this morning|day before|last (?:week|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i
const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const num = (s: string) => Number(s.replace(',', '.'))

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 9
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? d[i - 2][j - 2] + 1 : 99
      )
  return d[a.length][b.length]
}

/** Common spellings of the usual exercises, so "push ups", "pushup" and "press-ups" all mean push-ups. */
const ALIASES: Record<string, string[]> = {
  pushups: ['pushup', 'pushups', 'pressup', 'pressups', 'push'],
  situps: ['situp', 'situps', 'crunch', 'crunches'],
  squats: ['squat', 'squats'],
  pullups: ['pullup', 'pullups', 'chinup', 'chinups'],
  dips: ['dip', 'dips'],
  lunges: ['lunge', 'lunges'],
  burpees: ['burpee', 'burpees']
}

/** The exercise a word means ("pushups", "push ups", "puhsups", "squat"), or null. */
export function findExerciseWord(word: string, exercises: RouteCtx['exercises']): { id: string; name: string } | null {
  const w = letters(word)
  if (w.length < 3 || !exercises.length) return null
  const keys = (e: { id: string; name: string }) => {
    const n = letters(e.name)
    const id = letters(String(e.id).replace(/^ex_/, ''))
    const alias = Object.entries(ALIASES).find(([k, list]) => k === n || k === id || list.includes(n) || list.includes(id))
    return [...new Set([n, id, ...(alias ? [alias[0], ...alias[1]] : [])])].filter((k) => k.length >= 3)
  }
  const sing = (s: string) => s.replace(/e?s$/, '')
  // Exact, then singular/plural, then a close typo (2 letters off for long words, 1 for short).
  for (const test of [
    (k: string) => k === w,
    (k: string) => sing(k) === sing(w),
    (k: string) => lev(k, w) <= (Math.min(k.length, w.length) >= 6 ? 2 : 1)
  ])
    for (const e of exercises) if (keys(e).some(test)) return { id: String(e.id), name: String(e.name) }
  return null
}

function counterOf(ctx: RouteCtx): { id: string; name: string } | null {
  const ex = ctx.exercises
  if (!ex.length) return null
  return ex.find((e) => String(e.id) === ctx.counter) ?? findExerciseWord('pushups', ex) ?? ex[0]
}

const reps = (e: { id: string; name: string }, n: number): Route =>
  n < 1 || n > MAX_REPS
    ? { kind: 'ask', chip: `Reps go from 1 to ${MAX_REPS}`, say: `Reps go from 1 to ${MAX_REPS}. Try "50 ${e.name.toLowerCase()}".` }
    : { kind: 'reps', exId: e.id, name: e.name, n, chip: `Log ${n} ${e.name}` }

const water = (ml: number): Route => {
  const v = Math.round(ml)
  if (v < 10 || v > MAX_ML) return { kind: 'ask', chip: `Water goes from 10 to ${MAX_ML} ml`, say: `Water goes from 10 to ${MAX_ML} ml at a time.` }
  return { kind: 'water', ml: v, chip: `Add ${v} ml water` }
}

/** "500", "500ml", "0.5 l", "2 glasses", "2" (glasses when 10 or less). */
function waterAmount(rest: string, glass: number): number | null {
  const s = rest.trim().toLowerCase()
  if (!s) return glass
  const m = /^(\d+(?:[.,]\d+)?)\s*(ml|l|liters?|litres?|glass(?:es)?|cups?|bottles?)?$/.exec(s)
  if (!m) return null
  const n = num(m[1])
  const u = m[2] ?? ''
  if (u === 'ml') return n
  if (/^(l|lit)/.test(u)) return n * 1000
  if (/^(glass|cup)/.test(u)) return n * glass
  if (/^bottle/.test(u)) return n * 500
  return n <= 10 ? n * glass : n
}

const task = (text: string, ctx: RouteCtx, confirm: boolean): Route => {
  const r = parseQuick(text, { today: ctx.today, now: ctx.now })
  if (!r.ok) return { kind: 'ask', chip: r.ask, say: r.ask }
  return { kind: 'task', task: r.task, chip: confirm ? `Add as a task? ${r.task.chip}` : `New task: ${r.task.chip}`, ...(confirm ? { confirm: true } : {}) }
}

const focus = (minutes: number, subject: string): Route => {
  const m = Math.max(5, Math.min(180, Math.round(minutes) || 25))
  const s = subject.trim().slice(0, 80) || 'Focus'
  return { kind: 'focus', minutes: m, subject: s, chip: `Start focus: ${m} min${s === 'Focus' ? '' : ` · ${s}`}` }
}

function food(text: string, ctx: RouteCtx, strict: boolean): Route | null {
  const r = parseFoodWords(text, ctx.foods ?? [])
  if (!r.items.length) return strict ? { kind: 'ask', chip: r.say || 'Write what you ate, like "200g chicken"', say: r.say || 'Write what you ate, like "200g chicken".' } : null
  if (!strict && (r.unknown.length || r.needGrams.length)) return null
  if (r.unknown.length || r.needGrams.length) return { kind: 'ask', chip: r.say, say: r.say }
  const protein = Math.round(r.items.reduce((a, i) => a + i.protein, 0))
  const kcal = Math.round(r.items.reduce((a, i) => a + i.kcal, 0))
  const name = r.items.map((i) => `${i.name} ${i.grams} g`).join(', ')
  return { kind: 'food', items: r.items, name: r.items.map((i) => i.name).join(', ').slice(0, 60), protein, kcal, chip: `Log food: ${name} · ${protein} g protein` }
}

/** A saved meal, saved food or the standard day named in the line, as a food route. */
function savedFood(text: string, ctx: RouteCtx): Route | null {
  const s = ctx.saved
  const hit = s ? matchSaved(text, s) : null
  if (!s || !hit) return null
  const sum = (items: FoodItem[]) => ({ protein: Math.round(items.reduce((a, i) => a + i.protein, 0)), kcal: Math.round(items.reduce((a, i) => a + i.kcal, 0)) })
  if (hit.kind === 'day') {
    const meals = s.day.slots.map((sl) => ({ name: `${sl.label}: ${itemsText(s, slotItems(sl))}`.slice(0, 60), type: sl.slot, slot: sl.id, items: itemsOf(s, slotItems(sl)) }))
    const items = meals.flatMap((m) => m.items)
    const t = sum(items)
    return { kind: 'food', items, name: 'Standard day', ...t, saved: true, meals, chip: `Log my standard day: ${t.kcal.toLocaleString('en-US')} kcal · ${t.protein} g protein` }
  }
  if (hit.kind === 'meal') {
    const items = itemsOf(s, hit.meal.items)
    const t = sum(items)
    return { kind: 'food', items, name: hit.meal.name, ...t, saved: true, chip: `Log ${hit.meal.name} · ${t.kcal} kcal · ${t.protein} g protein` }
  }
  const item = itemOf(hit.food, hit.qty)
  const name = hit.qty === 1 ? hit.food.name : `${hit.qty} × ${hit.food.name}`
  return { kind: 'food', items: [item], name, protein: Math.round(item.protein), kcal: item.kcal, saved: true, chip: `Log ${name} · ${item.kcal} kcal · ${Math.round(item.protein)} g protein` }
}

function habit(word: string, ctx: RouteCtx): Route {
  const w = letters(word)
  const list = ctx.habits
  const hit =
    list.find((h) => letters(h.name) === w) ??
    list.find((h) => w.length >= 3 && (letters(h.name).includes(w) || w.includes(letters(h.name)))) ??
    list.find((h) => w.length >= 4 && lev(letters(h.name), w) <= 2)
  if (!hit) {
    const names = list.slice(0, 5).map((h) => h.name).join(', ')
    return { kind: 'ask', chip: `No habit called "${word}"`, say: names ? `No habit called "${word}". Yours: ${names}.` : 'You have no habits of your own yet. Add one on Today.' }
  }
  if (hit.done) return { kind: 'ask', chip: `${hit.name} is already done today`, say: `${hit.name} is already done today.` }
  return { kind: 'habit', id: hit.id, name: hit.name, chip: `Tick habit: ${hit.name}` }
}

const isLog = (r: Route | null) => !!r && LOG_KINDS.includes(r.kind)
const past = (): Route => ({
  kind: 'ask',
  chip: 'Quick add logs only what you do now',
  say: 'Quick add logs only what you do now. Fix a past day where it was logged (Sport Track, Food, Habits).'
})

/**
 * Every reading of one line, best first; Tab cycles them. Empty for an empty line.
 * The first one is what Enter does.
 */
export function routeOptions(raw: string, ctx: RouteCtx): Route[] {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return []
  const glass = ctx.glassMl && ctx.glassMl > 0 ? ctx.glassMl : 250
  const out: Route[] = []
  const add = (r: Route | null) => {
    if (r && !out.some((o) => o.chip === r.chip)) out.push(r)
  }
  const lower = t.toLowerCase()
  let m: RegExpExecArray | null

  // ---- a word up front says what it is ----
  if ((m = /^(?:task|todo|to do|t)\s*[:\-]?\s+(.+)$/i.exec(t))) return [task(m[1], ctx, false)]
  if ((m = /^(?:note|n)\s*[:\-]?\s+(.+)$/i.exec(t))) return [{ kind: 'note', text: m[1].slice(0, 2000), chip: `Save note: ${m[1].slice(0, 60)}` }]
  if ((m = /^(?:focus|f)(?:\s+(.*))?$/i.exec(t))) {
    const rest = (m[1] ?? '').trim()
    const n = /(?:^|\s)(\d{1,3})\s*(?:min(?:utes?)?|m)?(?=\s|$)/i.exec(rest)
    return [focus(n ? Number(n[1]) : 25, n ? rest.replace(n[0], ' ').replace(/\s+/g, ' ') : rest)]
  }
  if ((m = /^(?:done|did|tick|check)\s+(.+)$/i.exec(t))) return [PAST.test(t) ? past() : habit(m[1].replace(PAST, '').trim(), ctx)]
  if ((m = /^(?:water|drank|drink|h2o)\b\s*(.*)$/i.exec(t))) {
    if (PAST.test(t)) return [past()]
    const ml = waterAmount(m[1], glass)
    return [ml == null ? { kind: 'ask', chip: 'How much water?', say: 'How much water? Try "water 500" or "water 2" (glasses).' } : water(ml)]
  }
  // ---- your saved meals and foods first: "standard day", "breakfast", "2 eggs" ----
  const saved = PAST.test(t) ? null : savedFood(t, ctx)
  if (saved) return [saved]
  if ((m = /^(?:ate|eat|had|food|meal)\s*[:\-]?\s+(.+)$/i.exec(t))) return [PAST.test(t) ? past() : (food(m[1], ctx, true) as Route)]

  const pastWords = PAST.test(t)
  // The line without its "2 hours ago" / "yesterday", to see what it would have logged.
  const core = pastWords ? t.replace(/\b\d+\s*(?:m|min(?:utes?)?|h|hours?|days?)\s+ago\b/i, ' ').replace(PAST, ' ').replace(/\s+/g, ' ').trim() : t
  // ---- "+50": the default counter ----
  if ((m = /^\+\s*(\d{1,4})$/.exec(t))) {
    const c = counterOf(ctx)
    return [c ? reps(c, Number(m[1])) : { kind: 'ask', chip: 'No exercises in Sport Track yet', say: 'Add an exercise in Sport Track first.' }]
  }
  // ---- "500 ml", "0.5l", "2 glasses" ----
  if ((m = /^(\d+(?:[.,]\d+)?)\s*(ml|l|liters?|litres?|glass(?:es)?|cups?|bottles?)(?:\s+(?:of\s+)?water)?$/i.exec(t))) {
    add(pastWords ? past() : water(waterAmount(`${m[1]} ${m[2]}`, glass) ?? 0))
  }
  // ---- reps: "50 pushups", "pushups 50", "50x pushups", "3x15 squats", "pushups50" ----
  const sets = /^(\d{1,2})\s*x\s*(\d{1,3})\s+(.+)$/i.exec(core)
  const front = /^(\d{1,4})\s*x?\s+([a-z][a-z \-]*)$/i.exec(core)
  const back = /^([a-z][a-z \-]*?)\s*[:x]?\s*(\d{1,4})$/i.exec(core)
  const rep = sets ? { n: Number(sets[1]) * Number(sets[2]), w: sets[3] } : front ? { n: Number(front[1]), w: front[2] } : back ? { n: Number(back[2]), w: back[1] } : null
  const ex = rep ? findExerciseWord(rep.w.replace(PAST, ''), ctx.exercises) : null
  if (rep && ex) add(pastWords ? past() : reps(ex, rep.n))
  // ---- food in plain words: "200g chicken", "2 eggs" (only when every word is a known food) ----
  if (!out.length && /\d/.test(t) && !ex) add(pastWords ? null : food(t, ctx, false))
  if (pastWords && !out.length && (rep || /\b(ml|glass|water|ate|pushups?)\b/i.test(t))) add(past())
  // ---- a bare number: the default counter, or a focus timer ----
  if ((m = /^(\d{1,3})$/.exec(t))) {
    const c = counterOf(ctx)
    if (c) add(reps(c, Number(m[1])))
    add(focus(Number(m[1]), ''))
    add(water(Number(m[1]) <= 10 ? Number(m[1]) * glass : Number(m[1])))
  }
  // ---- money, through the bot's own rules: "45 lunch", "spent 30 on taxi" ----
  const money = !pastWords && (/^(?:spent|paid|bought)\b/i.test(t) || (/^\d+(?:[.,]\d{1,2})?\s+[a-z]/i.test(t) && !ex && !isLog(out[0] ?? null)))
  if (money && !out.some((o) => o.kind === 'ask')) add({ kind: 'money', text: t, chip: `Log money: ${t.slice(0, 60)}` })
  // ---- anything else: a task, after one more Enter ----
  if (!/^\d+$/.test(t)) add(task(t, ctx, out.length === 0))
  if (!/^(?:note|n)\b/i.test(lower) && t.length > 3 && !/^\d+$/.test(t)) add({ kind: 'note', text: t, chip: `Save note: ${t.slice(0, 60)}` })
  return out
}

/** What Enter does with this line (the first reading), or null for an empty line. */
export function routeQuick(raw: string, ctx: RouteCtx): Route | null {
  return routeOptions(raw, ctx)[0] ?? null
}

/** One short line for the Undo toast once it is done: "50 push-ups logged". */
export function doneLine(r: Route): string {
  switch (r.kind) {
    case 'reps':
      return `${r.n} ${r.name} logged`
    case 'water':
      return `${r.ml} ml water added`
    case 'food':
      return `${cap(r.name)}: ${r.protein} g protein logged`
    case 'task':
      return `Task added: ${r.task.title}`
    case 'focus':
      return `Focus started: ${r.minutes} min`
    case 'note':
      return 'Note saved'
    case 'habit':
      return `${r.name} ticked`
    case 'money':
      return 'Money logged'
    default:
      return r.chip
  }
}

/**
 * Routes that can be sent again safely with the same id after a reload (the
 * write behind them ignores a second copy of the same id). The others are
 * shown as "not sure it saved" instead of being sent twice.
 */
export function canReplay(r: Route): boolean {
  return r.kind === 'reps' || r.kind === 'water' || r.kind === 'food' || r.kind === 'habit'
}
