// ME4: Ben remembers past conversations. Pure and tested (benConvo.test.ts).
//
// Two small things are kept (settings key `ben_convo`, synced, never in the
// repo):
// - key points from your messages, found in code: decisions ("I decided…",
//   "from now on…"), struggles ("the essay feels hard", "can't focus") and
//   wins ("finished the lab", "passed"), each with its date (at most 150);
// - a rolling summary of the last weeks built from those points (no model
//   call, at most ~600 characters).
// Ben may mention one briefly when it fits ("Last week the essay felt hard…").
// `searchPoints` is the store the chat search uses.

import { normalize, similarity } from './benNormalize'

export const BEN_CONVO = 'ben_convo'
export const POINTS_MAX = 150
export const SUMMARY_MAX = 600

export type PointKind = 'decision' | 'struggle' | 'win'

export interface ConvoPoint {
  at: string
  day: string
  kind: PointKind
  text: string
  via?: string
}

export interface Convo {
  points: ConvoPoint[]
  summary: string
  /** The day the summary was last rebuilt. */
  summaryDay: string | null
}

export const EMPTY_CONVO: Convo = { points: [], summary: '', summaryDay: null }

export function cleanConvo(raw: unknown): Convo {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<Convo>
  const points = (Array.isArray(o.points) ? o.points : []).filter((p): p is ConvoPoint => !!p && typeof p.text === 'string' && (p.kind === 'decision' || p.kind === 'struggle' || p.kind === 'win') && typeof p.day === 'string')
  return { points: points.slice(-POINTS_MAX), summary: typeof o.summary === 'string' ? o.summary.slice(0, SUMMARY_MAX) : '', summaryDay: typeof o.summaryDay === 'string' ? o.summaryDay : null }
}

const WIN = /\b(i (?:finally )?(?:finished|completed|passed|nailed|shipped|submitted|got|won|did it|made it|hit)|finished the|passed the|got an? (?:a|10|9)|am terminat|am trecut|am luat|am reusit|я (?:сделал|закончил|сдал)|сдал)\b/i
const STRUGGLE = /\b(hard|difficult|struggl\w*|can'?t focus|cannot focus|no motivation|unmotivated|stressed|overwhelmed|stuck|tired of|burn(?:ed|t)? out|procrastinat\w*|e greu|greu|nu ma pot concentra|n-am chef|obosit|stresat|тяжело|трудно|не могу сосредоточиться|устал|нет мотивации)\b/i
const DECISION = /\b(i(?:'ve| have)? decided|from now on|i'?m going to stop|i'?ll stop|i will stop|no more|starting (?:today|tomorrow|monday)|am decis|de acum|я решил|с завтрашнего дня|больше не буду)\b/i

/** The key point in one message of his, or null (most messages have none). */
export function pointOf(text: string): PointKind | null {
  const t = String(text ?? '')
  if (t.length < 8 || t.length > 400 || /^\s*\//.test(t)) return null
  if (DECISION.test(t)) return 'decision'
  if (WIN.test(t)) return 'win'
  if (STRUGGLE.test(t)) return 'struggle'
  return null
}

/** Adds the point in his message (if any), never the same words twice in a day. */
export function addPoint(c: Convo, text: string, day: string, now = new Date(), via?: string): Convo {
  const kind = pointOf(text)
  if (!kind) return c
  const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 160)
  if (c.points.some((p) => p.day === day && normalize(p.text) === normalize(clean))) return c
  return { ...c, points: [...c.points, { at: now.toISOString(), day, kind, text: clean, ...(via ? { via } : {}) }].slice(-POINTS_MAX) }
}

/**
 * LF12: a big moment you shared with Ben (a boss beaten, a season closed),
 * kept as a win with `via: 'moment'` so his arc can bring it up. Never twice.
 */
export function addMoment(c: Convo, text: string, day: string, now = new Date()): Convo {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
  if (!clean || c.points.some((p) => p.via === 'moment' && normalize(p.text) === normalize(clean))) return c
  return { ...c, points: [...c.points, { at: now.toISOString(), day, kind: 'win' as const, text: clean, via: 'moment' }].slice(-POINTS_MAX) }
}

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}

/** The rolling summary from the last 4 weeks of points (newest first within each kind). */
export function rollSummary(c: Convo, today: string): Convo {
  const recent = c.points.filter((p) => p.day >= addDays(today, -28))
  const pick = (k: PointKind, n: number) =>
    recent
      .filter((p) => p.kind === k)
      .slice(-n)
      .reverse()
      .map((p) => `${p.text.slice(0, 70)} (${p.day.slice(5)})`)
  const parts = [pick('decision', 3).length ? `Decided: ${pick('decision', 3).join('; ')}` : '', pick('struggle', 3).length ? `Found hard: ${pick('struggle', 3).join('; ')}` : '', pick('win', 3).length ? `Wins: ${pick('win', 3).join('; ')}` : ''].filter(Boolean)
  return { ...c, summary: parts.join('. ').slice(0, SUMMARY_MAX), summaryDay: today }
}

/** Points about what he wrote now (shared words, typos allowed), newest first. */
export function searchPoints(c: Convo, query: string, k = 5): ConvoPoint[] {
  const q = normalize(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4)
  if (!q.length) return []
  return c.points
    .map((p, i) => ({ p, i, s: q.filter((w) => normalize(p.text).includes(w.slice(0, 5)) || similarity(w, p.text) >= 0.85).length }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.i - a.i)
    .slice(0, k)
    .map((x) => x.p)
}

const ago = (day: string, today: string) => {
  const d = Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`)) / 86400000)
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 7 ? `${d} days ago` : d < 14 ? 'last week' : `${Math.round(d / 7)} weeks ago`
}

/**
 * One or two lines for his prompt: the points that fit this message (with
 * when), else nothing. Kept small on purpose.
 */
export function pastLine(c: Convo, text: string, today: string): string {
  const hits = searchPoints(c, text, 2).filter((p) => p.day < today)
  if (!hits.length) return ''
  return `From past chats (mention briefly only if it helps, e.g. "Last week the essay felt hard…"): ${hits.map((p) => `${ago(p.day, today)} he said (${p.kind}): "${p.text.slice(0, 100)}"`).join('; ')}.`
}
