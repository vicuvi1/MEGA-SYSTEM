// Ben never states a time, an event or progress that isn't in his data (pure, tested).
//
// The model sometimes fills gaps: "you have until 19:50 before the next meeting"
// (no meeting existed), "room nearly done" (nothing said so). After the model
// answers, each sentence is checked against what Ben was given (his day, the
// calendar, the plan, lookups) and what you wrote:
// - a clock time ("19:50", "7pm") must appear there (or be the time now);
// - a meeting / class / lecture / appointment / interview / exam must be named there;
// - "nearly done", "almost finished", "halfway through" needs your own words ("almost", "half").
// A sentence that fails is dropped; when every sentence fails, only the made-up
// parts are taken out.

const pad = (n: number) => String(n).padStart(2, '0')
const TIME = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g
const AMPM = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s?(am|pm)\b/gi
const EVENT = /\b(meetings?|appointments?|interviews?|lectures?|class(?:es)?|seminars?|exams?)\b/gi
const PROGRESS = /\b(?:nearly|almost|mostly|half(?:way)?|basically|practically)\s+(?:done|finished|through|complete|there)\b/i

export interface GroundFacts {
  /** Everything Ben was given about his day (context, calendar, plan, lookups, the chat so far). */
  facts: string
  /** His message. */
  said: string
  now: Date
}

const norm = (h: number, m: number) => `${pad(h)}:${pad(m)}`

/** Every clock time in a text, as "HH:MM" (am/pm turned into 24 h). */
export function timesIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(TIME)) out.push(norm(Number(m[1]), Number(m[2])))
  for (const m of text.matchAll(AMPM)) {
    let h = Number(m[1]) % 12
    if (/pm/i.test(m[3])) h += 12
    out.push(norm(h, Number(m[2] ?? 0)))
  }
  return out
}

const stem = (w: string) => w.toLowerCase().replace(/(ss)es$/, '$1').replace(/([^s])s$/, '$1')

/** What in one sentence isn't backed by the facts: invented times, events, progress. */
export function ungrounded(sentence: string, g: GroundFacts): { times: string[]; events: string[]; progress: boolean } {
  const known = new Set([...timesIn(g.facts), ...timesIn(g.said)])
  const t = g.now
  for (const d of [-1, 0, 1]) {
    const x = new Date(t.getTime() + d * 60000)
    known.add(norm(x.getHours(), x.getMinutes()))
  }
  const times = timesIn(sentence).filter((x) => !known.has(x))
  const where = `${g.facts}\n${g.said}`.toLowerCase()
  const events = [...sentence.matchAll(EVENT)].map((m) => m[1]).filter((w) => !where.includes(stem(w)))
  // Only his own "almost / nearly / half" backs it: "I finished X" is not "X is nearly done".
  const progress = PROGRESS.test(sentence) && !/\b(almost|nearly|half|halfway|most of|mostly)\b/i.test(g.said)
  return { times, events, progress }
}

const sentences = (text: string) => text.split(/(?<=[.!?…])\s+|\n+/).filter((s) => s.trim())

/** The reply with every invented time, event and progress claim taken out. `dropped` lists what went. */
export function groundReply(reply: string, g: GroundFacts): { reply: string; dropped: string[] } {
  const text = String(reply ?? '').trim()
  if (!text) return { reply: text, dropped: [] }
  const parts = sentences(text)
  const dropped: string[] = []
  const kept: string[] = []
  for (const s of parts) {
    const u = ungrounded(s, g)
    if (u.times.length || u.events.length) {
      dropped.push(s.trim())
      continue
    }
    if (u.progress) {
      // "Coffee in, room nearly done — good": only the made-up clause goes.
      const clauses = s.split(/\s*(?:,|;|—|–| - )\s*/)
      const ok = clauses.filter((c) => !PROGRESS.test(c))
      dropped.push(...clauses.filter((c) => PROGRESS.test(c)).map((c) => c.trim()))
      if (ok.length) {
        const joined = ok.join(', ').replace(/\s+([.!?])/g, '$1')
        kept.push(/[.!?…]$/.test(joined) ? joined : `${joined}.`)
      }
      continue
    }
    kept.push(s.trim())
  }
  if (!dropped.length) return { reply: text, dropped }
  if (kept.length) return { reply: kept.join(' ').trim(), dropped }
  // Every sentence had something made up: keep the words, take out only those parts.
  let r = text
  for (const s of parts) {
    const u = ungrounded(s, g)
    for (const x of u.times) r = r.replace(new RegExp(`\\s*\\b(?:at|until|till|by|from|before|after|around)?\\s*${x.replace(/^0/, '0?')}\\b`, 'g'), '')
    for (const w of u.events) r = r.replace(new RegExp(`\\s*\\b(?:before|until|after)?\\s*(?:the|your|a)?\\s*(?:next\\s+)?${w}\\b`, 'gi'), '')
  }
  r = r.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/,\s*\./g, '.').trim()
  return { reply: r || text, dropped }
}
