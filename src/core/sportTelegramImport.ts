// Import from Telegram: your old sport bot chat, exported with Telegram
// Desktop (messages.html, messages2.html…), read in the browser. Nothing is
// uploaded. The bot's day cards ("Push-ups (123/117 reps)", "press 0 / 35",
// "⚪ Push-ups 0 / 91 reps") and your own logs ("103 push ups", "47pushups")
// become day totals: for each day, the highest count seen per exercise.
// Imported days are volume only (no sets), never pay points, and keep the
// higher number when a day already exists. Pure and tested.
import { matchMove } from './sportMoves'
import { moveOf, type SportEx } from './sportLadders'

export interface TgCount {
  /** The name as the chat wrote it (the bot's spelling when there is one). */
  name: string
  done: number
  target: number | null
  unit: 'reps' | 'sec'
}
/** { 'YYYY-MM-DD': { key: count } }; key is the name squashed ("pushup"). */
export type TgDays = Record<string, Record<string, TgCount>>

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }
const decode = (s: string) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m))
const plain = (html: string) => decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ')

/** "Push-ups", "push ups", "pushups" → "pushup" (one key per exercise). */
export const nameKey = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '').replace(/([^s])s$/, '$1')

export interface TgMessage {
  /** The day (local, from the export's date); a message before 04:00 counts for the day before. */
  day: string
  from: string
  text: string
}

const shift = (day: string, n: number) => {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The messages in a Telegram Desktop HTML export (div.message.default with .date[title], .from_name, .text). */
export function readMessages(html: string): TgMessage[] {
  const out: TgMessage[] = []
  let from = ''
  const parts = String(html ?? '').split(/<div class="message default\b/).slice(1)
  for (const chunk of parts) {
    const date = /class="[^"]*\bdate\b[^"]*"\s+title="(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})/.exec(chunk)
    if (!date) continue
    const fn = /<div class="from_name">\s*([\s\S]*?)\s*<\/div>/.exec(chunk)
    if (fn) from = plain(fn[1]).trim()
    const tx = /<div class="text">([\s\S]*?)<\/div>/.exec(chunk)
    if (!tx) continue
    let day = `${date[3]}-${date[2]}-${date[1]}`
    if (Number(date[4]) < 4) day = shift(day, -1)
    out.push({ day, from, text: plain(tx[1]).trim() })
  }
  return out
}

const NAME = String.raw`([A-Za-z][A-Za-z' -]{0,28}[A-Za-z])`
/** "Push-ups (123/117 reps)", "Plank (60/60 sec)". */
const CARD = new RegExp(String.raw`${NAME}\s*\(\s*(\d{1,4})\s*/\s*(\d{1,4})\s*(reps?|sec|s)?\s*\)`, 'g')
/** "press 0 / 35", "Push-ups 0 / 91 reps". */
const SLASH = new RegExp(String.raw`${NAME}\s+(\d{1,4})\s*/\s*(\d{1,4})\s*(reps?|sec|s)?\b`, 'g')
/** Your own log: "103 push ups", "47pushups", "+20 squats". */
const LOG = new RegExp(String.raw`^\+?(\d{1,4})\s*${NAME}$`)

const WORDS = /^(today|still|time|done|left|target|workout|total|streak|day|days|water|of|reps|sec)$/i
const NOT_SPORT = /water|glass|sleep|spent|lei|focus|coffee|task|minute|hour|step/
const KNOWN = /press|pushup|situp|squat|pullup|dip|plank|lunge|crunch|burpee|abs/

/**
 * Counts per day from the messages: the bot's done/target lines (the highest
 * done that day) and your own logs (added up that day); the day's number is
 * the higher of the two. "Today's Workout (YYYY-MM-DD)" sets the day of its card.
 */
export function parseTelegramExport(htmls: string | string[]): { days: TgDays; first: string | null; last: string | null; messages: number } {
  const msgs = (Array.isArray(htmls) ? htmls : [htmls]).flatMap(readMessages)
  const card: TgDays = {}
  const logs: TgDays = {}
  const put = (to: TgDays, day: string, c: TgCount, add: boolean) => {
    const k = nameKey(c.name)
    if (!k || k.length < 3 || WORDS.test(c.name.trim()) || NOT_SPORT.test(k)) return
    // Your own short logs only for real exercises ("2 glasses" or "40 lei taxi" are not reps).
    if (add && !matchMove(c.name) && !KNOWN.test(k)) return
    const m = (to[day] ??= {})
    const was = m[k]
    if (!was) m[k] = { ...c }
    else if (add) was.done += c.done
    else {
      if (c.done > was.done) was.done = c.done
      if (c.target != null) was.target = Math.max(was.target ?? 0, c.target)
      if (/^[A-Z]/.test(c.name) && !/^[A-Z]/.test(was.name)) was.name = c.name
    }
  }
  for (const msg of msgs) {
    const dated = /\((\d{4}-\d{2}-\d{2})\)/.exec(msg.text)
    const day = dated && /workout/i.test(msg.text) ? dated[1] : msg.day
    let found = false
    for (const line of msg.text.split('\n')) {
      const l = line.replace(/[^\x20-\x7E]/g, ' ').trim()
      if (!l) continue
      let hit = false
      for (const re of [CARD, SLASH]) {
        re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = re.exec(l))) {
          hit = true
          const unit = m[4] && /^s(ec)?$/i.test(m[4]) ? 'sec' : 'reps'
          put(card, day, { name: m[1].trim(), done: Number(m[2]), target: Number(m[3]), unit }, false)
        }
        if (hit) break
      }
      if (hit) { found = true; continue }
      const lg = LOG.exec(l)
      if (lg && !found) put(logs, msg.day, { name: lg[2].trim(), done: Number(lg[1]), target: null, unit: 'reps' }, true)
    }
  }
  const days: TgDays = JSON.parse(JSON.stringify(card))
  for (const [d, m] of Object.entries(logs)) {
    for (const [k, c] of Object.entries(m)) {
      const t = (days[d] ??= {})
      if (!t[k]) t[k] = c
      else if (c.done > t[k].done) t[k].done = c.done
    }
  }
  for (const d of Object.keys(days)) {
    for (const k of Object.keys(days[d])) if (!(days[d][k].done > 0)) delete days[d][k]
    if (!Object.keys(days[d]).length) delete days[d]
  }
  const list = Object.keys(days).sort()
  return { days, first: list[0] ?? null, last: list[list.length - 1] ?? null, messages: msgs.length }
}

/** Which of your exercises a name is: the same name ("press" is your "press"), else the same library move, else null (a new one). */
export function matchExercise(name: string, exercises: SportEx[]): SportEx | null {
  const k = nameKey(name)
  const same = exercises.find((e) => nameKey(e.name) === k || nameKey(String(e.id)) === k || nameKey(String(e.id).replace(/^ex_/, '')) === k)
  if (same) return same
  const mv = matchMove(name)
  return (mv && exercises.find((e) => moveOf(e)?.id === mv.id)) || null
}

export interface ImportResult {
  st: any
  days: string[]
  /** New exercises made for names you don't have (turned off). */
  added: string[]
}

/**
 * Adds the picked days to the sport state: the day log keeps the higher
 * number per exercise, and each day gets one history entry marked
 * source "telegram import" (a full day when every target was reached). Today
 * and later are skipped (only past days), and nothing here pays points.
 */
export function mergeTelegramDays(st: any, days: TgDays, pick: string[], today: string, now = Date.now()): ImportResult {
  const out = JSON.parse(JSON.stringify(st ?? {}))
  out.exercises = Array.isArray(out.exercises) ? out.exercises : []
  out.days = out.days && typeof out.days === 'object' ? out.days : {}
  out.history = Array.isArray(out.history) ? out.history : []
  out.importedDays = out.importedDays && typeof out.importedDays === 'object' ? out.importedDays : {}
  const added: string[] = []
  const done: string[] = []
  for (const day of [...new Set(pick)].sort()) {
    if (day >= today || !days[day]) continue
    const items: any[] = []
    let full = true
    for (const c of Object.values(days[day])) {
      let ex = matchExercise(c.name, out.exercises)
      if (!ex) {
        const mv = matchMove(c.name)
        ex = { id: 'ex_tg_' + nameKey(c.name), name: c.name, target: c.target ?? c.done, unit: c.unit, active: false, ...(mv ? { move: mv.id } : {}) } as SportEx
        out.exercises.push({ ...ex, doneToday: 0 })
        added.push(c.name)
      }
      const id = String(ex.id)
      const m = (out.days[day] ??= {})
      // A day total with no real sets is history, streak and volume only: never evidence for a level.
      if (!out.sets?.[day]?.[id]?.length) {
        const l = (out.importedDays[day] ??= [])
        if (!l.includes(id)) l.push(id)
      }
      m[id] = Math.max(Number(m[id]) || 0, c.done)
      if (c.target != null && c.done < c.target) full = false
      items.push({ exerciseId: id, name: ex.name, unit: c.unit, amount: m[id] })
    }
    const summary = items.map((i) => `${i.amount} ${i.name}`).join(', ')
    const entry = { id: Date.parse(day + 'T12:00:00Z'), day, category: 'Calisthenics', title: `${full ? 'Daily routine' : 'Partial day'}: ${summary}`, amount: `${items.length} exercises`, source: 'telegram import', imported: now, paid: 0, items }
    const at = out.history.findIndex((h: any) => h?.day === day && h?.source === 'telegram import')
    if (at >= 0) out.history[at] = entry
    else if (!out.history.some((h: any) => h?.day === day && /^Daily routine/.test(String(h?.title ?? '')))) out.history.push(entry)
    done.push(day)
  }
  out.history.sort((a: any, b: any) => (Number(b?.id) || 0) - (Number(a?.id) || 0))
  return { st: out, days: done, added }
}
