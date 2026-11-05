// The daily self-check, server side (CL3): asks every part once (the probes
// come from api/cron.mjs, which holds the keys), saves the answers in
// sys_health (note:selfcheck, shown in Settings → System health) and sends
// what is broken to Telegram once (the same "warned about" list as the
// 30-minute alerts, so nothing is said twice). The judging is in
// src/core/selfCheck.ts.
import { alertDecisions, alertText, type Beats, type Check } from '@core/health'
import { confirmed, selfCheckChecks, selfCheckLine, type BotProbe, type Probe } from '@core/selfCheck'
import { calendarDay } from '@core/dates'
import { TursoHttp } from '../renderer/src/web/tursoHttp'
import { readHealth, setNote } from '../renderer/src/web/systemHealth'

export interface SelfCheckDeps {
  tursoUrl: string
  tursoToken: string
  /** Each server bot's Telegram link, fixed when wrong (api/_lib.mjs). */
  webhooks?: () => Promise<BotProbe[]>
  google?: () => Promise<Probe | null>
  todoist?: () => Promise<Probe | null>
  ai?: () => Promise<(Probe & { model?: string | null }) | null>
  budget?: () => Promise<{ spent: number; budget: number } | null>
  /** Sends one message to you (Telegram). */
  send?: (text: string) => Promise<unknown>
  now?: Date
}

/** Runs a probe; a probe that throws counts as a failed check (never stops the rest). */
async function probe<T>(fn: (() => Promise<T>) | undefined, fail: (e: Error) => T): Promise<T | null> {
  if (!fn) return null
  try {
    return await fn()
  } catch (e) {
    return fail(e as Error)
  }
}

/** Times one call (ms). */
export async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now()
  const value = await fn()
  return { value, ms: Date.now() - t0 }
}

export async function runSelfCheck(d: SelfCheckDeps): Promise<{ checks: Check[]; warned: string[] }> {
  const now = d.now ?? new Date()
  const t = new TursoHttp(d.tursoUrl, d.tursoToken)
  const fail = (e: Error): Probe => ({ ok: false, error: e.message })
  const [bots, google, todoist, ai, budget] = await Promise.all([
    probe(d.webhooks, (e) => [{ name: 'BOTS', ok: false, error: e.message }]),
    probe(d.google, fail),
    probe(d.todoist, fail),
    probe(d.ai, fail),
    probe(d.budget, () => null)
  ])
  // The database: a plain SELECT, timed; then today's backup and the health notes.
  let db: Probe
  try {
    const { value, ms } = await timed(() => t.readMany([{ sql: 'SELECT 1', args: [] }]))
    db = value[0] instanceof Error ? { ok: false, error: value[0].message, ms } : { ok: true, ms }
  } catch (e) {
    db = { ok: false, error: (e as Error).message }
  }
  const day = calendarDay(now)
  const [snap] = await t.readMany([{ sql: 'SELECT day, COALESCE(size_bytes, LENGTH(data)) FROM cloud_snapshots WHERE day = ?', args: [day] }]).catch(() => [new Error('no answer')])
  const snapshot = snap instanceof Error || !snap.rows.length ? null : { day: String(snap.rows[0][0]), bytes: Number(snap.rows[0][1]) || 0 }
  const h = await readHealth(t).catch(() => ({ beats: {} as Beats, notes: {} as Record<string, any>, errors: [], latestSnapshot: null }))
  const drillAt = typeof h.notes.drill === 'string' ? h.notes.drill : h.beats.restoreDrill?.ok ?? null
  const checks = selfCheckChecks({ now, bots, google, todoist, ai, budget, db, snapshot, drillAt, beats: h.beats })
  const fixed = (bots ?? []).filter((b) => b.fixed).length
  await setNote(t, 'selfcheck', { at: now.toISOString(), line: selfCheckLine(checks, now.toISOString(), fixed), checks, fixed })
  // Problems once (alertDecisions remembers what was said); "working again" when a part is fixed.
  const dec = alertDecisions(confirmed(checks, now), h.notes.alerted ?? {}, now)
  if ((dec.warn.length || dec.fixed.length) && d.send) {
    await setNote(t, 'alerted', dec.next)
    await d.send(alertText(dec.warn, dec.fixed)).catch(() => null)
  }
  return { checks, warned: dec.warn.map((c) => c.id) }
}

/** One plain message from the server's bot (HTML, like Ben's). */
export async function tgSend(token: string, chatId: string, text: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const r = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000)
  }).catch(() => null)
  return !!r?.ok
}
