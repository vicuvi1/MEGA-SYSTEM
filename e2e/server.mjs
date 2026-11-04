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

// A fake Google Calendar (made-up events this week), so the calendar can be tested.
const gcal = (() => {
  const at = (dayOffset, hm) => {
    const d = new Date()
    d.setDate(d.getDate() + dayOffset)
    const [h, m] = hm.split(':').map(Number)
    d.setHours(h, m, 0, 0)
    return d.toISOString()
  }
  let n = 0
  const ev = (dayOffset, s, e, title, color) => ({ id: `ev${++n}`, calendarId: 'primary', title, start: at(dayOffset, s), end: at(dayOffset, e), allDay: false, color, ours: false })
  const events = [
    ev(0, '07:00', '09:00', 'Deep block 1', '#c084fc'),
    ev(0, '09:45', '11:15', 'Lecture: Algorithms', '#7cc4ff'),
    ev(0, '13:30', '15:00', 'Lab: Programming', '#7cc4ff'),
    ev(0, '18:05', '22:00', 'Calls + work window', '#5eead4'),
    ev(0, '18:30', '19:00', 'Stand-up', '#fbbf24'),
    ev(0, '18:30', '19:15', 'Client call', '#f87171'),
    ev(0, '19:00', '20:00', 'Downstream review', '#f87171'),
    ev(0, '19:00', '19:30', 'Quick sync', '#fbbf24'),
    ev(0, '19:10', '19:40', 'Mentor chat', '#a3e635'),
    ev(0, '20:00', '21:00', 'Interview prep', '#a3e635'),
    ev(1, '07:00', '09:00', 'Deep block 1', '#c084fc'),
    ev(1, '12:00', '13:30', 'Lecture: Math', '#7cc4ff'),
    ev(1, '17:00', '17:30', 'Sport (20 min)', '#fbbf24'),
    { ...ev(1, '20:00', '21:00', 'Weekly review', '#a78bfa'), recurringEventId: 'series1' }
  ]
  return (q, r) => {
    const b = q.body || {}
    const send = (j) => (r.setHeader('Content-Type', 'application/json'), r.end(JSON.stringify(j)))
    if (b.op === 'status') return send({ configured: true, connected: true, calendars: [{ id: 'primary', name: 'Test calendar', color: '#7cc4ff', canWrite: true, on: true }] })
    if (b.op === 'events') return send({ events: events.filter((e) => e.end > b.from && e.start < b.to) })
    if (b.op === 'create') {
      const e = { id: `ev${++n}`, calendarId: 'primary', title: b.title, start: b.start, end: b.end, allDay: false, ours: true }
      events.push(e)
      return send({ event: e })
    }
    const e = events.find((x) => x.id === b.id)
    if (b.op === 'move' && e) return (Object.assign(e, { start: b.start, end: b.end }), send({ ok: true }))
    if (b.op === 'update' && e) {
      gcal.last = b
      return (Object.assign(e, Object.fromEntries(Object.entries({ title: b.title, start: b.start, end: b.end, description: b.description, colorId: b.colorId }).filter(([, v]) => v !== undefined))), send({ ok: true }))
    }
    if (b.op === 'lastUpdate') return send(gcal.last ?? null)
    if (b.op === 'remove' && e) return (events.splice(events.indexOf(e), 1), send({ ok: true }))
    return send({ ok: true })
  }
})()

// A fake Todoist (made-up tasks): one waiting to be scheduled, one timed today.
const todo = (() => {
  const day = new Date().toISOString().slice(0, 10)
  const t = (id, content, due, dueTime) => ({ id, content, priority: 1, due, dueTime, project: 'Inbox', section: null, recurring: false, projectId: 'p1', sectionId: null, labels: [], duration: null })
  const tasks = [t('t1', 'Pay the internet bill', day, null), t('t2', 'Email the lab partner', day, '16:00'), t('t3', 'Read chapter 4', null, null)]
  return (q, r) => {
    const b = q.body || {}
    const send = (j) => (r.setHeader('Content-Type', 'application/json'), r.end(JSON.stringify(j)))
    const open = tasks.filter((x) => !x.done)
    if (b.op === 'status') return send({ connected: true })
    if (b.op === 'everything') return send({ tasks: open, areas: [{ key: 'p:p1', kind: 'project', id: 'p1', projectId: 'p1', name: 'Inbox' }] })
    if (b.op === 'today' || b.op === 'upcoming') return send({ connected: true, tasks: open.filter((x) => x.due) })
    if (b.op === 'changes') return send({ token: 'x', changed: 0 })
    const x = tasks.find((y) => y.id === b.id)
    if (b.op === 'update' && x) {
      if (b.due) [x.due, x.dueTime] = b.due === 'no date' ? [null, null] : [b.due.slice(0, 10), b.due.slice(11, 16) || null]
      if (b.duration !== undefined) x.duration = b.duration
      return send({ ok: true })
    }
    if (b.op === 'close' && x) return ((x.done = true), send({ ok: true }))
    if (b.op === 'peek') return send(tasks)
    return send({ ok: true, tasks: [], items: [] })
  }
})()

// Fake /api/ai: Ben's brain settings (model list with prices, usage), no real AI.
let aiChosen = { chat: null, deep: null }
const fakeAi = (q, r) => {
  const send = (j) => (r.setHeader('Content-Type', 'application/json'), r.end(JSON.stringify(j)))
  const b = q.body || {}
  if (b.op === 'status') return send({ configured: true, model: aiChosen.chat || 'deepseek/deepseek-v4.1-flash', chosen: aiChosen, auto: { chat: 'deepseek/deepseek-v4.1-flash', deep: 'deepseek/deepseek-v4-pro' } })
  if (b.op === 'models')
    return send({ models: [
      { id: 'anthropic/claude-sonnet-5.5', name: 'Anthropic: Claude Sonnet 5.5', in: 3, out: 15, context: 1000000, tools: true, reasoning: true },
      { id: 'openai/gpt-6-mini', name: 'OpenAI: GPT-6 mini', in: 0.4, out: 1.6, context: 400000, tools: true, reasoning: true },
      { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek: V4.1 Flash', in: 0.1, out: 0.4, context: 128000, tools: true, reasoning: false },
      { id: 'meta/llama-free', name: 'Meta: Llama (free)', in: 0, out: 0, context: 64000, tools: false, reasoning: false }
    ] })
  if (b.op === 'setModels') return ((aiChosen = { chat: b.chat || null, deep: b.deep || null }), send({ ok: true, chosen: aiChosen }))
  if (b.op === 'usage')
    return send({ today: { calls: 14, cost: 0.083, tokens: 112000 }, week: { calls: 96, cost: 0.61, tokens: 790000 }, month: { calls: 380, cost: 2.4, tokens: 3100000 }, byModel: [{ model: 'deepseek/deepseek-v4.1-flash', calls: 340, cost: 0.9, tokens: 2800000 }, { model: 'anthropic/claude-sonnet-5.5', calls: 40, cost: 1.5, tokens: 300000 }], recent: [{ at: new Date().toISOString(), model: 'anthropic/claude-sonnet-5.5', kind: 'chat', prompt: 8200, completion: 420, cost: 0.031 }], credits: { total: 20, used: 7.5, left: 12.5 } })
  if (b.op === 'eval')
    return send({ model: b.model || 'deepseek/deepseek-v4.1-flash', passed: 17, total: 20, cost: 0.042, calls: 23, results: [
      { id: 'spend', say: 'spent 50 lei on lunch', want: 'logs a 50 lei expense', ok: true, trace: '✅ Logged: lunch 50\nREPLY: Logged.', ms: 3200 },
      { id: 'delete', say: 'delete the gym block, not going today', want: 'deletes the Gym block', ok: false, trace: 'REPLY: Ok, skip it.', ms: 2900 }
    ] })
  r.statusCode = 503
  return send({ error: 'No AI in the e2e server' })
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
        if (n === 'google') return gcal(q, r)
        if (n === 'todoist') return todo(q, r)
        if (n === 'ai') return fakeAi(q, r)
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
