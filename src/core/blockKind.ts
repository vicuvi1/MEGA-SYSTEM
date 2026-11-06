// Focus blocks vs events. A FOCUS BLOCK is time you work in (Ben's booked
// blocks, deep work, study): it gets the timer flow (Start, Move, Skip, "back
// to it?"). An EVENT is something you go to or sit through (a class, a
// commute, a meeting, an appointment): it can't be measured in focus time, so
// it gets ✓ Done / Didn't go and no timer or "start now?" nudges.
// Your choice per title wins (all "Programarea Calculatoarelor" lectures are
// events once you say so), and is kept in the synced setting `block_kinds`.
import { isFocusBlock } from './dayTime'

export type BlockKind = 'focus' | 'event'
export type BlockKinds = Record<string, BlockKind>
export const BLOCK_KINDS_MAX = 200

/** The key a choice is kept under: the title without its leading symbols, case or extra spaces (so a recurring event shares one). */
export function kindKey(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 80)
}

/** Things you go to: lectures, classes, travel, appointments (Romanian and English). */
const EVENT_WORDS = /\b(university|universitate\w*|uni|lecture|class|classes|seminar\w*|curs|cursul|lab session|laborator\w*|going to|spre|commute|drive|bus|train|tram|metro|flight|doctor|dentist|appointment|programare la|meeting|sedinta|interview|party|dinner|lunch|breakfast|wedding|birthday)\b/i

/**
 * What a calendar item is. Your choice first; then meetings (a call link or
 * other people) are events, Life System's own blocks are focus, a title that
 * says "deep / study / project…" is focus, a title that says "class / going
 * to / dentist…" is an event, and anything else from your calendar is an event.
 */
export function blockKindOf(e: { title: string; ours?: boolean; allDay?: boolean; call?: boolean }, kinds: BlockKinds = {}): BlockKind {
  const mine = kinds[kindKey(e.title)]
  if (mine === 'focus' || mine === 'event') return mine
  if (e.allDay || e.call) return 'event'
  if (e.ours) return 'focus'
  if (EVENT_WORDS.test(e.title) || /^\W*c\.\s/i.test(e.title)) return 'event'
  return isFocusBlock({ title: e.title, ours: false, allDay: false }) ? 'focus' : 'event'
}

/** Only good entries, the newest kept when there are too many. */
export function cleanBlockKinds(v: unknown): BlockKinds {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: BlockKinds = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const key = kindKey(k)
    if (key && (x === 'focus' || x === 'event')) out[key] = x
  }
  const keys = Object.keys(out)
  return keys.length > BLOCK_KINDS_MAX ? Object.fromEntries(keys.slice(-BLOCK_KINDS_MAX).map((k) => [k, out[k]])) : out
}

/** Remember a choice for this title (and every later one with the same title). */
export function setBlockKind(kinds: BlockKinds, title: string, kind: BlockKind): BlockKinds {
  const key = kindKey(title)
  if (!key) return kinds
  const { [key]: _old, ...rest } = cleanBlockKinds(kinds)
  return cleanBlockKinds({ ...rest, [key]: kind })
}

// ---- The shared done state (the same marks the Today timeline's ✓ uses) ----

export type BlockMark = 'done' | 'skip'
export type DayMarks = Record<string, BlockMark>

/** Set or clear one item's mark for a day; keeps the last 14 days. */
export function applyMark(all: Record<string, DayMarks>, day: string, id: string, v: BlockMark | null): Record<string, DayMarks> {
  const dayMarks = { ...(all[day] ?? {}) }
  if (v) dayMarks[id] = v
  else delete dayMarks[id]
  const keep = Object.keys(all).sort().filter((d) => d !== day).slice(-13)
  const next: Record<string, DayMarks> = Object.fromEntries(keep.map((d) => [d, all[d]]))
  next[day] = dayMarks
  return next
}

/**
 * After an event ends: ask "Did you go?" once (never for a focus block, a
 * meeting still going on, or one you already marked or answered).
 */
export function didYouGo<B extends { id?: string; title: string; start: number; end: number; kind?: BlockKind; mark?: BlockMark | null; maybe?: unknown }>(blocks: B[], now: number, answered: Record<string, string>): B | null {
  return (
    blocks
      .filter((b) => b.kind === 'event' && !b.mark && !b.maybe && b.end <= now && now - b.end <= 3 * 3600_000 && !answered[b.id ?? `${b.start}:${b.title}`])
      .sort((x, y) => y.end - x.end)[0] ?? null
  )
}
