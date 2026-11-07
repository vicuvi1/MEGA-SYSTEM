// Identity votes (LF6): 3–5 "I am someone who…" lines. Every habit, task or
// session you really log is a vote for the lines it fits, shown as a bar
// that fills through the week and a short line like "14 votes this week for:
// I keep my word". Votes come only from the honest ledger (what paid points
// because it happened) and from wins you wrote down: confidence from proof,
// not hype. Pure; the lines live in the synced setting `saga_identity`.
import { addDays } from './dates'
import { effective, type LedgerEntry } from './ledger'
import { mondayOf } from './season'

export type VoteKind = 'focus' | 'body' | 'sleep' | 'discipline' | 'tasks' | 'habits' | 'money' | 'goals' | 'kind'

export const VOTE_KINDS: { id: VoteKind; label: string; icon: string; hint: string }[] = [
  { id: 'focus', label: 'Focus & study', icon: '🎯', hint: 'focus sessions and study blocks' },
  { id: 'body', label: 'Training', icon: '💪', hint: 'workouts, move breaks, healthy days' },
  { id: 'sleep', label: 'Sleep', icon: '🌙', hint: 'up and in bed on time' },
  { id: 'discipline', label: 'Discipline', icon: '🛡️', hint: 'clean days and urges beaten' },
  { id: 'tasks', label: 'Tasks', icon: '✅', hint: 'Todoist tasks and must-dos done' },
  { id: 'habits', label: 'Habits', icon: '🔁', hint: 'your own habits' },
  { id: 'money', label: 'Money', icon: '🪙', hint: 'logged spending, under budget' },
  { id: 'goals', label: 'Goals', icon: '🏔️', hint: 'goal check-ins and milestones' },
  { id: 'kind', label: 'Kind deeds', icon: '🤍', hint: 'kind things you wrote on the wins wall' }
]
const KIND_IDS = VOTE_KINDS.map((k) => k.id)

export interface IdentityLine {
  id: string
  /** "I am a disciplined hacker" (the "I am someone who" is implied). */
  text: string
  emoji: string
  kinds: VoteKind[]
  /** Extra words that count a vote when they appear in what you logged ("CTF", "mom"). */
  words: string[]
  /** Votes a week that fill the bar. */
  target: number
}

export interface IdentityBook {
  lines: IdentityLine[]
}

export const IDENTITY_MAX = 5
export const EMPTY_IDENTITY: IdentityBook = { lines: [] }

/** Starter lines to pick from (you can type your own). */
export const IDENTITY_STARTERS: Omit<IdentityLine, 'id'>[] = [
  { text: 'I am a disciplined hacker', emoji: '🗡️', kinds: ['focus'], words: ['ctf', 'hack', 'rust', 'crypto'], target: 12 },
  { text: 'I keep my word', emoji: '🤝', kinds: ['tasks', 'habits'], words: [], target: 20 },
  { text: 'I am someone who trains', emoji: '💪', kinds: ['body'], words: [], target: 6 },
  { text: 'I am a son who shows up', emoji: '🏠', kinds: ['kind'], words: ['mom', 'dad', 'family', 'home'], target: 3 },
  { text: 'I protect my sleep', emoji: '🌙', kinds: ['sleep'], words: [], target: 10 },
  { text: 'I am in control of my money', emoji: '🪙', kinds: ['money'], words: [], target: 7 },
  { text: 'I master my urges', emoji: '🛡️', kinds: ['discipline'], words: [], target: 7 }
]

const str = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

export function cleanIdentity(raw: unknown): IdentityBook {
  const list = Array.isArray((raw as any)?.lines) ? (raw as any).lines : []
  const lines: IdentityLine[] = []
  for (const [i, l] of list.entries()) {
    const text = str(l?.text, 70)
    if (!text) continue
    const kinds = (Array.isArray(l?.kinds) ? l.kinds : []).filter((k: unknown): k is VoteKind => KIND_IDS.includes(k as VoteKind))
    const words = (Array.isArray(l?.words) ? l.words : []).map((w: unknown) => str(w, 24).toLowerCase()).filter((w: string) => w.length >= 2).slice(0, 8)
    const t = Math.round(Number(l?.target))
    lines.push({ id: str(l?.id, 24) || `i${i + 1}`, text, emoji: str(l?.emoji, 8) || '✦', kinds: [...new Set(kinds)] as VoteKind[], words, target: Number.isFinite(t) && t >= 1 && t <= 100 ? t : 10 })
    if (lines.length >= IDENTITY_MAX) break
  }
  return { lines }
}

/** The kinds of vote one ledger row casts (none for spends, penalties and undos). */
export function voteKindsOf(e: Pick<LedgerEntry, 'kind' | 'coins' | 'xp' | 'module' | 'ruleId' | 'ref'>): VoteKind[] {
  if (e.kind !== 'earn' || (e.coins <= 0 && e.xp <= 0)) return []
  const r = e.ruleId ?? ''
  const ref = e.ref ?? ''
  if (ref.startsWith('quest:') || ref.startsWith('chest:')) return []
  const out = new Set<VoteKind>()
  if (/^(study|focus)\./.test(r) || e.module === 'focus' || e.module === 'schedule') out.add('focus')
  if (/^body\./.test(r) || (e.module === 'body' && !r)) out.add('body')
  if (/^sleep\./.test(r)) out.add('sleep')
  if (/^discipline\./.test(r) && r !== 'discipline.reset') out.add('discipline')
  if (r === 'tasks.todoist_done' || ref.startsWith('task:') || ref.startsWith('mustdo:') || /^mustdo/.test(r)) out.add('tasks')
  if (r === 'habit.own' || r === 'face.routine_done') out.add('habits')
  if (/^money\./.test(r)) out.add('money')
  if (/^goal\./.test(r)) out.add('goals')
  return [...out]
}

/** A vote from outside the ledger: a kind deed or other win you wrote down. */
export interface ExtraVote {
  day: string
  kinds: VoteKind[]
  text: string
}

export interface LineVotes {
  id: string
  text: string
  emoji: string
  week: number
  lastWeek: number
  /** The last 4 weeks, oldest first (this week last). */
  weeks: number[]
  total28: number
  target: number
  /** The bar: this week's votes toward the target, 0..1. */
  fill: number
  /** "14 votes this week for: I keep my word". */
  line: string
  trend: 'up' | 'down' | 'same'
}

const matches = (l: IdentityLine, kinds: VoteKind[], text: string): boolean => {
  if (kinds.some((k) => l.kinds.includes(k))) return true
  if (!l.words.length || !text) return false
  const t = text.toLowerCase()
  return l.words.some((w) => t.includes(w))
}

/** Each line's votes: this week (Monday on), last week and the last 4 weeks. */
export function identityVotes(book: IdentityBook, entries: LedgerEntry[], today: string, extra: ExtraVote[] = []): LineVotes[] {
  const mon = mondayOf(today)
  const starts = [addDays(mon, -21), addDays(mon, -14), addDays(mon, -7), mon]
  const from = starts[0]
  const live = effective(entries).filter((e) => e.day >= from && e.day <= today)
  const casts: { day: string; kinds: VoteKind[]; text: string }[] = [
    ...live.map((e) => ({ day: e.day, kinds: voteKindsOf(e), text: `${e.note ?? ''} ${e.ref ?? ''}` })).filter((c) => c.kinds.length || c.text.trim()),
    ...extra.filter((x) => x.day >= from && x.day <= today)
  ]
  return book.lines.map((l) => {
    const weeks = starts.map((s, i) => {
      const end = i < 3 ? addDays(starts[i + 1], -1) : today
      return casts.filter((c) => c.day >= s && c.day <= end && matches(l, c.kinds, c.text)).length
    })
    const week = weeks[3]
    const lastWeek = weeks[2]
    return {
      id: l.id,
      text: l.text,
      emoji: l.emoji,
      week,
      lastWeek,
      weeks,
      total28: weeks.reduce((t, x) => t + x, 0),
      target: l.target,
      fill: Math.min(1, week / Math.max(1, l.target)),
      line: `${week} vote${week === 1 ? '' : 's'} this week for: ${l.text}`,
      trend: week > lastWeek ? 'up' : week < lastWeek ? 'down' : 'same'
    }
  })
}

/** The line with the most proof this week (for praise), or null. */
export function strongestLine(v: LineVotes[]): LineVotes | null {
  return [...v].filter((x) => x.week > 0).sort((a, b) => b.fill - a.fill || b.week - a.week)[0] ?? null
}

/** Ben's line: the votes, and the one he can praise with (never more than the proof). */
export function identityLine(v: LineVotes[]): string {
  if (!v.length) return ''
  const best = strongestLine(v)
  return `Who he's becoming (his identity lines; each real log is a vote): ${v.map((x) => `"${x.text}" ${x.week} this week (last week ${x.lastWeek})`).join('; ')}.${best ? ` When you praise him, praise the identity with the proof, e.g. "${best.week} votes this week for '${best.text}'. That's who you are now."` : ''}`
}
