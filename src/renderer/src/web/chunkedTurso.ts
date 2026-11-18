// The transport for big synced settings (core/settingParts.ts): on the way to
// the server a big app copy becomes pieces plus a short manifest, on the way
// back the manifest becomes the whole text again. Everything above this (the
// mirror, the desktop outbox, the apps' sync, the bots on the server) keeps
// reading and writing whole values and never sees a manifest.
//
// Writing: the pieces the server lacks go up first, in requests of at most
// UPLOAD_BYTES (they change nothing by themselves); then the caller's own
// transaction runs with the manifest in place of the big text, a check that
// every piece is there, and the clean-up of this key's old pieces. All or
// nothing, so a reader never finds half a write.
//
// Reading: any answer cell that is a manifest is put back together. Pieces
// this device already has (from its own copy of the value) are not downloaded
// again; each downloaded piece is checked against its name.
import type { Change, Param } from './browserDb'
import type { Rows } from './tursoHttp'
import { jsonBytes } from './desktopSync'
import { MANIFEST_HEAD, PARTS_DDL, PARTS_OK_TABLE, PARTS_TABLE, PartsError, WHOLE_UP_TO, assemble, looksLikeManifest, manifestOf, parseManifest, partOk, splitText, travelsInParts, type Part, type PartsManifest } from '@core/settingParts'
import { hash64 } from '@core/textHash'

/** What the mirror needs from a database connection (TursoHttp, or this wrapper around one). */
export interface TursoLike {
  readMany(stmts: Change[]): Promise<(Rows | Error)[]>
  writeAtomic(stmts: Change[]): Promise<Param[][][]>
}

const UPSERT = /^\s*INSERT\s+INTO\s+["`]?settings["`]?\s*\(\s*["`]?key["`]?\s*,\s*["`]?value["`]?\s*\)\s*VALUES\s*\(\s*\?\s*,\s*\?\s*\)/i
const UPDATE = /^\s*UPDATE\s+["`]?settings["`]?\s+SET\s+["`]?value["`]?\s*=\s*\?\s+WHERE\s+["`]?key["`]?\s*=\s*\?\s*$/i
const CAS = /^\s*INSERT\s+INTO\s+sys_cas\s*\(ok\)\s*VALUES\s*\(\(SELECT\s+value\s+FROM\s+settings\s+WHERE\s+key\s*=\s*\?\)\s+IS\s+\?\)\s*$/i

type Shape = { kind: 'set'; key: string; value: string; arg: number } | { kind: 'cas'; key: string; value: string }

/** A statement whose big value travels in pieces, or null. */
function shapeOf(c: Change): Shape | null {
  const big = (key: unknown, value: unknown): value is string => typeof key === 'string' && travelsInParts(key) && typeof value === 'string' && value.length > WHOLE_UP_TO && !looksLikeManifest(value)
  if (c.args.length === 2) {
    if (UPSERT.test(c.sql) && big(c.args[0], c.args[1])) return { kind: 'set', key: c.args[0] as string, value: c.args[1], arg: 1 }
    if (UPDATE.test(c.sql) && big(c.args[1], c.args[0])) return { kind: 'set', key: c.args[1] as string, value: c.args[0], arg: 0 }
    if (CAS.test(c.sql) && big(c.args[0], c.args[1])) return { kind: 'cas', key: c.args[0] as string, value: c.args[1] }
  }
  return null
}

const isMissingPart = (e: unknown) => new RegExp(`${PARTS_OK_TABLE}|parts_ok`, 'i').test(String((e as Error)?.message ?? e))
const isNoTable = (e: unknown) => new RegExp(`no such table: ${PARTS_TABLE}`, 'i').test(String((e as Error)?.message ?? e))

export class ChunkedTurso implements TursoLike {
  /** One upload request carries at most this many bytes of pieces (far below the server's 4.5 MB). */
  static UPLOAD_BYTES = 900_000
  /** One download request asks for at most this many characters of pieces. */
  static FETCH_CHARS = 600_000
  /** A whole (not chunked) value bigger than this is read in slices. */
  static SLICE_OVER = 1_200_000
  static SLICE_CHARS = 500_000
  /** An old piece is only cleaned up when it is at least this old (a reader or a writer may still be using it). */
  static GRACE_MS = 10 * 60_000

  /** Pieces this device holds, per key (of the newest values it wrote or read). */
  private have = new Map<string, Map<string, string>>()
  /** The last two texts encoded per key (a write names the value it replaces and the new one; encoding them again costs nothing). */
  private last = new Map<string, { text: string; manifest: string; parts: Part[] }[]>()
  /** For the speed check and tests: what travelled. */
  stats = { requests: 0, partsUp: 0, bytesUp: 0, partsDown: 0, charsDown: 0, biggestRequest: 0 }

  /** `local(key)`: this device's own copy of a setting (its pieces need no download). */
  constructor(private inner: TursoLike, private local: (key: string) => string | null = () => null) {}

  /** True when this statement's big value goes up in pieces (so it never makes a request too big). */
  travelsInParts(c: Change): boolean {
    return shapeOf(c)?.kind === 'set'
  }

  private encode(key: string, text: string): { manifest: string; parts: Part[] } {
    const list = this.last.get(key) ?? []
    const was = list.find((x) => x.text.length === text.length && x.text === text)
    if (was) return was
    const enc = { text, ...manifestOf(key, text) }
    this.last.set(key, [enc, ...list].slice(0, 2))
    return enc
  }
  /** The manifest text a value is stored as (null: it is stored whole). */
  manifestText(key: string, text: string): string | null {
    return travelsInParts(key) && text.length > WHOLE_UP_TO ? this.encode(key, text).manifest : null
  }
  private keep(key: string, parts: Part[]): void {
    this.have.set(key, new Map(parts.map((p) => [p.id, p.text])))
  }

  private async raw(stmts: Change[]): Promise<(Rows | Error)[]> {
    this.count(stmts)
    return this.inner.readMany(stmts)
  }
  private count(stmts: Change[]): void {
    this.stats.requests++
    let n = 0
    for (const s of stmts) {
      n += s.sql.length + 40
      for (const a of s.args) n += typeof a === 'string' ? jsonBytes(a) : 24
    }
    if (n > this.stats.biggestRequest) this.stats.biggestRequest = n
  }

  /** Reads without putting manifests together (the mirror's "is it still the same?" probe). */
  readRaw(stmts: Change[]): Promise<(Rows | Error)[]> {
    return this.raw(stmts)
  }

  // ---- Writing --------------------------------------------------------------

  /** Sends the pieces of `enc` the server doesn't have yet. */
  private async upload(key: string, enc: { parts: Part[] }): Promise<void> {
    const ids = [...new Set(enc.parts.map((p) => p.id))]
    let there = new Set<string>()
    const [r] = await this.raw([{ sql: `SELECT id FROM ${PARTS_TABLE} WHERE key = ? AND id IN (SELECT value FROM json_each(?))`, args: [key, JSON.stringify(ids)] }])
    if (r instanceof Error) {
      if (!isNoTable(r)) throw r
    } else there = new Set(r.rows.map((x) => String(x[0])))
    const todo: Part[] = []
    const seen = new Set<string>()
    for (const p of enc.parts) {
      if (there.has(p.id) || seen.has(p.id)) continue
      seen.add(p.id)
      todo.push(p)
    }
    const now = Date.now()
    let batch: Change[] = []
    let size = 0
    const flush = async () => {
      if (!batch.length) return
      const stmts = [...PARTS_DDL.map((sql) => ({ sql, args: [] as Param[] })), ...batch]
      this.count(stmts)
      await this.inner.writeAtomic(stmts)
      this.stats.partsUp += batch.length
      this.stats.bytesUp += size
      batch = []
      size = 0
    }
    for (const p of todo) {
      const bytes = jsonBytes(p.text)
      if (batch.length && size + bytes > ChunkedTurso.UPLOAD_BYTES) await flush()
      // A piece that is already there only gets a new time (so the clean-up leaves it alone).
      batch.push({ sql: `INSERT INTO ${PARTS_TABLE} (key, id, data, at) VALUES (?, ?, ?, ?) ON CONFLICT(key, id) DO UPDATE SET at = excluded.at`, args: [key, p.id, p.text, now] })
      size += bytes
    }
    await flush()
  }

  /**
   * Makes sure the server has every piece of this value (a piece lost or damaged
   * there is sent again from this device's whole copy). Changes no value.
   */
  async heal(key: string, text: string): Promise<void> {
    if (!travelsInParts(key) || text.length <= WHOLE_UP_TO) return
    const enc = this.encode(key, text)
    const ids = [...new Set(enc.parts.map((p) => p.id))]
    // Pieces whose stored length is not the one their name stands for are replaced.
    const size = new Map(enc.parts.map((p) => [p.id, p.text.length]))
    const [lens] = await this.raw([{ sql: `SELECT id, length(data) FROM ${PARTS_TABLE} WHERE key = ? AND id IN (SELECT value FROM json_each(?))`, args: [key, JSON.stringify(ids)] }])
    if (!(lens instanceof Error)) {
      const bad = lens.rows.filter(([id, n]) => size.get(String(id)) !== Number(n)).map(([id]) => String(id))
      if (bad.length) await this.inner.writeAtomic([{ sql: `DELETE FROM ${PARTS_TABLE} WHERE key = ? AND id IN (SELECT value FROM json_each(?))`, args: [key, JSON.stringify(bad)] }])
    }
    await this.upload(key, enc)
  }

  async writeAtomic(stmts: Change[]): Promise<Param[][][]> {
    const shapes = stmts.map(shapeOf)
    if (!shapes.some(Boolean)) {
      this.count(stmts)
      return this.inner.writeAtomic(stmts)
    }
    const encAt = shapes.map((s) => (s ? this.encode(s.key, s.value) : null))
    const sets = shapes.some((s) => s?.kind === 'set')
    let last: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      for (let i = 0; i < shapes.length; i++) if (shapes[i]?.kind === 'set') await this.upload(shapes[i]!.key, encAt[i]!)
      const out: Change[] = []
      const at: number[] = []
      if (sets) for (const sql of PARTS_DDL) out.push({ sql, args: [] })
      const cutoff = Date.now() - ChunkedTurso.GRACE_MS
      stmts.forEach((c, i) => {
        const s = shapes[i]
        if (!s) {
          at[i] = out.push(c) - 1
          return
        }
        if (s.kind === 'cas') {
          // "Still what I read?": the server holds either this value's manifest, or (written
          // before pieces existed, or put back by a restore) the whole text itself, which is
          // told by its length and its first and last letters (the start carries savedAt, which
          // every write changes).
          const text = s.value
          at[i] = out.push({
            sql: 'INSERT INTO sys_cas (ok) VALUES (COALESCE((SELECT (value = ?) OR (length(value) = ? AND substr(value, 1, 96) = ? AND substr(value, -96) = ?) FROM settings WHERE key = ?), 0))',
            args: [encAt[i]!.manifest, text.length, text.slice(0, 96), text.slice(-96), s.key]
          }) - 1
          return
        }
        const enc = encAt[i]!
        const ids = JSON.stringify([...new Set(enc.parts.map((p) => p.id))])
        const args = [...c.args]
        args[s.arg] = enc.manifest
        // Every piece must be there, or nothing in this transaction happens.
        out.push({ sql: `INSERT INTO ${PARTS_OK_TABLE} (parts_ok) VALUES ((SELECT COUNT(*) FROM ${PARTS_TABLE} WHERE key = ? AND id IN (SELECT value FROM json_each(?))) = ?)`, args: [s.key, ids, new Set(enc.parts.map((p) => p.id)).size] })
        at[i] = out.push({ sql: c.sql, args }) - 1
        // This key's pieces no value uses any more (old enough that no reader or writer is still on them).
        out.push({ sql: `DELETE FROM ${PARTS_TABLE} WHERE key = ? AND at < ? AND id NOT IN (SELECT value FROM json_each(?))`, args: [s.key, cutoff, ids] })
      })
      if (sets) out.push({ sql: `DELETE FROM ${PARTS_OK_TABLE}`, args: [] })
      try {
        this.count(out)
        const res = await this.inner.writeAtomic(out)
        // What this device just wrote is what it holds (the next read needs no download).
        shapes.forEach((sh, i) => sh?.kind === 'set' && this.keep(sh.key, encAt[i]!.parts))
        return stmts.map((_, i) => res[at[i]] ?? [])
      } catch (e) {
        last = e
        // A piece was cleaned up between the upload and the switch (another device wrote meanwhile),
        // or the table is new: send every piece again and try once more.
        if (!isMissingPart(e) && !isNoTable(e)) throw e
      }
    }
    throw last
  }

  // ---- Reading --------------------------------------------------------------

  async readMany(stmts: Change[]): Promise<(Rows | Error)[]> {
    const res = await this.raw(stmts)
    const out: (Rows | Error)[] = []
    for (const r of res) {
      if (r instanceof Error) {
        out.push(r)
        continue
      }
      let failed: Error | null = null
      for (const row of r.rows) {
        for (let i = 0; i < row.length && !failed; i++) {
          if (!looksLikeManifest(row[i])) continue
          const m = parseManifest(row[i])
          if (!m || !travelsInParts(m.key)) continue
          try {
            row[i] = await this.resolve(m)
          } catch (e) {
            failed = e instanceof Error ? e : new Error(String(e))
          }
        }
        if (failed) break
      }
      out.push(failed ?? r)
    }
    return out
  }

  /** The whole text of a manifest: this device's pieces first, the rest downloaded and checked. */
  private async resolve(first: PartsManifest): Promise<string> {
    let m = first
    for (let attempt = 0; ; attempt++) {
      const got = await this.gather(m)
      if (got != null) return got
      if (attempt >= 3) throw new PartsError(`Could not read ${m.key}: its pieces changed while reading. Try again.`)
      // Replaced while we were reading: the manifest again, then its pieces.
      const [r] = await this.raw([{ sql: 'SELECT value FROM settings WHERE key = ?', args: [m.key] }])
      if (r instanceof Error) throw r
      const v = r.rows[0]?.[0]
      const next = parseManifest(v)
      if (!next) {
        // Now stored whole (a restore, or it became small): that is the value.
        if (typeof v === 'string') return v
        throw new PartsError(`Could not read ${m.key}: it was removed while reading.`)
      }
      if (next.sum === m.sum && attempt >= 1) throw new PartsError(`Could not read ${m.key}: a piece is missing on the server. This device's own copy is not changed.`)
      m = next
    }
  }

  /** All pieces of `m` put together, or null when the server no longer has one of them. */
  private async gather(m: PartsManifest): Promise<string | null> {
    let mine = this.have.get(m.key) ?? new Map<string, string>()
    const lacks = () => m.p.filter((id, i) => !partOk(id, m.n[i], mine.get(id)))
    if (lacks().length) {
      // This device's own copy of the value: most pieces are usually the same.
      const own = this.local(m.key)
      if (own != null && own.length > 0) {
        mine = new Map(mine)
        for (const t of splitText(own)) mine.set(hash64(t), t)
      }
    }
    const need = [...new Set(lacks())]
    if (need.length) {
      const size = new Map(m.p.map((id, i) => [id, m.n[i]]))
      const groups: string[][] = []
      let cur: string[] = []
      let chars = 0
      for (const id of need) {
        const n = size.get(id) ?? 0
        if (cur.length && chars + n > ChunkedTurso.FETCH_CHARS) {
          groups.push(cur)
          cur = []
          chars = 0
        }
        cur.push(id)
        chars += n
      }
      if (cur.length) groups.push(cur)
      mine = new Map(mine)
      let next = 0
      let gone = false
      await Promise.all(Array.from({ length: Math.min(4, groups.length) }, async () => {
        while (next < groups.length && !gone) {
          const g = groups[next++]
          const [r] = await this.raw([{ sql: `SELECT id, data FROM ${PARTS_TABLE} WHERE key = ? AND id IN (SELECT value FROM json_each(?))`, args: [m.key, JSON.stringify(g)] }])
          if (r instanceof Error) {
            if (isNoTable(r)) {
              gone = true
              return
            }
            throw r
          }
          for (const [id, data] of r.rows) {
            const n = size.get(String(id)) ?? -1
            // A piece that is not the text its name says is treated as missing (never used).
            if (partOk(String(id), n, data)) {
              mine.set(String(id), data)
              this.stats.partsDown++
              this.stats.charsDown += data.length
            }
          }
        }
      }))
      if (gone || lacks().length) return null
    }
    const text = assemble(m, (id) => mine.get(id))
    // Keep only this value's pieces (the next read or write starts from them).
    this.have.set(m.key, new Map(m.p.map((id) => [id, mine.get(id)!])))
    return text
  }

  /**
   * One setting as the server holds it, whole, however big: a manifest is put
   * together; a big whole value (written before pieces existed, or put back by
   * a restore) is read in slices so no answer is too big. Null: no such setting.
   */
  async readSetting(key: string): Promise<string | null> {
    for (let attempt = 0; ; attempt++) {
      const probe = { sql: 'SELECT length(value), length(CAST(value AS BLOB)), substr(value, 1, 64), substr(value, -64) FROM settings WHERE key = ?', args: [key] as Param[] }
      const [p] = await this.raw([probe])
      if (p instanceof Error) throw p
      const row = p.rows[0]
      if (!row) return null
      const chars = Number(row[0])
      if (Number(row[1]) <= ChunkedTurso.SLICE_OVER || String(row[2] ?? '').startsWith(MANIFEST_HEAD)) {
        const [r] = await this.readMany([{ sql: 'SELECT value FROM settings WHERE key = ?', args: [key] }])
        if (r instanceof Error) throw r
        const v = r.rows[0]?.[0]
        return v == null ? null : String(v)
      }
      const reads: Change[] = []
      for (let o = 1; o <= chars; o += ChunkedTurso.SLICE_CHARS) reads.push({ sql: 'SELECT substr(value, ?, ?) FROM settings WHERE key = ?', args: [o, ChunkedTurso.SLICE_CHARS, key] })
      const slices: string[] = new Array(reads.length)
      let next = 0
      await Promise.all(Array.from({ length: Math.min(4, reads.length) }, async () => {
        while (next < reads.length) {
          const i = next++
          const [r] = await this.raw([reads[i]])
          if (r instanceof Error) throw r
          slices[i] = String(r.rows[0]?.[0] ?? '')
        }
      }))
      // The value must not have changed between the slices.
      const [q] = await this.raw([probe])
      if (q instanceof Error) throw q
      const text = slices.join('')
      const again = q.rows[0]
      if (again && Number(again[0]) === chars && String(again[2]) === String(row[2]) && String(again[3]) === String(row[3]) && text.length === chars) return text
      if (attempt >= 3) throw new PartsError(`Could not read ${key}: it kept changing while reading. Try again.`)
    }
  }
}
