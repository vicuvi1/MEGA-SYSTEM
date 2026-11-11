// Tomorrow's 3 must-dos must be concrete (feature freeze, 2026-11-11).
// Pure and tested (mustDoRule.test.ts). Ben (Telegram and the app) and the
// "Pick tomorrow's 3" box on Today use the same rule.
//
// Vague: a single word, or no number / duration ("sport", "Dorm", "study math").
// Concrete: "sport: 25 min, 30 push-ups", "read 20 pages", "essay intro 45 min".

export const NEED = 3

/** Why a must-do is too vague, or null when it is concrete enough. */
export function vagueReason(text: string): string | null {
  const t = String(text ?? '').trim()
  if (!t) return 'It is empty.'
  const words = t.split(/[\s:,;/.+-]+/).filter((w) => /\p{L}|\d/u.test(w))
  if (words.length < 2) return `"${t}" is one word. Say what and how much.`
  if (!/\d/.test(t)) return `"${t}" has no number. Add minutes or an amount.`
  return null
}

export const isVague = (text: string): boolean => vagueReason(text) != null

/** Splits a message into items: one per line, or separated by ";" or numbered "1. … 2. …". */
export function splitMustDos(text: string): string[] {
  const raw = String(text ?? '')
    .replace(/\r/g, '')
    .split(/\n|;|(?:^|\s)(?=\d[.)]\s)/)
    .map((s) => s.replace(/^\s*(?:\d[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean)
  return raw.slice(0, 10)
}

export interface PickResult {
  ok: boolean
  /** The 3 items, when ok. */
  items: string[]
  /** What to tell him (one short message). */
  reply: string
}

/** Checks a pick of tomorrow's must-dos: exactly 3, each concrete. */
export function checkPick(text: string): PickResult {
  const items = splitMustDos(text)
  if (items.length !== NEED) {
    return { ok: false, items: [], reply: `I need exactly 3 must-dos, one per line (you sent ${items.length}). For example: "sport: 25 min, 30 push-ups".` }
  }
  const bad = items.map((i) => vagueReason(i)).filter((r): r is string => !!r)
  if (bad.length) {
    return { ok: false, items: [], reply: `Too vague: ${bad.join(' ')} Something concrete, like "sport: 25 min, 30 push-ups".` }
  }
  return { ok: true, items, reply: `Saved tomorrow's 3:\n1. ${items[0]}\n2. ${items[1]}\n3. ${items[2]}` }
}

/** A message that looks like an answer to "pick tomorrow's 3" (a prefix or 3 lines). */
export function looksLikePick(text: string): boolean {
  const t = String(text ?? '').trim()
  if (/^(tomorrow'?s?\s*3|tomorrow|mâine|maine|завтра)\s*[:\-]/i.test(t)) return true
  return false
}

/** Strips a "tomorrow:" prefix. */
export function pickBody(text: string): string {
  return String(text ?? '').trim().replace(/^(tomorrow'?s?\s*3|tomorrow|mâine|maine|завтра)\s*[:\-]\s*/i, '')
}
