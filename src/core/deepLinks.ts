// Links that open the app and act at once (pure, FT14 + FT15): home-screen
// shortcuts ("+250 ml water", "Start 25 min focus", "Log spending", "Talk to
// Ben") and text or links shared from any phone app.
import { parseWhen } from './whenParse'
import { WATER_GLASS_ML, WATER_MAX_ML } from './defaults'

export type DeepLink =
  | { kind: 'water'; ml: number }
  | { kind: 'focus'; minutes: number; subject: string }
  | { kind: 'spend' }
  | { kind: 'ben' }
  | { kind: 'share'; title: string; text: string; url: string }

const clip = (s: string | null, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** What a URL's query asks for, or null for a plain open. */
export function readDeepLink(search: string): DeepLink | null {
  const q = new URLSearchParams(search)
  const share = q.has('share') || ((q.has('text') || q.has('url')) && !q.has('do'))
  if (share) {
    const title = clip(q.get('title'), 200)
    const text = clip(q.get('text'), 2000)
    const url = clip(q.get('url'), 1000)
    if (!title && !text && !url) return null
    return { kind: 'share', title, text, url }
  }
  const d = q.get('do')
  if (d === 'water') {
    const ml = Math.round(Number(q.get('ml')) || WATER_GLASS_ML)
    return ml >= 50 && ml <= WATER_MAX_ML ? { kind: 'water', ml } : { kind: 'water', ml: WATER_GLASS_ML }
  }
  if (d === 'focus') {
    const minutes = Math.round(Number(q.get('min')) || 25)
    return { kind: 'focus', minutes: Math.max(5, Math.min(180, minutes)), subject: clip(q.get('subject'), 40) || 'Focus' }
  }
  if (d === 'spend') return { kind: 'spend' }
  if (d === 'ben') return { kind: 'ben' }
  return null
}

/** The query keys a deep link uses, cleared from the address once handled (a reload must not act twice). */
export const DEEP_KEYS = ['do', 'ml', 'min', 'subject', 'share', 'title', 'text', 'url']

/** Title, text and link as one clean line (the link once, even when it is also in the text). */
export function sharedText(s: { title: string; text: string; url: string }): string {
  const parts = [s.title, s.text].filter(Boolean)
  if (s.title && s.text.startsWith(s.title)) parts.shift()
  const body = parts.join(' — ')
  return s.url && !body.includes(s.url) ? `${body}${body ? ' ' : ''}${s.url}`.trim() : body
}

export type ShareAs = 'task' | 'note' | 'event'

/** A first guess: a time in it → event, a link or a long text → note, else a task. */
export function guessShare(s: { title: string; text: string; url: string }, now = new Date()): ShareAs {
  const all = sharedText(s)
  if (findWhen(all, now)) return 'event'
  if (s.url || /https?:\/\//.test(all) || all.length > 140) return 'note'
  return 'task'
}

/** The first run of words that reads as a time ("fri 18:00", "tomorrow 9-10:30"), with what's left as the title. */
export function findWhen(text: string, now = new Date()): { title: string; when: NonNullable<ReturnType<typeof parseWhen>> } | null {
  const words = text.replace(/https?:\/\/\S+/g, ' ').split(/\s+/).filter(Boolean)
  for (let len = Math.min(5, words.length); len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const chunk = words.slice(i, i + len).join(' ')
      // A bare number ("3 pages") is not a time.
      if (/^\d+$/.test(chunk)) continue
      const when = parseWhen(chunk, now)
      if (when) {
        const title = [...words.slice(0, i), ...words.slice(i + len)].join(' ').replace(/\s+(at|on|la|în|in)$/i, '').trim()
        return { title: title || 'Event', when }
      }
    }
  }
  return null
}
