// The daily self-check (CL3): once a day the server looks at every part that
// can break while nobody watches (the bots' Telegram links, Google, Todoist,
// the AI and its budget, the database, today's backup and its restore drill,
// Ben's timers), fixes what it can (a wrong Telegram link is set again) and
// tells you about the rest once. This file only judges the answers; the
// server (src/server/selfCheck.ts) asks the questions. Pure and tested.
import type { Beats, Check } from './health'

export const SELF_CHECK = {
  /** Telegram: messages waiting for the bot before it counts as stuck. */
  pending: 50,
  /** Telegram: a delivery error newer than this means the link is broken. */
  errorHours: 24,
  /** A plain SELECT slower than this is a slow database. */
  dbSlowMs: 2000,
  /** Today's backup: warn above this size (a server answer may be at most 4.5 MB). */
  snapshotWarnBytes: 3_000_000,
  snapshotMaxBytes: 4_500_000,
  /** The restore drill runs weekly; older than this is a missed drill. */
  drillDays: 8,
  /** Ben's tick and the outside timer should run every 10 minutes. */
  beatMinutes: 30,
  /** Share of the monthly AI budget that earns a warning (CL11). */
  budgetWarn: 0.8
} as const

export interface BotProbe {
  name: string
  /** The bot answered and its link points at this server. */
  ok: boolean
  /** The link was wrong and has just been set again. */
  fixed?: boolean
  error?: string | null
  pending?: number | null
  lastErrorAt?: string | null
  lastError?: string | null
}

export interface Probe {
  ok: boolean
  ms?: number
  error?: string | null
}

export interface SelfCheckInput {
  now: Date
  /** One per server bot (missing: no bots set up). */
  bots?: BotProbe[] | null
  /** null: not connected (nothing to check). */
  google?: Probe | null
  todoist?: Probe | null
  ai?: (Probe & { model?: string | null }) | null
  budget?: { spent: number; budget: number } | null
  db: Probe
  /** Today's cloud backup (calendar day), or null when there is none yet. */
  snapshot: { day: string; bytes: number } | null
  /** When the last restore drill ran (ISO), or null. */
  drillAt: string | null
  beats: Beats
}

const mins = (now: Date, iso: string) => Math.round((now.getTime() - Date.parse(iso)) / 60000)
const agoText = (m: number) => (m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`)
const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`

/**
 * What a bot's Telegram link says (getWebhookInfo): `fix` when it must be set
 * again (pointed elsewhere, missing button presses, or deliveries failing in
 * the last 24 h); `problem` is the plain-English reason.
 */
export function webhookVerdict(info: { url?: string; allowed_updates?: string[]; pending_update_count?: number; last_error_date?: number; last_error_message?: string } | null | undefined, wantUrl: string, now = new Date()): { ok: boolean; fix: boolean; problem: string | null } {
  if (!info) return { ok: false, fix: false, problem: 'Telegram did not answer' }
  if (info.url !== wantUrl) return { ok: false, fix: true, problem: info.url ? 'points somewhere else' : 'has no link to the server' }
  if (!(info.allowed_updates ?? []).includes('callback_query')) return { ok: false, fix: true, problem: 'does not get button presses' }
  const errAt = info.last_error_date ? info.last_error_date * 1000 : 0
  if (errAt && now.getTime() - errAt < SELF_CHECK.errorHours * 3600_000) return { ok: false, fix: true, problem: `deliveries failed: ${String(info.last_error_message ?? 'error').slice(0, 80)}` }
  if ((info.pending_update_count ?? 0) >= SELF_CHECK.pending) return { ok: false, fix: false, problem: `${info.pending_update_count} messages are waiting` }
  return { ok: true, fix: false, problem: null }
}

/** The day's checks, in the same shape as Settings → System health (ids start with "sc:"). */
export function selfCheckChecks(i: SelfCheckInput): Check[] {
  const { now } = i
  const at = now.toISOString()
  const out: Check[] = []
  const add = (id: string, label: string, ok: boolean, detail: string) => out.push({ id: `sc:${id}`, label, ok, detail, ...(ok ? {} : { since: at }) })

  for (const b of i.bots ?? []) {
    const bits = [b.fixed ? 'its link was wrong and has been set again' : null, b.error, (b.pending ?? 0) >= SELF_CHECK.pending ? `${b.pending} messages waiting` : null].filter(Boolean)
    add(`bot:${b.name}`, `Telegram link (${b.name.replace(/_TOKEN$/, '').toLowerCase()})`, b.ok && !(b.pending && b.pending >= SELF_CHECK.pending), bits.length ? String(bits.join('; ')) : `OK${b.pending ? `, ${b.pending} waiting` : ''}`)
  }
  if (i.google) add('google', 'Google sign-in', i.google.ok, i.google.ok ? `Renews fine${i.google.ms != null ? ` (${i.google.ms} ms)` : ''}` : `Could not renew: ${String(i.google.error ?? 'no answer').slice(0, 120)}`)
  if (i.todoist) add('todoist', 'Todoist key', i.todoist.ok, i.todoist.ok ? 'Works' : `Refused: ${String(i.todoist.error ?? 'no answer').slice(0, 120)}`)
  if (i.ai) add('ai', "Ben's AI", i.ai.ok, i.ai.ok ? `Answers${i.ai.ms != null ? ` in ${(i.ai.ms / 1000).toFixed(1)} s` : ''}${i.ai.model ? ` (${i.ai.model.split('/').pop()})` : ''}` : `No answer: ${String(i.ai.error ?? 'failed').slice(0, 120)}`)
  if (i.budget && i.budget.budget > 0) {
    const share = i.budget.spent / i.budget.budget
    add('budget', 'AI budget', share < SELF_CHECK.budgetWarn, `${Math.round(share * 100)}% of $${i.budget.budget} used this month${share >= SELF_CHECK.budgetWarn ? ': Ben switches to cheaper answers soon. Raise it in Settings → Ben → Brain if you want' : ''}`)
  }
  add('db', 'Database', i.db.ok && (i.db.ms ?? 0) < SELF_CHECK.dbSlowMs, !i.db.ok ? `Not reachable: ${String(i.db.error ?? '').slice(0, 120)}` : `Answers in ${i.db.ms} ms${(i.db.ms ?? 0) >= SELF_CHECK.dbSlowMs ? ' (slow)' : ''}`)
  if (!i.snapshot) add('snapshot', "Today's backup", false, 'Not made yet today')
  else if (i.snapshot.bytes >= SELF_CHECK.snapshotWarnBytes)
    add('snapshot', "Today's backup", false, `${mb(i.snapshot.bytes)}: close to the ${mb(SELF_CHECK.snapshotMaxBytes)} a backup may be. Download a backup in Settings → Data and tell your helper to make backups smaller`)
  else add('snapshot', "Today's backup", true, `Saved (${mb(i.snapshot.bytes)})`)
  if (!i.drillAt) add('drill', 'Restore drill', false, 'Has not run yet')
  else {
    const m = mins(now, i.drillAt)
    add('drill', 'Restore drill', m < SELF_CHECK.drillDays * 1440, `Last ${agoText(m)}`)
  }
  for (const [id, label] of [['tick', "Ben's server"], ['timer', "Ben's timer"]] as const) {
    const ok = i.beats[id]?.ok
    if (!ok) {
      if (id === 'tick') add(id, label, false, 'Has not run')
      continue
    }
    const m = mins(now, ok)
    add(id, label, m < SELF_CHECK.beatMinutes, `Last ran ${agoText(m)}`)
  }
  return out
}

/**
 * The problems to tell you about now, in the shape alertDecisions expects:
 * the self-check already confirmed them, so they count as broken for 30 minutes.
 */
export function confirmed(checks: Check[], now: Date): Check[] {
  const since = new Date(now.getTime() - 31 * 60000).toISOString()
  return checks.map((c) => (c.ok ? c : { ...c, since }))
}

/** One line for Settings → System health. */
export function selfCheckLine(checks: Check[], at: string, fixed: number): string {
  const bad = checks.filter((c) => !c.ok)
  return `${bad.length ? `${bad.length} need${bad.length === 1 ? 's' : ''} a look` : 'All good'}${fixed ? `, ${fixed} fixed by itself` : ''} · ${at.slice(0, 16).replace('T', ' ')} UTC`
}
