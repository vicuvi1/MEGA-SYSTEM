// Health beats and the shared error log, in two small tables (sys_health,
// sys_error_log: message, stack, build version, screen) that devices never copy and that don't count as a data change,
// so checking health never slows sync down. Used by the server (Ben's tick)
// and by the apps (website, desktop, island).
import type { Beats, ErrorEntry } from '@core/health'
import type { TursoHttp } from './tursoHttp'

const ENSURE = [
  { sql: 'CREATE TABLE IF NOT EXISTS sys_health (key TEXT PRIMARY KEY, at TEXT NOT NULL, msg TEXT)', args: [] },
  { sql: 'CREATE TABLE IF NOT EXISTS sys_error_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, source TEXT, msg TEXT, stack TEXT, version TEXT, place TEXT)', args: [] }
]
const put = (key: string, at: string, msg: string | null) => ({ sql: 'INSERT INTO sys_health (key, at, msg) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, msg = excluded.msg', args: [key, at, msg] })

const lastOk = new Map<string, number>()

/** A part worked (ok) or failed (with why). Never throws. OKs are written at most every 5 minutes. */
export async function beat(t: TursoHttp, key: string, ok: boolean, msg?: string, now = new Date()): Promise<void> {
  if (ok) {
    if (now.getTime() - (lastOk.get(key) ?? 0) < 5 * 60000) return
    lastOk.set(key, now.getTime())
  } else lastOk.delete(key)
  await t.writeAtomic([...ENSURE, put(`${key}:${ok ? 'ok' : 'err'}`, now.toISOString(), ok ? null : String(msg ?? 'failed').slice(0, 300))] as any).catch(() => {})
}

/** One error for the log: what, where in the code (stack), which build, which screen. */
export interface ErrorReport { at?: string; source: string; msg: string; stack?: string; version?: string; place?: string }

/** Several errors in one write (the apps send them in batches). Last 500 kept. Never throws. */
export async function logErrors(t: TursoHttp, list: ErrorReport[], now = new Date()): Promise<void> {
  const rows = list.filter((e) => e && e.msg).slice(0, 50)
  if (!rows.length) return
  await t
    .writeAtomic([
      ...ENSURE,
      ...rows.map((e) => ({
        sql: 'INSERT INTO sys_error_log (at, source, msg, stack, version, place) VALUES (?, ?, ?, ?, ?, ?)',
        args: [e.at || now.toISOString(), String(e.source || '?').slice(0, 20), String(e.msg).slice(0, 400), e.stack ? String(e.stack).slice(0, 2000) : null, e.version ? String(e.version).slice(0, 40) : null, e.place ? String(e.place).slice(0, 80) : null]
      })),
      { sql: 'DELETE FROM sys_error_log WHERE id <= (SELECT MAX(id) FROM sys_error_log) - 500', args: [] }
    ] as any)
    .catch(() => {})
}

/** One line in the shared error log. Never throws. */
export async function logError(t: TursoHttp, source: string, msg: string, now = new Date()): Promise<void> {
  await logErrors(t, [{ source, msg }], now)
}

/** Small JSON values (Ben's alert state, weekly report date…). */
export async function setNote(t: TursoHttp, key: string, value: unknown): Promise<void> {
  await t.writeAtomic([...ENSURE, put(`note:${key}`, new Date().toISOString(), JSON.stringify(value))] as any).catch(() => {})
}

export async function readHealth(t: TursoHttp): Promise<{ beats: Beats; errors: ErrorEntry[]; notes: Record<string, any>; latestSnapshot: string | null }> {
  const [h, e, s] = await t.readMany([
    { sql: 'SELECT key, at, msg FROM sys_health', args: [] },
    { sql: 'SELECT at, source, msg, stack, version, place FROM sys_error_log ORDER BY id DESC LIMIT 200', args: [] },
    { sql: 'SELECT MAX(day) FROM cloud_snapshots', args: [] }
  ] as any)
  const beats: Beats = {}
  const notes: Record<string, any> = {}
  if (!(h instanceof Error)) {
    for (const [k, at, msg] of h.rows as [string, string, string | null][]) {
      if (String(k).startsWith('note:')) {
        try {
          notes[String(k).slice(5)] = JSON.parse(String(msg))
        } catch {
          /* skip */
        }
        continue
      }
      const [part, kind] = String(k).split(':')
      const b = (beats[part] ??= {})
      if (kind === 'ok') b.ok = String(at)
      else b.err = { at: String(at), msg: String(msg ?? '') }
    }
  }
  const errors: ErrorEntry[] =
    e instanceof Error
      ? []
      : (e.rows as (string | null)[][])
          .map(([at, source, msg, stack, version, place]) => ({ at: String(at), source: String(source), msg: String(msg), ...(stack ? { stack: String(stack) } : {}), ...(version ? { version: String(version) } : {}), ...(place ? { place: String(place) } : {}) }))
          .reverse()
  const latestSnapshot = s instanceof Error ? null : ((s.rows[0]?.[0] as string | null) ?? null)
  return { beats, errors, notes, latestSnapshot }
}
