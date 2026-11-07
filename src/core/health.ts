// Is the system healthy? Each part leaves a "beat" (last OK, last error);
// this turns them into checks, decides when Ben warns you (broken 30+ min)
// and when he says it's fixed, and writes the weekly report. Pure and tested.

export interface Beat {
  ok?: string
  err?: { at: string; msg: string }
  /** Failed calls in a row since the last OK, and when the first of them failed (sys_health "<part>:fails"). */
  fails?: { n: number; since: string }
}

/**
 * A part counts as broken only after this many failed calls in a row (a refused
 * key at once). One timed-out AI call followed by silence is a blip, not an
 * outage: before, a single timeout with no call after it turned into
 * "Failing since 34 min ago".
 */
export const FAILS_TO_BREAK = 3
export type Beats = Record<string, Beat>
export interface ErrorEntry { at: string; source: string; msg: string; stack?: string; version?: string; place?: string }

export interface HealthInput {
  now: Date
  beats: Beats
  /** Last time Sporty talked to Life System (null: never connected). */
  sportySeen: string | null
  /** Newest daily cloud snapshot (YYYY-MM-DD) or null. */
  latestSnapshot: string | null
  /** Today, local (YYYY-MM-DD). */
  today: string
  errors: ErrorEntry[]
  /** Small notes the server keeps in sys_health (coldreads:YYYY-MM, schema…). */
  notes?: Record<string, any>
}

/** 1234567 → "1.2M" */
const big = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)))
/** Turso's free plan reads 500M rows a month; warn well before (LT7). */
export const COLD_READS_WARN = 300e6
/** Vercel's free plan answers about a million function calls a month; warn well before (CL2). */
export const API_CALLS_WARN = 700e3

export interface Check {
  id: string
  label: string
  ok: boolean
  /** One line for you. */
  detail: string
  /** Broken since (ISO), for "30+ minutes" alerts. */
  since?: string
}

const ago = (now: Date, iso: string) => {
  const m = Math.round((now.getTime() - Date.parse(iso)) / 60000)
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`
}
const addDaysISO = (day: string, n: number) => {
  const d = new Date(day + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Does a failed AI call count against Ben's AI health? Not when the caller capped it on
 * purpose and retries itself (Ben's chat gives the thinking model `thinkMs` with `noFallback`,
 * then asks the quick model), and not when another call answered after this one started (the
 * chat already moved on; its late timeout is noise). Everything else counts.
 */
export function aiFailureCounts(e: { message?: string; timeUp?: boolean } | null | undefined, opts: { thinkMs?: number; noFallback?: boolean } | undefined, startedAt: number, lastOkAt: number): boolean {
  if (lastOkAt >= startedAt) return false
  const timeout = /abort|timed? ?out|took too long|time is up/i.test(String(e?.message ?? '')) || !!e?.timeUp
  if (timeout && opts?.noFallback && opts?.thinkMs) return false
  return true
}

/** Where to fix a key that was refused (revoked, expired, wrong). */
const KEY_FIX: Record<string, string> = {
  telegram: 'Ben\'s bot token was refused: make a new one in @BotFather (/revoke), then update TELEGRAM_BOT_TOKEN in Vercel',
  ai: 'The AI key was refused or ran out: check OPENROUTER_API_KEY / GEMINI_API_KEY in Vercel',
  calendar: 'Google access was revoked or expired: Settings → Google Calendar → connect again',
  todoist: 'The Todoist key was refused: Todoist → Settings → Integrations → Developer, copy the token into TODOIST_TOKEN in Vercel'
}
const REFUSED = /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid_grant|invalid api key|api key not valid|revoked|expired/i

/** The fix for a refused key, or null when the error is something else. */
export function keyHint(id: string, msg: string): string | null {
  return KEY_FIX[id] && REFUSED.test(msg) ? KEY_FIX[id] : null
}

/**
 * A part that reports OK/errors: broken when its last error is newer than its last OK
 * AND it failed `need` times in a row (a refused key: at once). Fewer failures show as OK
 * with a note, so the card only appears for a real, sustained failure and clears with the next OK.
 */
function okErr(id: string, label: string, b: Beat | undefined, now: Date, never: string, need = FAILS_TO_BREAK): Check | null {
  if (!b || (!b.ok && !b.err)) return { id, label, ok: true, detail: never }
  const errNewer = !!b.err && (!b.ok || b.err.at > b.ok)
  const hint = errNewer ? keyHint(id, b.err!.msg) : null
  const n = Math.max(1, b.fails?.n ?? 1)
  const since = b.fails?.since && (!b.ok || b.fails.since > b.ok) ? b.fails.since : b.err?.at
  if (errNewer && (hint || n >= need)) return { id, label, ok: false, detail: hint ? `${hint}. Since ${ago(now, since!)}: ${b.err!.msg.slice(0, 80)}` : `Failing since ${ago(now, since!)} (${n} failed in a row): ${b.err!.msg.slice(0, 140)}`, since }
  if (errNewer) return { id, label, ok: true, detail: `${b.ok ? `OK, last ${ago(now, b.ok)}; ` : ''}${n === 1 ? 'one call' : `${n} calls`} failed ${ago(now, b.err!.at)} (${b.err!.msg.slice(0, 80)}), not a pattern yet` }
  return { id, label, ok: true, detail: `OK, last ${ago(now, b.ok!)}` }
}

export function healthChecks(i: HealthInput): Check[] {
  const { now, beats } = i
  const out: Check[] = []
  // Ben's server runs every 10 minutes (GitHub wakes it; an open app does too).
  const tick = beats.tick?.ok
  if (!tick) out.push({ id: 'tick', label: "Ben's server", ok: false, detail: 'Has not run yet', since: now.toISOString() })
  else {
    const late = now.getTime() - Date.parse(tick) > 30 * 60000
    out.push({ id: 'tick', label: "Ben's server", ok: !late, detail: late ? `Last ran ${ago(now, tick)} (should be every 10 min)` : `Ran ${ago(now, tick)}`, ...(late ? { since: new Date(Date.parse(tick) + 10 * 60000).toISOString() } : {}) })
  }
  // LT2: the outside timer on its own (an open app also wakes Ben, which hides a dead timer).
  const timer = beats.timer?.ok
  if (timer) {
    const late = now.getTime() - Date.parse(timer) > 30 * 60000
    out.push({ id: 'timer', label: "Ben's timer", ok: !late, detail: late ? `Last ran ${ago(now, timer)}: check the "Coach tick" workflow on GitHub (Actions) or your second pinger` : `Last ran ${ago(now, timer)}`, ...(late ? { since: new Date(Date.parse(timer) + 30 * 60000).toISOString() } : {}) })
  }
  out.push(okErr('telegram', 'Telegram', beats.telegram, now, 'No messages sent yet')!)
  out.push(okErr('ai', "Ben's AI", beats.ai, now, 'Not used yet')!)
  out.push(okErr('calendar', 'Google Calendar', beats.calendar, now, 'Not used yet')!)
  if (beats.todoist) out.push(okErr('todoist', 'Todoist', beats.todoist, now, '')!)
  if (i.sportySeen) {
    const off = now.getTime() - Date.parse(i.sportySeen) > 26 * 3600000
    out.push({ id: 'sporty', label: 'Sporty', ok: !off, detail: off ? `Not heard from since ${ago(now, i.sportySeen)}` : `Seen ${ago(now, i.sportySeen)}`, ...(off ? { since: new Date(Date.parse(i.sportySeen) + 26 * 3600000).toISOString() } : {}) })
  }
  if (i.latestSnapshot) {
    const old = i.latestSnapshot < addDaysISO(i.today, -1)
    out.push({ id: 'snapshot', label: 'Cloud backup', ok: !old, detail: old ? `Newest daily snapshot is from ${i.latestSnapshot}` : `Snapshot ${i.latestSnapshot}`, ...(old ? { since: `${addDaysISO(i.latestSnapshot, 2)}T00:00:00.000Z` } : {}) })
  }
  const pc = beats.desktopBackup?.ok
  if (pc) {
    const old = now.getTime() - Date.parse(pc) > 3 * 86400000
    out.push({ id: 'desktopBackup', label: 'PC / Drive backup', ok: !old, detail: old ? `Last backup file ${ago(now, pc)}` : `Backup file ${ago(now, pc)}`, ...(old ? { since: new Date(Date.parse(pc) + 3 * 86400000).toISOString() } : {}) })
  }
  const drill = beats.restoreDrill
  if (drill?.ok || drill?.err) out.push(okErr('restoreDrill', 'Restore drill', drill, now, '', 1)!)
  // LT7: each cold server start downloads the whole database; this month's total.
  const cold = i.notes?.[`coldreads:${now.toISOString().slice(0, 7)}`]
  if (cold && Number.isFinite(Number(cold.rows))) {
    // CL6: the server's later reloads count too, not only its cold starts.
    const reload = Number(cold.reload) || 0
    const rows = Number(cold.rows) + reload
    out.push({ id: 'coldReads', label: "Database reads by Ben's server", ok: rows < COLD_READS_WARN, detail: `This month: ${big(rows)} rows (${big(Number(cold.rows))} in ${Number(cold.starts) || 0} cold starts${reload ? `, ${big(reload)} in reloads` : ''})${rows >= COLD_READS_WARN ? " (near Turso's monthly free reads)" : ''}` })
  }
  // CL2: every call the server answered this month (counted by the server itself), and the rows it read.
  const month = now.toISOString().slice(0, 7)
  const calls = i.notes?.[`calls:${month}`]
  if (calls && Number(calls.total) > 0) {
    const total = Number(calls.total)
    const hours = Math.max(1, (now.getTime() - Date.parse(`${month}-01T00:00:00Z`)) / 3600_000)
    const top = Object.entries(calls)
      .filter(([k, v]) => !['total', 'rows'].includes(k) && Number(v) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 4)
      .map(([k, v]) => `${k} ${big(Number(v))}`)
    const rows = Number(calls.rows) || 0
    out.push({ id: 'apiCalls', label: 'Server calls', ok: total < API_CALLS_WARN, detail: `This month: ${big(total)} (about ${Math.round(total / hours)} an hour${top.length ? `: ${top.join(', ')}` : ''})${rows ? `, ${big(rows)} database rows read` : ''}${total >= API_CALLS_WARN ? " (near Vercel's free monthly limit)" : ''}` })
  }
  // CL3: the daily self-check: when it last ran, and what it found (problems, and parts Ben warned about).
  const sc = i.notes?.selfcheck
  if (sc && typeof sc.at === 'string') {
    const stale = now.getTime() - Date.parse(sc.at) > 26 * 3600_000
    out.push({ id: 'selfcheck', label: 'Daily self-check', ok: !stale, detail: stale ? `Has not run since ${ago(now, sc.at)}` : String(sc.line ?? `Ran ${ago(now, sc.at)}`), ...(stale ? { since: new Date(Date.parse(sc.at) + 26 * 3600_000).toISOString() } : {}) })
    const alerted = i.notes?.alerted ?? {}
    for (const c of Array.isArray(sc.checks) ? (sc.checks as Check[]) : []) if (c && typeof c.id === 'string' && (!c.ok || alerted[c.id])) out.push(c)
  }
  const day = i.errors.filter((e) => now.getTime() - Date.parse(e.at) < 86400000)

  out.push({ id: 'errors', label: 'Errors (24 h)', ok: day.length < 20, detail: day.length ? `${day.length} in the last 24 h, last: ${day[day.length - 1].msg.slice(0, 100)}` : 'None', ...(day.length >= 20 ? { since: day[day.length - 20].at } : {}) })
  return out
}

/**
 * What Ben says now: parts broken for 30+ minutes he hasn't warned about yet,
 * and parts he warned about that work again. `alerted` = id → when he warned.
 */
export function alertDecisions(checks: Check[], alerted: Record<string, string>, now: Date): { warn: Check[]; fixed: Check[]; next: Record<string, string> } {
  const next = { ...alerted }
  const warn: Check[] = []
  const fixed: Check[] = []
  for (const c of checks) {
    if (!c.ok && c.since && now.getTime() - Date.parse(c.since) >= 30 * 60000 && !alerted[c.id]) {
      warn.push(c)
      next[c.id] = now.toISOString()
    } else if (c.ok && alerted[c.id]) {
      fixed.push(c)
      delete next[c.id]
    }
  }
  return { warn, fixed, next }
}

export function alertText(warn: Check[], fixed: Check[]): string {
  const lines: string[] = []
  if (warn.length) lines.push(`🔧 <b>Something needs a look</b>\n${warn.map((c) => `• ${c.label}: ${c.detail}`).join('\n')}\nSettings → System health has the details.`)
  if (fixed.length) lines.push(`✅ Working again: ${fixed.map((c) => c.label).join(', ')}.`)
  return lines.join('\n\n')
}

export function weeklyReport(checks: Check[], errors: ErrorEntry[], now: Date): string {
  const week = errors.filter((e) => now.getTime() - Date.parse(e.at) < 7 * 86400000)
  const bad = checks.filter((c) => !c.ok)
  const bySource = new Map<string, number>()
  for (const e of week) bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1)
  return [
    `🩺 <b>Weekly system check</b>`,
    bad.length ? `Needs a look: ${bad.map((c) => `${c.label} (${c.detail})`).join('; ')}.` : 'Everything is working.',
    week.length ? `Errors this week: ${week.length} (${[...bySource].map(([s, n]) => `${s} ${n}`).join(', ')}).` : 'No errors this week.',
    checks.filter((c) => ['snapshot', 'desktopBackup', 'restoreDrill'].includes(c.id)).map((c) => `${c.label}: ${c.detail}`).join(' · ')
  ]
    .filter(Boolean)
    .join('\n')
}
