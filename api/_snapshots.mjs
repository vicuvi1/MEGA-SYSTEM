// The daily cloud backups (cloud_snapshots, 30 kept) outside the page's reach
// (LT1). Pages may only READ them through /api/db (_sqlguard.mjs); the app's
// daily backup is added here, and the weekly off-site copy (GitHub Actions,
// .github/workflows/backup.yml) downloads the newest one with CRON_SECRET.
import { gzipSync } from 'node:zlib'
import { run } from './_lib.mjs'

export const SNAPSHOTS_TABLE = 'CREATE TABLE IF NOT EXISTS cloud_snapshots (day TEXT PRIMARY KEY, exported_at TEXT, size_bytes INTEGER, data TEXT)'
/** What one request may carry (Vercel takes 4.5 MB). */
const MAX = 4_200_000
const DAY_MS = 86400_000
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10)

/** Why a backup from the app is refused, or null. `day` must be today (± 1 day for time zones). */
export function snapshotProblem(snap, now = Date.now()) {
  if (!snap || typeof snap !== 'object') return 'Expected {snapshot: {day, data}}'
  const { day, data } = snap
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'Bad day'
  if (day < isoDay(now - DAY_MS) || day > isoDay(now + DAY_MS)) return 'A backup can only be saved for today'
  if (typeof data !== 'string' || !data) return 'Empty backup'
  if (data.length > MAX) return 'This backup is too big to save in the cloud'
  if (!(data.startsWith('gz:') ? /^[A-Za-z0-9+/=]+$/.test(data.slice(3, 4096)) : data.trimStart().startsWith('{'))) return 'Not a backup'
  return null
}

/** Adds today's backup when there is none yet (never overwrites one) and drops those older than 30 days. */
export async function saveSnapshot(cfg, snap, now = Date.now(), fetchImpl = fetch) {
  const problem = snapshotProblem(snap, now)
  if (problem) return { status: 400, body: { error: problem } }
  try {
    const [, ins] = await run(
      cfg,
      [
        [SNAPSHOTS_TABLE],
        ['INSERT INTO cloud_snapshots (day, exported_at, size_bytes, data) VALUES (?, ?, ?, ?) ON CONFLICT(day) DO NOTHING RETURNING day', [snap.day, new Date(now).toISOString(), Buffer.byteLength(snap.data), snap.data]],
        ['DELETE FROM cloud_snapshots WHERE day < ?', [isoDay(now - 31 * DAY_MS)]]
      ],
      fetchImpl
    )
    return { status: 200, body: { ok: true, saved: ins.length > 0 } }
  } catch (e) {
    return { status: 503, body: { error: e.message || 'Database not reachable' } }
  }
}

/** The newest backup as gzip bytes (what the off-site copy stores), or null when there is none. */
export async function newestSnapshot(cfg, fetchImpl = fetch) {
  const [, rows] = await run(cfg, [[SNAPSHOTS_TABLE], ['SELECT day, data FROM cloud_snapshots ORDER BY day DESC LIMIT 1']], fetchImpl)
  if (!rows.length) return null
  const [day, data] = rows[0]
  const raw = String(data ?? '')
  return { day: String(day), gz: raw.startsWith('gz:') ? Buffer.from(raw.slice(3), 'base64') : gzipSync(Buffer.from(raw, 'utf8')) }
}
