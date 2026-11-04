// Health beats and the shared error log, in two small tables (sys_health,
// sys_errors) that devices never copy and that don't count as a data change,
// so checking health never slows sync down. Used by the server (Ben's tick)
// and by the apps (website, desktop, island).
import type { Beats, ErrorEntry } from '@core/health'
import type { TursoHttp } from './tursoHttp'

const ENSURE = [
  { sql: 'CREATE TABLE IF NOT EXISTS sys_health (key TEXT PRIMARY KEY, at TEXT NOT NULL, msg TEXT)', args: [] },
  { sql: 'CREATE TABLE IF NOT EXISTS sys_errors (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, source TEXT, msg TEXT)', args: [] }
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

/** One line in the shared error log (last 500 kept). Never throws. */
export async function logError(t: TursoHttp, source: string, msg: string, now = new Date()): Promise<void> {
  await t
    .writeAtomic([
      ...ENSURE,
      { sql: 'INSERT INTO sys_errors (at, source, msg) VALUES (?, ?, ?)', args: [now.toISOString(), source.slice(0, 20), String(msg).slice(0, 400)] },
      { sql: 'DELETE FROM sys_errors WHERE id <= (SELECT MAX(id) FROM sys_errors) - 500', args: [] }
    ] as any)
    .catch(() => {})
}

/** Small JSON values (Ben's alert state, weekly report date…). */
export async function setNote(t: TursoHttp, key: string, value: unknown): Promise<void> {
  await t.writeAtomic([...ENSURE, put(`note:${key}`, new Date().toISOString(), JSON.stringify(value))] as any).catch(() => {})
}

export async function readHealth(t: TursoHttp): Promise<{ beats: Beats; errors: ErrorEntry[]; notes: Record<string, any>; latestSnapshot: string | null }> {
  const [h, e, s] = await t.readMany([
    { sql: 'SELECT key, at, msg FROM sys_health', args: [] },
    { sql: 'SELECT at, source, msg FROM sys_errors ORDER BY id DESC LIMIT 200', args: [] },
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
  const errors = e instanceof Error ? [] : (e.rows as [string, string, string][]).map(([at, source, msg]) => ({ at: String(at), source: String(source), msg: String(msg) })).reverse()
  const latestSnapshot = s instanceof Error ? null : ((s.rows[0]?.[0] as string | null) ?? null)
  return { beats, errors, notes, latestSnapshot }
}
