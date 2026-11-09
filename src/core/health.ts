// Is the system healthy? Each part leaves a "beat" (last OK, last error);
// this turns them into checks, decides when Ben warns you (broken 30+ min)
// and when he says it's fixed, and writes the weekly report. Pure and tested.

import { DESKTOP_ALERT_HELP } from './desktopUpdates'

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
  /** GitHub (or another outside part) did not answer: shown as unknown, never as broken. */
  unknown?: boolean
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
export function aiFailureCounts(e: { message?: string; timeUp?: boolean; skipped?: boolean } | null | undefined, opts: { thinkMs?: number; noFallback?: boolean } | undefined, startedAt: number, lastOkAt: number): boolean {
  if (lastOkAt >= startedAt) return false
  // No call was made at all: earlier steps of the same tick used up its time (api/ai.mjs slot()).
  if (e?.skipped) return false
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
    out.push({ id: 'timer', label: "Ben's timer", ok: !late, detail: late ? `Last ran ${ago(now, timer)} (should be every 10 min)` :`Last ran ${ago(now, timer)}`, ...(late ? { since: new Date(Date.parse(timer) + 30 * 60000).toISOString() } : {}) })
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
  // Desktop updates: is the Windows release build still working? (note:desktopupdates, refreshed hourly by the server)
  const du = i.notes?.desktopupdates
  if (du && typeof du === 'object') {
    const built = du.version ? `Latest release ${du.version}${du.builtAt ? `, built ${ago(now, du.builtAt)}` : ''}` : 'No release found yet'
    if (!du.okAt) out.push({ id: 'desktop', label: 'Desktop updates', ok: true, unknown: true, detail: 'Unknown (GitHub did not answer yet)' })
    else if (du.broken) out.push({ id: 'desktop', label: 'Desktop updates', ok: false, detail: `Not being built: the last ${du.failed} Windows release runs failed. ${built}${du.runUrl ? `. ${du.runUrl}` : ''}`, since: du.brokenSince ?? du.okAt })
    else out.push({ id: 'desktop', label: 'Desktop updates', ok: true, detail: built })
  }
  // CL3: the daily self-check: when it last ran, and what it found (problems, and parts Ben warned about).
  const sc = i.notes?.selfcheck
  if (sc && typeof sc.at === 'string') {
    const stale = now.getTime() - Date.parse(sc.at) > 26 * 3600_000
    out.push({ id: 'selfcheck', label: 'Daily self-check', ok: !stale, detail: stale ? `Has not run since ${ago(now, sc.at)}` : String(sc.line ?? `Ran ${ago(now, sc.at)}`), ...(stale ? { since: new Date(Date.parse(sc.at) + 26 * 3600_000).toISOString() } : {}) })
    const alerted = i.notes?.alerted ?? {}
    const warnedAbout = (id: string) => {
      const v = alerted[alertKey(id)] ?? alerted[id]
      return typeof v === 'string' || !!v?.on
    }
    // The server, the timer and the AI have live checks, fresher than this morning's answer:
    // a stale "sc:timer" must not keep the timer broken all day after it is fixed.
    const live = new Set(out.filter((c) => ['tick', 'timer', 'ai'].includes(c.id) && c.detail !== 'Not used yet').map((c) => c.id))
    for (const c of Array.isArray(sc.checks) ? (sc.checks as Check[]) : []) if (c && typeof c.id === 'string' && !live.has(alertKey(c.id)) && (!c.ok || warnedAbout(c.id))) out.push(c)
  }
  const day = i.errors.filter((e) => now.getTime() - Date.parse(e.at) < 86400000)

  out.push({ id: 'errors', label: 'Errors (24 h)', ok: day.length < 20, detail: day.length ? `${day.length} in the last 24 h, last: ${day[day.length - 1].msg.slice(0, 100)}` : 'None', ...(day.length >= 20 ? { since: day[day.length - 20].at } : {}) })
  return out
}

/** What Ben remembers about one kind of problem (sys_health note "alerted"). */
export interface AlertState {
  /** When he last warned. */
  at: string
  /** The local day he last warned (YYYY-MM-DD): at most one warning a day per kind. */
  day: string
  /** He warned and hasn't said "working again" yet. */
  on: boolean
  /** OK since (ISO): "working again" only after it stays OK for ALERT_STEADY_MS. */
  okSince?: string
}
/** Older notes kept only the time of the warning (a string). */
export type Alerted = Record<string, AlertState | string>
/** "Working again" waits until a part has worked this long (a timer that ran once is not fixed). */
export const ALERT_STEADY_MS = 60 * 60000
/** "Mute this for 7 days" (the button under a warning). */
export const MUTE_DAYS = 7
/** Settings key (synced, not secret): kind → muted until (ISO). */
export const HEALTH_MUTES = 'health_mutes'
/** Problems Ben tells you about: broken this long. */
const ALERT_AFTER_MS = 30 * 60000

/**
 * One kind of problem, whoever found it: the 30-minute checks ("ai") and the daily
 * self-check ("sc:ai") are the same problem, so they share one warning a day.
 */
export function alertKey(id: string): string {
  const k = id.replace(/^sc:/, '')
  if (k.startsWith('bot:')) return 'telegram'
  return ({ google: 'calendar', drill: 'restoreDrill' } as Record<string, string>)[k] ?? k
}

const stateOf = (v: AlertState | string | undefined): AlertState | undefined => (typeof v === 'string' ? { at: v, day: v.slice(0, 10), on: true } : v)

/** A kind muted until a time still in the future. */
export const muted = (mutes: Record<string, string> | null | undefined, key: string, now: Date): boolean => !!mutes?.[key] && Date.parse(mutes[key]) > now.getTime()

const brokenLong = (c: Check, now: Date) => !c.ok && !!c.since && now.getTime() - Date.parse(c.since) >= ALERT_AFTER_MS

/**
 * What Ben says now. A kind of problem broken 30+ minutes is told at most ONCE A
 * DAY (a new local day may remind you once if it is still broken), never while
 * muted. "Working again" comes only for a kind he warned about, and only once it
 * has stayed OK for an hour (a timer that runs every few hours doesn't flap
 * "broken / fixed / broken"). Checks of the same kind are one line.
 * `next` is the new "alerted" note.
 */
export function alertDecisions(checks: Check[], alerted: Alerted, now: Date, opts: { today?: string; mutes?: Record<string, string> | null } = {}): { warn: Check[]; fixed: Check[]; next: Record<string, AlertState> } {
  const today = opts.today ?? now.toISOString().slice(0, 10)
  const next: Record<string, AlertState> = {}
  for (const [k, v] of Object.entries(alerted ?? {})) {
    const st = stateOf(v)
    // Settled entries matter only on the day of their warning.
    if (st && (st.on || st.day === today)) next[alertKey(k)] = st
  }
  const groups = new Map<string, Check[]>()
  for (const c of checks) groups.set(alertKey(c.id), [...(groups.get(alertKey(c.id)) ?? []), c])
  const warn: Check[] = []
  const fixed: Check[] = []
  for (const [key, list] of groups) {
    const st = next[key]
    if (list.some((c) => !c.ok)) {
      if (st?.okSince) {
        const { okSince: _drop, ...rest } = st
        next[key] = rest
      }
      const broken = list.filter((c) => brokenLong(c, now))
      if (!broken.length || muted(opts.mutes, key, now) || st?.day === today) continue
      warn.push({ ...broken[0], id: key })
      next[key] = { at: now.toISOString(), day: today, on: true }
    } else if (st?.on) {
      const okSince = st.okSince ?? now.toISOString()
      if (now.getTime() - Date.parse(okSince) >= ALERT_STEADY_MS) {
        fixed.push({ ...list[0], id: key })
        next[key] = { at: st.at, day: st.day, on: false }
      } else next[key] = { ...st, okSince }
    }
  }
  return { warn, fixed, next }
}

/** The kinds broken 30+ minutes and not muted (the tick answers health:false for these, so the GitHub run fails). */
export function brokenKinds(checks: Check[], now: Date, mutes?: Record<string, string> | null): string[] {
  const out = new Set<string>()
  for (const c of checks) if (brokenLong(c, now) && !muted(mutes, alertKey(c.id), now)) out.add(alertKey(c.id))
  return [...out]
}

/** The address an outside pinger calls (the public app URL, never a secret). */
export const DEFAULT_APP_URL = 'https://mega-system-ten.vercel.app'

/** What to do, in plain words, per kind (header NAMES only, never a secret value). */
export function alertHelp(key: string, appUrl: string = DEFAULT_APP_URL): string | null {
  switch (key) {
    case 'timer':
    case 'tick':
      return `Set up a second pinger (3 steps): 1) make a free account at cron-job.org (or UptimeRobot); 2) add a job that opens ${appUrl.replace(/\/+$/, '')}/api/cron?job=tick every 10 minutes; 3) give it two headers: <code>Authorization</code> = <code>Bearer</code> + your CRON_SECRET (copy it from Vercel → Settings → Environment Variables) and <code>X-Life-Timer</code> = <code>pinger</code>. GitHub runs its timer only every few hours, so it can't do this alone.`
    case 'ai':
      return 'Usually nothing: Ben answers with the quick model meanwhile. If it lasts a day, check your OpenRouter credits and openrouter.ai/status.'
    case 'telegram':
      return 'Settings → System health shows the bot links; the daily check sets a wrong link again by itself.'
    case 'calendar':
      return 'Settings → Google Calendar → connect again.'
    case 'todoist':
      return 'Copy a fresh token from Todoist → Settings → Integrations → Developer into TODOIST_TOKEN in Vercel.'
    case 'snapshot':
      return 'Ben makes it on his next run; to be safe, download a backup in Settings → Data.'
    case 'desktop':
      return DESKTOP_ALERT_HELP
    case 'budget':
      return 'Raise the budget in Settings → Ben → Brain, or let Ben use cheaper answers.'
    default:
      return null
  }
}

/** The lines to show: the server line folds into the timer's (the same fix). */
function shownWarnings(warn: Check[]): Check[] {
  const keys = new Set(warn.map((c) => alertKey(c.id)))
  return warn.filter((c) => !(alertKey(c.id) === 'tick' && keys.has('timer')))
}

/** "Desktop updates are not being built: the last N Windows release runs failed. The app on your PC can't update until it's fixed." + the run link. */
function desktopAlertDetail(detail: string): string {
  const n = detail.match(/last (\d+) Windows/)?.[1] ?? '2'
  const link = detail.match(/https:\/\/\S+/)?.[0]
  return `Desktop updates are not being built: the last ${n} Windows release runs failed. The app on your PC can't update until it's fixed${link ? `. Run: ${link}` : ''}`
}

/** One message for everything broken at once, each with what to do. */
export function alertText(warn: Check[], fixed: Check[], opts: { appUrl?: string } = {}): string {
  const lines: string[] = []
  const keys = new Set(warn.map((c) => alertKey(c.id)))
  const shown = shownWarnings(warn)
  if (shown.length) {
    const items = shown.map((c) => {
      const k = alertKey(c.id)
      const extra = k === 'timer' && keys.has('tick') ? " Ben's server stops too while nothing wakes it." : ''
      const help = alertHelp(k, opts.appUrl)
      const detail = k === 'desktop' ? desktopAlertDetail(c.detail) : c.detail.replace(/[.\s]+$/, '')
      return `• <b>${c.label}</b>: ${detail}.${extra}${help ? `\n  What to do: ${help}` : ''}`
    })
    lines.push(`🔧 <b>Something needs a look</b>\n${items.join('\n')}\nYou'll hear about each problem at most once a day. Settings → System health has the details.`)
  }
  if (fixed.length) lines.push(`✅ Working again: ${fixed.map((c) => c.label).join(', ')}.`)
  return lines.join('\n\n')
}

/** "Mute this for 7 days" under a warning: one button per kind (callback hm|<kind>). */
export function alertKeyboard(warn: Check[]): { inline_keyboard: { text: string; callback_data: string }[][] } | undefined {
  const rows = shownWarnings(warn)
    .filter((c) => /^[\w.:-]{1,40}$/.test(alertKey(c.id)))
    .slice(0, 5)
    .map((c) => [{ text: `🔕 Mute "${c.label}" for ${MUTE_DAYS} days`.slice(0, 60), callback_data: `hm|${alertKey(c.id)}` }])
  return rows.length ? { inline_keyboard: rows } : undefined
}

/** The mutes after a tap on "Mute … for 7 days" (expired ones dropped; the timer's mute covers the server line too). */
export function muteKind(mutes: Record<string, string> | null | undefined, key: string, now: Date): Record<string, string> {
  const until = new Date(now.getTime() + MUTE_DAYS * 86400_000).toISOString()
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(mutes ?? {})) if (Date.parse(v) > now.getTime()) out[k] = v
  out[key] = until
  if (key === 'timer') out.tick = until
  return out
}

/** The mutes setting as saved (anything unreadable: none). */
export function readMutes(raw: string | null | undefined): Record<string, string> {
  try {
    const v = JSON.parse(raw || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) as Record<string, string> : {}
  } catch {
    return {}
  }
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
