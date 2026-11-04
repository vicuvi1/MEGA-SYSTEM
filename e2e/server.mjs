// A local stand-in for production, for the smoke tests: serves the built app
// (dist/), a fake Turso (/v2/pipeline, in memory, made-up data) and the real
// /api handlers pointed at it. No real data, no real tokens.
//   node e2e/server.mjs [port]
import http from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.argv[2] || process.env.E2E_PORT || 5299)
const require = createRequire(join(repo, 'package.json'))
const SQL = await require('sql.js')({ locateFile: (f) => require.resolve('sql.js/dist/' + f) })
const db = new SQL.Database()
for (const m of [...readFileSync(join(repo, 'src/core/schema.ts'), 'utf8').matchAll(/`([\s\S]*?)`/g)].map((x) => x[1])) db.exec(m)
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
db.run("INSERT INTO ledger (ts, day, module, kind, coins, xp, note) VALUES (?, ?, 'x', 'adjust', 500, 0, 'starting coins')", [new Date().toISOString(), day(3)])
db.run("INSERT INTO discipline_events (kind, day, ts) VALUES ('start', ?, ?)", [day(10), new Date().toISOString()])
db.run("INSERT INTO settings (key, value) VALUES ('pin_hash', '1234')")

Object.assign(process.env, { TURSO_URL: `http://127.0.0.1:${port}`, TURSO_TOKEN: 'fake-turso-key', SESSION_SECRET: 'e2e-secret' })
const api = {}
for (const n of ['login', 'db', 'config']) api[n] = (await import(pathToFileURL(join(repo, 'api', `${n}.mjs`)).href)).default

const toH = (v) => (v === null || v === undefined ? { type: 'null' } : typeof v === 'number' ? (Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v }) : { type: 'text', value: String(v) })
const fromH = (v) => (!v || v.type === 'null' ? null : v.type === 'integer' || v.type === 'float' ? Number(v.value) : v.value)
function run(stmt) {
  const s = db.prepare(stmt.sql)
  try {
    s.bind((stmt.args || []).map(fromH))
    const cols = s.getColumnNames()
    const rows = []
    while (s.step()) rows.push(s.get())
    return { cols: cols.map((name) => ({ name })), rows: rows.map((r) => r.map(toH)), affected_row_count: db.getRowsModified() }
  } finally {
    s.free()
  }
}
function pipeline(body) {
  const results = []
  for (const req of body.requests || []) {
    if (req.type === 'close') results.push({ type: 'ok', response: { type: 'close' } })
    else if (req.type === 'execute') {
      try {
        results.push({ type: 'ok', response: { type: 'execute', result: run(req.stmt) } })
      } catch (e) {
        results.push({ type: 'error', error: { message: e.message } })
      }
    } else if (req.type === 'batch') {
      const sr = []
      const se = []
      const ok = (c) => (!c ? true : c.type === 'ok' ? sr[c.step] != null : c.type === 'not' ? !ok(c.cond) : true)
      req.batch.steps.forEach((st, i) => {
        sr[i] = null
        se[i] = null
        if (!ok(st.condition)) return
        try {
          sr[i] = run(st.stmt)
        } catch (e) {
          se[i] = { message: e.message }
        }
      })
      results.push({ type: 'ok', response: { type: 'batch', result: { step_results: sr, step_errors: se } } })
    }
  }
  return { results }
}

const dist = join(repo, 'dist')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
http
  .createServer((q, r) => {
    let body = ''
    q.on('data', (c) => (body += c))
    q.on('end', () => {
      const url = new URL(q.url, 'http://x')
      if (url.pathname.startsWith('/api/')) {
        const n = url.pathname.slice(5)
        q.body = body ? JSON.parse(body) : {}
        return api[n] ? api[n](q, r) : ((r.statusCode = 404), r.end('{}'))
      }
      if (url.pathname === '/v2/pipeline') {
        if (q.headers.authorization !== 'Bearer fake-turso-key') return ((r.statusCode = 401), r.end('{}'))
        r.setHeader('Content-Type', 'application/json')
        return r.end(JSON.stringify(pipeline(JSON.parse(body))))
      }
      let p = join(dist, decodeURIComponent(url.pathname))
      if (!existsSync(p) || statSync(p).isDirectory()) p = existsSync(join(p, 'index.html')) ? join(p, 'index.html') : join(dist, 'index.html')
      r.setHeader('Content-Type', types[extname(p)] || 'application/octet-stream')
      r.end(readFileSync(p))
    })
  })
  .listen(port, () => console.log(`e2e server on http://127.0.0.1:${port}`))
