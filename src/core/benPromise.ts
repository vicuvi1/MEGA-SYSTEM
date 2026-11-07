// ME5: Ben tracks your promises. Pure and tested (benPromise.test.ts).
//
// "I'll start the essay tomorrow", "o să fac laboratorul diseară", "завтра
// сделаю лабу" → a promise with a time to ask. It is kept with the other
// check-ins (`coach_reminders`, marked `promise`), so the scorecard counts
// it like before. At that time Ben asks: "You said you'd start the essay
// today." with Done / Tomorrow / Drop. A promise due today goes into the
// day plan as one of his own asks.

import type { Reminder } from './coachKit'
import { calendarDay } from './dates'
import { normalize } from './benNormalize'

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => calendarDay(d)
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAYS_RO = ['duminica', 'luni', 'marti', 'miercuri', 'joi', 'vineri', 'sambata']
const DAYS_RU = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу']

export interface PromiseFound {
  what: string
  /** When Ben asks (ISO). */
  at: string
  /** "tomorrow", "tonight", "on Friday", "later", "at 18:00". */
  when: string
}

const at = (base: Date, h: number, m = 0) => {
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d
}

/** The time to ask about a promise made `now` for `word`. */
function askAt(word: string, now: Date): { d: Date; when: string } | null {
  const w = normalize(word)
  const tm = /^at (\d{1,2})(?::(\d{2}))?$/.exec(w)
  if (tm) {
    let h = Number(tm[1])
    const m = Number(tm[2] ?? 0)
    if (h < 12 && h <= 6) h += 12
    if (h > 23 || m > 59) return null
    let d = at(now, h, m)
    if (d.getTime() <= now.getTime()) d = new Date(d.getTime() + 86400000)
    return { d, when: `at ${pad(h)}:${pad(m)}` }
  }
  if (/^(tomorrow|maine)$/.test(w) || w === 'завтра') {
    const d = at(now, 10)
    d.setDate(d.getDate() + 1)
    return { d, when: 'tomorrow' }
  }
  if (/^(tonight|diseara|this evening|вечером)$/.test(w)) {
    const d = at(now, 20)
    return d.getTime() > now.getTime() + 15 * 60000 ? { d, when: 'tonight' } : { d: new Date(now.getTime() + 60 * 60000), when: 'tonight' }
  }
  if (/^(later|mai tarziu|позже|later today)$/.test(w)) return { d: new Date(now.getTime() + 3 * 3600_000), when: 'later' }
  if (/^(today|azi|сегодня)$/.test(w)) {
    const d = at(now, 18)
    return d.getTime() > now.getTime() + 30 * 60000 ? { d, when: 'today' } : { d: new Date(now.getTime() + 90 * 60000), when: 'today' }
  }
  const day = w.replace(/^(on|this|next|in|в|во)\s+/, '')
  let k = DAYS.indexOf(day)
  if (k < 0) k = DAYS_RO.indexOf(day)
  if (k < 0) k = DAYS_RU.indexOf(day)
  if (k >= 0) {
    const d = at(now, 10)
    let add = (k - now.getDay() + 7) % 7
    if (add === 0) add = 7
    d.setDate(d.getDate() + add)
    return { d, when: `on ${DAYS[k][0].toUpperCase()}${DAYS[k].slice(1)}` }
  }
  return null
}

const WHEN = "(tomorrow|tonight|later today|later|today|this evening|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|at \\d{1,2}(?::\\d{2})?)"
const WHEN_RO = '(maine|diseara|azi|mai tarziu|luni|marti|miercuri|joi|vineri|sambata|duminica)'
const WHEN_RU = '(завтра|вечером|сегодня|позже|в (?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье))'

/**
 * A promise in his message, or null. Needs a "will" and a time word; "I'll
 * try" or a question is not one. The text is kept short and in his words.
 */
export function readPromise(text: string, now = new Date()): PromiseFound | null {
  const raw = String(text ?? '').trim()
  if (!raw || raw.length > 200 || /\?\s*$/.test(raw)) return null
  const t = normalize(raw).replace(/[.!]+$/, '')
  if (/\b(try|maybe|might|perhaps|poate|может)\b/.test(t)) return null
  let m: RegExpExecArray | null
  const en = new RegExp(`(?:^|\\b)(?:i'?ll|i will|i'?m going to|i am going to|going to|i promise (?:to|i'?ll))\\s+(.{3,80}?)\\s+${WHEN}$`, 'i')
  const enFront = new RegExp(`^${WHEN},?\\s+(?:i'?ll|i will|i'?m going to)\\s+(.{3,80})$`, 'i')
  const ro = new RegExp(`(?:^|\\s)(?:o sa|am sa|voi|ma apuc sa|ma apuc de)\\s+(.{3,80}?)\\s+${WHEN_RO}$`, 'i')
  const roFront = new RegExp(`^${WHEN_RO},?\\s+(?:o sa|am sa|voi|ma apuc sa|ma apuc de)\\s+(.{3,80})$`, 'i')
  const ru = new RegExp(`^${WHEN_RU},?\\s+(?:я\\s+)?((?:сделаю|начну|закончу|напишу|выучу|схожу|позвоню|уберу)\\s*.{0,70})$`, 'iu')
  const ruBack = new RegExp(`^(?:я\\s+)?((?:сделаю|начну|закончу|напишу|выучу|схожу|позвоню|уберу)\\s*.{0,70}?)\\s+${WHEN_RU}$`, 'iu')
  let what = ''
  let word = ''
  if ((m = en.exec(t))) [what, word] = [m[1], m[2]]
  else if ((m = enFront.exec(t))) [word, what] = [m[1], m[2]]
  else if ((m = ro.exec(t))) [what, word] = [m[1], m[2]]
  else if ((m = roFront.exec(t))) [word, what] = [m[1], m[2]]
  else if ((m = ru.exec(t))) [word, what] = [m[1], m[2]]
  else if ((m = ruBack.exec(t))) [what, word] = [m[1], m[2]]
  else return null
  what = what.replace(/^(do|to)\s+/i, '').replace(/\s+(then|ok|okay|promise)$/i, '').trim()
  if (what.length < 3 || /^(it|that|this|so|asta|это)$/.test(what)) return null
  const when = askAt(word, now)
  if (!when) return null
  return { what, at: when.d.toISOString(), when: when.when }
}

/** A promise as a check-in reminder (asked once at its time, then followed up like the others). */
export function promiseReminder(p: PromiseFound): Omit<Reminder, 'id' | 'createdAt'> & { promise: { what: string; when: string } } {
  return { at: p.at, text: p.what, kind: 'checkin', follow: true, promise: { what: p.what, when: p.when } }
}

export type PromiseReminder = Reminder & { promise?: { what: string; when: string } }

/** "You said you'd start the essay today." */
export function promiseAsk(r: PromiseReminder, now = new Date()): string {
  const made = new Date(r.createdAt)
  const sameDay = ymd(made) === ymd(now)
  const when = sameDay ? (r.promise?.when === 'later' ? 'later' : 'today') : 'today'
  return `🤝 You said you'd ${r.promise?.what ?? r.text} ${when}. How did it go?`
}

/** Done / Tomorrow / Drop, as chat buttons (the same words work on Telegram). */
export function promiseButtons(id: string): { label: string; do: string }[] {
  return [
    { label: '✅ Done', do: `say:Promise done (${id})` },
    { label: '↪ Tomorrow', do: `say:Promise tomorrow (${id})` },
    { label: '✖ Drop it', do: `say:Promise drop (${id})` }
  ]
}

/** "Promise done (abc12)" → the answer, or null. */
export function readPromiseAnswer(text: string): { id: string; op: 'done' | 'tomorrow' | 'drop' } | null {
  const m = /^\s*promise (done|tomorrow|drop)\s*\(([a-z0-9]{2,20})\)\s*$/i.exec(String(text ?? ''))
  return m ? { op: m[1].toLowerCase() as 'done' | 'tomorrow' | 'drop', id: m[2] } : null
}

/** Applies Done / Tomorrow / Drop to the list (Done = kept, Drop = dropped without a broken count). */
export function answerPromise(list: PromiseReminder[], id: string, op: 'done' | 'tomorrow' | 'drop', now = new Date()): { list: PromiseReminder[]; r: PromiseReminder | null } {
  const r = list.find((x) => x.id === id) ?? null
  if (!r) return { list, r: null }
  const next = list.map((x) => {
    if (x.id !== id) return x
    if (op === 'done') return { ...x, outcome: 'kept' as const, done: true, answeredAt: now.toISOString() }
    if (op === 'drop') return { ...x, done: true, answeredAt: now.toISOString(), handled: true }
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    d.setHours(10, 0, 0, 0)
    return { ...x, at: d.toISOString(), sentAt: null, tries: 0, done: false, ignored: false, promise: { what: x.promise?.what ?? x.text, when: 'tomorrow' } }
  })
  return { list: next, r }
}

/** Promises due on `day` (still open): they go into that day's plan. */
export function promisesFor(list: PromiseReminder[], day: string): string[] {
  return list.filter((r) => r.promise && !r.done && ymd(new Date(r.at)) === day).map((r) => r.promise!.what)
}
