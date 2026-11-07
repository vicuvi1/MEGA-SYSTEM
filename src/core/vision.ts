// The vision board (LF4): one word for the year, a "who I'm becoming" line
// and 6–9 cards (drawn art or your own picture, plus one sentence). They
// show on the island's morning card and in Ben's prompt, and goals and
// season quests can link to a card, so the daily grind stays tied to the
// bigger why. Pure; stored in `saga_vision` (+ pictures in
// `saga_vision_photos`, made small on the device, like the wallpaper photo).

export type VisionArt = 'summit' | 'blade' | 'temple' | 'scroll' | 'iron' | 'flag' | 'home' | 'star' | 'wave' | 'sunrise' | 'shield' | 'key' | 'crescent' | 'coin'

export const VISION_ARTS: { id: VisionArt; label: string; colors: [string, string] }[] = [
  { id: 'summit', label: 'Summit', colors: ['#2b3a67', '#f4a261'] },
  { id: 'blade', label: 'Blade', colors: ['#1b1f3b', '#38d8ff'] },
  { id: 'temple', label: 'Temple', colors: ['#3a1f2b', '#e76f51'] },
  { id: 'scroll', label: 'Scroll', colors: ['#2d2a24', '#e9c46a'] },
  { id: 'iron', label: 'Iron', colors: ['#1f2a2e', '#ff9f43'] },
  { id: 'flag', label: 'Flag', colors: ['#24123a', '#ff3ea5'] },
  { id: 'home', label: 'Home', colors: ['#2a1d2e', '#ec8db0'] },
  { id: 'star', label: 'Star', colors: ['#0d1b2a', '#c8f135'] },
  { id: 'wave', label: 'Wave', colors: ['#0f2540', '#7fd8ff'] },
  { id: 'sunrise', label: 'Sunrise', colors: ['#3d1e2e', '#ffc98f'] },
  { id: 'shield', label: 'Shield', colors: ['#16222e', '#b892ff'] },
  { id: 'key', label: 'Key', colors: ['#21201a', '#f5c84b'] },
  { id: 'crescent', label: 'Crescent', colors: ['#0e2226', '#7fd8c4'] },
  { id: 'coin', label: 'Coin', colors: ['#272012', '#f5c84b'] }
]
const ART_IDS = VISION_ARTS.map((a) => a.id)

export interface VisionCard {
  id: string
  text: string
  art: VisionArt
  /** A picture of yours is saved for this card (in saga_vision_photos). */
  photo: boolean
}

export interface VisionBook {
  year: number
  word: string
  becoming: string
  cards: VisionCard[]
}

export const VISION_MAX = 9
export const VISION_MIN = 6
/** A card picture: at most this long as a data URL (about 90 KB). */
export const VISION_PHOTO_MAX = 120_000

const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

export const emptyVision = (year: number): VisionBook => ({ year, word: '', becoming: '', cards: [] })

export function cleanVision(raw: unknown, year: number): VisionBook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const y = Math.round(Number(r.year))
  const seen = new Set<string>()
  const cards: VisionCard[] = (Array.isArray(r.cards) ? r.cards : [])
    .map((c: any, i: number) => ({ id: str(c?.id, 24) || `v${i + 1}`, text: str(c?.text, 80), art: ART_IDS.includes(c?.art) ? c.art : ART_IDS[i % ART_IDS.length], photo: !!c?.photo }))
    .filter((c: VisionCard) => c.text && !seen.has(c.id) && !!seen.add(c.id))
    .slice(0, VISION_MAX)
  return { year: Number.isFinite(y) && y > 2000 && y < 3000 ? y : year, word: str(r.word, 24), becoming: str(r.becoming, 140), cards }
}

export function okVisionPhoto(v: unknown): v is string {
  return typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(v) && v.length <= VISION_PHOTO_MAX
}

export function cleanVisionPhotos(raw: unknown, cards: VisionCard[]): Record<string, string> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ids = new Set(cards.map((c) => c.id))
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(r)) if (ids.has(k) && okVisionPhoto(v)) out[k] = v
  return out
}

/** Today's card for the morning (a different one each day, same all day). */
export function cardOfDay(book: VisionBook, day: string): VisionCard | null {
  if (!book.cards.length) return null
  const n = Math.round(Date.parse(`${day}T12:00:00Z`) / 864e5)
  return book.cards[((n % book.cards.length) + book.cards.length) % book.cards.length]
}

/** Is the board filled enough to show (a word or 1+ card)? */
export const hasVision = (b: VisionBook) => !!(b.word || b.becoming || b.cards.length)

/** Ben's line (empty when there is no board yet). */
export function visionLine(b: VisionBook): string {
  if (!hasVision(b)) return ''
  return `His year (${b.year})${b.word ? `, word of the year: "${b.word}"` : ''}${b.becoming ? `; who he's becoming: "${b.becoming}"` : ''}${b.cards.length ? `; vision cards: ${b.cards.map((c) => c.text).join('; ')}` : ''}. Tie hard days back to this why, briefly, in his own words.`
}
