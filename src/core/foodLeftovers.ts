// Before & after photos (pure, tested): a second photo of the same meal, sent
// within 90 minutes and marked "after" (or read by the AI as leftovers), logs
// only what was eaten. The meal's foods minus what is left = what counts.
// - Each leftover is matched to a food of the meal by its words ("rice" →
//   "boiled white rice"); a lone food with a lone leftover match each other.
// - A food with nothing left counts in full; a food all left is dropped.
// - Leftovers that match nothing are listed, not subtracted (no guessing).
// The meal is changed through the food counter's own edit (same day and time),
// so it stays one meal in one log. No points.
import { scaleItem, type FoodItem, type FoodMeal } from './food'
import { foodKey } from './foodVision'

/** An "after" photo must come this soon after the meal. */
export const AFTER_MS = 90 * 60_000

/** A caption that says the photo is what was left ("after", "leftovers", "what's left", "didn't finish"). */
export function isAfterNote(caption: string): boolean {
  const t = String(caption ?? '').toLowerCase()
  return /\b(after|leftovers?|left ?over|what'?s left|what is left|remains|rest of it|didn'?t finish|did not finish|not finished|couldn'?t finish|uneaten|ramas|rămas|resturi|после|остатки)\b/.test(t)
}

export interface Leftover {
  name: string
  grams: number
}
export interface AfterResult {
  /** What was eaten: the meal's foods minus the leftovers (all-left foods dropped). */
  eaten: FoodItem[]
  /** Each leftover matched to a food, with the grams taken off. */
  left: { name: string; grams: number; of: string }[]
  /** Leftovers that match no food of the meal (listed, not subtracted). */
  unmatched: string[]
}

const words = (s: string) => new Set(foodKey(s).split(' ').filter(Boolean))

/** The food a leftover belongs to: the most shared words (ties: the first), or the lone food. */
function matchOf(before: FoodItem[], l: Leftover, taken: Set<number>): number {
  const lw = words(l.name)
  let best = -1
  let score = 0
  before.forEach((b, i) => {
    if (taken.has(i)) return
    const n = [...words(b.name)].filter((w) => lw.has(w)).length
    if (n > score) (best = i), (score = n)
  })
  if (best < 0 && before.length === 1 && !taken.has(0)) return 0
  return best
}

/** What was eaten of `before` when `left` is what the after photo shows. */
export function eatenFrom(before: FoodItem[], left: Leftover[]): AfterResult {
  const taken = new Set<number>()
  const off = new Map<number, number>()
  const out: AfterResult = { eaten: [], left: [], unmatched: [] }
  const lone = before.length === 1 && left.length === 1
  for (const l of left) {
    const g = Math.max(0, Math.round(Number(l.grams) || 0))
    if (!g) continue
    const i = lone ? 0 : matchOf(before, l, taken)
    if (i < 0) {
      out.unmatched.push(l.name)
      continue
    }
    taken.add(i)
    const g2 = Math.min(before[i].grams, g)
    off.set(i, g2)
    out.left.push({ name: l.name, grams: g2, of: before[i].name })
  }
  before.forEach((b, i) => {
    const rest = b.grams - (off.get(i) ?? 0)
    if (rest < 5) return
    out.eaten.push(off.has(i) ? { ...scaleItem(b, rest), lo: undefined, hi: undefined } : b)
  })
  // Drop the empty range keys a partly eaten food got.
  out.eaten = out.eaten.map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as unknown as FoodItem)
  return out
}

/** The newest photo meal still open to an "after" photo (live, logged within 90 minutes), or null. */
export function recentPhotoMeal<M extends Pick<FoodMeal, 'id' | 'at' | 'source' | 'supp'> & { removed?: boolean }>(meals: M[], now: number, live?: Set<string>): M | null {
  const list = meals
    .filter((m) => m.source === 'photo' && !m.supp && !m.removed && (!live || live.has(`${m.id}-p`)))
    .filter((m) => {
      const t = Date.parse(m.at)
      return Number.isFinite(t) && now - t >= 0 && now - t <= AFTER_MS
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  return list[0] ?? null
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
/** "Left: 120 g rice, 40 g chicken" (or "Nothing left: all of it eaten"). */
export function leftLine(r: AfterResult): string {
  if (!r.left.length) return 'Nothing left: all of it counts.'
  return `Left: ${r.left.map((l) => `${fmt(l.grams)} g ${l.of.toLowerCase()}`).join(', ')}${r.unmatched.length ? ` (not in the meal: ${r.unmatched.join(', ')})` : ''}.`
}
