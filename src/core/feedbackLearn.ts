// QA2: 👍 / 👎 on Ben's answers, with an optional reason, and what Ben learns
// from the pattern (pure, tested). "Too long" three times in two weeks becomes
// a standing rule in his prompt ("keep answers short"); the weekly list shows
// what he got wrong, so you can see it too.

export type FeedbackKind = 'up' | 'down' | 'long' | 'wrong'
/** Why a 👎 (optional). */
export type FeedbackReason = 'wrong' | 'long' | 'notdone' | 'tone' | 'other'

export interface FeedbackItem {
  at: string
  kind: FeedbackKind
  text: string
  reason?: FeedbackReason
  /** Your own words, when you add them (at most 140 characters). */
  note?: string
}

export const REASONS: { id: FeedbackReason; label: string }[] = [
  { id: 'wrong', label: 'Wrong' },
  { id: 'long', label: 'Too long' },
  { id: 'notdone', label: "Didn't do it" },
  { id: 'tone', label: 'Wrong tone' },
  { id: 'other', label: 'Something else' }
]

/** The reason a rating stands for (old ratings had the reason as their kind). */
export function reasonOf(f: FeedbackItem): FeedbackReason | null {
  if (f.reason) return f.reason
  if (f.kind === 'long') return 'long'
  if (f.kind === 'wrong') return 'wrong'
  return null
}

const RULES: Record<FeedbackReason, string> = {
  long: 'Keep answers short: 1–3 sentences unless he asks for more.',
  wrong: 'Check facts against his data before you state them; say "I don\'t know" rather than guess.',
  notdone: 'When he asks you to do something, do it with an action, then confirm in one line. Never only describe it.',
  tone: 'Match his mood: less lecturing, more plain help.',
  other: ''
}

/** Standing rules learned from 2+ of the same reason in the last 14 days (newest pattern first). */
export function learnedRules(list: FeedbackItem[], now = new Date(), min = 2): string[] {
  const since = now.getTime() - 14 * 86400000
  const counts = new Map<FeedbackReason, { n: number; last: string }>()
  for (const f of list) {
    if (Date.parse(f.at) < since || f.kind === 'up') continue
    const r = reasonOf(f)
    if (!r || !RULES[r]) continue
    const c = counts.get(r) ?? { n: 0, last: '' }
    counts.set(r, { n: c.n + 1, last: f.at > c.last ? f.at : c.last })
  }
  // A 👍 on a short answer after "too long" ratings means it worked: the rule stays.
  return [...counts.entries()]
    .filter(([, c]) => c.n >= min)
    .sort((a, b) => b[1].last.localeCompare(a[1].last))
    .map(([r, c]) => `${RULES[r]} (he marked ${c.n} answers "${REASONS.find((x) => x.id === r)!.label.toLowerCase()}" in 2 weeks)`)
}

/** The prompt block: learned rules first, then the latest misses as examples. */
export function feedbackPrompt(list: FeedbackItem[], now = new Date()): string {
  const rules = learnedRules(list, now)
  const recent = list.filter((f) => Date.parse(f.at) > now.getTime() - 14 * 86400000)
  if (!recent.length) return ''
  const n = (k: FeedbackKind) => recent.filter((f) => f.kind === k).length
  const bad = recent.filter((f) => f.kind !== 'up').slice(-4)
  return [
    rules.length ? `Learned from his ratings (follow these):\n${rules.map((r) => `- ${r}`).join('\n')}` : '',
    `His ratings of your replies (14 days): 👍 ${n('up')}, 👎 ${recent.length - n('up')}.`,
    ...bad.map((f) => `- he marked "${REASONS.find((x) => x.id === reasonOf(f))?.label.toLowerCase() ?? 'bad'}"${f.note ? ` (${f.note})` : ''}: "${f.text.replace(/\s+/g, ' ').slice(0, 120)}"`)
  ]
    .filter(Boolean)
    .join('\n')
}

export interface WeekMiss {
  at: string
  reason: string
  text: string
  note?: string
}

/** "What Ben got wrong this week": the 👎s of the last 7 days, newest first, and a count per reason. */
export function weeklyMisses(list: FeedbackItem[], now = new Date()): { misses: WeekMiss[]; byReason: { label: string; n: number }[]; ups: number } {
  const since = now.getTime() - 7 * 86400000
  const week = list.filter((f) => Date.parse(f.at) >= since)
  const bad = week.filter((f) => f.kind !== 'up')
  const by = new Map<string, number>()
  for (const f of bad) {
    const label = REASONS.find((x) => x.id === reasonOf(f))?.label ?? 'Not helpful'
    by.set(label, (by.get(label) ?? 0) + 1)
  }
  return {
    misses: bad
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 8)
      .map((f) => ({ at: f.at, reason: REASONS.find((x) => x.id === reasonOf(f))?.label ?? 'Not helpful', text: f.text.replace(/\s+/g, ' ').slice(0, 140), ...(f.note ? { note: f.note } : {}) })),
    byReason: [...by.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
    ups: week.length - bad.length
  }
}

/** A saved rating made safe. */
export function cleanFeedback(x: any): FeedbackItem | null {
  if (!x || typeof x !== 'object' || Number.isNaN(Date.parse(String(x.at)))) return null
  const kind: FeedbackKind = ['up', 'down', 'long', 'wrong'].includes(x.kind) ? x.kind : 'down'
  const reason = REASONS.some((r) => r.id === x.reason) ? (x.reason as FeedbackReason) : undefined
  const note = typeof x.note === 'string' && x.note.trim() ? x.note.trim().slice(0, 140) : undefined
  return { at: String(x.at), kind, text: String(x.text ?? '').slice(0, 300), ...(reason ? { reason } : {}), ...(note ? { note } : {}) }
}
