// A local stand-in for production, for the smoke tests: serves the built app
// (dist/), a fake Turso (/v2/pipeline, in memory, made-up data) and the real
// /api handlers pointed at it. No real data, no real tokens.
//   node e2e/server.mjs [port]
import http from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

// E2E_NOW=<ms since 1970>: this server lives at that moment (the clock keeps
// ticking from there), so the made-up day and every server "now" match the
// browser's fixed clock in e2e/smoke.mjs, whatever the real time of day is.
if (process.env.E2E_NOW) {
  const RealDate = Date
  const shift = Number(process.env.E2E_NOW) - RealDate.now()
  if (!Number.isFinite(shift)) throw new Error('E2E_NOW must be a time in milliseconds')
  globalThis.Date = class extends RealDate {
    constructor(...a) {
      if (a.length) super(...a)
      else super(RealDate.now() + shift)
    }
    static now() {
      return RealDate.now() + shift
    }
  }
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.argv[2] || process.env.E2E_PORT || 5299)
const require = createRequire(join(repo, 'package.json'))
const SQL = await require('sql.js')({ locateFile: (f) => require.resolve('sql.js/dist/' + f) })
const db = new SQL.Database()
for (const m of [...readFileSync(join(repo, 'src/core/schema.ts'), 'utf8').matchAll(/`([\s\S]*?)`/g)].map((x) => x[1])) db.exec(m)
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
db.run("INSERT INTO ledger (ts, day, module, kind, coins, xp, note) VALUES (?, ?, 'quests', 'adjust', 500, 0, 'starting coins')", [new Date().toISOString(), day(3)])
if (process.env.E2E_DISCIPLINE !== 'demo') db.run("INSERT INTO discipline_events (kind, day, ts) VALUES ('start', ?, ?)", [day(10), new Date().toISOString()])
db.run("INSERT INTO settings (key, value) VALUES ('pin_hash', '1234')")
// E2E_DISCIPLINE=demo: a made-up 5-month Discipline history (check-ins, urges, two
// honest resets) for screenshots of the Discipline page.
if (process.env.E2E_DISCIPLINE === 'demo') {
  const ins = db.prepare('INSERT INTO discipline_events (kind, day, ts) VALUES (?, ?, ?)')
  const at = (n, h) => `${day(n)}T${String(h).padStart(2, '0')}:10:00.000Z`
  ins.run(['start', day(160), at(160, 12)])
  for (let n = 159; n >= 1; n--) {
    if (n === 118 || n === 18) ins.run(['reset', day(n), at(n, 23)])
    else if (n % 9 !== 4) ins.run(['checkin', day(n), at(n, 21)])
    if (n % 5 === 2 || n % 11 === 3) ins.run(['urge', day(n), at(n, n % 3 ? 22 : 15)])
  }
  ins.free()
  db.run("INSERT INTO settings (key, value) VALUES ('discipline_why', 'To be clear-headed and proud of who I am becoming.')")
}
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
  // Coach fix: last night's plan card (before the app day turned at 04:00): it must show as expired.
  const dayStartMs = (() => {
    const d = new Date()
    if (d.getHours() < 4) d.setDate(d.getDate() - 1)
    d.setHours(4, 0, 0, 0)
    return d.getTime()
  })()
  const lastNight = (min) => new Date(dayStartMs - min * 60000).toISOString()
  // Ben 2: last night's weekly card (made-up numbers), with its push data for the Coach card.
  const weekly = { score: 72, delta: 5, wins: ['Training: 4 of 4', 'Focus: 9h of 10h', 'Must-dos: 15 of 21'], fix: 'Wake-ups: 3 of 7' }
  const log = [
    { role: 'coach', bot: 'mega', via: 'telegram', proactive: true, text: '📊 Your week: 72/100 (+5 vs last week)\n\n🏆 Wins\n• Training: 4 of 4\n• Focus: 9h of 10h\n• Must-dos: 15 of 21\n\n🔧 One thing to fix: Wake-ups: 3 of 7', at: lastNight(170), push: { type: 'weekly', key: 'weekly:demo', title: 'Your week', lines: ['📊 Your week: 72/100 (+5 vs last week)'], weekly } },
    { role: 'me', bot: 'mega', via: 'app', text: 'plan tomorrow for me, short night', at: lastNight(150) },
    { role: 'coach', bot: 'mega', via: 'app', text: 'Short night, so a lighter day: one 40-minute block for now. See you in the morning.', at: lastNight(149), show: ['plan'] },
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
  db.run("INSERT INTO settings (key, value) VALUES ('coach_rhythm', ?)", [JSON.stringify({ day: appDay, water: [], briefing: { status: 'proposed', sentAt: ago(30), plan, version: 2, planner: 2 } })])
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

// Made-up career data (Career page smoke and screenshots): companies from the
// usual sample names, a few flashcards, an essay, a portfolio, a money plan.
// E2E_CAREER_DEMO=1 also adds a work window and some focus time (screenshots only).
{
  const set = (k, v) => db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)])
  const ahead = (n) => day(-n)
  const job = (id, company, role, stage, added, applied, followUp, moves) => ({ id, company, role, link: null, stage, added: day(added), applied: applied == null ? null : day(applied), followUp: followUp == null ? null : day(followUp), chased: 0, notes: '', moves: moves.map(([s, n]) => ({ stage: s, day: day(n) })) })
  set('career_jobs', {
    quota: 3,
    jobs: [
      job('dj1', 'Northwind Labs', 'SOC analyst intern', 'applied', 9, 8, 1, [['found', 9], ['applied', 8]]),
      job('dj2', 'Contoso Security', 'Junior pentester', 'interview', 20, 18, -1, [['found', 20], ['applied', 18], ['interview', 1]]),
      job('dj3', 'Fabrikam Cloud', 'Security support intern', 'applied', 3, 1, -6, [['found', 3], ['applied', 1]]),
      job('dj4', 'Tailspin Games', 'Backend intern (Rust)', 'found', 2, null, null, [['found', 2]]),
      job('dj5', 'Litware Bank', 'IT security trainee', 'found', 1, null, null, [['found', 1]]),
      job('dj6', 'Adventure Works', 'Helpdesk + security', 'no', 30, 28, null, [['found', 30], ['applied', 28], ['no', 12]]),
      job('dj7', 'Proseware', 'Junior analyst', 'applied', 15, 14, -2, [['found', 15], ['applied', 14]]),
      job('dj8', 'Woodgrove Labs', 'Red team intern', 'offer', 40, 38, -2, [['found', 40], ['applied', 38], ['interview', 20], ['offer', 1]])
    ]
  })
  set('career_proofs', [
    { id: 'dp1', kind: 'ctf', title: 'Practice CTF: the login that trusted cookies', problem: 'A made-up web challenge where the admin flag sat behind a cookie the server never checked.', did: 'Read the requests in Burp, changed role=user to role=admin and wrote down how to fix it with a signed session.', skills: ['Web security', 'Burp Suite', 'Sessions'], link: 'https://example.com/writeups/cookie', day: day(4), pub: true },
    { id: 'dp2', kind: 'crate', title: 'tiny-xor: a small Rust crate for XOR ciphers', problem: 'I wanted to understand repeating-key XOR and how it breaks.', did: 'Wrote the cipher, a key-length guesser and tests in Rust; published the code with examples.', skills: ['Rust', 'Cryptography', 'Testing'], link: 'https://example.com/code/tiny-xor', day: day(11), pub: true },
    { id: 'dp3', kind: 'lab', title: 'Firewall lab: lock down a practice server', problem: 'A university lab: a practice server with every port open.', did: 'Closed all but SSH and HTTPS with nftables, logged the drops and wrote a short report.', skills: ['Linux', 'Networking', 'nftables'], link: null, day: day(19), pub: true },
    { id: 'dp4', kind: 'feature', title: 'Study packs for quiet moments', problem: 'Idle minutes at work were wasted.', did: 'Built a small planner feature that offers 10–25 minute study packs.', skills: ['TypeScript', 'React'], link: null, day: day(26), pub: false }
  ])
  const card = (id, front, back, deck, ivl, reps, dueIn, lastAgo) => ({ id, front, back, deck, created: day(30), due: day(-dueIn), ivl, ease: 2.5, reps, lapses: 0, last: lastAgo == null ? null : day(lastAgo) })
  set('career_cards', {
    cards: [
      card('dc1', 'Which port does SSH use?', '22', 'Ports', 3, 2, 0, 3),
      card('dc2', 'Which port does HTTPS use?', '443', 'Ports', 8, 3, 0, 8),
      card('dc3', 'What does XOR of a value with itself give?', '0', 'Crypto', 1, 1, 0, 1),
      card('dc4', 'In RSA, what is n?', 'The product of the two primes p and q', 'Crypto', 0, 0, 0, null),
      card('dc5', 'Rust: how many mutable borrows can exist at once?', 'One (and no shared borrows at the same time)', 'Rust', 0, 0, 0, null),
      card('dc6', 'Which port does DNS use?', '53', 'Ports', 25, 5, 10, 15),
      card('dc7', 'What does the "S" in HTTPS stand for?', 'Secure (HTTP over TLS)', 'Ports', 30, 6, 12, 18)
    ],
    log: Array.from({ length: 24 }, (_, i) => ({ day: day(1 + (i % 9)), id: `dc${1 + (i % 7)}`, grade: i % 6 === 0 ? 'again' : 'good' }))
  })
  const essayDue = ahead(6)
  const steps = [['outline', 'Outline', 2, 40, true], ['draft', 'Draft 1/3', 1, 50, true], ['draft', 'Draft 2/3', 0, 50, false], ['draft', 'Draft 3/3', -1, 50, false], ['edit', 'Edit', -3, 40, false], ['submit', 'Submit', -6, 15, false]]
  set('career_study', {
    essays: [
      { id: 'de1', title: 'Made-up essay: privacy in smart cities', due: essayDue, words: 1400, added: day(4), tight: false, steps: steps.map(([kind, label, n, minutes, done], i) => ({ id: `de1-${i}`, kind, label, day: day(n), minutes, done })) },
      { id: 'de2', title: 'Lab report: packet capture', due: ahead(2), words: 800, added: day(5), tight: false, steps: [['outline', 'Outline', 3, 30, true], ['draft', 'Draft 1/2', 2, 50, false], ['draft', 'Draft 2/2', 1, 50, false], ['edit', 'Edit', -1, 25, false], ['submit', 'Submit', -2, 15, false]].map(([kind, label, n, minutes, done], i) => ({ id: `de2-${i}`, kind, label, day: day(n), minutes, done })) }
    ],
    queue: [
      { id: 'dq1', kind: 'ctf', text: 'Practice CTF: a format string warm-up', link: null, done: false, added: day(3) },
      { id: 'dq2', kind: 'reading', text: 'A short guide to the OWASP Top 10: injection', link: null, done: false, added: day(2) }
    ],
    turn: 0
  })
  set('career_money', {
    plan: { months: 3, payPct: 20, careerPct: 25, careerGoal: 2500, careerGoalName: 'Certificate exam voucher', investMonthly: 500, investRate: 5, investYears: 10, incomeTarget: 12000, moves: [{ id: 'dm1', text: 'Apply to 2 paid internships', done: true }, { id: 'dm2', text: 'One small freelance bot a month', done: false }], fundStart: 0 },
    answers: [
      { txId: 'old-1', day: day(66), moved: 1500, answered: day(66) },
      { txId: 'old-2', day: day(36), moved: 1800, answered: day(36) }
    ],
    spends: [{ id: 'ds1', what: 'A month of a practice lab platform', lei: 180, day: day(20) }]
  })
  set('learn_log', [
    { id: 'dl1', track: 'ctf', title: 'Practice CTF: format string warm-up', tag: 'pwn', link: null, day: day(2) },
    { id: 'dl2', track: 'rust', title: 'Ch 8: Common collections', tag: '', link: null, day: day(6) }
  ])
  const month = (k) => {
    const d = new Date()
    d.setUTCDate(15)
    d.setUTCMonth(d.getUTCMonth() - k)
    return d.toISOString().slice(0, 7)
  }
  set('career_letters', [
    { month: month(1), written: `${month(0)}-01`, title: `Your career in ${new Date(`${month(1)}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`, lines: ['📨 You sent 11 applications (the quota asked for about 13), got 2 interviews.', '🧾 3 portfolio entries: Practice CTF: the login that trusted cookies, tiny-xor, Firewall lab.', '🧠 New skills on record: Burp Suite, nftables, Testing.', '⏱ 14.5 h of career work, 9 shift packs included.', '🃏 312 flashcard reviews, 86% remembered.', '✍️ 2 assignments done on time.', '💸 Income 9,000 of 12,000 lei (75%).', '🛟 Emergency fund 38%, paid yourself first 2× in a row.'], change: 'Income was 9,000 of 12,000 lei. Pick one move from your list and do its first step this week.' }
  ])
  if (process.env.E2E_CAREER_DEMO) {
    set('life_fit', { latestBed: '00:30', work: { on: true, days: [0, 1, 2, 3, 4, 5, 6], from: '17:00', to: '24:00', minH: 1, maxH: 3 }, push: 'firm', tonight: null })
    for (const [n, subject, minutes] of [[1, 'Study pack', 20], [1, 'CTF', 50], [2, 'Study pack', 15], [3, 'Rust', 45], [0, 'Study pack', 20]]) db.run('INSERT INTO focus_sessions (day, subject, minutes, started_at, ended_at, coins) VALUES (?, ?, ?, ?, ?, 0)', [day(n), subject, minutes, `${day(n)}T18:00:00.000Z`, `${day(n)}T18:30:00.000Z`])
  }
}

// Made-up goals (Goals page smoke and screenshots): three you can measure with
// a few weekly check-ins, and one hour goal planned into focus blocks.
// E2E_NO_GOALS=1: none at all (the empty Goals page).
if (!process.env.E2E_NO_GOALS) {
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
  // The newer kinds (their extras live in settings goal_meta:<id>): a habit, a do-less limit, a project with steps.
  const meta = (m) => db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [`goal_meta:${Number(db.exec('SELECT MAX(id) FROM focus_goals')[0].values[0][0])}`, JSON.stringify(m)])
  const metaOf = (title, m) => db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [`goal_meta:${Number(db.exec(`SELECT id FROM focus_goals WHERE title = '${title}'`)[0].values[0][0])}`, JSON.stringify(m)])
  metaOf('Profit 5,000 lei a month', { type: 'target', emoji: '💰', color: 'amber', cover: 'sunrise', pinned: true, vision: 'Rent paid on the 1st, savings growing, no money stress at all.', reward: { id: 1, title: 'New headphones', emoji: '🎧', price: 900 } })
  add(['Read 20 pages, 5× a week', '2099-12-31', 5, day(40), 'count', null, 5, 0, 'Read more than I scroll', 'Study', 'weekly', 'line'], [1, 2, 4, 7, 8, 9, 10, 11, 14, 15, 17, 18, 21, 22, 23, 24, 25].map((n) => [n, 1]))
  meta({ type: 'habit', per: 'week', emoji: '📚', color: 'cyan', cover: 'ocean' })
  add(['Gaming: at most 5h a week', '2099-12-31', 5, day(30), 'hours', null, 5, 0, 'Evenings for CTFs instead', 'Discipline', 'weekly', 'line'], [[1, 1.5], [3, 1], [8, 2], [10, 2.5], [12, 2], [16, 1.5], [19, 2]])
  meta({ type: 'limit', per: 'week', emoji: '🎮', color: 'rose', cover: 'ember' })
  add(['Get Security+', ahead(70), 100, day(20), 'pct', null, 100, 0, 'The first cert for a security job', 'Study', 'weekly', 'line'], [[12, 11.1], [6, 22.2], [2, 33.3]])
  meta({ type: 'project', emoji: '🛡️', color: 'violet', cover: 'night', vision: 'I walk into the exam calm and walk out certified.', steps: ['Learn domain 1', 'Learn domain 2', 'Learn domain 3', 'Learn domain 4', 'Learn domain 5', 'Practice exam 1', 'Practice exam 2', 'Practice exam 3', 'Book the exam'].map((text, i) => ({ id: `s${i}`, text, weight: 1, done: i < 3 ? day(12 - i * 5) : null })) })
  db.run("INSERT INTO focus_goals (title, subject, deadline, hours, created_day) VALUES ('Rust book', 'Rust', ?, 30, ?)", [ahead(40), day(10)])
  db.run("INSERT INTO focus_sessions (day, subject, minutes, coins, started_at, ended_at) VALUES (?, 'Rust', 240, 0, ?, ?)", [day(4), new Date().toISOString(), new Date().toISOString()])
  g.free()
  c.free()
}

// E2E_SAGA_DEMO=1: the Season page on made-up data (e2e/sagaDemo.mjs).
if (process.env.E2E_SAGA_DEMO) (await import(pathToFileURL(join(repo, 'e2e/sagaDemo.mjs')).href)).seedSaga(db, day)

// E2E_BODY_DEMO=1: six weeks of made-up body data (weigh-ins, protein, tape,
// sets, a short night), for looking at Body (screenshots). Off for the smoke test.
if (process.env.E2E_BODY_DEMO) {
  const w = db.prepare('INSERT OR REPLACE INTO body_metrics (day, weight, waist, note, updated_at) VALUES (?, ?, ?, NULL, ?)')
  for (let n = 41; n >= 0; n--) if (n % 2 === 0 || n % 7 === 3) w.run([day(n), Math.round((68.6 + (41 - n) * 0.004 + Math.sin(n * 1.7) * 0.35) * 10) / 10, n % 7 === 0 ? 79.5 : null, new Date().toISOString()])
  const p = db.prepare('INSERT INTO body_log (id, at, day, kind, amount, source) VALUES (?, ?, ?, ?, ?, ?)')
  const meals = [['egg', 18], ['cottage', 28], ['chicken', 46], ['whey', 24], ['lentils', 18]]
  for (let n = 6; n >= 1; n--) meals.slice(0, 3 + (n % 3)).forEach(([k, g], i) => p.run([`demo-p${n}-${i}`, `${day(n)}T${String(8 + i * 3).padStart(2, '0')}:00:00.000Z`, day(n), `protein:${k}`, g - (n % 2) * 4, 'web']))
  p.run(['demo-p0-0', `${day(0)}T06:00:00.000Z`, day(0), 'protein:egg', 18, 'phone'])
  p.run(['demo-p0-1', `${day(0)}T06:10:00.000Z`, day(0), 'protein:cottage', 28, 'phone'])
  p.run(['demo-p0-2', `${day(0)}T06:20:00.000Z`, day(0), 'supp:creatine', 1, 'phone'])
  for (let n = 1; n <= 5; n++) p.run([`demo-s${n}`, `${day(n)}T07:00:00.000Z`, day(n), 'supp:creatine', 1, 'web'])
  const sl = db.prepare('INSERT OR REPLACE INTO sleep_logs (day, wake_time, wake_target, on_time, bed_time, bed_target, bed_on_time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  for (let n = 6; n >= 1; n--) sl.run([day(n), '06:30', '06:30', 1, n % 2 ? '00:40' : '00:15', '23:30', 0, new Date().toISOString()])
  sl.run([day(0), '06:30', '06:30', 1, '01:05', '23:30', 0, new Date().toISOString()])
  const set = (k, v) => db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)])
  set('body_tape', [
    { day: day(40), arm: 31.5, chest: 92, shoulders: 108, thigh: 53 },
    { day: day(20), arm: 32, chest: 93, shoulders: 109.5, thigh: 53.5 },
    { day: day(2), arm: 32.5, chest: 94, shoulders: 110.5, thigh: 54 }
  ])
  set('body_plus', { gPerKg: 1.8, meals: [{ id: 'meal-bfast', name: 'Breakfast', items: [{ food: 'egg', qty: 3 }, { food: 'cottage', qty: 2 }] }], favs: ['egg', 'cottage'], supps: ['creatine', 'vitd'], fuelLead: 60, photoEvery: 14 })
  set('life_fit', { work: { on: true, days: [0, 1, 2, 3, 4, 5, 6], from: '17:00', to: '24:00', minH: 2, maxH: 3 } })
  // Sport Track: three home moves with sets over three weeks (push-ups stall, squats climb).
  const sets = {}
  const add = (n, id, reps) => ((sets[day(n)] ??= {})[id] = reps.map((r, i) => ({ reps: r, at: Date.now() - n * 864e5 + i * 1000, id: `d${n}${id}${i}` })))
  for (const n of [20, 17, 13, 10, 6, 3, 1]) {
    add(n, 'pushups', n > 12 ? [12, 11, 10] : [12, 11, 11])
    add(n, 'squats', [14 + Math.round((20 - n) / 3), 13 + Math.round((20 - n) / 3), 12 + Math.round((20 - n) / 3)])
    if (n % 2) add(n, 'rows', [9, 8, 8])
  }
  set('sport_tracker_json', {
    savedAt: Date.now(),
    data: {
      lastDate: day(0),
      exercises: [
        { id: 'pushups', name: 'Push-ups', target: 36, unit: 'reps', active: true, move: 'pushup', doneToday: 0 },
        { id: 'squats', name: 'Squats', target: 45, unit: 'reps', active: true, move: 'squat', doneToday: 0 },
        { id: 'rows', name: 'Table rows', target: 27, unit: 'reps', active: true, move: 'table_row_bent', doneToday: 0 }
      ],
      water: { currentMl: 0, targetMl: 2500, glassSizeMl: 250 },
      history: [],
      sets,
      sportySettings: { autoProgression: true, progressMode: 'grow', planMinutes: 30, planPerWeek: 3 }
    }
  })
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
  // Rewards 2 (made up): a week of coding and security focus, workouts, nights on time and water,
  // a reward that unlocks by doing, healthy limits, a level-up chest and a done top 3 (the mystery box).
  add.run(['30 min of gaming', 45, 'bronze', 0, 0, null, '🎮', 'fun', 0, 0, 0, 7])
  add.run(['A long gaming evening (3 h)', 350, 'silver', 0, 0, null, '🕹️', 'fun', 6, 0, 0, 8])
  add.run(['A mechanical keyboard', 2200, 'gold', 1100, 0, null, '⌨️', 'gear', 0, 1, 3, 9])
  const idOf = (t) => db.exec('SELECT id FROM rewards WHERE title = ?', [t])[0].values[0][0]
  const monday = (() => {
    const d = new Date(`${day(0)}T12:00:00Z`)
    const wd = d.getUTCDay()
    d.setUTCDate(d.getUTCDate() - (wd === 0 ? 6 : wd - 1))
    return d.toISOString().slice(0, 10)
  })()
  const since = Math.max(0, Math.round((Date.parse(`${day(0)}T12:00:00Z`) - Date.parse(`${monday}T12:00:00Z`)) / 864e5))
  const subjects = ['Rust project', 'CTF practice', 'Rust project', 'Study', 'CTF practice', 'Python']
  for (let n = 0; n <= Math.max(since, 3); n++) {
    db.run('INSERT INTO focus_sessions (day, subject, minutes, coins, started_at, ended_at) VALUES (?, ?, ?, 15, ?, ?)', [day(n), subjects[n % subjects.length], 100 + (n % 3) * 20, new Date().toISOString(), new Date().toISOString()])
    db.run('INSERT INTO focus_sessions (day, subject, minutes, coins, started_at, ended_at) VALUES (?, ?, 50, 15, ?, ?)', [day(n), subjects[(n + 1) % subjects.length], new Date().toISOString(), new Date().toISOString()])
  }
  for (const n of [0, 1, 2, 4, 5]) {
    db.run("INSERT INTO workouts (day, ts, title, items_json) VALUES (?, ?, 'Push-ups and sit-ups', '[]')", [day(n), `${day(n)}T18:00:00.000Z`])
    put(n, 'body', 'earn', 10, 'body.workout_done', 'Workout: push-ups and sit-ups')
  }
  for (let n = 0; n < 7; n++) db.run('INSERT OR IGNORE INTO sleep_logs (day, wake_time, wake_target, on_time, bed_time, bed_target, bed_on_time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [day(n), '07:05', '07:30', n === 3 ? 0 : 1, '23:10', '23:30', 1, new Date().toISOString()])
  for (let n = 0; n < 7; n++) db.run('INSERT INTO body_log (id, at, day, kind, amount, source) VALUES (?, ?, ?, ?, ?, ?)', [`demo-w${n}`, `${day(n)}T12:00:00.000Z`, day(n), 'water', n % 3 === 1 ? 1500 : 2200, 'web'])
  put(1, 'money', 'earn', 6, 'money.logged', 'Logged spending')
  put(2, 'discipline', 'earn', 20, 'discipline.clean_day', 'Clean day')
  ins.run([`${day(0)}T09:00:00.000Z`, day(0), 'quests', 'earn', 0, 900, null, 'demo:xp', 'made-up: experience for a level-up chest'])
  const set = (k, v) => db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)])
  set('reward_unlocks', { [idOf('A long gaming evening (3 h)')]: { kind: 'deed', deed: 'focusHours', target: 20 }, [idOf('A mechanical keyboard')]: { kind: 'deed', deed: 'codeHours', target: 10 }, [idOf('Spa afternoon')]: { kind: 'deed', deed: 'sleepNights', target: 5 } })
  set('reward_rules', { [idOf('30 min of gaming')]: { perDay: 2 }, [idOf('Pizza night')]: { pair: 'workout' } })
  set('week_plans', { [monday]: { week: monday, focus: 'focus', note: '', big3: [{ text: 'Finish the Rust parser', done: true }, { text: 'Two CTF rooms', done: true }, { text: 'Three workouts', done: true }], savedAt: new Date().toISOString() } })
}

// E2E_CARE_DEMO=1: a made-up week of short nights, two coffees today, an evening
// job 17:00–24:00 and half a grooming routine, for the sleep care screenshots
// (e2e/careShots.mjs). Off for the smoke test.
if (process.env.E2E_CARE_DEMO) {
  const nights = [['23:40', '06:35'], ['00:50', '06:30'], ['23:30', '07:20'], ['01:10', '06:40'], [null, '06:30'], ['00:20', '06:30'], ['23:50', '06:35']]
  nights.forEach(([bed, wake], k) => db.run('INSERT OR IGNORE INTO sleep_logs (day, wake_time, wake_target, on_time, bed_time, bed_target, bed_on_time, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [day(6 - k), wake, '06:30', wake <= '06:35' ? 1 : 0, bed, '23:30', bed && bed <= '23:45' && bed >= '12:00' ? 1 : 0, new Date().toISOString()]))
  const set = (k, v) => db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, typeof v === 'string' ? v : JSON.stringify(v)])
  set('sleep_bed_target', '23:30')
  set('sleep_weekday_target', '06:30')
  set('life_fit', { latestBed: '00:00', work: { on: true, days: [1, 2, 3, 4, 5], from: '17:00', to: '24:00', minH: 2, maxH: 4 }, push: 'push' })
  const at = (hm) => new Date(`${day(0)}T${hm}:00`).getTime()
  set('sleep_care', { needH: 8, curfewH: 9.5, days: { [day(0)]: { coffee: [at('08:10'), at('12:40')] } } })
  set('grooming', { days: { [day(0)]: ['wash_am', 'moist_am', 'teeth_am'] }, nails: day(9), haircut: day(33), haircutWeeks: 4, paid: {} })
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
    // Short events back to back and small overlaps (the "can't see them" case):
    // they must sit side by side, never on top of each other.
    { ...ev(0, '16:45', '17:00', 'Stand-up prep', '#fb923c'), description: "Look over yesterday's notes", location: 'Room 204' },
    { ...ev(0, '17:00', '17:15', 'Team stand-up', '#60a5fa'), meet: 'https://meet.example.com/abc-defg-hij', attendees: 4, recurringEventId: 'standup1' },
    ev(0, '17:15', '17:35', 'Sport (20 min)', '#c084fc'),
    ev(0, '22:00', '22:40', 'AI study', '#f97316'),
    ev(0, '22:25', '22:45', 'Family call', '#f472b6'),
    ev(0, '23:00', '23:15', 'Plan tomorrow', '#facc15'),
    ev(0, '23:05', '23:20', 'Read 10 min', '#818cf8'),
    ev(1, '07:00', '09:00', 'Deep block 1', '#c084fc'),
    ev(1, '12:00', '13:30', 'Lecture: Math', '#7cc4ff'),
    ev(1, '17:00', '17:30', 'Sport (20 min)', '#fbbf24'),
    { ...ev(1, '20:00', '21:00', 'Weekly review', '#a78bfa'), recurringEventId: 'series1' }
  ]
  // Every change asked of the calendar, in order (the smoke test reads it with op 'log').
  const log = []
  return (q, r) => {
    const b = q.body || {}
    const send = (j) => (r.setHeader('Content-Type', 'application/json'), r.end(JSON.stringify(j)))
    if (['create', 'move', 'update', 'remove'].includes(b.op)) log.push({ ...b, at: Date.now() })
    if (b.op === 'log') return send(log)
    if (b.op === 'status') return send({ configured: true, connected: true, calendars: [{ id: 'primary', name: 'Test calendar', color: '#7cc4ff', canWrite: true, on: true }] })
    if (b.op === 'events') return send({ events: events.filter((e) => e.end > b.from && e.start < b.to) })
    if (b.op === 'create') {
      const e = { id: `ev${++n}`, calendarId: b.calendarId || 'primary', title: b.title, start: b.start, end: b.end, allDay: false, ours: true, description: b.description ?? null, location: b.location ?? null }
      events.push(e)
      return send({ event: e })
    }
    const e = events.find((x) => x.id === b.id)
    if (b.op === 'move' && e) return (Object.assign(e, { start: b.start, end: b.end }), send({ ok: true }))
    if (b.op === 'update' && e) {
      gcal.last = b
      return (Object.assign(e, Object.fromEntries(Object.entries({ title: b.title, start: b.start, end: b.end, description: b.description, location: b.location, colorId: b.colorId }).filter(([, v]) => v !== undefined))), send({ ok: true }))
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
  // QA4: this month's spend against the budget (E2E_BUDGET=used: used up, so the chat is in basic mode).
  const budget = process.env.E2E_BUDGET === 'used' ? { budget: 10, spent: 10.02, tier: 'minimal' } : { budget: 10, spent: 8.6, tier: 'save' }
  if (b.op === 'budget') return send({ budget })
  if (b.op === 'setBudget') return send({ ok: true, budget: { ...budget, budget: Number(b.usd) || 0 } })
  if (b.op === 'usage')
    return send({ today: { calls: 14, cost: 0.083, tokens: 112000 }, week: { calls: 96, cost: 0.61, tokens: 790000 }, month: { calls: 380, cost: 2.4, tokens: 3100000 }, byModel: [{ model: 'deepseek/deepseek-v4.1-flash', calls: 340, cost: 0.9, tokens: 2800000 }, { model: 'anthropic/claude-sonnet-5.5', calls: 40, cost: 1.5, tokens: 300000 }], recent: [{ at: new Date().toISOString(), model: 'anthropic/claude-sonnet-5.5', kind: 'chat', prompt: 8200, completion: 420, cost: 0.031 }], credits: { total: 20, used: 7.5, left: 12.5 }, budget })
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
