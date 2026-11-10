// Soak test (CL12): the real app (website build) on the fake server, with a
// fake clock that runs through nights. It checks that a tab left open for a
// long time stays healthy: memory and listeners don't keep growing, an idle
// hour asks the server little, changes made offline or while the server is
// down all arrive, a database version bump shows the reload bar, the session
// renews, and Today shows the new day after 04:00.
//
//   npm run build:web && npm run soak              (about a simulated day and a half)
//   npm run soak -- --short                        (a quick night, about 2 minutes)
//   npm run soak -- --months=24                    (with two years of made-up history)
//   CHROMIUM_PATH=/path/to/chrome npm run soak     (a browser of your own)
//   SOAK_DEBUG=1 npm run soak                      (also lists the database calls of each idle hour)
//
// Fails (exit 1) on: heap growth over 2 MB per simulated day, steady listener
// or DOM node growth, more than 200 server calls in an idle hour, page errors,
// waiting changes not sent within 5 simulated minutes, the wrong day after 04:00.
// Made-up data only.
import { spawn } from 'node:child_process'
import { randomBytes, scryptSync } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const SHORT = args.includes('--short')
const MONTHS = Number(args.find((a) => a.startsWith('--months='))?.split('=')[1] ?? 0)
const PIN = '2468'
const MIN = 60_000
const HOUR = 60 * MIN

const port = 6100 + Math.floor(Math.random() * 500)
const base = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, [join(repo, 'e2e/server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((ok, no) => {
  server.stdout.on('data', (d) => String(d).includes('e2e server') && ok())
  setTimeout(() => no(new Error('e2e server did not start')), 15000)
})

const post = async (path, body, headers = {}) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  return r.json().catch(() => ({}))
}
const control = (op, extra = {}) => post('/api/_e2e', { op, ...extra })
const turso = (stmts) => post('/v2/pipeline', { requests: [...stmts.map(([sql, a = []]) => ({ type: 'execute', stmt: { sql, args: a.map((v) => (typeof v === 'number' ? { type: 'integer', value: String(v) } : { type: 'text', value: String(v) })) } })), { type: 'close' }] }, { Authorization: 'Bearer fake-turso-key' })

// A hashed PIN, like a real install (the server copies it into its own table on first sign-in).
const salt = randomBytes(16)
const hash = `${salt.toString('hex')}:${scryptSync(PIN, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex')}`
await turso([["UPDATE settings SET value = ? WHERE key = 'pin_hash'", [hash]]])

// Optional: a long made-up history (about 30 points rows a day).
if (MONTHS > 0) {
  const rows = []
  const t0 = Date.now() - MONTHS * 30 * 86400_000
  for (let d = 0; d < MONTHS * 30; d++)
    for (let k = 0; k < 30; k++) {
      const ts = new Date(t0 + d * 86400_000 + k * 1800_000).toISOString()
      rows.push(`('${ts}', '${ts.slice(0, 10)}', 'quests', 'adjust', 1, 1, 'made-up ${d}.${k}')`)
    }
  for (let i = 0; i < rows.length; i += 2000) await turso([[`INSERT INTO ledger (ts, day, module, kind, coins, xp, note) VALUES ${rows.slice(i, i + 2000).join(',')}`]])
  console.log(`seeded ${rows.length} made-up points rows (${MONTHS} months)`)
}

const fails = []
const notes = []
const fail = (msg) => {
  fails.push(msg)
  console.log(`✗ ${msg}`)
}
const ok = (msg) => console.log(`✓ ${msg}`)

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: 'Europe/Chisinau' })
await ctx.route(/api\.telegram\.org|fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '{}' }))
// 21:00 local (Chisinau) today: the run crosses midnight and the 04:00 day turn.
// SOAK_START=HH:MM starts at another time (e.g. 23:00 with --short: the one idle hour crosses midnight).
const startDay = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Chisinau' })
const offset = new Date().toLocaleString('en-US', { timeZone: 'Europe/Chisinau', timeZoneName: 'longOffset' }).match(/GMT([+-]\d\d):?(\d\d)?/)
const startHm = /^\d\d:\d\d$/.test(process.env.SOAK_START ?? '') ? process.env.SOAK_START : '21:00'
const startAt = new Date(`${startDay}T${startHm}:00${offset ? `${offset[1]}:${offset[2] ?? '00'}` : '+02:00'}`)
await ctx.clock.install({ time: startAt })
await ctx.addInitScript(() => localStorage.setItem('life_soak', '1'))
const pg = await ctx.newPage()
const errors = []
pg.on('pageerror', (e) => errors.push(e.message))
const cdp = await ctx.newCDPSession(pg)
await cdp.send('Performance.enable')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** Simulated time passes in small steps, so every timer and the network get their turn. */
async function pass(ms, step = 15_000) {
  for (let done = 0; done < ms; done += step) {
    await pg.clock.runFor(Math.min(step, ms - done))
    await sleep(15)
  }
}
const pageNow = () => pg.evaluate(() => Date.now())
const clockText = async () => new Date(await pageNow()).toLocaleString('en-GB', { timeZone: 'Europe/Chisinau', weekday: 'short', hour: '2-digit', minute: '2-digit' })
const metrics = async () => {
  await cdp.send('HeapProfiler.collectGarbage')
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]))
  return { at: await pageNow(), heap: m.JSHeapUsedSize, nodes: m.Nodes, listeners: m.JSEventListeners }
}
const outbox = () => pg.evaluate(() => JSON.parse(localStorage.getItem('life_offline_writes') || '[]').length)
const calls = async () => {
  const s = await control('stats')
  return Object.values(s.calls ?? {}).reduce((a, b) => a + b, 0)
}
let writes = 0
/** A small neutral change through the app itself (the order of Today's tasks). */
const write = () => pg.evaluate((n) => (window).__life.todoist.setOrder([`soak-${n}`]).then(() => 'ok', (e) => String(e?.message ?? e)), ++writes)
const savedOnServer = async (n) => {
  const r = await control('sql', { sql: "SELECT value FROM settings WHERE key = 'today_order'" })
  return String(r.rows?.[0]?.[0] ?? '').includes(`soak-${n}`)
}
/** Waits (in simulated time, up to `limit`) until the waiting changes are sent. */
async function drains(what, limit = 5 * MIN) {
  for (let t = 0; t <= limit; t += 15_000) {
    if ((await outbox()) === 0 && (await savedOnServer(writes))) return ok(`${what}: the waiting change arrived within ${Math.round(t / 1000)} s (simulated)`)
    await pass(15_000)
  }
  fail(`${what}: the waiting change did not arrive within ${limit / MIN} simulated minutes (still waiting: ${await outbox()})`)
}
async function idleHours(n, label) {
  const rates = []
  for (let h = 0; h < n; h++) {
    await control('reset')
    await pass(HOUR)
    const s = await control('stats')
    const total = Object.values(s.calls ?? {}).reduce((a, b) => a + b, 0)
    rates.push(total)
    notes.push(`${label} hour ${h + 1} (${await clockText()}): ${total} calls ${JSON.stringify(s.calls)}${s.db ? ` ${JSON.stringify(s.db)}` : ''}`)
  }
  return rates
}
const samples = []

try {
  // ---- Sign in ------------------------------------------------------------
  await pg.goto(base + '/')
  await pg.waitForSelector('input', { timeout: 30000 })
  await pg.fill('input', PIN)
  await pg.keyboard.press('Enter')
  await pg.waitForSelector('.td2', { timeout: 30000 })
  await pg.waitForFunction(() => !!(window).__life, null, { timeout: 15000 })
  await pg.clock.pauseAt((await pageNow()) + 1000)
  ok(`signed in with a hashed PIN at ${await clockText()}`)
  await pass(30 * MIN)
  samples.push(await metrics())

  // ---- Idle hours: how much does an open, untouched tab ask? ---------------
  const idle = await idleHours(SHORT ? 1 : 3, 'idle')
  const worst = Math.max(...idle)
  if (worst > 200) fail(`an idle hour made ${worst} server calls (limit 200)`)
  else ok(`idle hours made ${idle.join(', ')} server calls (limit 200, goal under 120)`)
  samples.push(await metrics())

  // ---- Offline with a change ------------------------------------------------
  await ctx.setOffline(true)
  await pass(5 * MIN)
  const offW = await write()
  if ((await outbox()) < 1) fail(`a change made offline was not kept (${offW})`)
  else ok('a change made offline waits on this device')
  await pass((SHORT ? 1 : 3) * HOUR - 5 * MIN)
  await ctx.setOffline(false)
  await drains('back online')

  // ---- The new day at 04:00 -----------------------------------------------
  const untilFour = async () => {
    const h = Number(new Date(await pageNow()).toLocaleString('en-GB', { timeZone: 'Europe/Chisinau', hour: '2-digit', hour12: false }))
    return h >= 4 && h < 12 ? 0 : (((28 - h) % 24) * HOUR)
  }
  const wait = await untilFour()
  if (wait > 0) await pass(wait + 10 * MIN)
  else await pass(10 * MIN)
  const day = await pg.evaluate(() => [document.documentElement.dataset.lifeToday ?? '', new Date(Date.now() - 4 * 3600_000).toLocaleDateString('sv-SE')])
  if (day[0] !== day[1]) fail(`after 04:00 Today shows ${day[0] || 'nothing'}, not ${day[1]}`)
  else ok(`after 04:00 Today shows the new day (${day[1]}) at ${await clockText()}`)
  samples.push(await metrics())

  // ---- The server down for a while, with a change -------------------------
  await control('down', { on: true })
  await pass(5 * MIN)
  const downW = await write()
  if ((await outbox()) < 1) fail(`a change made while the server was down was not kept (${downW})`)
  else ok('a change made while the server is down waits on this device')
  await pass(SHORT ? 30 * MIN : 2 * HOUR)
  await control('down', { on: false })
  await drains('server back')

  // ---- A new database version: the page may not save until it reloads -----
  await control('schema', { on: true })
  const w = await write()
  await pass(30_000)
  const bar = await pg.locator('.nv-bar[role="alert"]').count()
  if (!bar) fail(`a database version bump did not show the reload bar (${w})`)
  else ok('a database version bump shows "please reload"')
  await control('schema', { on: false })
  await pg.reload()
  await pg.waitForSelector('.td2, input', { timeout: 30000 })
  if (await pg.locator('input[type="password"], input[inputmode="numeric"]').count()) {
    await pg.fill('input', PIN)
    await pg.keyboard.press('Enter')
  }
  await pg.waitForSelector('.td2', { timeout: 30000 })
  await pg.waitForFunction(() => !!(window).__life, null, { timeout: 15000 })
  ok('after the reload the app opens again')
  samples.push(await metrics())

  // ---- A long stretch of quiet (memory, listeners) --------------------------
  const longIdle = await idleHours(SHORT ? 1 : 12, 'later')
  const worstLater = Math.max(...longIdle)
  if (worstLater > 200) fail(`a later idle hour made ${worstLater} server calls (limit 200)`)
  samples.push(await metrics())

  // ---- Session renewal: four days on, the session renews by itself ---------
  const before = await pg.evaluate(() => localStorage.getItem('life_web_session'))
  await pg.clock.fastForward(4 * 86400_000)
  await pass(6 * HOUR + 5 * MIN, 60_000)
  const after = await pg.evaluate(() => localStorage.getItem('life_web_session'))
  if (!after || after === before) fail('the session did not renew itself')
  else ok('the session renewed itself (4 days later)')
  const okWrite = await write()
  await pass(MIN)
  if (okWrite !== 'ok' || !(await savedOnServer(writes))) fail(`a change after the renewal was not saved (${okWrite})`)
  else ok('changes still save after the renewal')
} catch (e) {
  fail(`the run stopped: ${e.message.split('\n')[0]}`)
}

// ---- Memory, listeners, DOM nodes ------------------------------------------
if (samples.length >= 3) {
  const first = samples[1]
  const last = samples[samples.length - 1]
  const days = Math.max(0.25, (last.at - first.at) / 86400_000)
  const perDay = (last.heap - first.heap) / days / 1e6
  const steady = (k) => samples.slice(1).every((s, i, a) => i === 0 || s[k] > a[i - 1][k])
  notes.push(`samples: ${samples.map((s) => `${(s.heap / 1e6).toFixed(1)} MB / ${s.nodes} nodes / ${s.listeners} listeners`).join(' → ')}`)
  if (perDay > 2) fail(`the page grew ${perDay.toFixed(1)} MB a simulated day (limit 2)`)
  else ok(`memory: ${perDay >= 0 ? '+' : ''}${perDay.toFixed(2)} MB a simulated day`)
  for (const k of ['listeners', 'nodes']) {
    if (steady(k) && last[k] > first[k] * 1.2 + 100) fail(`${k} kept growing: ${first[k]} → ${last[k]}`)
    else ok(`${k}: ${first[k]} → ${last[k]}`)
  }
}
const stats = await control('stats').catch(() => ({}))
if (stats.tooBig) fail(`${stats.tooBig} server answers were over 4.5 MB`)
if (errors.length) fail(`page errors: ${[...new Set(errors)].slice(0, 5).join(' | ')}`)
for (const n of notes) console.log(`  · ${n}`)
await browser.close()
server.kill()
console.log(fails.length ? `\nSoak test FAILED (${fails.length})` : '\nSoak test passed')
process.exit(fails.length ? 1 : 0)
