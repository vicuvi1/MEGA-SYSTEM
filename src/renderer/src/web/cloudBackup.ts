// Saving and reading a cloud backup of any size (2026-11-12): one gzip stream
// cut into parts (core/backupPack.ts), each part one row of
// cloud_snapshot_parts, and the day's cloud_snapshots row holding the manifest.
// Used by Ben's server (straight to Turso), the app (through /api/db, which
// only adds) and the restore. gzip and gunzip are passed in (Node zlib on the
// server, CompressionStream in the app).
import { CHUNK_WARN, PARTS_PREFIX, biggestChunk, fromBase64, joinParts, manifestText, packParts, readManifest, toBase64 } from '@core/backupPack'

export const SNAPSHOTS_SQL = 'CREATE TABLE IF NOT EXISTS cloud_snapshots (day TEXT PRIMARY KEY, exported_at TEXT, size_bytes INTEGER, data TEXT)'
export const PARTS_SQL = 'CREATE TABLE IF NOT EXISTS cloud_snapshot_parts (day TEXT NOT NULL, part INTEGER NOT NULL, size_bytes INTEGER, sha TEXT, data TEXT, PRIMARY KEY (day, part))'
/** Cloud backups kept (days). */
export const CLOUD_KEEP_DAYS = 30

type Gzip = (u8: Uint8Array) => Uint8Array | Promise<Uint8Array>
type Write = (stmts: { sql: string; args: unknown[] }[]) => Promise<unknown>
type Read = (sql: string, args: unknown[]) => Promise<unknown[][]>

export interface SavedBackup {
  day: string
  parts: number
  /** Stored size in all (base64 characters). */
  bytes: number
  /** The biggest single stored chunk (warn at CHUNK_WARN). */
  biggest: number
  warn: boolean
}

const minusDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') - n * 864e5).toISOString().slice(0, 10)

/** The backup's JSON packed into parts and their manifest. */
export async function packBackup(json: string, gzip: Gzip) {
  const gz = await gzip(new TextEncoder().encode(json))
  return packParts(gz, json.length)
}

/**
 * Saves a day's backup straight to Turso (Ben's server, or the app in its
 * direct test mode): each part in its own request, the manifest last (a day
 * that already has a backup is never changed), then backups older than 30 days go.
 */
export async function saveBackupDirect(write: Write, day: string, json: string, gzip: Gzip, now = new Date()): Promise<SavedBackup> {
  const { manifest, parts } = await packBackup(json, gzip)
  await write([{ sql: SNAPSHOTS_SQL, args: [] }, { sql: PARTS_SQL, args: [] }])
  for (let i = 0; i < parts.length; i++)
    await write([
      {
        sql: 'INSERT INTO cloud_snapshot_parts (day, part, size_bytes, sha, data) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM cloud_snapshots WHERE day = ?) ON CONFLICT(day, part) DO UPDATE SET size_bytes = excluded.size_bytes, sha = excluded.sha, data = excluded.data',
        args: [day, i, parts[i].length, manifest.shas[i], parts[i], day]
      }
    ])
  const bytes = parts.reduce((n, p) => n + p.length, 0)
  const cut = minusDays(day, CLOUD_KEEP_DAYS)
  await write([
    { sql: 'INSERT INTO cloud_snapshots (day, exported_at, size_bytes, data) VALUES (?, ?, ?, ?) ON CONFLICT(day) DO NOTHING', args: [day, now.toISOString(), bytes, manifestText(manifest)] },
    { sql: 'DELETE FROM cloud_snapshots WHERE day < ?', args: [cut] },
    { sql: 'DELETE FROM cloud_snapshot_parts WHERE day < ?', args: [cut] }
  ])
  const biggest = Math.max(...manifest.sizes)
  return { day, parts: parts.length, bytes, biggest, warn: biggest >= CHUNK_WARN }
}

/**
 * Saves today's backup through /api/db (the app: pages may only read the
 * backups, the server only adds). `post` sends one JSON body and throws on an
 * error answer. Each part is one request; the manifest goes last.
 */
export async function saveBackupViaServer(post: (body: unknown) => Promise<unknown>, day: string, json: string, gzip: Gzip): Promise<SavedBackup> {
  const { manifest, parts } = await packBackup(json, gzip)
  for (let i = 0; i < parts.length; i++) await post({ snapshotPart: { day, part: i, data: parts[i], sha: manifest.shas[i] } })
  await post({ snapshot: { day, data: manifestText(manifest) } })
  const biggest = Math.max(...manifest.sizes)
  return { day, parts: parts.length, bytes: parts.reduce((n, p) => n + p.length, 0), biggest, warn: biggest >= CHUNK_WARN }
}

/**
 * A day's backup as its JSON text: a parts backup is joined and checked
 * (every part's and the whole SHA-256), an old one-piece backup ("gz:" +
 * base64, or plain JSON) is read as before. Parts are read one per request
 * (an answer may be at most 4.5 MB).
 */
export async function readBackup(read: Read, day: string, gunzip: Gzip): Promise<string> {
  const rows = await read('SELECT data FROM cloud_snapshots WHERE day = ?', [day])
  if (!rows.length) throw new Error(`No cloud backup of ${day}`)
  const data = String(rows[0][0] ?? '')
  if (data.startsWith(PARTS_PREFIX)) {
    const m = readManifest(data)
    if (!m) throw new Error(`The ${day} backup's list of parts is broken`)
    const parts: (string | null)[] = []
    for (let i = 0; i < m.parts; i++) {
      const p = await read('SELECT data FROM cloud_snapshot_parts WHERE day = ? AND part = ?', [day, i])
      parts.push(p.length ? String(p[0][0]) : null)
    }
    return new TextDecoder().decode(await gunzip(await joinParts(m, parts)))
  }
  if (data.startsWith('gz:')) return new TextDecoder().decode(await gunzip(fromBase64(data.slice(3))))
  return data
}

/** How big a stored backup is: its biggest single chunk (for the warning), from its row's data. */
export const chunkOf = (data: string) => biggestChunk(data)

export { toBase64 }
