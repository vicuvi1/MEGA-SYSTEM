// Turso (libSQL) over HTTP: reads, and writes sent as one transaction so a
// change is either fully saved or not at all.
import type { Change, Param } from './browserDb'

type HranaValue =
  | { type: 'null' }
  | { type: 'integer'; value: string }
  | { type: 'float'; value: number }
  | { type: 'text'; value: string }
  | { type: 'blob'; base64: string }

const toHrana = (v: Param): HranaValue => {
  if (v === null) return { type: 'null' }
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v }
  if (v instanceof Uint8Array) {
    let s = ''
    v.forEach((b) => (s += String.fromCharCode(b)))
    return { type: 'blob', base64: btoa(s) }
  }
  return { type: 'text', value: String(v) }
}

const fromHrana = (v: any): Param => {
  if (!v || v.type === 'null') return null
  if (v.type === 'integer') return Number(v.value)
  if (v.type === 'float') return Number(v.value)
  if (v.type === 'blob') {
    const s = atob(v.base64 ?? '')
    return Uint8Array.from(s, (c) => c.charCodeAt(0))
  }
  return v.value ?? ''
}

export interface Rows { cols: string[]; rows: Param[][] }

export class TursoHttp {
  private url: string

  constructor(url: string, private token: string) {
    let base = (url || '').trim()
    if (base.startsWith('libsql://')) base = 'https://' + base.slice('libsql://'.length)
    if (!/^https?:\/\//.test(base)) base = 'https://' + base
    this.url = base.replace(/\/+$/, '') + '/v2/pipeline'
  }

  private async pipeline(requests: unknown[]): Promise<any[]> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [...requests, { type: 'close' }] })
    })
    if (!res.ok) throw new Error(`Turso HTTP ${res.status}: ${(await res.text().catch(() => '')) || res.statusText}`)
    const json = await res.json()
    return json.results ?? []
  }

  /** Several reads in one round trip; a failed one comes back as an Error. */
  async readMany(stmts: Change[]): Promise<(Rows | Error)[]> {
    const results = await this.pipeline(stmts.map((s) => ({ type: 'execute', stmt: { sql: s.sql, args: s.args.map(toHrana) } })))
    return stmts.map((_, i) => {
      const r = results[i]
      if (!r || r.type === 'error') return new Error(r?.error?.message ?? 'Turso read failed')
      const result = r.response?.result
      return {
        cols: (result?.cols ?? []).map((c: any) => String(c.name)),
        rows: (result?.rows ?? []).map((row: any[]) => row.map(fromHrana))
      }
    })
  }

  /** Runs the statements in one transaction: all of them, or none. */
  async writeAtomic(stmts: Change[]): Promise<void> {
    if (!stmts.length) return
    const steps: unknown[] = [{ stmt: { sql: 'BEGIN' } }]
    stmts.forEach((s, i) => steps.push({ condition: { type: 'ok', step: i }, stmt: { sql: s.sql, args: s.args.map(toHrana) } }))
    const last = steps.length - 1
    steps.push({ condition: { type: 'ok', step: last }, stmt: { sql: 'COMMIT' } })
    steps.push({ condition: { type: 'not', cond: { type: 'ok', step: last + 1 } }, stmt: { sql: 'ROLLBACK' } })
    const [r] = await this.pipeline([{ type: 'batch', batch: { steps } }])
    if (!r || r.type === 'error') throw new Error(r?.error?.message ?? 'Turso write failed')
    const res = r.response?.result
    const errs: any[] = res?.step_errors ?? []
    const commitOk = res?.step_results?.[last + 1] != null
    if (!commitOk) {
      const firstErr = errs.find((e) => e) as { message?: string } | undefined
      throw new Error(firstErr?.message ?? 'Turso did not save the change')
    }
  }
}
