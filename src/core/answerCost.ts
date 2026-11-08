// QA4: which model answered and roughly what it cost (pure, tested). The
// server collects the usage rows each answer writes (tokens and cost, the same
// rows as Settings → Ben's brain) and sends a short summary with the reply;
// the chat shows it as one muted line on hover. Also the budget step-down:
// near the budget the cheap model, at the budget basic mode unless you say so.

export interface UsageRow {
  model: string
  kind?: string | null
  prompt?: number | null
  completion?: number | null
  cost?: number | null
}

export interface AnswerMeta {
  /** The model that wrote the reply (the last chat call), short form. */
  model: string
  /** All calls of this answer. */
  calls: number
  tokens: number
  /** USD, null when unknown. */
  cost: number | null
  /** No AI call at all (answered in code). */
  code?: boolean
  /** Coach chat fix: from the tap to the whole answer, and to its first words (ms). */
  ms?: number
  firstMs?: number
  /** The steps in plain English ("Read your sleep log (7 nights)"). */
  steps?: string[]
  /** A short summary of the thinking model's reasoning, when it gave one. */
  reasoning?: string
  tier?: string
}

/** "deepseek/deepseek-v4.1-flash" → "deepseek-v4.1-flash"; "google/gemini-x" → "gemini-x". */
export const shortModel = (id: string) => String(id ?? '').replace(/^[^/]+\//, '').replace(/:.*$/, '') || 'unknown'

/** One answer's usage rows → its summary (null when there were no rows: answered in code). */
export function answerMeta(rows: UsageRow[]): AnswerMeta {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.model)
  if (!list.length) return { model: 'answered in code', calls: 0, tokens: 0, cost: 0, code: true }
  const main = [...list].reverse().find((r) => /^(chat|retry|media|lookup)/.test(String(r.kind ?? 'chat'))) ?? list[list.length - 1]
  const costs = list.map((r) => (typeof r.cost === 'number' && Number.isFinite(r.cost) ? r.cost : null))
  return {
    model: shortModel(main.model),
    calls: list.length,
    tokens: list.reduce((t, r) => t + (Number(r.prompt) || 0) + (Number(r.completion) || 0), 0),
    cost: costs.every((c) => c == null) ? null : costs.reduce<number>((t, c) => t + (c ?? 0), 0)
  }
}

/** "$0.0004", "<$0.0001", "$0.02". */
export function money(usd: number | null): string {
  if (usd == null) return 'cost unknown'
  if (usd === 0) return '$0'
  if (usd < 0.0001) return '<$0.0001'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`
}

/** The muted line under an answer: "deepseek-v4.1-flash · 2 calls · 3.1k tokens · $0.0006". */
export function costLine(m: AnswerMeta | null | undefined): string {
  if (!m) return ''
  const time = typeof m.ms === 'number' && Number.isFinite(m.ms) && m.ms >= 0 ? secs(m.ms) : ''
  if (m.code) return [time, 'Answered from your data · no AI · $0'].filter(Boolean).join(' · ')
  const tk = m.tokens >= 1000 ? `${(m.tokens / 1000).toFixed(1)}k tokens` : `${m.tokens} tokens`
  return [time, m.model, m.calls > 1 ? `${m.calls} calls` : '', m.tokens ? tk : '', money(m.cost)].filter(Boolean).join(' · ')
}

/** "0.4 s", "3.2 s", "12 s", "1 min 5 s". */
export function secs(ms: number): string {
  const s = ms / 1000
  if (s < 10) return `${s.toFixed(1)} s`
  if (s < 60) return `${Math.round(s)} s`
  const m = Math.floor(s / 60)
  const r = Math.round(s - m * 60)
  return r ? `${m} min ${r} s` : `${m} min`
}

export type BudgetMode = 'normal' | 'cheap' | 'basic'

/**
 * What Ben may use now: 'cheap' near the budget (80% used, or well ahead of the
 * month's pace: the server's "save" tier), 'basic' when it's used up (no AI)
 * unless you chose to go over it this time.
 */
export function budgetMode(b: { tier?: string; spent?: number; budget?: number } | null | undefined, override = false): BudgetMode {
  if (!b) return 'normal'
  if (b.tier === 'minimal' || (Number(b.budget) > 0 && Number(b.spent) >= Number(b.budget))) return override ? 'cheap' : 'basic'
  if (b.tier === 'save') return 'cheap'
  return 'normal'
}

/** The bar's fill (0–1) and its words. */
export function budgetBar(b: { spent: number; budget: number } | null | undefined): { fill: number; words: string; level: 'ok' | 'near' | 'over' } {
  if (!b || !(b.budget > 0)) return { fill: 0, words: b ? `${money(b.spent)} this month · no limit` : '', level: 'ok' }
  const fill = Math.min(1, Math.max(0, b.spent / b.budget))
  const level = fill >= 1 ? 'over' : fill >= 0.8 ? 'near' : 'ok'
  return { fill, words: `${money(b.spent)} of ${money(b.budget)} this month (${Math.round(fill * 100)}%)`, level }
}

/** Per-answer meta kept for the chat (synced setting `coach_answer_meta`), newest 200. */
export function keepMeta(all: Record<string, AnswerMeta>, at: string, m: AnswerMeta, max = 200): Record<string, AnswerMeta> {
  const next = { ...(all && typeof all === 'object' ? all : {}), [at]: m }
  const keys = Object.keys(next).sort()
  return keys.length > max ? Object.fromEntries(keys.slice(-max).map((k) => [k, next[k]])) : next
}
