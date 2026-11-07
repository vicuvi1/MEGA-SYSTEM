// Flashcards with real spaced repetition (CR4). Pure and tested (srs.test.ts).
//
// An SM-2 style scheduler: each card keeps its own interval and ease. You
// grade yourself after seeing the answer (Again / Hard / Good / Easy); a card
// you know well comes back later and later, a card you forgot comes back
// tomorrow and gets a little harder to grow. New cards are limited per day so
// a big import doesn't bury you. This replaces "review the whole topic on
// fixed 1-3-7-14-30 day steps" for anything you can put on a card.
import { addDays, daysBetween } from '../dates'

export type Grade = 'again' | 'hard' | 'good' | 'easy'
export const GRADES: Grade[] = ['again', 'hard', 'good', 'easy']
export const GRADE_LABEL: Record<Grade, string> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' }

export interface Card {
  id: string
  front: string
  back: string
  /** A deck name ("Ports", "Crypto", "Rust"), free text. */
  deck: string
  /** Where it came from ("Notebook: Lab 3", "Ben"), optional. */
  src?: string
  created: string
  /** The next day it is due (YYYY-MM-DD). */
  due: string
  /** Days until the next review after the last one (0 = new). */
  ivl: number
  ease: number
  /** Good answers in a row since it was last forgotten. */
  reps: number
  lapses: number
  last: string | null
  /** Suspended cards never come up. */
  off?: boolean
}

export interface ReviewMark {
  day: string
  id: string
  grade: Grade
}

export const START_EASE = 2.5
export const MIN_EASE = 1.3
export const MAX_IVL = 365
/** New cards shown per day at most. */
export const NEW_PER_DAY = 12

const clampEase = (e: number) => Math.max(MIN_EASE, Math.min(3.2, Math.round(e * 100) / 100))

export function newCard(front: string, back: string, deck: string, today: string, id: string, src?: string): Card {
  return { id, front: front.trim().slice(0, 300), back: back.trim().slice(0, 600), deck: (deck.trim() || 'General').slice(0, 40), ...(src ? { src: src.slice(0, 80) } : {}), created: today, due: today, ivl: 0, ease: START_EASE, reps: 0, lapses: 0, last: null }
}

export const isNew = (c: Card) => c.reps === 0 && c.last === null

/** The interval (days) each grade would give, without changing the card. */
export function nextIvl(c: Card, g: Grade, today: string): number {
  if (g === 'again') return 1
  const late = c.last ? Math.max(0, daysBetween(c.due, today)) : 0
  const base = c.ivl + Math.floor(late / 2)
  let ivl: number
  if (g === 'hard') ivl = c.reps === 0 ? 1 : Math.max(c.ivl + 1, Math.round(base * 1.2))
  else if (g === 'good') ivl = c.reps === 0 ? 1 : c.reps === 1 ? 3 : Math.max(c.ivl + 1, Math.round(base * c.ease))
  else ivl = c.reps === 0 ? 3 : c.reps === 1 ? 5 : Math.max(c.ivl + 2, Math.round(base * c.ease * 1.3))
  return Math.min(MAX_IVL, Math.max(1, ivl))
}

/** The card after you graded it today. */
export function grade(c: Card, g: Grade, today: string): Card {
  const ivl = nextIvl(c, g, today)
  if (g === 'again') return { ...c, ivl, due: addDays(today, ivl), reps: 0, lapses: c.lapses + 1, ease: clampEase(c.ease - 0.2), last: today }
  const ease = g === 'hard' ? clampEase(c.ease - 0.15) : g === 'easy' ? clampEase(c.ease + 0.15) : c.ease
  return { ...c, ivl, due: addDays(today, ivl), reps: c.reps + 1, ease, last: today }
}

/** "1d", "3d", "2w", "4mo": what a grade button says. */
export function ivlText(days: number): string {
  if (days < 14) return `${days}d`
  if (days < 60) return `${Math.round(days / 7)}w`
  return `${Math.round(days / 30)}mo`
}

/** New cards already started today (so the daily limit holds across sessions). */
export function newSeenToday(log: ReviewMark[], today: string): number {
  const first = new Map<string, string>()
  for (const m of log) if (!first.has(m.id) || m.day < first.get(m.id)!) first.set(m.id, m.day)
  return [...first.values()].filter((d) => d === today).length
}

/** Today's review queue: due cards first (oldest due first), then new ones up to the daily limit. */
export function dueCards(cards: Card[], today: string, opts: { newLimit?: number; newSeen?: number; deck?: string | null } = {}): Card[] {
  const live = cards.filter((c) => !c.off && (!opts.deck || c.deck === opts.deck))
  const due = live.filter((c) => !isNew(c) && c.due <= today).sort((a, b) => a.due.localeCompare(b.due) || a.ivl - b.ivl || a.id.localeCompare(b.id))
  const room = Math.max(0, (opts.newLimit ?? NEW_PER_DAY) - (opts.newSeen ?? 0))
  const fresh = live.filter(isNew).sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id)).slice(0, room)
  return [...due, ...fresh]
}

export interface DeckStats {
  total: number
  due: number
  fresh: number
  /** Known well: the next review is 3+ weeks away. */
  mature: number
  /** Share of reviews in the last 30 days that weren't "Again" (0–1), or null with fewer than 10. */
  retention: number | null
  reviewedToday: number
  /** Days in a row with at least one review, ending today or yesterday. */
  streak: number
  decks: { deck: string; total: number; due: number }[]
}

export function deckStats(cards: Card[], log: ReviewMark[], today: string, newSeen = 0): DeckStats {
  const q = dueCards(cards, today, { newSeen })
  const recent = log.filter((m) => daysBetween(m.day, today) < 30)
  const days = new Set(log.map((m) => m.day))
  let streak = 0
  for (let d = days.has(today) ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) streak++
  const decks = new Map<string, { total: number; due: number }>()
  for (const c of cards.filter((x) => !x.off)) {
    const d = decks.get(c.deck) ?? { total: 0, due: 0 }
    d.total++
    if (q.includes(c)) d.due++
    decks.set(c.deck, d)
  }
  return {
    total: cards.filter((c) => !c.off).length,
    due: q.filter((c) => !isNew(c)).length,
    fresh: q.filter(isNew).length,
    mature: cards.filter((c) => !c.off && c.ivl >= 21).length,
    retention: recent.length >= 10 ? Math.round((recent.filter((m) => m.grade !== 'again').length / recent.length) * 100) / 100 : null,
    reviewedToday: log.filter((m) => m.day === today).length,
    streak,
    decks: [...decks.entries()].map(([deck, v]) => ({ deck, ...v })).sort((a, b) => b.due - a.due || b.total - a.total || a.deck.localeCompare(b.deck))
  }
}

/**
 * Cards from your own notes: one per line as "front :: back", "front — back",
 * "front - back", "front = back" or "front<TAB>back", or "Q: …" followed by
 * "A: …". Headings, bullets and blank lines are skipped; duplicates once.
 */
export function parseCards(text: string, max = 100): { front: string; back: string }[] {
  const out: { front: string; back: string }[] = []
  const seen = new Set<string>()
  const push = (f: string, b: string) => {
    const front = f.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()
    const back = b.trim()
    if (front.length < 2 || !back || front.length > 300 || back.length > 600) return
    const k = front.toLowerCase()
    if (seen.has(k)) return
    seen.add(k)
    out.push({ front, back })
  }
  const lines = String(text ?? '').split(/\r?\n/)
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const line = lines[i].trim()
    if (!line || /^#/.test(line)) continue
    const q = /^(?:q|question|front)\s*[:.]\s*(.+)$/i.exec(line)
    if (q) {
      const a = /^(?:a|answer|back)\s*[:.]\s*(.+)$/i.exec((lines[i + 1] ?? '').trim())
      if (a) {
        push(q[1], a[1])
        i++
      }
      continue
    }
    const m = /^(.+?)\s*(?:::|\t| — | – | = | -> | → | - )\s*(.+)$/.exec(line)
    if (m) push(m[1], m[2])
  }
  return out
}

/** What Ben is asked when he drafts cards from a writeup or a note (answer: "front :: back" lines). */
export function cardPrompt(text: string, deck: string): string {
  return [
    `Make 5-12 flashcards for spaced repetition from these notes (deck: ${deck || 'General'}).`,
    'One fact per card. The front is a short question, the back a short exact answer (a port, a formula, a rule, a term).',
    'Answer ONLY with lines in the form: question :: answer',
    '',
    String(text ?? '').slice(0, 6000)
  ].join('\n')
}

export function cleanCards(raw: unknown): Card[] {
  if (!Array.isArray(raw)) return []
  const day = /^\d{4}-\d{2}-\d{2}$/
  const out: Card[] = []
  for (const x of raw as any[]) {
    if (!x || typeof x.id !== 'string' || typeof x.front !== 'string' || typeof x.back !== 'string') continue
    const created = day.test(x.created) ? x.created : '2026-01-01'
    out.push({
      id: x.id.slice(0, 40),
      front: x.front.slice(0, 300),
      back: x.back.slice(0, 600),
      deck: typeof x.deck === 'string' && x.deck.trim() ? x.deck.slice(0, 40) : 'General',
      ...(typeof x.src === 'string' ? { src: x.src.slice(0, 80) } : {}),
      created,
      due: day.test(x.due) ? x.due : created,
      ivl: Number.isFinite(x.ivl) ? Math.max(0, Math.min(MAX_IVL, Math.round(x.ivl))) : 0,
      ease: Number.isFinite(x.ease) ? clampEase(x.ease) : START_EASE,
      reps: Number.isFinite(x.reps) ? Math.max(0, Math.round(x.reps)) : 0,
      lapses: Number.isFinite(x.lapses) ? Math.max(0, Math.round(x.lapses)) : 0,
      last: day.test(x.last) ? x.last : null,
      ...(x.off === true ? { off: true } : {})
    })
  }
  return out.slice(0, 3000)
}

export function cleanMarks(raw: unknown): ReviewMark[] {
  if (!Array.isArray(raw)) return []
  return (raw as any[]).filter((m) => m && /^\d{4}-\d{2}-\d{2}$/.test(m.day) && typeof m.id === 'string' && GRADES.includes(m.grade)).slice(-1500)
}
