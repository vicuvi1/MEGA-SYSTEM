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
db.run("INSERT INTO ledger (ts, day, module, kind, coins, xp, note) VALUES (?, ?, 'quests', 'adjust', 500, 0, 'starting coins')", [new Date().toISOString(), day(3)])
db.run("INSERT INTO discipline_events (kind, day, ts) VALUES ('start', ?, ?)", [day(10), new Date().toISOString()])
db.run("INSERT INTO settings (key, value) VALUES ('pin_hash', '1234')")
// Speed tests (e2e/perf.mjs): E2E_LEDGER_ROWS made-up points rows spread over
// the last two years, about 1 in 40 undone, to see how the app copes with a long history.
{
  const n = Number(process.env.E2E_LEDGER_ROWS || 0)
  if (n > 0) {
    const mods = [['tasks', 'task_done', 5], ['focus', 'focus_block', 10], ['sleep', 'bed_on_time', 8], ['body', 'workout', 12], ['money', 'spending_logged', 3], ['quests', null, 4]]
    const ins = db.prepare('INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, ref, note, undo_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const days = 730
    let id = Number(db.exec('SELECT MAX(id) FROM ledger')[0].values[0][0])
    db.run('BEGIN')
    for (let i = 0; i < n; i++) {
      const d = day(days - Math.floor((i * days) / n))
      const [m, rule, c] = mods[i % mods.length]
      ins.run([`${d}T${String(6 + (i % 16)).padStart(2, '0')}:00:00.000Z`, d, m, 'earn', c, c, rule, `perf:${i}`, 'made-up row', null])
      id++
      if (i % 40 === 39) (ins.run([`${d}T23:00:00.000Z`, d, m, 'undo', 0, 0, rule, null, 'made-up undo', id]), id++)
    }
    db.run('COMMIT')
    ins.free()
  }
}
// A made-up chat with Ben (Night 7 smoke): his automatic messages and a short talk.
{
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString()
  const hmIn = (min) => new Date(Date.now() + min * 60000).toTimeString().slice(0, 5)
  const ben = (min, text) => ({ role: 'coach', bot: 'mega', via: 'telegram', text, at: ago(min), proactive: true, mood: 'chill' })
  const log = [
    { role: 'me', bot: 'mega', via: 'telegram', text: '30 pushups', at: ago(420) },
    { role: 'coach', bot: 'mega', via: 'telegram', text: 'Good. Water 750/2700, push-ups 30/130. 3 sets of 10 more today.', at: ago(419), done: ['💪 Push-ups +30 · 30/130 today'] },
    ben(400, '🌅 Your day · 45-min study focus first; 20-min sport, 10-min read\n\nMust-dos\n1. 45-min focus block on the study project\n2. Sport 20 min\n3. Read 10 min\n\nApprove, change it, or ask for another one.'),
    ben(240, '⏳ Your plan for today is still waiting: 45-min study focus first.\nApprove it, change it, or ask for a new one.'),
    ben(200, '🔗 Yesterday slipped (no focus yesterday). Today just do the small version: 15 minutes of focus.'),
    ben(90, '💧 Water 0.3 of 2.7 L and the day is going. Drink 4 glasses now.'),
    ben(60, '😐 Lunch check-in: how do you feel right now?'),
    ben(30, '🎯 3h 10m since your last thing. Pick anything on your list and give it 10 minutes.'),
    ben(5, `📚 🎯 Deep block (afternoon) starts at ${hmIn(9)} · 100 min · +30 points if you focus.\nStart the timer?`),
    { role: 'me', bot: 'mega', via: 'app', text: 'Just finished 20 min of reading', at: ago(3) },
    { role: 'me', bot: 'mega', via: 'app', text: 'What should I do before the block?', at: ago(3) },
    { role: 'coach', bot: 'mega', via: 'app', text: 'Good work. Reading is 20/30 min, so 10 min left for tonight.', at: ago(2), done: ['📚 Reading +20 min · 20/30 today'], undo: [{ op: 'demo' }] },
    { role: 'coach', bot: 'mega', via: 'app', text: 'Before the block: one glass of water, phone in the other room, and open the study notes. You start in 9 min.', at: ago(2), chips: ['Start the block now', 'Log 250 ml water'], show: ['day'] },
    // Coach UI v3: an action result with Undo and the plan card (`show: ['plan']`).
    { role: 'me', bot: 'mega', via: 'app', text: 'Rename Deep block 1 to App dev and redo the rest of my day', at: ago(1) },
    {
      role: 'coach',
      bot: 'mega',
      via: 'app',
      text: 'Done. **App dev** goes first while your head is fresh, study after lunch.\n\n- 3 blocks, the longest one first\n- Gym at the end, so you leave the desk on time\n\nLook it over and approve it.',
      at: ago(0.5),
      done: ['✏️ Renamed Deep block 1 → App dev', '🗓 Plan v2 ready · 3 blocks'],
      undo: [{ op: 'demo' }, null],
      show: ['plan'],
      chips: ['Approve the plan', 'Make the gym later']
    }
  ]
  db.run("INSERT INTO settings (key, value) VALUES ('coach_log', ?)", [JSON.stringify(log)])
  // Today's made-up plan, waiting for approval: blocks around now, so the timeline shows "now".
  const appDay = (() => {
    const d = new Date(Date.now() - 4 * 3600e3)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const nowM = new Date().getHours() * 60 + new Date().getMinutes()
  const base = Math.min(Math.max(0, Math.floor((nowM - 50) / 15) * 15), 23 * 60 - 480)
  const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const plan = {
    day: appDay,
    headline: 'App dev first, study after lunch, the gym to close the day',
    mustdos: ['Ship the settings screen', 'Revise algebra chapter 4', 'Gym: legs'],
    blocks: [
      { title: 'App dev', start: hm(base), minutes: 100, kind: 'focus', tasks: ['Ship the settings screen'] },
      { title: 'Draft the networking lab report', start: hm(base + 110), minutes: 60, kind: 'focus', tasks: ['Draft the networking lab report'] },
      { title: 'Study algebra', start: hm(base + 180), minutes: 90, kind: 'focus', tasks: ['Revise algebra chapter 4', 'Read chapter 4'] },
      { title: 'Quick tasks (3)', start: hm(base + 280), minutes: 45, kind: 'quick', tasks: ['Pay the internet bill', 'Email the lab partner', 'Book the dentist'] },
      { title: 'CV and a CTF challenge', start: hm(base + 335), minutes: 75, kind: 'focus', tasks: ['Update the CV projects section', 'Try one beginner CTF challenge'] }
    ],
    training: { time: hm(base + 420), what: 'Gym: legs' },
    waterMl: 2700,
    // DP1: every other task of the day, with estimates (made-up).
    also: [
      { id: 't4', title: 'Draft the networking lab report', minutes: 60, priority: 4, project: 'University', overdue: true, at: hm(base + 110) },
      { id: 't5', title: 'Update the CV projects section', minutes: 30, priority: 3, project: 'Job & Career', at: hm(base + 335) },
      { title: 'Read chapter 4', minutes: 45, priority: 2, project: 'University', at: hm(base + 180) },
      { id: 't6', title: 'Try one beginner CTF challenge', minutes: 45, priority: 2, project: 'Cyber', at: hm(base + 335) },
      { id: 't1', title: 'Pay the internet bill', minutes: 15, priority: 1, project: 'Inbox', at: hm(base + 280) },
      { id: 't2', title: 'Email the lab partner', minutes: 15, priority: 1, project: 'Inbox', at: hm(base + 280) },
      { id: 't7', title: 'Book the dentist', minutes: 15, priority: 1, project: 'Inbox', at: hm(base + 280) }
    ],
    deferred: [
      { id: 't8', title: 'Watch the refactoring talk, part 1', why: 'The day is full (today already has 6h10 of focus): tomorrow' },
      { id: 't9', title: 'Sort the photo folder', why: 'The day is full (today already has 6h10 of focus): tomorrow' }
    ],
    why: '11 tasks and 2 classes, 7h free: 5 blocks (6h10), small tasks batched.'
  }
  db.run("INSERT INTO settings (key, value) VALUES ('coach_rhythm', ?)", [JSON.stringify({ day: appDay, water: [], briefing: { status: 'proposed', sentAt: ago(30), plan, version: 2 } })])
}
// Made-up Finance Helper data (Night 11 Money hub): two months of everyday
// spending, a salary, rent, a monthly limit and two savings goals. Nothing real.
{
  const iso = (d) => d.toISOString().slice(0, 10)
  const today = new Date()
  const month0 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  const monthStart = (k) => iso(new Date(Date.UTC(month0.getUTCFullYear(), month0.getUTCMonth() + k, 1)))
  let seed = 7
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
  const tx = []
  let n = 0
  const add = (date, type, lei, category, note, account = 'wallet') => tx.push({ id: `demo-${n++}`, createdAt: 1, updatedAt: 1, type, amount: Math.round(lei * 100), currency: 'MDL', rate: 1, base: Math.round(lei * 100), date, category, account, note })
  for (let back = 62; back >= 0; back--) {
    const date = day(back)
    add(date, 'expense', 35 + Math.round(rnd() * 55), 'food', ['Lunch', 'Coffee and a bun', 'Groceries', 'Dinner'][back % 4])
    if (back % 3 === 0) add(date, 'expense', 12 + Math.round(rnd() * 30), 'transport', back % 2 ? 'Bus' : 'Taxi', 'card')
    if (back % 6 === 2) add(date, 'expense', 90 + Math.round(rnd() * 120), 'fun', back % 4 ? 'Cinema' : 'Board game night', 'card')
    if (back % 9 === 4) add(date, 'expense', 60 + Math.round(rnd() * 90), 'clothes', 'Socks and a T-shirt', 'card')
    if (back % 11 === 5) add(date, 'expense', 45 + Math.round(rnd() * 40), 'health', 'Pharmacy')
  }
  for (const k of [-2, -1, 0]) {
    const d = monthStart(k)
    if (d <= day(0)) add(d, 'income', 9000, 'work', 'Salary', 'card')
    const rent = d.slice(0, 8) + '03'
    if (rent <= day(0)) add(rent, 'expense', 2500, 'home', 'Rent', 'card')
  }
  const data = {
    settings: {
      currency: 'MDL',
      updatedAt: 1,
      limit: { on: true, amount: 450000 },
      accounts: [
        { id: 'wallet', name: 'Wallet', kind: 'cash', emoji: '💵', currency: 'MDL', start: 300000, updatedAt: 1 },
        { id: 'card', name: 'Bank card', bank: 'maib', kind: 'card', emoji: '💳', currency: 'MDL', start: 800000, updatedAt: 1 },
        { id: 'safe', name: 'Safe', kind: 'savings', savings: true, emoji: '🏦', currency: 'MDL', start: 500000, updatedAt: 1 }
      ]
    },
    tx,
    recurring: [
      { id: 'r-rent', type: 'expense', amount: 250000, note: 'Rent', category: 'home', account: 'card', every: 'month', start: `${monthStart(-2).slice(0, 8)}03`, lastDone: day(0) >= `${day(0).slice(0, 8)}03` ? `${day(0).slice(0, 8)}03` : null, updatedAt: 1 },
      { id: 'r-net', type: 'expense', amount: 15000, note: 'Internet', category: 'subscriptions', account: 'card', every: 'month', start: day(-2), updatedAt: 1 },
      { id: 'r-pay', type: 'income', amount: 900000, note: 'Salary', category: 'work', account: 'card', every: 'month', start: monthStart(-2), lastDone: monthStart(0), updatedAt: 1 }
    ],
    goals: [
      { id: 'g-laptop', name: 'New laptop', emoji: '💻', target: 1500000, account: 'manual', saved: 420000, deadline: day(-120), history: [{ date: day(70), amount: 150000 }, { date: day(40), amount: 140000 }, { date: day(10), amount: 130000 }], updatedAt: 1 },
      { id: 'g-trip', name: 'Mountain trip', emoji: '🏔️', target: 600000, account: 'manual', saved: 380000, deadline: null, history: [{ date: day(50), amount: 200000 }, { date: day(20), amount: 180000 }], updatedAt: 1 }
    ],
    people: [],
    deleted: {}
  }
  db.run("INSERT INTO settings (key, value) VALUES ('app_sync_finance', ?)", [JSON.stringify({ savedAt: Date.now(), data })])
}

// Made-up goals (Goals page smoke and screenshots): three you can measure with
// a few weekly check-ins, and one hour goal planned into focus blocks.
{
  const ahead = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
  const g = db.prepare("INSERT INTO focus_goals (title, subject, deadline, hours, created_day, kind, unit, unit_label, target, start_value, why, area, cadence, source, milestones, curve) VALUES (?, '', ?, ?, ?, 'measure', ?, ?, ?, ?, ?, ?, ?, '{\"kind\":\"manual\"}', '[]', ?)")
  const c = db.prepare("INSERT INTO goal_checkins (id, goal_id, at, day, value, who) VALUES (?, ?, ?, ?, ?, 'me')")
  const add = (row, checks) => {
    g.run(row)
    const id = Number(db.exec('SELECT MAX(id) FROM focus_goals')[0].values[0][0])
    for (const [n, v] of checks) c.run([`demo${id}-${n}`, id, `${day(n)}T18:00:00.000Z`, day(n), v])
  }
  add(['Profit 5,000 lei a month', ahead(55), 5000, day(36), 'lei', null, 5000, 1200, 'Rent and savings without stress', 'Money', 'weekly', 'line'], [[29, 1500], [22, 1850], [15, 2200], [8, 2450]])
  add(['Lose 5 kg', ahead(86), 77, day(36), 'kg', null, 77, 82, 'Feel light on the bike again', 'Body', 'weekly', 'front'], [[26, 81.3], [12, 80.2], [2, 79.5]])
  add(['100 GitHub stars', ahead(145), 100, day(52), 'custom', 'stars', 100, 12, 'A portfolio people notice', 'Career', 'weekly', 'ramp'], [[36, 18], [17, 26], [3, 33]])
  db.run("INSERT INTO focus_goals (title, subject, deadline, hours, created_day) VALUES ('Rust book', 'Rust', ?, 30, ?)", [ahead(40), day(10)])
  db.run("INSERT INTO focus_sessions (day, subject, minutes, coins, started_at, ended_at) VALUES (?, 'Rust', 240, 0, ?, ?)", [day(4), new Date().toISOString(), new Date().toISOString()])
  g.free()
  c.free()
}

// E2E_REWARDS_DEMO=1: a month of made-up points and a few made-up rewards, for
// looking at the Rewards page (screenshots). Off for the smoke test.
if (process.env.E2E_REWARDS_DEMO) {
  const ins = db.prepare('INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, ref, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  let k = 0
  const put = (n, mod, kind, coins, rule, note) => ins.run([`${day(n)}T10:00:00.000Z`, day(n), mod, kind, coins, 0, rule, `demo:${k++}`, note])
  for (let n = 29; n >= 0; n--) {
    const f = n < 9 ? 1 + (n % 3) : n % 4 === 0 ? 0 : 1 + (n % 2)
    for (let i = 0; i < f; i++) put(n, 'focus', 'earn', 15, 'focus.session', 'Focus 50 min · Study')
    for (let i = 0; i < (n * 7) % 4; i++) put(n, 'plan', 'earn', 10, 'plan.item_done', 'Must-do: made-up task')
    for (let i = 0; i < (n * 5) % 3; i++) put(n, 'tasks', 'earn', 5, 'tasks.todoist_done', 'Task done')
    for (let i = 0; i < 2 + (n % 3); i++) put(n, 'sleep', 'earn', 2, 'sleep.up_on_time', 'Up on time')
    if (n % 6 === 2) put(n, 'focus', 'spend', -30, 'focus.fun', 'Fun 30 min')
    if (n === 11) put(n, 'plan', 'earn', 5, null, 'Lucky +5 for a finished must-do')
  }
  put(0, 'quests', 'adjust', -1100, null, 'made-up: start lower')
  const add = db.prepare('INSERT INTO rewards (title, price, tier, real_cost, pinned, note, emoji, category, cooldown_days, one_time, goal_rank, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  add.run(['Pizza night', 120, 'bronze', 150, 0, 'The good place, large', '🍕', 'food', 3, 0, 0, 1])
  add.run(['Cinema with friends', 250, 'bronze', 120, 0, null, '🎟️', 'experience', 0, 0, 0, 2])
  add.run(['New headphones', 900, 'bronze', 1200, 1, 'Over-ear, noise cancelling', '🎧', 'gear', 0, 1, 1, 3])
  add.run(['New game release', 600, 'bronze', 700, 0, null, '🎮', 'fun', 0, 1, 0, 4])
  add.run(['Spa afternoon', 400, 'bronze', 450, 0, null, '💆', 'selfcare', 30, 0, 0, 5])
  add.run(['Mountain weekend', 5000, 'bronze', 3000, 0, 'With the whole group', '🏔️', 'big', 0, 1, 2, 6])
  db.run('UPDATE rewards SET pinned = 0 WHERE title NOT IN (\'New headphones\')')
  db.run("UPDATE rewards SET archived = 1 WHERE emoji IS NULL")
}

Object.assign(process.env, { TURSO_URL: `http://127.0.0.1:${port}`, TURSO_TOKEN: 'fake-turso-key', SESSION_SECRET: 'e2e-secret' })
const api = {}
for (const n of ['login', 'db', 'config', 'mcp']) api[n] = (await import(pathToFileURL(join(repo, 'api', `${n}.mjs`)).href)).default

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
  const tasks = [t('t1', 'Pay the internet bill', day, null), t('t2', 'Email the lab partner', day, '16:00'), t('t3', 'Read chapter 4', null, null), t('t4', 'Draft the networking lab report', day, null), t('t5', 'Update the CV projects section', day, null), t('t6', 'Try one beginner CTF challenge', day, null), t('t7', 'Book the dentist', day, null), t('t8', 'Watch the refactoring talk, part 1', day, null)]
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
  if (b.op === 'status') return send({ configured: true, model: aiChosen.chat || 'deepseek/deepseek-v4.1-flash', chosen: aiChosen, auto: { chat: 'deepseek/deepseek-v4.1-flash', deep: 'deepseek/deepseek-v4-pro' }, newer: { chat: 'deepseek/deepseek-v4.2-flash', deep: null } })
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

// Like Vercel (CL1): an answer from a function may be at most 4.5 MB; bigger ones fail.
const MAX_ANSWER = 4.5 * 1024 * 1024
function capAnswer(r) {
  const end = r.end.bind(r)
  r.end = (body, ...rest) => {
    if (body != null && Buffer.byteLength(body) > MAX_ANSWER) {
      stats.tooBig++
      r.statusCode = 500
      r.setHeader('Content-Type', 'text/plain')
      return end('FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE')
    }
    return end(body, ...rest)
  }
}

// For the soak test (e2e/soak.mjs): calls counted by path, and "the server is down" on demand.
const stats = { calls: {}, tooBig: 0 }
let down = false
let schemaOld = false
function e2eControl(q, r) {
  const b = q.body || {}
  if (b.op === 'down') down = !!b.on
  if (b.op === 'schema') schemaOld = !!b.on
  if (b.op === 'reset') (stats.calls = {}), (stats.db = undefined)
  if (b.op === 'sql') {
    try {
      const out = db.exec(String(b.sql))
      r.setHeader('Content-Type', 'application/json')
      return r.end(JSON.stringify({ rows: out[0]?.values ?? [] }))
    } catch (e) {
      r.statusCode = 400
      return r.end(JSON.stringify({ error: e.message }))
    }
  }
  r.setHeader('Content-Type', 'application/json')
  r.end(JSON.stringify({ ...stats, down }))
}

// The same response headers as production (vercel.json), so the smoke test
// runs under the real Content-Security-Policy (LT3).
const vercelHeaders = JSON.parse(readFileSync(join(repo, 'vercel.json'), 'utf8')).headers.map((h) => ({ re: new RegExp(`^${h.source}$`), headers: h.headers }))
const withHeaders = (pathname, r) => {
  for (const h of vercelHeaders) if (h.re.test(pathname)) for (const { key, value } of h.headers) r.setHeader(key, value)
}
const dist = process.env.E2E_DIST || join(repo, 'dist')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }
http
  .createServer((q, r) => {
    let body = ''
    q.on('data', (c) => (body += c))
    q.on('end', () => {
      const url = new URL(q.url, 'http://x')
      if (url.pathname !== '/v2/pipeline') withHeaders(url.pathname, r)
      if (url.pathname.startsWith('/api/')) {
        const n = url.pathname.slice(5)
        q.body = body ? JSON.parse(body) : {}
        if (n === '_e2e') return e2eControl(q, r)
        const key = n + (q.body?.op ? `:${q.body.op}` : url.searchParams.get('job') ? `:${url.searchParams.get('job')}` : '')
        stats.calls[key] = (stats.calls[key] ?? 0) + 1
        if (n === 'db' && process.env.SOAK_DEBUG) {
          const first = (q.body.requests ?? []).map((x) => x.stmt?.sql ?? x.batch?.steps?.map((st) => st.stmt.sql).join(';') ?? '').join(' | ').slice(0, 90)
          stats.db = stats.db ?? {}
          stats.db[first] = (stats.db[first] ?? 0) + 1
        }
        if (down) return ((r.statusCode = 503), r.end('{"error":"down for the soak test"}'))
        // The soak test's "new database version": writes from this page are refused until it reloads (LT22).
        if (schemaOld && n === 'db' && /\b(INSERT|UPDATE|DELETE)\b/i.test(body)) return (r.setHeader('Content-Type', 'application/json'), (r.statusCode = 409), r.end('{"error":"A new version is out — please reload","reload":true}'))
        // A stand-in for Ben's server tick (the app wakes it every few minutes).
        if (n === 'cron') return (r.setHeader('Content-Type', 'application/json'), r.end('{"ok":true,"skipped":true}'))
        if (n === 'google') return gcal(q, r)
        if (n === 'todoist') return todo(q, r)
        if (n === 'ai') return fakeAi(q, r)
        if (api[n]) capAnswer(r)
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
