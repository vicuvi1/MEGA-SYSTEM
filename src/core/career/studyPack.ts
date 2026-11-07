// The evening shift study kit (CR3). Pure and tested.
//
// A shift holds a few hours of real work and a lot of waiting. During your
// work window (My life) Ben offers a 10–25 minute pack for the quiet bits:
// the flashcards that are due, one CTF hint to try, a short reading, one
// essay paragraph. Starting a pack starts a focus timer named "Study pack",
// so a finished pack is simply focus time: the timer pays, nothing else.
export type QueueKind = 'ctf' | 'reading' | 'other'
export const QUEUE_LABEL: Record<QueueKind, string> = { ctf: 'CTF hint', reading: 'Reading', other: 'Other' }

export interface QueueItem {
  id: string
  kind: QueueKind
  text: string
  link: string | null
  done: boolean
  added: string
}

export type PackKind = 'cards' | 'ctf' | 'reading' | 'essay' | 'notes'
export const PACK_ICON: Record<PackKind, string> = { cards: '🃏', ctf: '🚩', reading: '📖', essay: '✍️', notes: '🗒️' }

export interface PackItem {
  kind: PackKind
  text: string
  minutes: number
  /** The queue item or essay step it came from. */
  ref?: string
  link?: string | null
}

export interface Pack {
  minutes: number
  items: PackItem[]
}

export const PACK_SUBJECT = 'Study pack'
export const PACK_MIN = 10
export const PACK_MAX = 25

/**
 * A pack that fits `minutes` (10–25): due cards first, then one essay
 * paragraph when a draft step is due, one CTF hint, one reading. `turn`
 * rotates the queue so each pack offers something new.
 */
export function buildPack(input: { dueCards: number; queue: QueueItem[]; essaySteps: { title: string; kind: string; ref: string }[]; minutes?: number; turn?: number }): Pack {
  const budget = Math.max(PACK_MIN, Math.min(PACK_MAX, Math.round(input.minutes ?? 20)))
  const items: PackItem[] = []
  let left = budget
  const add = (it: PackItem) => {
    if (left < 3) return
    const m = Math.min(it.minutes, left)
    items.push({ ...it, minutes: m })
    left -= m
  }
  if (input.dueCards > 0) add({ kind: 'cards', text: `${Math.min(input.dueCards, 30)} flashcard${input.dueCards === 1 ? '' : 's'} due`, minutes: Math.min(10, Math.max(3, Math.ceil(Math.min(input.dueCards, 30) / 2))) })
  const draft = input.essaySteps.find((s) => s.kind === 'draft') ?? input.essaySteps.find((s) => s.kind === 'outline' || s.kind === 'edit')
  if (draft) add({ kind: 'essay', text: draft.kind === 'draft' ? `Write one paragraph of "${draft.title}"` : draft.kind === 'outline' ? `Jot 3 outline points for "${draft.title}"` : `Edit one page of "${draft.title}"`, minutes: 10, ref: draft.ref })
  const open = input.queue.filter((q) => !q.done)
  const turn = Math.max(0, input.turn ?? 0)
  const pick = (k: QueueKind) => {
    const list = open.filter((q) => q.kind === k)
    return list.length ? list[turn % list.length] : null
  }
  const ctf = pick('ctf')
  if (ctf) add({ kind: 'ctf', text: `Try one hint: ${ctf.text}`, minutes: 8, ref: ctf.id, link: ctf.link })
  const read = pick('reading') ?? pick('other')
  if (read) add({ kind: 'reading', text: read.kind === 'reading' ? `Read: ${read.text}` : read.text, minutes: 10, ref: read.id, link: read.link })
  if (!items.length || left >= 8) add({ kind: 'notes', text: items.length ? 'Reread today\'s lecture notes and star one thing to remember' : 'Reread your latest notes and turn 3 facts into flashcards', minutes: Math.min(10, left) })
  const minutes = Math.max(PACK_MIN, items.reduce((t, i) => t + i.minutes, 0))
  return { minutes, items }
}

const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/** Is now inside tonight's work window (and the shift isn't off)? `nowMin` is minutes after midnight. */
export function inShift(work: { from: string; to: string; mode: string } | null | undefined, nowMin: number): boolean {
  if (!work || work.mode === 'off' || !/^\d\d:\d\d$/.test(work.from) || !/^\d\d:\d\d$/.test(work.to)) return false
  return nowMin >= toMin(work.from) && nowMin < toMin(work.to)
}

/** The pack as a Telegram / island message (plain text; the caller escapes it). */
export function packText(p: Pack): string {
  return [`📚 ${p.minutes}-min study pack for a quiet moment:`, ...p.items.map((i) => `${PACK_ICON[i.kind]} ${i.text} · ${i.minutes} min`)].join('\n')
}

/** Finished packs: focus sessions named "Study pack" (the timer is the proof). */
export function packsDone(sessions: { day: string; subject: string; minutes: number }[], from: string, to: string): { count: number; minutes: number } {
  const list = sessions.filter((s) => s.day >= from && s.day <= to && s.subject.toLowerCase().startsWith(PACK_SUBJECT.toLowerCase()))
  return { count: list.length, minutes: list.reduce((t, s) => t + s.minutes, 0) }
}

/** The island's Study page (snapshot): the pack for now, and one quick flashcard. */
export interface IslandStudy {
  /** Inside tonight's work window right now. */
  shift: boolean
  pack: Pack
  card: { id: string; front: string; back: string; deck: string; left: number; ivls: Record<'again' | 'hard' | 'good' | 'easy', string> } | null
  due: number
  /** Packs finished this week (focus sessions named Study pack). */
  packsWeek: number
}

export function cleanQueue(raw: unknown): QueueItem[] {
  const kinds: QueueKind[] = ['ctf', 'reading', 'other']
  return (Array.isArray(raw) ? raw : [])
    .filter((q: any) => q && typeof q.id === 'string' && typeof q.text === 'string' && kinds.includes(q.kind))
    .map((q: any) => ({ id: q.id.slice(0, 40), kind: q.kind, text: q.text.slice(0, 160), link: typeof q.link === 'string' && /^https?:\/\//i.test(q.link) ? q.link.slice(0, 300) : null, done: q.done === true, added: /^\d{4}-\d{2}-\d{2}$/.test(q.added) ? q.added : '2026-01-01' }))
    .slice(0, 200)
}
