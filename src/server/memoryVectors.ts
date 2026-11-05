// BR1: Ben remembers by meaning. Pieces of memory (facts, notes, chat days,
// tasks, his notes about you) are turned into embeddings and kept in Turso's
// own vector column (F32_BLOB + libsql_vector_idx), in a server-only table
// (sys_mem_vec: never copied to devices, not in backups; it can always be
// rebuilt). A message finds the closest pieces with vector_top_k; without the
// index, with vector_distance_cos over the table; without vector functions at
// all, by computing the distance here. When embeddings fail, Ben's brain falls
// back to its keyword recall (webBots.ts), so answers never wait on this.
//
// Embeddings: Google's gemini-embedding-001 through the GEMINI_API_KEY the
// server already has (free tier; a few dozen small calls a day), 768 numbers
// per piece. Nothing runs on your PC or phone.
import { planSync, textHash, type MemDoc } from '@core/benMemory'
import type { TursoHttp } from '../renderer/src/web/tursoHttp'

export const EMBED_DIM = 768
export const EMBED_MODEL = 'gemini-embedding-001'

/** Texts → unit vectors. `task`: a stored piece or a question. */
export type Embedder = (texts: string[], task: 'doc' | 'query') => Promise<number[][]>

export interface RecallHit {
  id: string
  kind: string
  text: string
  /** Cosine distance (0 = same meaning, 2 = opposite). */
  dist: number
}

const unit = (v: number[]) => {
  const n = Math.sqrt(v.reduce((t, x) => t + x * x, 0)) || 1
  return v.map((x) => x / n)
}

/** Gemini's batch embeddings (up to 100 texts a call), cut to 768 numbers and normalised. */
export function geminiEmbedder(key: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Embedder {
  return async (texts, task) => {
    const out: number[][] = []
    for (let i = 0; i < texts.length; i += 100) {
      const part = texts.slice(i, i + 100)
      const r = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: AbortSignal.timeout(task === 'query' ? 4_000 : 15_000),
        body: JSON.stringify({
          requests: part.map((t) => ({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text: t.slice(0, 2000) }] }, taskType: task === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT', outputDimensionality: EMBED_DIM }))
        })
      })
      const j: any = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(`Embeddings ${r.status}: ${j?.error?.message ?? 'failed'}`)
      const list = Array.isArray(j?.embeddings) ? j.embeddings : []
      if (list.length !== part.length) throw new Error('Embeddings: wrong count')
      for (const e of list) {
        const v = Array.isArray(e?.values) ? e.values.map(Number) : []
        if (v.length !== EMBED_DIM || v.some((x: number) => !Number.isFinite(x))) throw new Error('Embeddings: bad vector')
        out.push(unit(v))
      }
    }
    return out
  }
}

/** A vector as libSQL's F32 blob (little-endian float32), and back. */
export function toBlob(v: number[]): Uint8Array {
  const f = new Float32Array(v)
  return new Uint8Array(f.buffer.slice(0))
}
export function fromBlob(b: unknown): Float32Array | null {
  if (!(b instanceof Uint8Array) || b.length % 4) return null
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length))
}
const cosDist = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let d = 0
  let x = 0
  let y = 0
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i]
    x += a[i] * a[i]
    y += b[i] * b[i]
  }
  return 1 - d / (Math.sqrt(x * y) || 1)
}

const TABLE = `CREATE TABLE IF NOT EXISTS sys_mem_vec (id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL, at TEXT NOT NULL, emb F32_BLOB(${EMBED_DIM}) NOT NULL)`
const INDEX = "CREATE INDEX IF NOT EXISTS sys_mem_vec_idx ON sys_mem_vec (libsql_vector_idx(emb, 'metric=cosine'))"

/** How this database can search: the index, a scan with vector functions, or plain reads. */
type Mode = 'index' | 'scan' | 'js'

export class MemoryVectors {
  private ready: Promise<Mode> | null = null
  constructor(
    private db: TursoHttp,
    private embed: Embedder
  ) {}

  /** Makes the table (and the index when Turso has it); remembers what works. */
  mode(): Promise<Mode> {
    return (this.ready ??= (async () => {
      await this.db.writeAtomic([{ sql: TABLE, args: [] }])
      try {
        await this.db.writeAtomic([{ sql: INDEX, args: [] }])
        return 'index' as Mode
      } catch {
        const [r] = await this.db.readMany([{ sql: 'SELECT vector_distance_cos(vector32(?), vector32(?))', args: ['[1,0]', '[0,1]'] }])
        return (r instanceof Error ? 'js' : 'scan') as Mode
      }
    })().catch((e) => {
      this.ready = null
      throw e
    }))
  }

  /** Embeds new and changed pieces (at most `limit` in one call), drops the ones gone. */
  async sync(docs: MemDoc[], limit = 60): Promise<{ embedded: number; dropped: number }> {
    await this.mode()
    const [r] = await this.db.readMany([{ sql: 'SELECT id, hash FROM sys_mem_vec', args: [] }])
    if (r instanceof Error) throw r
    const stored = new Map(r.rows.map((x) => [String(x[0]), String(x[1])]))
    const plan = planSync(docs, stored, limit)
    const at = new Date().toISOString()
    const writes: { sql: string; args: any[] }[] = []
    if (plan.embed.length) {
      const vecs = await this.embed(plan.embed.map((d) => d.text), 'doc')
      plan.embed.forEach((d, i) =>
        writes.push({ sql: 'INSERT INTO sys_mem_vec (id, kind, text, hash, at, emb) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, text = excluded.text, hash = excluded.hash, at = excluded.at, emb = excluded.emb', args: [d.id, d.kind, d.text, textHash(d.text), at, toBlob(vecs[i])] })
      )
    }
    for (let i = 0; i < plan.drop.length; i += 50) {
      const ids = plan.drop.slice(i, i + 50)
      writes.push({ sql: `DELETE FROM sys_mem_vec WHERE id IN (${ids.map(() => '?').join(',')})`, args: ids })
    }
    if (writes.length) await this.db.writeAtomic(writes as any)
    return { embedded: plan.embed.length, dropped: plan.drop.length }
  }

  /** The pieces of one kind already stored (as they were embedded). */
  async stored(kind: MemDoc['kind']): Promise<MemDoc[]> {
    await this.mode()
    const [r] = await this.db.readMany([{ sql: 'SELECT id, text FROM sys_mem_vec WHERE kind = ?', args: [kind] }])
    if (r instanceof Error) throw r
    return r.rows.map((x) => ({ id: String(x[0]), kind, text: String(x[1]) }))
  }

  /** The `k` pieces closest in meaning to the question (optionally only some kinds). */
  async search(query: string, k = 6, kinds?: string[]): Promise<RecallHit[]> {
    const q = query.trim().slice(0, 1500)
    if (!q) return []
    const [mode, [vec]] = await Promise.all([this.mode(), this.embed([q], 'query')])
    return this.near(vec, k, kinds, mode)
  }

  /** Closest pieces to a vector. */
  async near(vec: number[], k: number, kinds?: string[], mode?: Mode): Promise<RecallHit[]> {
    mode ??= await this.mode()
    const only = kinds?.length ? ` AND m.kind IN (${kinds.map(() => '?').join(',')})` : ''
    const json = JSON.stringify(vec.map((x) => Math.round(x * 1e6) / 1e6))
    const hit = (r: any[]): RecallHit => ({ id: String(r[0]), kind: String(r[1]), text: String(r[2]), dist: Number(r[3]) })
    if (mode === 'index') {
      // The index gives the nearest overall; ask for more when filtering by kind.
      const n = kinds?.length ? k * 4 : k
      const [r] = await this.db.readMany([{ sql: `SELECT m.id, m.kind, m.text, vector_distance_cos(m.emb, vector32(?)) AS d FROM vector_top_k('sys_mem_vec_idx', vector32(?), ${n}) AS t JOIN sys_mem_vec m ON m.rowid = t.id WHERE 1${only} ORDER BY d LIMIT ${k}`, args: [json, json, ...(kinds ?? [])] }])
      if (!(r instanceof Error)) return r.rows.map(hit)
    }
    if (mode !== 'js') {
      const [r] = await this.db.readMany([{ sql: `SELECT m.id, m.kind, m.text, vector_distance_cos(m.emb, vector32(?)) AS d FROM sys_mem_vec m WHERE 1${only} ORDER BY d LIMIT ${k}`, args: [json, ...(kinds ?? [])] }])
      if (!(r instanceof Error)) return r.rows.map(hit)
    }
    const [r] = await this.db.readMany([{ sql: `SELECT m.id, m.kind, m.text, m.emb FROM sys_mem_vec m WHERE 1${only}`, args: [...(kinds ?? [])] }])
    if (r instanceof Error) throw r
    return r.rows
      .map((x) => {
        const v = fromBlob(x[3])
        return { id: String(x[0]), kind: String(x[1]), text: String(x[2]), dist: v && v.length === vec.length ? cosDist(vec, v) : 2 }
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, k)
  }
}
