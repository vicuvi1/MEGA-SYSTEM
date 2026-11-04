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
  return words.length ? words.join(' ').toLowerCase() : null
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
