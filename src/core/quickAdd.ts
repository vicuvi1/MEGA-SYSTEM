// Quick-add in words (pure, tested in quickAdd.test.ts). One short line becomes
// a task: "lab report tomorrow 2h", "gym 18:00 45 min", "call mom at 7pm",
// "essay friday 3h p1", "read 20m". English only; tolerant to typos ("tomorow",
// "2 h", "45min"), 24h and am/pm, weekdays, p1-p4.
//
// The parser never guesses wrong on purpose: when a word could mean two things
// ("at 7", "friday" said on a Friday, a time that has passed today) it returns
// ONE short question instead (`ask`). Nothing here reads the clock: the caller
// passes today's date and the time now.
import { addDays } from './dates'

export interface QuickCtx {
  /** Today, YYYY-MM-DD. */
  today: string
  /** The time now, HH:MM. */
  now: string
}

export interface QuickTask {
  title: string
  /** The due day, YYYY-MM-DD (today when no day was said). */
  day: string
  /** A time said ("18:00"), else null. */
  time: string | null
  /** How long, in minutes, when said. */
  minutes: number | null
  /** p1 (most urgent) to p4, as you type it; null when not said. */
  p: 1 | 2 | 3 | 4 | null
  /** Todoist's own number for it (4 = P1, 1 = none). */
  priority: number
  /** The preview chip: "Lab report · tomorrow · 2h". */
  chip: string
  /** What goes to Todoist's quick add: "Lab report tomorrow p1 for 120 min". */
  todoist: string
  /** How many of date / time / length / priority were said (the chat uses it to tell a task from talk). */
  said: number
}

export type QuickResult = { ok: true; task: QuickTask } | { ok: false; ask: string }

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const pad = (n: number) => String(n).padStart(2, '0')
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? d[i - 2][j - 2] + 1 : 99)
  return d[a.length][b.length]
}

const wdayOf = (day: string) => new Date(`${day}T12:00:00`).getDay()

/** "1h 30m", "2h", "45 min". */
export function fmtLen(m: number): string {
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
}

/** How a day reads in the chip: today, tomorrow, Friday (within 6 days), 20 Nov. */
export function dayWords(day: string, today: string): string {
  if (day === today) return 'today'
  if (day === addDays(today, 1)) return 'tomorrow'
  const n = Math.round((new Date(`${day}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000)
  if (n > 1 && n < 7) return cap(DAYS[wdayOf(day)])
  return `${Number(day.slice(8))} ${cap(MONTHS[Number(day.slice(5, 7)) - 1]).slice(0, 3)}`
}

type Hit = { day: string; raw: string }
type Fail = { ask: string }
const fail = (ask: string): Fail => ({ ask })
const isFail = (x: unknown): x is Fail => !!x && typeof (x as Fail).ask === 'string'

/** The next `wd` after today (1–7 days ahead); next = the one in next calendar week (Monday-based). */
function coming(today: string, wd: number, next: boolean): string {
  let n = (wd - wdayOf(today) + 7) % 7
  if (n === 0) n = 7
  let day = addDays(today, n)
  if (next) {
    const untilMonday = ((8 - wdayOf(today)) % 7) || 7
    if (n < untilMonday) day = addDays(day, 7)
  }
  return day
}

const PREP = /^(on|by|due|until|before|this|next|at)$/

/**
 * Reads one line. `ok:false` carries the one short question to ask.
 */
export function parseQuick(input: string, ctx: QuickCtx): QuickResult {
  let s = ` ${input.replace(/\s+/g, ' ').trim()} `
  if (s.trim().length < 2) return { ok: false, ask: "What's the task?" }
  let said = 0
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(s)
    if (m) s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)
    return m
  }
  const all = (re: RegExp): RegExpExecArray[] => {
    const out = [...s.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))]
    s = s.replace(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`), ' ')
    return out
  }

  // ---- priority: p1 (urgent) to p4 ----
  let p: 1 | 2 | 3 | 4 | null = null
  const ps = all(/(?<=\s)p([1-4])(?=\s|[.,;]|$)/i)
  if (ps.length) {
    p = Number(ps[0][1]) as 1 | 2 | 3 | 4
    said++
  }

  // ---- time ----
  let time: string | null = null
  let minutes: number | null = null
  const hmOf = (h: number, m: number, ap?: string): string | Fail => {
    if (ap) {
      if (h < 1 || h > 12 || m > 59) return fail(`I couldn't read ${h}:${pad(m)} ${ap} as a time. Try 7pm or 19:00.`)
      return `${pad((h % 12) + (/^p/i.test(ap) ? 12 : 0))}:${pad(m)}`
    }
    if (h > 23 || m > 59) return fail(`I couldn't read ${h}:${pad(m)} as a time. Try 18:30.`)
    return `${pad(h)}:${pad(m)}`
  }
  const range = take(/(?:(?:\b(?:at|from)|@)\s*)?\b(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\b/i)
  if (range) {
    const a = hmOf(Number(range[1]), Number(range[2]))
    const b = hmOf(Number(range[3]), Number(range[4]))
    if (isFail(a)) return { ok: false, ask: a.ask }
    if (isFail(b)) return { ok: false, ask: b.ask }
    if (toMin(b) <= toMin(a)) return { ok: false, ask: `${a}-${b} ends before it starts. What are the times?` }
    time = a
    minutes = toMin(b) - toMin(a)
    said += 2
  }
  const clock = all(/(?:(?:\bat|@)\s*)?\b(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?(?![\w:])/i)
  const ampm = all(/(?:(?:\bat|@)\s*)?\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/i)
  const bare = all(/(?:\bat|@)\s*(\d{1,2})\b(?!\s*(?:h\b|hr|hour|m\b|min|:))/i)
  const noon = all(/\b(?:at\s+)?noon\b/i)
  const found: string[] = []
  for (const m of clock) {
    const t = hmOf(Number(m[1]), Number(m[2]), m[3]?.replace(/\./g, ''))
    if (isFail(t)) return { ok: false, ask: t.ask }
    found.push(t)
  }
  for (const m of ampm) {
    const t = hmOf(Number(m[1]), 0, m[2].replace(/\./g, ''))
    if (isFail(t)) return { ok: false, ask: t.ask }
    found.push(t)
  }
  for (const m of bare) {
    const h = Number(m[1])
    if (h >= 1 && h <= 12) return { ok: false, ask: `Is "at ${h}" morning or evening? Say ${h}am or ${h}pm.` }
    const t = hmOf(h, 0)
    if (isFail(t)) return { ok: false, ask: t.ask }
    found.push(t)
  }
  if (noon.length) found.push('12:00')
  if (found.length > 1 && !range) return { ok: false, ask: `Which time: ${found[0]} or ${found[1]}?` }
  if (found.length && !range) {
    time = found[0]
    said++
  }

  // ---- length ----
  const lens: number[] = []
  for (const m of all(/\b(?:for\s+)?(\d{1,2})\s*(?:h|hr|hrs|hours?)\s*(?:(\d{1,2})\s*(?:m|mins?|minutes?)\b|(?<=h|hr|hrs|hour|hours)(\d{1,2})\b)/i)) lens.push(Number(m[1]) * 60 + Number(m[2] ?? m[3]))
  for (const m of all(/\b(?:for\s+)?(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hours?)\b/i)) lens.push(Math.round(Number(m[1].replace(',', '.')) * 60))
  for (const m of all(/\b(?:for\s+)?(\d+)\s*(?:m|mins?|minutes?)\b/i)) lens.push(Number(m[1]))
  for (const m of all(/\b(?:for\s+)?(half an hour|a half hour|an hour|one hour)\b/i)) lens.push(/half/i.test(m[1]) ? 30 : 60)
  if (lens.length > 1 && !range) return { ok: false, ask: `Which length: ${fmtLen(lens[0])} or ${fmtLen(lens[1])}?` }
  if (lens.length && !range) {
    if (lens[0] < 1) return { ok: false, ask: 'How long should it take? Try 30 min or 1h.' }
    if (lens[0] > 12 * 60) return { ok: false, ask: `${fmtLen(lens[0])} is a very long task. Did you mean minutes?` }
    minutes = lens[0]
    said++
  }

  // ---- day ----
  const days: Hit[] = []
  const today = ctx.today
  const iso = take(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso) days.push({ day: iso[0].trim(), raw: iso[0].trim() })
  const inN = take(/\bin\s+(\d{1,3})\s*(d|days?|w|wks?|weeks?)\b/i)
  if (inN) days.push({ day: addDays(today, Number(inN[1]) * (/^w/i.test(inN[2]) ? 7 : 1)), raw: inN[0].trim() })
  const monthRe = MONTHS.map((m) => m.slice(0, 3)).join('|')
  const dm = take(new RegExp(`\\b(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthRe})[a-z]*\\b`, 'i')) ?? take(new RegExp(`\\b(?:on\\s+)?(${monthRe})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'))
  if (dm) {
    const [a, b] = [dm[1], dm[2]]
    const mon = MONTHS.findIndex((m) => m.startsWith((/\d/.test(a) ? b : a).toLowerCase().slice(0, 3)))
    const d = Number(/\d/.test(a) ? a : b)
    if (mon < 0 || d < 1 || d > 31) return { ok: false, ask: `I couldn't read "${dm[0].trim()}" as a date. Try 20 Nov.` }
    let y = Number(today.slice(0, 4))
    let day = `${y}-${pad(mon + 1)}-${pad(d)}`
    if (day < today) day = `${++y}-${pad(mon + 1)}-${pad(d)}`
    if (new Date(`${day}T12:00:00`).getDate() !== d) return { ok: false, ask: `There is no ${d} ${cap(MONTHS[mon])}. Which day?` }
    days.push({ day, raw: dm[0].trim() })
  }
  if (/\bnext\s+week\b/i.test(s)) return { ok: false, ask: 'Which day next week? Try "next Monday".' }

  // Single words: tomorrow, today, tonight, weekdays (typos allowed). Short weekday forms need a hint word.
  const words = s.split(' ')
  const keep: string[] = []
  const todayWd = wdayOf(today)
  for (let i = 0; i < words.length; i++) {
    const raw = words[i]
    const w = raw.toLowerCase().replace(/[^a-z]/g, '')
    const prev = (words[i - 1] ?? '').toLowerCase()
    const prevHint = PREP.test(prev)
    const last = words.slice(i + 1).every((x) => !x.trim())
    let hit: Hit | null = null
    if (w.length >= 3 && raw.replace(/[a-z]/gi, '').replace(/[.,;!]/g, '') === '') {
      if (['tmr', 'tmrw', 'tmrrw', '2morrow', 'tmmrw'].includes(w) || (w.length >= 6 && w.length <= 9 && lev(w, 'tomorrow') <= 2 && w[0] === 't')) hit = { day: addDays(today, 1), raw }
      else if (w === 'today' || w === 'tonite' || w === 'tonight' || (w.length >= 4 && w.length <= 7 && /^to/.test(w) && (lev(w, 'today') <= 1 || lev(w, 'tonight') <= 1))) hit = { day: today, raw }
      else {
        const near = DAYS.map((d, k) => ({ k, dist: lev(w, d) })).sort((a, b) => a.dist - b.dist)
        const full = near[0].dist === 0 || (w.length >= 5 && near[0].dist <= (w.length >= 7 ? 2 : 1) && near[0].dist < near[1].dist) ? near[0].k : -1
        const abbr: Record<string, number> = { fri: 5, tue: 2, tues: 2, thu: 4, thur: 4, thurs: 4, mon: 1, wed: 3, sat: 6, sun: 0 }
        const ab = abbr[w]
        const wd = full >= 0 ? full : ab !== undefined && (['fri', 'tue', 'tues', 'thu', 'thur', 'thurs'].includes(w) || prevHint || last) ? ab : -1
        if (wd >= 0) {
          const nextWord = prev === 'next'
          if (wd === todayWd && !nextWord) return { ok: false, ask: `Today is ${cap(DAYS[wd])}: today or next ${cap(DAYS[wd])}? Say "today" or "next ${DAYS[wd]}".` }
          hit = { day: coming(today, wd, nextWord), raw }
        }
      }
    }
    if (hit) {
      days.push(hit)
      if (keep.length && PREP.test((keep[keep.length - 1] ?? '').toLowerCase().replace(/[^a-z]/g, ''))) keep.pop()
      continue
    }
    keep.push(raw)
  }
  s = ` ${keep.join(' ')} `
  const distinct = [...new Set(days.map((d) => d.day))]
  if (distinct.length > 1) return { ok: false, ask: `Which day: ${dayWords(distinct[0], today)} or ${dayWords(distinct[1], today)}?` }
  const explicitDay = distinct.length === 1
  const day = explicitDay ? distinct[0] : today
  if (explicitDay) said++
  if (day < today) return { ok: false, ask: `${dayWords(day, today)} is in the past. Which day?` }
  if (!explicitDay && time && day === today && toMin(time) < toMin(ctx.now)) return { ok: false, ask: `${time} has already passed today. Say "tomorrow"?` }

  // ---- the title: what is left ----
  let title = s
    .replace(/\b(?:at|on|by|for|in|due|until|before|this|next|from|@)\s*(?=\s*$)/gi, ' ')
    .replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.\-–]+|[\s,;:\-–]+$/g, '')
    .trim()
  // A dangling preposition once the other words are gone ("call mom at" → "call mom").
  title = title.replace(/\s+(?:at|on|by|for|in|due|until|before)$/i, '').trim()
  if (!title || !/[\p{L}\p{N}]/u.test(title)) return { ok: false, ask: "What's the task called?" }
  title = cap(title).slice(0, 120)

  const priority = p ? 5 - p : 1
  const chip = [title, `${dayWords(day, today)}${time ? ` ${time}` : ''}`, minutes ? fmtLen(minutes) : null, p ? `P${p}` : null].filter(Boolean).join(' · ')
  const base = { title, day, time, minutes, p }
  const todoist = todoistText(base, ctx.today)
  return { ok: true, task: { ...base, priority, chip, todoist, said } }
}

/**
 * What goes to Todoist's quick add: "Lab report tomorrow p1 for 120 min". With `noTime` the time
 * is left out (a block placed in today's plan carries it, and approving the block gives the task
 * its time; a time on the task itself would read as a deadline to the plan audit).
 */
export function todoistText(t: Pick<QuickTask, 'title' | 'day' | 'time' | 'minutes' | 'p'>, today: string, o: { noTime?: boolean } = {}): string {
  const due = t.day === today ? 'today' : t.day === addDays(today, 1) ? 'tomorrow' : `${Number(t.day.slice(8))} ${cap(MONTHS[Number(t.day.slice(5, 7)) - 1]).slice(0, 3)}${t.day.slice(0, 4) === today.slice(0, 4) ? '' : ` ${t.day.slice(0, 4)}`}`
  return [t.title, due + (t.time && !o.noTime ? ` at ${t.time}` : ''), t.p ? `p${t.p}` : null, t.minutes ? `for ${t.minutes} min` : null].filter(Boolean).join(' ')
}

/**
 * The Coach chat: is this line a quick-add? Only when it starts with "task", "todo", "quick add"
 * or "+" ("task lab report tomorrow 2h", "+ read 20m"). Any other line (including "add ..." and
 * "gym at 18:00", which Ben reads as an event or a question) stays with Ben's own reading.
 * Returns null for those, `{ ask }` for a task that needs one question.
 */
export function chatQuickAdd(text: string, ctx: QuickCtx): { ask: string } | { task: QuickTask } | null {
  const t = text.trim()
  if (!t || t.length > 140) return null
  const body = t.replace(/^(?:quick\s*add|task|todo)\b[:\-\s]*|^\+\s*/i, '')
  if (body.length >= t.length || !body.trim()) return null
  const r = parseQuick(body, ctx)
  return r.ok ? { task: r.task } : { ask: r.ask }
}
