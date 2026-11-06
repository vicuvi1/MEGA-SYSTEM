// Meetings on the desktop island (MT1–MT3): captions from Windows 11 Live
// Captions while you're in a call, the newest lines under the pill, and an
// optional transcript saved into the Notebook.
//
// - The desktop reads the Live Captions window's text about once a second.
//   That text is a rolling window: new words come at the end, old lines fall
//   off the start, and the last few words can still change. captionStep()
//   lines the new read up with the last one and keeps only what is new (and
//   fixes the last words when Live Captions corrected them).
// - Captions live in memory only, at most 2 hours, and are wiped when you
//   stop, unless you tap Save.
// - Private meetings (doctor, HR, anything on the eyes' private list) never
//   get the Caption button.
//
// Pure and tested (meetings.test.ts).
import { calendarDay } from './dates'
import { deniedBy } from './eyesGuard'

/** Captions are kept at most this long (older lines are dropped). */
export const CAPTION_KEEP_MS = 2 * 3600_000
/** And at most this many words (about 2 hours of fast talk). */
export const CAPTION_MAX_WORDS = 25_000
/** A pause this long starts a new line in the transcript. */
export const LINE_GAP_MS = 4000
/** A line this long (characters) ends at the next sentence end… */
const LINE_SOFT = 60
/** …and always at this length. */
const LINE_HARD = 220
/** The last words Live Captions may still correct. */
const REVISE_MAX = 3

export interface CaptionLine {
  /** When its first word came (ms). */
  at: number
  words: string[]
}

export interface CaptionState {
  startedAt: number
  /** The last read's words (to line up the next read). */
  last: string[]
  lines: CaptionLine[]
  /** When words last came (ms). */
  lastAddAt: number
}

export const newCaptions = (now: number): CaptionState => ({ startedAt: now, last: [], lines: [], lastAddAt: 0 })

export const captionWords = (t: string): string[] =>
  String(t ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

/** The word for lining up: lower case, no punctuation ("Hello," = "hello"). */
const key = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/**
 * How `next` continues `prev` (both the Live Captions text, as words): how
 * many of the words already taken must be taken back (Live Captions changed
 * them) and which words are new. Nothing lines up (the box was cleared): all
 * of `next` is new.
 */
export function captionDiff(prev: string[], next: string[]): { drop: number; add: string[] } {
  if (!prev.length) return { drop: 0, add: next.slice() }
  if (!next.length) return { drop: 0, add: [] }
  const pk = prev.map(key)
  const nk = next.map(key)
  // Where in `prev` does `next` start? The earliest start wins (the longest overlap).
  for (let i = 0; i < prev.length; i++) {
    const tail = prev.length - i
    let m = 0
    while (m < tail && m < next.length && pk[i + m] === nk[m]) m++
    const whole = m === tail && (tail >= 2 || i === 0)
    // The last few words were changed (or dropped) by Live Captions.
    const revised = m >= 3 && tail - m <= REVISE_MAX
    // The text got shorter: next is a corrected start of prev's tail.
    if (!whole && !revised) continue
    // Take back from the first word that is not written exactly the same (a comma, a capital).
    let same = 0
    while (same < m && prev[i + same] === next[same]) same++
    return { drop: tail - same, add: next.slice(same) }
  }
  return { drop: 0, add: next.slice() }
}

const lineText = (l: CaptionLine) => l.words.join(' ')

/** The words, added to the transcript's lines (a pause or a long sentence starts a new line). */
function append(lines: CaptionLine[], add: string[], now: number, lastAddAt: number): CaptionLine[] {
  if (!add.length) return lines
  const out = lines.map((l) => ({ at: l.at, words: l.words.slice() }))
  let first = true
  for (const w of add) {
    const cur = out[out.length - 1]
    const len = cur ? lineText(cur).length : 0
    const fresh =
      !cur ||
      (first && lastAddAt > 0 && now - lastAddAt > LINE_GAP_MS) ||
      len >= LINE_HARD ||
      (len >= LINE_SOFT && /[.?!…]["')\]]?$/.test(cur.words[cur.words.length - 1] ?? ''))
    if (fresh) out.push({ at: now, words: [w] })
    else cur.words.push(w)
    first = false
  }
  return out
}

/** Takes the last `n` words back (across lines; an emptied line goes). */
function dropWords(lines: CaptionLine[], n: number): CaptionLine[] {
  const out = lines.map((l) => ({ at: l.at, words: l.words.slice() }))
  let left = n
  while (left > 0 && out.length) {
    const l = out[out.length - 1]
    const k = Math.min(left, l.words.length)
    l.words.splice(l.words.length - k, k)
    left -= k
    if (!l.words.length) out.pop()
  }
  return out
}

/** Old lines out: older than 2 hours, or past the word cap. */
export function pruneCaptions(lines: CaptionLine[], now: number): CaptionLine[] {
  let out = lines.filter((l) => now - l.at <= CAPTION_KEEP_MS)
  let total = out.reduce((n, l) => n + l.words.length, 0)
  while (total > CAPTION_MAX_WORDS && out.length > 1) {
    total -= out[0].words.length
    out = out.slice(1)
  }
  return out
}

/** A new read of the Live Captions text. `added`: the new words (empty when nothing changed). */
export function captionStep(st: CaptionState, raw: string, now: number): { state: CaptionState; added: string[]; dropped: number } {
  const next = captionWords(raw).slice(-400)
  const d = captionDiff(st.last, next)
  let lines = d.drop ? dropWords(st.lines, d.drop) : st.lines
  lines = pruneCaptions(append(lines, d.add, now, st.lastAddAt), now)
  return { state: { startedAt: st.startedAt, last: next, lines, lastAddAt: d.add.length ? now : st.lastAddAt }, added: d.add, dropped: d.drop }
}

/** The newest 1–2 lines for the strip under the pill, each cut to its last `max` characters. */
export function liveLines(lines: CaptionLine[], max = 90): string[] {
  const cut = (t: string) => {
    if (t.length <= max) return t
    const s = t.slice(t.length - max + 1)
    const sp = s.indexOf(' ')
    return `…${sp >= 0 && sp < 20 ? s.slice(sp + 1) : s}`
  }
  return lines.slice(-2).map((l) => cut(lineText(l))).filter(Boolean)
}

export const captionWordCount = (lines: CaptionLine[]) => lines.reduce((n, l) => n + l.words.length, 0)

// ---- the meeting's name and privacy ----

/** Meetings that are nobody else's business: never captioned. Whole words only ("HR", not "cHRome"). */
const PRIVATE_MEETING = /\b(doctors?|dr|gp|dentist|therap(y|ist)|counsel(l?ing|l?or)|psych\w*|medical|clinic|hospital|health|hr|human resources|lawyer|legal|attorney|salary|payroll|performance review|disciplinary|grievance|interview|confidential|private|personal)\b/i

/** Is a meeting with this title private (the meetings list, or the eyes' private list)? */
export function meetingPrivate(title: string | null | undefined, deny: string[]): boolean {
  const t = String(title ?? '').trim()
  if (!t) return false
  return PRIVATE_MEETING.test(t) || !!deniedBy({ title: t }, deny)
}

const CALL_APPS: [RegExp, string][] = [
  [/^zoom/i, 'Zoom'],
  [/^(ms-?teams|teams)/i, 'Teams'],
  [/^discord/i, 'Discord'],
  [/^slack/i, 'Slack'],
  [/^skype/i, 'Skype'],
  [/webex/i, 'Webex'],
  [/^(telegram)/i, 'Telegram'],
  [/^whatsapp/i, 'WhatsApp']
]

/** The call app from the program in front ("Zoom"), or null. */
export function callApp(proc: string | null | undefined): string | null {
  const p = String(proc ?? '').trim()
  for (const [re, name] of CALL_APPS) if (re.test(p)) return name
  return null
}

const pad = (n: number) => String(n).padStart(2, '0')
const dayOf = (ms: number) => calendarDay(new Date(ms))
const timeOf = (ms: number, secs = true) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}${secs ? `:${pad(d.getSeconds())}` : ''}`
}

/** "Meeting Weekly sync 2026-11-05": the calendar's title, else the app, else just the date. */
export function meetingNoteTitle(o: { title?: string | null; app?: string | null; at: number }): string {
  const name = String(o.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || String(o.app ?? '').trim().slice(0, 30)
  return `Meeting ${name ? `${name} ` : ''}${dayOf(o.at)}`
}

/** The note: a short header and one timestamped line per caption line. */
export function transcriptNote(o: { title?: string | null; app?: string | null; startedAt: number; lines: CaptionLine[]; now: number }): { title: string; body: string } {
  const title = meetingNoteTitle({ title: o.title, app: o.app, at: o.startedAt })
  const first = o.lines[0]?.at ?? o.startedAt
  const body = [
    `# ${title}`,
    '',
    `Captions from Windows Live Captions, ${timeOf(first, false)}–${timeOf(o.now, false)}. Saved by you from the island. Captions can have mistakes and don't say who spoke.`,
    '',
    ...(o.lines.length ? o.lines.map((l) => `- **${timeOf(l.at)}** ${lineText(l)}`) : ['_(no captions)_']),
    ''
  ].join('\n')
  return { title, body }
}

/** "Tell the others": a short message to copy into the call's chat. */
export function consentMessage(): string {
  return "Heads up: I'm using live captions on my PC to follow this call. They stay on my computer unless I save them as notes. Tell me if you'd rather I didn't."
}

/** The short notice before saving (others' words). */
export const SAVE_NOTICE = "You're saving what other people said. Make sure everyone is OK with it: in some places recording needs everyone's consent. The note syncs to your Life System account."
