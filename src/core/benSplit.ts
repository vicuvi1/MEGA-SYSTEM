// LS4 + LS5: many things in one message, and one short question instead of a
// guess. Pure and tested (benSplit.test.ts).
//
// "add laundry, move gym to 18, and remind me to call mom at 20" is split in
// code into three clauses, each read as one thing to do. When every clause is
// clear they all run, in order, with one combined receipt and one Undo all.
// When one isn't (a clause code can't read), the whole message goes to the
// model as before. When a time is unclear ("at 7": morning or evening?) Ben
// asks with 2–3 chips and changes nothing.
// Works on the canonical text (benNormalize.canon), so Romanian and Russian
// command words read the same.

import { readMoveEdit, type BlockEdit } from './benTalk'
import { clock } from './benFacts'
import { parseWater } from './sportShared'
import { calendarDay } from './dates'

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => calendarDay(d)
const plusDays = (d: Date, n: number) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

const VERB = /^(?:please\s+)?(add|move|push|shift|put|remind|log|book|schedule|delete|remove|cancel|start|stop|done|finish|mark|rename|drink|drank|water|break down|plan)\b/i

/**
 * The clauses of a message with several asks, or [] when it is one ask.
 * Parts that don't start with a verb stay with the one before ("add milk and
 * eggs" is one ask).
 */
export function splitIntents(text: string): string[] {
  const t = String(text ?? '').trim().replace(/[.!]+$/, '')
  if (t.length > 300) return []
  const raw = t.split(/\s*(?:;|,\s*(?:and\s+then|and|then|also|plus)?|\s+and\s+then\s+|\s+then\s+|\s+and\s+(?:also\s+)?|\s+also\s+|\s+plus\s+)\s*/i).map((s) => s.trim()).filter(Boolean)
  const out: string[] = []
  for (const p of raw) {
    if (!out.length || VERB.test(p)) out.push(p)
    else out[out.length - 1] = `${out[out.length - 1]} and ${p}`
  }
  return out.length >= 2 && out.every((p) => VERB.test(p)) ? out : []
}

export interface When {
  day: string
  time: string
}

/** A time choice to ask about ("at 7": 07:00 or 19:00). */
export interface TimeAsk {
  options: When[]
}

const DAY_WORD = /\b(today|tomorrow|tonight|in 2 days)\b/i

/** The day a clause names (today by default; "tonight" is today). */
export function dayOf(text: string, now: Date): string {
  const m = DAY_WORD.exec(text)
  const w = m?.[1].toLowerCase()
  return ymd(w === 'tomorrow' ? plusDays(now, 1) : w === 'in 2 days' ? plusDays(now, 2) : now)
}

/**
 * The time in "at 20", "at 8:30", "at 6pm", "in 30 min", or null. An hour
 * from 1 to 11 with no am/pm is unclear when both 07:00 and 19:00 are still
 * ahead today: then the caller asks.
 */
export function timeIn(text: string, now: Date): When | TimeAsk | null {
  const t = String(text ?? '').toLowerCase()
  const inMin = /\bin (\d{1,3}) ?(min|mins|minutes|h|hours?)\b/.exec(t)
  if (inMin) {
    const d = new Date(now.getTime() + Number(inMin[1]) * (/^h/.test(inMin[2]) ? 60 : 1) * 60000)
    return { day: ymd(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
  }
  const m = /\bat (\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)(?![\d:])/.exec(t)
  if (!m) return null
  const day = dayOf(t, now)
  const exact = clock(m[1])
  if (!exact || exact === '24:00') return null
  const h = Number(exact.slice(0, 2))
  const mins = exact.slice(3)
  if (/am|pm/.test(m[1]) || h === 0 || h >= 12) return { day, time: exact }
  const today = day === ymd(now)
  // Another day: 1–6 is the afternoon, 7–11 the morning (an evening time would say so).
  if (!today && !/\btonight\b/.test(t)) return { day, time: h <= 6 ? `${pad(h + 12)}:${mins}` : exact }
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const amAhead = !today || h * 60 + Number(mins) > nowMin
  const pmAhead = !today || (h + 12) * 60 + Number(mins) > nowMin
  // "tonight at 8" is the evening; "at 7" when 07:00 has passed is the evening.
  if (/\btonight\b/.test(t) || (pmAhead && !amAhead)) return { day, time: `${pad(h + 12)}:${mins}` }
  if (amAhead && pmAhead) {
    // 1–6 usually mean the afternoon, 11 the late morning; 7–10 could be either: ask.
    if (h <= 6) return { day, time: `${pad(h + 12)}:${mins}` }
    if (h === 11) return { day, time: exact }
    return { options: [{ day, time: exact }, { day, time: `${pad(h + 12)}:${mins}` }] }
  }
  return { day, time: exact }
}

export const isAsk = (x: When | TimeAsk | null): x is TimeAsk => !!x && 'options' in x

export type Clause =
  | { kind: 'add'; title: string; when: When | TimeAsk | null; dayWord: string | null }
  | { kind: 'remind'; text: string; when: When | TimeAsk }
  | { kind: 'move'; edit: BlockEdit }
  | { kind: 'water'; ml: number }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const stripWhen = (s: string) =>
  s
    .replace(/\b(today|tomorrow|tonight|in 2 days)\b/gi, ' ')
    .replace(/\bat \d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?(?![\d:])/gi, ' ')
    .replace(/\bin \d{1,3} ?(?:min|mins|minutes|h|hours?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const NOT_A_TITLE = /^(it|that|this|them|something|stuff|a task|task|everything|all|plan|my plan|the plan|a reminder|reminder)$/i

/** One clause read as one thing to do, or null when code can't read it. */
export function readClause(clause: string, now: Date): Clause | null {
  const c = String(clause ?? '').trim().replace(/^(please|pls)\s+/i, '').replace(/[.!]+$/, '')
  let m: RegExpExecArray | null
  // "remind me to call mom at 20", "remind me at 20 to call mom", "remind me in 30 min to stretch".
  if ((m = /^remind me (?:to\s+)?(.+)$/i.exec(c))) {
    const rest = m[1]
    const when = timeIn(rest, now)
    const what = stripWhen(rest.replace(/^(?:at|in) [^ ]+(?: (?:min|mins|minutes|h|hours?|am|pm))? (?:to )?/i, '')).replace(/^to\s+/i, '')
    if (!when || !what || what.length < 2) return null
    return { kind: 'remind', text: cap(what), when }
  }
  const move = readMoveEdit(c)
  if (move) return { kind: 'move', edit: move }
  if ((m = /^(?:add|put|schedule|book)\s+(.{2,80})$/i.exec(c))) {
    const rest = m[1].replace(/\s+(?:to|on|in) (?:my )?(?:list|todoist|tasks|calendar)\b/i, '')
    const when = timeIn(rest, now)
    const title = stripWhen(rest)
    if (!title || NOT_A_TITLE.test(title) || /\d+\s*(ml|l)\b/i.test(title)) return null
    const dw = DAY_WORD.exec(rest)?.[1].toLowerCase() ?? null
    return { kind: 'add', title: cap(title), when, dayWord: dw }
  }
  const ml = parseWater(c.replace(/^(log|drank|drink)\s+/i, (x) => (/drank|drink/i.test(x) ? 'drank ' : '')))
  if (ml) return { kind: 'water', ml }
  return null
}

/**
 * LS3: a short message with no verb that names a thing and a day or time is
 * an "add" ("curata camera today", "tomorrow gym at 18"). Questions, logs and
 * longer chat are not.
 */
export function bareAdd(text: string, now: Date): Clause | null {
  const t = String(text ?? '').trim().replace(/[.!]+$/, '')
  if (!t || /\?/.test(t) || VERB.test(t) || t.split(/\s+/).length > 7) return null
  if (!DAY_WORD.test(t) && !/\bat \d{1,2}/.test(t)) return null
  const title = stripWhen(t)
  if (!title || title.length < 3 || NOT_A_TITLE.test(title) || /\d/.test(title)) return null
  // Words that make it something else (a log, a question, a mood, the plan).
  if (/\b(what|how|why|when|where|who|plan|review|water|sleep|slept|woke|spent|bought|paid|feel|feeling|tired|i|i'm|im|me|my day|nothing|ok|okay|yes|no|done|later|shift|work|working|free)\b/i.test(title)) return null
  const when = timeIn(t, now)
  return { kind: 'add', title: cap(title), when, dayWord: DAY_WORD.exec(t)?.[1].toLowerCase() ?? null }
}

/** The chips for an unclear time ("07:00", "19:00"). */
export function timeChips(a: TimeAsk): string[] {
  return a.options.map((o) => o.time)
}

/** "Morning or evening?" in his language, naming what it's for. */
export function timeQuestion(what: string, lang: 'en' | 'ro' | 'ru' = 'en'): string {
  const w = what.slice(0, 40)
  return lang === 'ro' ? `${w}: dimineața sau seara?` : lang === 'ru' ? `${w}: утром или вечером?` : `${w}: morning or evening?`
}

/** "Which one?" with the names, in his language. */
export function whichQuestion(n: number, what: string, lang: 'en' | 'ro' | 'ru' = 'en'): string {
  return lang === 'ro' ? `Se potrivesc ${n}: ${what}. Care?` : lang === 'ru' ? `Подходят ${n}: ${what}. Какой?` : `${n} fit: ${what}. Which one?`
}
