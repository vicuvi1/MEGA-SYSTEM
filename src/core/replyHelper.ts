// AI17 "Help me reply" on the desktop island: in Telegram, WhatsApp, Discord
// or a mail app, one tap reads the last message (the text you selected, else
// the window's text), and the AI writes 3 short replies in your style. You
// copy one, or paste it (through the Allow / Deny PC action); it is never
// sent by itself.
//
// Text goes to the AI only on your tap, and only through the eyes' gate: the
// eyes' Pause, your private list (the app and the window title), a rate
// limit, and text that looks private (passwords, codes, cards) is never sent.
//
// Pure and tested (replyHelper.test.ts).
import { deniedBy, isPaused, looksSensitive, scrub, type EyesPrefs } from './eyesGuard'

export type ReplyApp = 'Telegram' | 'WhatsApp' | 'Discord' | 'Mail'

const BROWSERS = /^(chrome|msedge|firefox|brave|opera|vivaldi|arc|librewolf|waterfox)$/i

const APPS: { app: ReplyApp; proc: RegExp; title: RegExp }[] = [
  { app: 'Telegram', proc: /^(telegram|ayugram|kotatogram|64gram)/i, title: /telegram/i },
  { app: 'WhatsApp', proc: /^whatsapp/i, title: /whatsapp/i },
  { app: 'Discord', proc: /^discord(ptb|canary)?$/i, title: /discord/i },
  { app: 'Mail', proc: /^(outlook|olk|hxoutlook|thunderbird|mailspring|mailbird|em ?client|betterbird)$/i, title: /\b(gmail|outlook|inbox|proton mail|mail)\b/i }
]

/** The chat or mail app in front ("Discord"), or null. A browser counts only by its title (web.whatsapp.com…). */
export function replyApp(proc: string | null | undefined, title?: string | null): ReplyApp | null {
  const p = String(proc ?? '').trim()
  if (!p) return null
  if (BROWSERS.test(p)) {
    const t = String(title ?? '')
    return t ? (APPS.find((a) => a.title.test(t))?.app ?? null) : null
  }
  return APPS.find((a) => a.proc.test(p))?.app ?? null
}

/** The app's buttons and labels, not messages. */
const NOISE = /^(type a message|write a message.*|message( #.*| @.*)?|send a message|search.*|reply|send|attach.*|emoji|gif|stickers?|voice message|record.*|call|video call|more( options)?|menu|back|close|minimi[sz]e|maximi[sz]e|restore|online|offline|last seen.*|typing.*|today|yesterday|new messages?|unread messages?|\d+ unread.*|\d{1,2}:\d{2}( ?[ap]\.?m\.?)?|edited|forward(ed)?|pinned.*|settings|chats?|contacts?|calls|archived?|inbox|sent|drafts|compose|new mail|delete|mark as read|subject.*|to|cc|from)$/i

/**
 * The last message from a window's text (one line per UI element, roughly
 * oldest first): the app's buttons and times are dropped, the last 3 lines
 * are kept, newest last, at most `max` characters.
 */
export function lastMessage(text: string, max = 600): string {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 2 && !NOISE.test(l))
  const out: string[] = []
  let n = 0
  for (let i = lines.length - 1; i >= 0 && out.length < 3; i--) {
    const l = lines[i].length > max ? lines[i].slice(lines[i].length - max) : lines[i]
    if (out.length && n + l.length > max) break
    out.unshift(l)
    n += l.length
  }
  return out.join('\n')
}

/** What may go to the AI: null when it looks private; emails, links and long numbers taken out. */
export function textForAi(text: string, max = 800): string | null {
  const t = String(text ?? '').trim()
  if (!t || looksSensitive(t)) return null
  return scrub(t).replace(/[ \t]+/g, ' ').trim().slice(0, max) || null
}

/** At least this long between two reads (ms). */
export const REPLY_GAP_MS = 10_000

export type ReplyCheck = { ok: true } | { ok: false; said: string }

/** May "Help me reply" read now? The eyes' Pause, your private list (app and title) and the rate limit. */
export function mayReply(o: { prefs: EyesPrefs; lastAt: number; now: number; proc: string; app: string; title?: string | null }): ReplyCheck {
  if (isPaused(o.prefs, o.now)) return { ok: false, said: 'The eyes are paused' }
  const rule = deniedBy({ proc: o.proc, app: o.app, title: o.title ?? null }, o.prefs.deny)
  if (rule) return { ok: false, said: `${o.app} is on your private list (${rule}). Take it off in Settings → Island eyes to use this.` }
  if (o.lastAt && o.now - o.lastAt < REPLY_GAP_MS) return { ok: false, said: `Wait ${Math.ceil((REPLY_GAP_MS - (o.now - o.lastAt)) / 1000)} s` }
  return { ok: true }
}

/** The People note from Ben's notes (the coach_blocks text), cut short. */
export function peopleNote(blocks: { name: string; text: string }[] | null | undefined, max = 600): string {
  const b = (blocks ?? []).find((x) => x && x.name === 'People')
  return String(b?.text ?? '').trim().slice(0, max)
}

/** The prompt: 3 short replies in the owner's own style, as JSON. */
export function replyPrompt(o: { app: ReplyApp | string; message: string; people?: string; style?: string }): string {
  return [
    `You help the owner answer a message he got in ${o.app}. Write 3 different short replies he could send.`,
    'His style: casual, warm, direct, a university student texting a friend. Short: one line each, under 25 words. Same language as the message. No emojis unless the message has some. No greetings like "Dear". Never promise money, never share codes, passwords or addresses.',
    'Make them different: one yes / positive, one that asks a short question back, one that politely says not now or later (when that fits).',
    ...(o.style ? [`How he likes to write: ${o.style}`] : []),
    ...(o.people ? ['', 'People in his life (from his notes; use only to know who it might be):', o.people] : []),
    '',
    'The last message (newest last):',
    o.message,
    '',
    'Answer with JSON only: {"replies":["…","…","…"]}'
  ].join('\n')
}

/** The model's answer → up to 3 clean one-line replies (JSON, else numbered or plain lines). */
export function parseReplies(raw: string): string[] {
  const t = String(raw ?? '').trim()
  let list: unknown[] = []
  const json = t.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (json) {
    try {
      const j = JSON.parse(json[0])
      list = Array.isArray(j) ? j : Array.isArray(j?.replies) ? j.replies : []
    } catch {
      list = []
    }
  }
  if (!list.length) list = t.split(/\r?\n/).filter((l) => /^\s*(\d+[.)]|[-*•])\s+/.test(l))
  const out: string[] = []
  for (const x of list) {
    const r = String(typeof x === 'string' ? x : ((x as { text?: unknown })?.text ?? ''))
      .replace(/^\s*(\d+[.)]|[-*•])\s+/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^["“'](.*)["”']$/, '$1')
      .trim()
      .slice(0, 200)
    if (r && !out.some((o) => o.toLowerCase() === r.toLowerCase())) out.push(r)
    if (out.length >= 3) break
  }
  return out
}
