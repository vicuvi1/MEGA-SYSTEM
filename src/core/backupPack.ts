// A cloud backup of any size (2026-11-12, "no size ceiling"). One request to
// the server may carry at most 4.5 MB, so the backup's JSON is gzipped once and
// the gzip bytes are cut into parts of PART_BYTES. Each part is one row of
// cloud_snapshot_parts; the cloud_snapshots row of the day holds only a small
// manifest ("parts:" + JSON). Joining the parts is a plain concatenation of
// their bytes (`cat part-* | gunzip` works too), checked against a SHA-256 of
// every part and of the whole. Pure: the callers gzip (Node zlib on the
// server, CompressionStream in the app).

/** Raw gzip bytes per part: about 2 MB once written as base64, well under one request. */
export const PART_BYTES = 1_500_000
/** A single stored chunk (base64 characters) at or above this earns a warning. */
export const CHUNK_WARN = 2_500_000
/** The most a single stored chunk may be (one request to the server is 4.5 MB). */
export const CHUNK_MAX = 4_200_000
export const PARTS_PREFIX = 'parts:'

export interface PartsManifest {
  v: 3
  /** How many parts. */
  parts: number
  /** Gzip bytes in all. */
  bytes: number
  /** SHA-256 (hex) of all the gzip bytes. */
  sha: string
  /** Length of the backup's JSON text. */
  json: number
  /** Stored size of each part (base64 characters). */
  sizes: number[]
  /** SHA-256 (hex) of each part's bytes. */
  shas: string[]
}

export function toBase64(u8: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function splitBytes(u8: Uint8Array, size = PART_BYTES): Uint8Array[] {
  if (size <= 0) throw new Error('Bad part size')
  const out: Uint8Array[] = []
  for (let i = 0; i < u8.length; i += size) out.push(u8.subarray(i, i + size))
  return out.length ? out : [new Uint8Array(0)]
}

export function joinBytes(list: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(list.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of list) {
    out.set(p, at)
    at += p.length
  }
  return out
}

export async function sha256Hex(u8: Uint8Array): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', u8 as unknown as ArrayBuffer)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The gzip bytes of a backup, as stored parts (base64) and their manifest. */
export async function packParts(gz: Uint8Array, jsonLength: number, size = PART_BYTES): Promise<{ manifest: PartsManifest; parts: string[] }> {
  const raw = splitBytes(gz, size)
  const parts = raw.map(toBase64)
  const shas = await Promise.all(raw.map(sha256Hex))
  return { parts, manifest: { v: 3, parts: parts.length, bytes: gz.length, sha: await sha256Hex(gz), json: jsonLength, sizes: parts.map((p) => p.length), shas } }
}

export const isManifest = (data: unknown): data is string => typeof data === 'string' && data.startsWith(PARTS_PREFIX)
export const manifestText = (m: PartsManifest) => PARTS_PREFIX + JSON.stringify(m)

/** The manifest in a cloud_snapshots row's data, or null when it is an old one-piece backup or broken. */
export function readManifest(data: unknown): PartsManifest | null {
  if (!isManifest(data)) return null
  try {
    const m = JSON.parse(data.slice(PARTS_PREFIX.length))
    if (m?.v !== 3 || !Number.isInteger(m.parts) || m.parts < 1 || !Array.isArray(m.shas) || m.shas.length !== m.parts || typeof m.sha !== 'string') return null
    return m as PartsManifest
  } catch {
    return null
  }
}

/** The stored parts joined back to the gzip bytes; throws when one is missing or changed. */
export async function joinParts(m: PartsManifest, parts: (string | null | undefined)[]): Promise<Uint8Array> {
  if (parts.length !== m.parts || parts.some((p) => typeof p !== 'string')) throw new Error(`The backup is missing parts (${parts.filter((p) => typeof p === 'string').length} of ${m.parts})`)
  const raw = (parts as string[]).map(fromBase64)
  for (let i = 0; i < raw.length; i++) if ((await sha256Hex(raw[i])) !== m.shas[i]) throw new Error(`Part ${i + 1} of the backup does not match its checksum`)
  const all = joinBytes(raw)
  if (all.length !== m.bytes || (await sha256Hex(all)) !== m.sha) throw new Error('The joined backup does not match its checksum')
  return all
}

/** The biggest single stored chunk of a backup: a manifest's biggest part, or an old one-piece backup's own size. */
export function biggestChunk(data: string): number {
  const m = readManifest(data)
  return m ? Math.max(0, ...(m.sizes ?? [])) : data.length
}
