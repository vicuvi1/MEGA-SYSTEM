// A big synced setting (an app's whole copy: Money after years of records)
// travels to the server in pieces, so no request ever comes near the 4.5 MB a
// request may be, and a small edit sends only the pieces it changed.
//
// On the SERVER a big value is stored as:
//   settings.value            a short manifest: the pieces' names, in order
//   setting_parts(key, id)    the pieces (id = the fingerprint of its text)
// On every DEVICE (the sql.js copy, the desktop file, backups, the bots' copy)
// the value stays one whole text, exactly as before: only the transport
// (web/chunkedTurso.ts) knows about pieces.
//
// The manifest is a pure function of the text: the same text always gives the
// same manifest, so "is the server's value still what I read?" works on
// manifests as it did on whole values.
//
// A reader never sees half a write: pieces are uploaded first (they change
// nothing), then ONE transaction checks they are all there and switches the
// manifest. A reader that finds a piece missing (replaced meanwhile) reads the
// manifest again; a piece whose text doesn't match its name is refused.
import { hash64 } from './textHash'

/** The pieces' table on the server (migration 025; never copied to devices). */
export const PARTS_TABLE = 'setting_parts'
/** Its one-row check table: a write fails when a piece is missing (`parts_ok = 1`). */
export const PARTS_OK_TABLE = 'setting_parts_ok'
export const PARTS_DDL = [
  `CREATE TABLE IF NOT EXISTS ${PARTS_TABLE} (key TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (key, id))`,
  `CREATE TABLE IF NOT EXISTS ${PARTS_OK_TABLE} (parts_ok INTEGER NOT NULL CHECK (parts_ok = 1))`
]

/** Only the apps' copies travel in pieces (`app_sync_<app>`, Money's sealed copy included). */
export const travelsInParts = (key: string): boolean => /^app_sync_/.test(key)
/** A value up to this long (characters) is stored whole, as it always was. */
export const WHOLE_UP_TO = 100_000
/** A piece is at least / at most this long (characters); about 40,000 on average for a list of records. */
export const PART_MIN = 8_000
export const PART_MAX = 128_000
const CUT_MASK = 0x7f
const WINDOW = 24

/**
 * Cuts a text into pieces at places that depend only on the text around them
 * (after a `}` that is followed by `,{`: the end of a record in a list), so
 * an edit in one record changes one or two pieces and leaves the others (and
 * their names) exactly as they were. Joining the pieces gives the text back.
 */
export function splitText(text: string): string[] {
  const n = text.length
  if (n <= PART_MAX) return [text]
  const out: string[] = []
  let start = 0
  let i = PART_MIN
  while (i < n) {
    let cut = -1
    const max = Math.min(n, start + PART_MAX)
    for (let j = Math.max(i, start + PART_MIN); j < max - 2; j++) {
      if (text.charCodeAt(j) !== 125 || text.charCodeAt(j + 1) !== 44 || text.charCodeAt(j + 2) !== 123) continue
      let h = 0x811c9dc5
      for (let k = j - WINDOW; k <= j; k++) h = Math.imul(h ^ text.charCodeAt(k), 16777619)
      h ^= h >>> 15
      if ((h & CUT_MASK) === 0) {
        cut = j + 1
        break
      }
    }
    if (cut < 0) {
      if (max >= n) break
      cut = max
      // Never between the two halves of one character (an emoji): the piece must be valid text on its own.
      const c = text.charCodeAt(cut - 1)
      if (c >= 0xd800 && c <= 0xdbff) cut--
    }
    out.push(text.slice(start, cut))
    start = cut
    i = start + PART_MIN
  }
  if (start < n) out.push(text.slice(start))
  return out
}

export interface PartsManifest {
  /** Format version (also the version of the fingerprint: core/textHash.ts hash64). */
  lifeParts: 1
  key: string
  /** The whole text's length in characters. */
  len: number
  /** A fingerprint of the list of pieces and the length. */
  sum: string
  /** The pieces' names, in order. */
  p: string[]
  /** Each piece's length in characters. */
  n: number[]
}

export const MANIFEST_HEAD = '{"lifeParts":1,'
/** A stored value that is a manifest (cheap: by its first letters). */
export const looksLikeManifest = (v: unknown): v is string => typeof v === 'string' && v.startsWith(MANIFEST_HEAD)

const sumOf = (p: string[], len: number) => hash64(`${p.join(',')}|${len}`)

export interface Part { id: string; text: string }

/** The manifest of a text and its pieces. */
export function manifestOf(key: string, text: string): { manifest: string; parts: Part[] } {
  const parts = splitText(text).map((t) => ({ id: hash64(t), text: t }))
  const p = parts.map((x) => x.id)
  const m: PartsManifest = { lifeParts: 1, key, len: text.length, sum: sumOf(p, text.length), p, n: parts.map((x) => x.text.length) }
  return { manifest: JSON.stringify(m), parts }
}

/** A manifest read back, or null when the text isn't one (or was damaged). */
export function parseManifest(text: unknown): PartsManifest | null {
  if (!looksLikeManifest(text)) return null
  let m: any
  try {
    m = JSON.parse(text)
  } catch {
    return null
  }
  if (!m || m.lifeParts !== 1 || typeof m.key !== 'string' || !Array.isArray(m.p) || !Array.isArray(m.n) || m.p.length !== m.n.length || !m.p.length) return null
  if (!m.p.every((x: unknown) => typeof x === 'string' && /^[0-9a-f]{16}$/.test(x)) || !m.n.every((x: unknown) => Number.isInteger(x) && (x as number) >= 0)) return null
  if (m.n.reduce((a: number, b: number) => a + b, 0) !== m.len || sumOf(m.p, m.len) !== m.sum) return null
  return m as PartsManifest
}

export class PartsError extends Error {}

/** True when this text is the piece with this name and length. */
export const partOk = (id: string, len: number, text: unknown): text is string => typeof text === 'string' && text.length === len && hash64(text) === id

/**
 * The whole text from a manifest and its pieces. Throws when a piece is
 * missing or is not the text its name says (never a half or mixed-up value).
 */
export function assemble(m: PartsManifest, get: (id: string) => string | undefined): string {
  const out: string[] = []
  for (let i = 0; i < m.p.length; i++) {
    const t = get(m.p[i])
    if (t === undefined) throw new PartsError(`A piece of ${m.key} is missing (${i + 1} of ${m.p.length})`)
    if (!partOk(m.p[i], m.n[i], t)) throw new PartsError(`A piece of ${m.key} is damaged (${i + 1} of ${m.p.length})`)
    out.push(t)
  }
  const text = out.join('')
  if (text.length !== m.len) throw new PartsError(`The pieces of ${m.key} don't add up`)
  return text
}
