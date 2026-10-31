// A stand-in for Turso's HTTP pipeline API on an in-memory sql.js database,
// for tests and for trying the web app locally without touching real data.
// Supports `execute` and `batch` (with ok/not conditions), like libSQL.
import type { Database as SqlJsDatabase, SqlValue } from 'sql.js'

const fromHrana = (v: any): SqlValue => {
  if (!v || v.type === 'null') return null
  if (v.type === 'integer') return Number(v.value)
  if (v.type === 'float') return Number(v.value)
  if (v.type === 'blob') return Uint8Array.from(atob(v.base64 ?? ''), (c) => c.charCodeAt(0))
  return v.value ?? ''
}

const toHrana = (v: SqlValue) => {
  if (v === null || v === undefined) return { type: 'null' }
  if (typeof v === 'number') return Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v }
  if (v instanceof Uint8Array) {
    let s = ''
    v.forEach((b) => (s += String.fromCharCode(b)))
    return { type: 'blob', base64: btoa(s) }
  }
  return { type: 'text', value: String(v) }
}

export function runStmt(db: SqlJsDatabase, stmt: { sql: string; args?: any[] }) {
  const args = (stmt.args ?? []).map(fromHrana)
  const s = db.prepare(stmt.sql)
  try {
    s.bind(args)
    const cols = s.getColumnNames()
    const rows: SqlValue[][] = []
    while (s.step()) rows.push(s.get())
    return {
      cols: cols.map((name) => ({ name })),
      rows: rows.map((r) => r.map(toHrana)),
      affected_row_count: db.getRowsModified(),
      last_insert_rowid: null
    }
  } finally {
    s.free()
  }
}

/** Handles one `/v2/pipeline` request body. */
export function handlePipeline(db: SqlJsDatabase, body: { requests: any[] }) {
  const results: any[] = []
  for (const req of body.requests ?? []) {
    if (req.type === 'close') {
      results.push({ type: 'ok', response: { type: 'close' } })
    } else if (req.type === 'execute') {
      try {
        results.push({ type: 'ok', response: { type: 'execute', result: runStmt(db, req.stmt) } })
      } catch (e) {
        results.push({ type: 'error', error: { message: (e as Error).message } })
      }
    } else if (req.type === 'batch') {
      const steps: any[] = req.batch?.steps ?? []
      const stepResults: any[] = []
      const stepErrors: any[] = []
      const ok = (cond: any): boolean => {
        if (!cond) return true
        if (cond.type === 'ok') return stepResults[cond.step] != null
        if (cond.type === 'error') return stepErrors[cond.step] != null
        if (cond.type === 'not') return !ok(cond.cond)
        if (cond.type === 'and') return (cond.conds ?? []).every(ok)
        if (cond.type === 'or') return (cond.conds ?? []).some(ok)
        return true
      }
      steps.forEach((step, i) => {
        stepResults[i] = null
        stepErrors[i] = null
        if (!ok(step.condition)) return
        try {
          stepResults[i] = runStmt(db, step.stmt)
        } catch (e) {
          stepErrors[i] = { message: (e as Error).message }
        }
      })
      results.push({ type: 'ok', response: { type: 'batch', result: { step_results: stepResults, step_errors: stepErrors } } })
    } else {
      results.push({ type: 'error', error: { message: `Unsupported request ${req.type}` } })
    }
  }
  return { baton: null, base_url: null, results }
}
