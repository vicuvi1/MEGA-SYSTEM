import type { Change } from './browserDb'
import type { TursoHttp } from './tursoHttp'

export interface PendingWrite { id: string; base: string; version: string; changes: Change[] }
export const encodePending = (write: PendingWrite) => JSON.stringify(write, (_key, value) => value instanceof Uint8Array ? { blob: Array.from(value) } : value)
export const decodePending = (text: string): PendingWrite => JSON.parse(text, (_key, value) => value && Array.isArray(value.blob) ? new Uint8Array(value.blob) : value)

/** A durable operation id makes retries safe after a response is lost. The
 * version check refuses stale SQL, including spending against an old balance. */
export async function sendPending(turso: TursoHttp, write: PendingWrite): Promise<void> {
  const receipt = async () => {
    const [row] = await turso.readMany([{ sql: 'SELECT id FROM desktop_sync_receipts WHERE id = ?', args: [write.id] }])
    return !(row instanceof Error) && row.rows.length > 0
  }
  if (await receipt()) return
  try {
    await turso.writeAtomic([
      { sql: 'CREATE TABLE IF NOT EXISTS desktop_sync_receipts (id TEXT PRIMARY KEY, saved_at TEXT NOT NULL)', args: [] },
      { sql: 'INSERT INTO desktop_sync_receipts (id, saved_at) VALUES (?, ?)', args: [write.id, new Date().toISOString()] },
      { sql: 'CREATE TABLE IF NOT EXISTS desktop_sync_guard (ok INTEGER CHECK (ok = 1))', args: [] },
      { sql: "INSERT INTO desktop_sync_guard (ok) SELECT CASE WHEN COALESCE((SELECT value FROM settings WHERE key = 'data_version'), '') = ? THEN 1 ELSE 0 END", args: [write.base] },
      ...write.changes,
      { sql: "INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [write.version] },
      { sql: 'DELETE FROM desktop_sync_guard', args: [] }
    ])
  } catch (error) {
    // The server may have committed before the network connection broke.
    if (await receipt()) return
    if (String(error).includes('CHECK constraint')) throw new Error('Sync conflict: the server changed while you were offline. Your local changes are kept. Save a backup before resolving this.')
    throw error
  }
}
