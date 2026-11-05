// What /api/db lets a device send to Turso (A1). The app and the embedded
// apps run their own SQL, so this is a deny-list of the things no page ever
// needs: the server's own tables (PIN, sign-outs, wrong-PIN counters,
// passkeys, devices, job slots), and statements that reach past the data
// (ATTACH, PRAGMA, VACUUM, extensions). Only plain execute/batch/close
// requests pass; stored or multi-statement SQL is refused.

/** Server-only tables: never read or written from a page. */
export const PROTECTED_TABLES = ['sys_auth', 'sys_login_guard', 'sys_passkeys', 'sys_passkey_chal', 'sys_devices', 'sys_gate', 'sys_push', 'sys_kv', 'sys_mcp_tokens']
const BANNED = new Set(['attach', 'detach', 'pragma', 'vacuum', 'load_extension'])

/**
 * The words of a statement outside strings, quoted names and comments;
 * null when a quote or comment is never closed (refused).
 */
export function codeWords(sql) {
  const s = String(sql)
  const words = []
  let i = 0
  let word = ''
  const flush = () => {
    if (word) words.push(word.toLowerCase())
    word = ''
  }
  while (i < s.length) {
    const c = s[i]
    const close = c === "'" ? "'" : c === '"' ? '"' : c === '`' ? '`' : c === '[' ? ']' : null
    if (close) {
      flush()
      let j = i + 1
      for (;;) {
        j = s.indexOf(close, j)
        if (j < 0) return null
        if (close !== ']' && s[j + 1] === close) j += 2 // '' "" `` inside
        else break
      }
      i = j + 1
      continue
    }
    if (c === '-' && s[i + 1] === '-') {
      flush()
      const j = s.indexOf('\n', i)
      i = j < 0 ? s.length : j + 1
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      flush()
      const j = s.indexOf('*/', i + 2)
      if (j < 0) return null
      i = j + 2
      continue
    }
    if (/[A-Za-z0-9_$]/.test(c)) word += c
    else flush()
    i++
  }
  flush()
  return words
}

/** Why a statement is refused, or null when it may run. */
export function stmtProblem(stmt) {
  if (!stmt || typeof stmt !== 'object') return 'Bad statement'
  if (stmt.sql_id != null || typeof stmt.sql !== 'string') return 'Only plain SQL is accepted'
  const lower = stmt.sql.toLowerCase()
  // Anywhere, even inside quotes: "sys_auth", [sys_auth] and `sys_auth` all name the table.
  const table = PROTECTED_TABLES.find((t) => lower.includes(t))
  if (table) return `The table ${table} belongs to the server`
  const words = codeWords(stmt.sql)
  if (!words) return 'Unclosed quote or comment'
  const bad = words.find((w) => BANNED.has(w))
  if (bad) return `${bad.toUpperCase()} is not allowed`
  return null
}

/** Why a pipeline body is refused, or null when every statement may run. */
export function pipelineProblem(body) {
  if (!body || !Array.isArray(body.requests)) return 'Expected {requests: [...]}'
  if (body.baton != null) return 'Streams are not supported'
  for (const r of body.requests) {
    if (!r || typeof r !== 'object') return 'Bad request'
    if (r.type === 'close') continue
    if (r.type === 'execute') {
      const p = stmtProblem(r.stmt)
      if (p) return p
      continue
    }
    if (r.type === 'batch') {
      const steps = r.batch?.steps
      if (!Array.isArray(steps)) return 'Bad batch'
      for (const step of steps) {
        const p = stmtProblem(step?.stmt)
        if (p) return p
      }
      continue
    }
    return `Request type "${r.type}" is not allowed`
  }
  return null
}
