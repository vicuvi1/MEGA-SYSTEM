// CH4: pinned messages in Ben's chat (pure, tested). A pin keeps its own short
// copy of the text, so it stays even after the message scrolls out of the
// chat log (the log keeps the newest 200). Synced setting `coach_pins`.

export interface ChatPin {
  /** The message's `at` (its id in the chat log). */
  at: string
  role: 'me' | 'coach'
  /** A copy of the text (at most 600 characters). */
  text: string
  /** When you pinned it. */
  pinnedAt: string
}

export const PINS_KEY = 'coach_pins'
export const MAX_PINS = 30
const MAX_TEXT = 600

/** A saved value made safe: only good pins, newest pin first, no duplicates, capped. */
export function cleanPins(raw: unknown): ChatPin[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ChatPin[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const at = String((p as any).at ?? '')
    const text = String((p as any).text ?? '').trim()
    if (!at || !text || seen.has(at) || Number.isNaN(Date.parse(at))) continue
    seen.add(at)
    const role = (p as any).role === 'me' ? 'me' : 'coach'
    const pinnedAt = Number.isNaN(Date.parse(String((p as any).pinnedAt))) ? at : String((p as any).pinnedAt)
    out.push({ at, role, text: text.slice(0, MAX_TEXT), pinnedAt })
  }
  return out.sort((a, b) => b.pinnedAt.localeCompare(a.pinnedAt)).slice(0, MAX_PINS)
}

export const isPinned = (pins: ChatPin[], at: string) => pins.some((p) => p.at === at)

/** Pin or unpin one message. */
export function togglePin(pins: ChatPin[], m: { at: string; role: 'me' | 'coach'; text: string }, now = new Date()): ChatPin[] {
  const list = cleanPins(pins)
  if (isPinned(list, m.at)) return list.filter((p) => p.at !== m.at)
  return cleanPins([{ at: m.at, role: m.role, text: m.text, pinnedAt: now.toISOString() }, ...list])
}

/** The one line a pin shows in the strip. */
export function pinTitle(p: ChatPin, max = 80): string {
  const t = p.text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}
