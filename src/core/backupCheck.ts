// Checksums of a backup: the row count and a checksum of every table, and the
// size and a checksum of every app blob (Finance, Sport Track, Waky, MAN).
// The restore drill compares a backup with what a restore put back; the same
// digest goes into each local backup file's manifest so a file can be checked
// without the app. Pure and synchronous (works in the app, the server and the
// desktop main process). Not a security hash: it finds lost or changed data.

/** 53-bit string hash (cyrb53). */
export function hash53(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** A value as stable text: object keys sorted, bytes as numbers, numbers that are whole printed whole. */
export function canonical(v: unknown): string {
  if (v === undefined || v === null) return 'null'
  if (v instanceof Uint8Array) return `b[${Array.from(v).join(',')}]`
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`
  }
  if (typeof v === 'bigint') return v.toString()
  return JSON.stringify(v)
}

export interface TableDigest {
  rows: number
  sum: string
}

/**
 * A table's digest: its row count and a checksum of its rows in any order.
 * `cols` limits it to these columns (a restore only puts back columns the
 * database still has).
 */
export function tableDigest(rows: Record<string, unknown>[], cols?: string[]): TableDigest {
  const keep = cols ? new Set(cols) : null
  const lines = rows.map((r) => {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r ?? {})) if (!keep || keep.has(k)) o[k] = v
    return canonical(o)
  })
  lines.sort()
  return { rows: rows.length, sum: hash53(lines.join('\n')) }
}

export interface BlobDigest {
  size: number
  sum: string
}

export const blobDigest = (v: unknown): BlobDigest => {
  const text = canonical(v)
  return { size: text.length, sum: hash53(text) }
}

export interface BackupDigest {
  tables: Record<string, TableDigest>
  blobs: Record<string, BlobDigest>
}

/** The digest of a whole backup: every table, and every app blob field in `blobFields` that it holds. */
export function backupDigest(snap: { tables?: Record<string, Record<string, unknown>[]>; [k: string]: unknown }, blobFields: readonly string[]): BackupDigest {
  const tables: Record<string, TableDigest> = {}
  for (const [t, rows] of Object.entries(snap?.tables ?? {})) if (Array.isArray(rows)) tables[t] = tableDigest(rows)
  const blobs: Record<string, BlobDigest> = {}
  for (const f of blobFields) if (snap?.[f] != null) blobs[f] = blobDigest(snap[f])
  return { tables, blobs }
}

/** What differs between two digests: one line per table or blob, empty when they match. */
export function digestDiff(want: BackupDigest, got: BackupDigest): string[] {
  const out: string[] = []
  for (const [t, w] of Object.entries(want.tables)) {
    const g = got.tables[t]
    if (!g) out.push(`${t}: missing`)
    else if (g.rows !== w.rows) out.push(`${t}: ${g.rows}/${w.rows} rows`)
    else if (g.sum !== w.sum) out.push(`${t}: rows changed`)
  }
  for (const [f, w] of Object.entries(want.blobs)) {
    const g = got.blobs[f]
    if (!g) out.push(`${f}: missing`)
    else if (g.sum !== w.sum) out.push(`${f}: changed`)
  }
  return out
}
