// How the chat looks: Ben's face (one of a few drawn looks) and your own
// photo. Stored in the synced `coach_looks` setting so every device shows the
// same faces. Pure: no DOM.

export type BenLook = 'orb' | 'bot' | 'coach' | 'fox'

export const BEN_LOOKS: { id: BenLook; label: string; hint: string }[] = [
  { id: 'orb', label: 'Glow', hint: 'A friendly glowing orb' },
  { id: 'bot', label: 'Bot', hint: 'A little robot with a visor' },
  { id: 'coach', label: 'Coach', hint: 'Cap and whistle, ready to push you' },
  { id: 'fox', label: 'Fox', hint: 'Sharp, quick and a bit cheeky' }
]

export interface CoachLooks {
  ben: BenLook
  /** Your photo as a small data URL (128 px), or null for initials. */
  me: string | null
}

export const DEFAULT_LOOKS: CoachLooks = { ben: 'orb', me: null }

/** Your photo may take at most this many characters (about 40 KB). */
export const AVATAR_MAX_CHARS = 40_000

/** A photo we accept: a small image data URL. */
export function okAvatar(v: unknown): v is string {
  return typeof v === 'string' && v.length <= AVATAR_MAX_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)
}

/** Whatever is stored, as a safe value (unknown looks and broken photos fall back). */
export function cleanLooks(raw: unknown): CoachLooks {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ben = BEN_LOOKS.some((x) => x.id === r.ben) ? (r.ben as BenLook) : DEFAULT_LOOKS.ben
  return { ben, me: okAvatar(r.me) ? r.me : null }
}

/** One or two letters for the fallback avatar ("Alex Doe" → "AD", "" → "ME"). */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return 'ME'
  const first = [...words[0]][0] ?? ''
  const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : ''
  return (first + last).toUpperCase()
}

/**
 * Ben's status line under his name: what he is doing now.
 * Busy beats everything; then a running focus; then the part of the day.
 */
export function benStatus(x: { busy: boolean; streaming: boolean; step?: string | null; running?: string | null; hour: number }): { text: string; live: boolean } {
  if (x.busy && x.streaming) return { text: 'Typing…', live: true }
  if (x.busy) return { text: x.step ? `${x.step.replace(/…$/, '')}…` : 'Thinking…', live: true }
  if (x.running) return { text: `Focusing with you · ${x.running}`, live: false }
  const h = x.hour
  const part = h < 5 ? 'Up late with you' : h < 11 ? 'Planning your morning' : h < 17 ? 'Watching your afternoon' : h < 22 ? 'Planning your evening' : 'Winding down with you'
  return { text: part, live: false }
}
