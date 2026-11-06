// AI usage page: how much your AI tools used, read from their own log files on
// this PC (only the numbers, never what was said), plus Ben's own AI budget.
// Pure and tested (aiUsage.test.ts).
//
// - Claude Code writes one JSON line per message under
//   ~/.claude/projects/**/*.jsonl; an assistant line carries `message.usage`
//   (input, output, cache write, cache read tokens), `message.model` and a
//   timestamp. The same message can appear in two files (a resumed session),
//   so lines are counted once by message id + request id, like ccusage does.
// - Codex writes ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl; `turn_context`
//   lines name the model and `token_count` events carry running totals and,
//   in newer versions, the real 5-hour limit ("rate_limits.primary").
// - 5-hour blocks (how Claude's limits reset): a block starts at the full hour
//   of its first message and lasts 5 hours; a gap of 5 hours also starts a new
//   one. Without a real limit, the ring compares this block with your busiest
//   block in the days read (or the limit you set).
import { costOf, NO_TOKENS, shortModel, type TokenCounts } from './usagePrices'

export const BLOCK_MS = 5 * 3600_000
const DAY_MS = 864e5

export type UsageTool = 'claude' | 'codex'
export interface UsageEntry { at: number; model: string; t: TokenCounts }

const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0)
const tsOf = (v: unknown) => {
  const t = typeof v === 'number' ? v : Date.parse(String(v ?? ''))
  return Number.isFinite(t) ? t : null
}
export const totalTokens = (t: TokenCounts) => t.input + t.output + t.cacheWrite + t.cacheRead
const add = (a: TokenCounts, b: TokenCounts): TokenCounts => ({ input: a.input + b.input, output: a.output + b.output, cacheWrite: a.cacheWrite + b.cacheWrite, cacheRead: a.cacheRead + b.cacheRead })

/** One Claude Code log line → its usage (and the key that de-duplicates it), or null. Never keeps any text. */
export function parseClaudeLine(line: string): (UsageEntry & { key: string | null }) | null {
  // Cheap check first: most lines are tool results and prompts without usage.
  if (!line || !line.includes('"usage"')) return null
  let j: any
  try {
    j = JSON.parse(line)
  } catch {
    return null
  }
  const m = j?.message
  const u = m?.usage
  if (!u || typeof u !== 'object') return null
  const at = tsOf(j.timestamp)
  if (at == null) return null
  const t: TokenCounts = { input: n(u.input_tokens), output: n(u.output_tokens), cacheWrite: n(u.cache_creation_input_tokens), cacheRead: n(u.cache_read_input_tokens) }
  if (!totalTokens(t)) return null
  const model = typeof m.model === 'string' ? m.model.slice(0, 60) : 'unknown'
  if (model === '<synthetic>') return null
  const key = typeof m.id === 'string' && typeof j.requestId === 'string' ? `${m.id}:${j.requestId}` : typeof m.id === 'string' ? m.id : null
  return { at, model, t, key }
}

/** Codex's real 5-hour (primary) and weekly (secondary) limits, when it reports them. */
export interface CodexLimit { pct: number; windowMin: number; resetsAt: number | null }
export interface CodexState { model: string | null; total: TokenCounts | null; limits: { primary: CodexLimit | null; secondary: CodexLimit | null; at: number } | null }
export const newCodexState = (): CodexState => ({ model: null, total: null, limits: null })

const codexTokens = (u: any): TokenCounts | null => {
  if (!u || typeof u !== 'object') return null
  const cached = n(u.cached_input_tokens)
  // OpenAI counts cached tokens inside input_tokens.
  return { input: Math.max(0, n(u.input_tokens) - cached), output: n(u.output_tokens), cacheWrite: 0, cacheRead: cached }
}
const codexLimit = (v: any, at: number): CodexLimit | null => {
  if (!v || typeof v !== 'object' || !Number.isFinite(Number(v.used_percent))) return null
  const reset = Number.isFinite(Number(v.resets_at)) ? Number(v.resets_at) * (Number(v.resets_at) < 1e12 ? 1000 : 1) : Number.isFinite(Number(v.resets_in_seconds)) ? at + Number(v.resets_in_seconds) * 1000 : null
  return { pct: Math.max(0, Math.min(100, Number(v.used_percent))), windowMin: n(v.window_minutes) || 300, resetsAt: reset }
}

/** One Codex log line (updates `st`: the model, the running total and the limits) → the new usage, or null. */
export function parseCodexLine(line: string, st: CodexState): UsageEntry | null {
  if (!line || !(line.includes('token_count') || line.includes('turn_context'))) return null
  let j: any
  try {
    j = JSON.parse(line)
  } catch {
    return null
  }
  const p = j?.payload
  if (j?.type === 'turn_context' && typeof p?.model === 'string') {
    st.model = p.model.slice(0, 60)
    return null
  }
  if (p?.type !== 'token_count') return null
  const at = tsOf(j.timestamp)
  if (at == null) return null
  if (p.rate_limits) st.limits = { primary: codexLimit(p.rate_limits.primary, at), secondary: codexLimit(p.rate_limits.secondary, at), at }
  const total = codexTokens(p.info?.total_token_usage)
  let t: TokenCounts | null = null
  if (total) {
    // The running total: count only what is new since the last event.
    const prev = st.total ?? NO_TOKENS
    t = { input: Math.max(0, total.input - prev.input), output: Math.max(0, total.output - prev.output), cacheWrite: 0, cacheRead: Math.max(0, total.cacheRead - prev.cacheRead) }
    st.total = total
  } else t = codexTokens(p.info?.last_token_usage)
  if (!t || !totalTokens(t)) return null
  return { at, model: st.model ?? 'gpt-5', t }
}

export interface UsageBlock { start: number; end: number; last: number; tokens: number; cost: number }

/** The 5-hour blocks of these entries (oldest first). */
export function usageBlocks(entries: UsageEntry[]): UsageBlock[] {
  const list = [...entries].sort((a, b) => a.at - b.at)
  const out: UsageBlock[] = []
  let cur: UsageBlock | null = null
  for (const e of list) {
    if (!cur || e.at - cur.start >= BLOCK_MS || e.at - cur.last >= BLOCK_MS) {
      const start = Math.floor(e.at / 3600_000) * 3600_000
      cur = { start, end: start + BLOCK_MS, last: e.at, tokens: 0, cost: 0 }
      out.push(cur)
    }
    cur.last = e.at
    cur.tokens += totalTokens(e.t)
    cur.cost += costOf(e.model, e.t)
  }
  return out
}

/** The block running now (its end is still ahead), or null. */
export function activeBlock(blocks: UsageBlock[], now: number): UsageBlock | null {
  const b = blocks[blocks.length - 1]
  return b && now < b.end && now - b.last < BLOCK_MS ? b : null
}

export interface UsageSum { tokens: number; cost: number }
export interface ModelUse { model: string; label: string; tokens: number; cost: number }
export interface ToolUsage {
  tool: UsageTool | 'ben'
  label: string
  /** The letter inside its ring on the pill. */
  letter: string
  today: UsageSum
  week: UsageSum
  /** Last 7 days, most expensive first. */
  byModel: ModelUse[]
  /** This window used, 0–100, or null when there is nothing to compare with. */
  pct: number | null
  /** What `pct` means: the 5-hour block, or (Ben) the month's budget. */
  window: '5h' | 'month'
  /** One id per window, so an alert fires once per window. */
  windowId: string
  resetsAt: number | null
  /** 'limit': a real limit (Codex reports it, or yours); 'busiest': compared with your busiest block; 'budget': Ben's budget. */
  basis: 'limit' | 'busiest' | 'budget' | 'none'
  block: UsageSum | null
}

const sum = (entries: UsageEntry[], from: number): UsageSum => {
  let tokens = 0
  let cost = 0
  for (const e of entries) {
    if (e.at < from) continue
    tokens += totalTokens(e.t)
    cost += costOf(e.model, e.t)
  }
  return { tokens, cost }
}

/** The start of today in local time, for a given "now". */
export function dayStart(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * One tool's column: today, 7 days, by model and the 5-hour ring.
 * `limit`: your own tokens per 5 hours (0 = compare with the busiest block).
 */
export function toolUsage(tool: UsageTool, entries: UsageEntry[], now: number, o: { limit?: number; codex?: CodexState['limits'] } = {}): ToolUsage {
  const week = entries.filter((e) => e.at >= now - 7 * DAY_MS && e.at <= now + 60_000)
  const byModel = new Map<string, ModelUse>()
  for (const e of week) {
    const label = shortModel(e.model)
    const m = byModel.get(label) ?? { model: e.model, label, tokens: 0, cost: 0 }
    m.tokens += totalTokens(e.t)
    m.cost += costOf(e.model, e.t)
    byModel.set(label, m)
  }
  const blocks = usageBlocks(week)
  const act = activeBlock(blocks, now)
  const past = blocks.filter((b) => b !== act)
  const busiest = past.reduce((mx, b) => Math.max(mx, b.tokens), 0)
  let pct: number | null = null
  let basis: ToolUsage['basis'] = 'none'
  let resetsAt = act?.end ?? null
  let windowId = act ? `5h:${act.start}` : '5h:none'
  const real = tool === 'codex' ? o.codex?.primary : null
  if (real && (real.resetsAt == null || real.resetsAt > now)) {
    pct = real.pct
    basis = 'limit'
    resetsAt = real.resetsAt ?? resetsAt
    if (real.resetsAt) windowId = `5h:${Math.round(real.resetsAt / 60_000)}`
  } else if (o.limit && o.limit > 0) {
    pct = act ? Math.min(100, (act.tokens / o.limit) * 100) : 0
    basis = 'limit'
  } else if (busiest > 0) {
    pct = act ? Math.min(100, (act.tokens / busiest) * 100) : 0
    basis = 'busiest'
  }
  return {
    tool,
    label: tool === 'claude' ? 'Claude Code' : 'Codex',
    letter: tool === 'claude' ? 'C' : 'X',
    today: sum(week, dayStart(now)),
    week: sum(week, now - 7 * DAY_MS),
    byModel: [...byModel.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens).slice(0, 6),
    pct: pct == null ? null : Math.round(pct),
    window: '5h',
    windowId,
    resetsAt,
    basis,
    block: act ? { tokens: act.tokens, cost: act.cost } : null
  }
}

/** Ben's AI, from /api/ai {op:'usage'} (the same numbers Settings → Ben's brain shows). */
export interface BenUsageReport {
  today?: { calls: number; cost: number; tokens: number } | null
  week?: { calls: number; cost: number; tokens: number } | null
  byModel?: { model: string; calls: number; cost: number; tokens: number }[]
  byModelWeek?: { model: string; calls: number; cost: number; tokens: number }[]
  byModelToday?: { model: string; calls: number; cost: number; tokens: number }[]
  budget?: { budget: number; spent: number; tier?: string } | null
}

/** Ben's column: this month's cost against the budget, today and 7 days, by model. */
export function benUsage(r: BenUsageReport | null, now: number): ToolUsage | null {
  if (!r) return null
  const b = r.budget
  const pct = b && b.budget > 0 ? Math.min(100, Math.round((b.spent / b.budget) * 100)) : null
  const d = new Date(now)
  const nextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
  const models = (r.byModelWeek ?? r.byModel ?? []).map((m) => ({ model: m.model, label: shortModel(m.model), tokens: Number(m.tokens) || 0, cost: Number(m.cost) || 0 }))
  return {
    tool: 'ben',
    label: "Ben's AI",
    letter: 'B',
    today: { tokens: Number(r.today?.tokens) || 0, cost: Number(r.today?.cost) || 0 },
    week: { tokens: Number(r.week?.tokens) || 0, cost: Number(r.week?.cost) || 0 },
    byModel: models.sort((a, b) => b.cost - a.cost).slice(0, 6),
    pct,
    window: 'month',
    windowId: `month:${d.getFullYear()}-${d.getMonth() + 1}`,
    resetsAt: nextMonth,
    basis: pct == null ? 'none' : 'budget',
    block: b ? { tokens: 0, cost: b.spent } : null
  }
}

// ---- Alerts: 70% (warning) and 90% (critical), each once per window ----

export interface UsageAlertPrefs { on: boolean; warn: number; crit: number }
export interface UsageNotice { id: string; level: 'warn' | 'crit'; text: string }

/**
 * The notice to show now (at most one), and the updated "already told you"
 * list. Reaching critical first also counts the warning as told.
 */
export function usageAlert(tools: ToolUsage[], told: string[], p: UsageAlertPrefs): { notice: UsageNotice | null; told: string[] } {
  if (!p.on) return { notice: null, told }
  const seen = new Set(told)
  let notice: UsageNotice | null = null
  for (const t of tools) {
    if (t.pct == null || t.basis === 'none') continue
    const level = t.pct >= p.crit ? 'crit' : t.pct >= p.warn ? 'warn' : null
    if (!level) continue
    const k = (l: string) => `${t.tool}|${t.windowId}|${l}`
    if (seen.has(k(level))) continue
    seen.add(k(level))
    if (level === 'crit') seen.add(k('warn'))
    if (!notice || (level === 'crit' && notice.level === 'warn')) {
      const what = t.tool === 'ben' ? "Ben's AI budget" : `${t.label.replace(' Code', '')} 5-hour`
      notice = { id: k(level), level, text: `${what} ${t.pct}% used` }
    }
  }
  return { notice, told: [...seen].slice(-40) }
}

// ---- Small formats ----

/** 1234 → "1.2k", 3_400_000 → "3.4M". */
export function fmtTokens(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '0'
  if (v < 1000) return String(Math.round(v))
  if (v < 1e6) return `${(v / 1e3).toFixed(v < 1e4 ? 1 : 0)}k`
  if (v < 1e9) return `${(v / 1e6).toFixed(v < 1e7 ? 1 : 0)}M`
  return `${(v / 1e9).toFixed(1)}B`
}

export function fmtUsd(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '$0'
  return v < 0.01 ? '<$0.01' : v < 10 ? `$${v.toFixed(2)}` : `$${Math.round(v)}`
}

/** Time until a reset: "2h 14m", "9m", "now". */
export function fmtLeft(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 30_000) return 'now'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.round(h / 24)}d`
}

export { add as addTokens }
