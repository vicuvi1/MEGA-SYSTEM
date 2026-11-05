// Ben says each kind of thing at most once a day: "💧 Water 0.0 of 2.7 L…"
// and "💧 Water 0.5 of 2.7 L…" are the same message with new numbers, so the
// second one is not sent. Your own reminders (🔔 ⏰) are never held back.

/** The message's kind: its opening words without numbers or markup. */
export function messageKind(html: string): string | null {
  const plain = html
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, ' ')
    .trim()
  if (!plain || /^(🔔|⏰)/u.test(plain)) return null
  const words = plain
    .replace(/[\d.,:%/+-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
  if (!words.length) return null
  // News about one specific thing (a calendar event added, moved or cancelled,
  // a block shifted, a health alert) is its own kind per thing: two different
  // events the same day both get through (T4). The whole text, minus numbers.
  if (/^(📅|❌|↪️|✂️|➡️|🔧|✅ Working again|⚠️)/u.test(plain)) return plain.replace(/[\d.,:%/+-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 160)
  return words.join(' ').toLowerCase()
}

export interface SentToday {
  day: string
  kinds: string[]
}

/** Whether to send it today, and what to remember if so. */
export function sendOnce(prev: SentToday | null, html: string, day: string): { send: boolean; next: SentToday } {
  const base: SentToday = prev && prev.day === day ? prev : { day, kinds: [] }
  const kind = messageKind(html)
  if (!kind) return { send: true, next: base }
  if (base.kinds.includes(kind)) return { send: false, next: base }
  return { send: true, next: { day, kinds: [...base.kinds, kind].slice(-200) } }
}
