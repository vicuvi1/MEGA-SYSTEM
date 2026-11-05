// Speed check of the real website build on made-up data: how long from typing
// the PIN to a usable Today, and how long each page takes to open, on a fast
// computer and on a phone-like one (4x slower CPU, 150 ms per request), with a
// small history and a 24-month one (28,800 points rows).
//   npm run build:web && node e2e/perf.mjs            (all four cases)
//   PERF_CASES=phone/24mo node e2e/perf.mjs           (just one)
//   E2E_DIST=/some/other/dist node e2e/perf.mjs       (measure another build)
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const all = ['fast/small', 'phone/small', 'fast/24mo', 'phone/24mo']
const cases = (process.env.PERF_CASES || all.join(',')).split(',')
// What each page shows once it has its content.
const ready = { coach: '.cf-col .cf-row', progress: '.pg-hero', shop: '.rw-head', discipline: '.discipline, .setup, .stealth-cover', money: 'iframe[src*="finance"]', today: '.td2 .thb' }
const pages = (process.env.PERF_PAGES || 'coach,progress,shop,discipline,money,today').split(',')

async function serve(rows) {
  const port = 6300 + Math.floor(Math.random() * 1500)
  const server = spawn(process.execPath, [join(repo, 'e2e/server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, E2E_LEDGER_ROWS: String(rows) } })
  await new Promise((ok, no) => {
    server.stdout.on('data', (d) => String(d).includes('e2e server') && ok())
    setTimeout(() => no(new Error('e2e server did not start')), 30000)
  })
  return { port, stop: () => server.kill() }
}

// Long tasks and the first moment a selector shows, recorded inside the page.
const probe = () => {
  window.__lt = []
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true })
  window.__seen = {}
  window.__watch = (key, test) => {
    const check = () => { if (!window.__seen[key] && test()) window.__seen[key] = performance.now() }
    check()
    new MutationObserver(check).observe(document, { childList: true, subtree: true, attributes: true })
  }
}

/** Waits until the main thread has had no long task for `quiet` ms; returns the long tasks since `from`. */
async function settle(pg, from, quiet, max = 40000) {
  const start = Date.now()
  for (;;) {
    await pg.waitForTimeout(250)
    const r = await pg.evaluate(([f]) => {
      const lt = window.__lt.filter(([s]) => s >= f)
      const end = lt.reduce((m, [s, d]) => Math.max(m, s + d), f)
      return { end, total: lt.reduce((t, [, d]) => t + d, 0), now: performance.now(), n: lt.length }
    }, [from])
    if (r.now - r.end >= quiet || Date.now() - start > max) return r
  }
}

async function run(name) {
  const [device, size] = name.split('/')
  const { port, stop } = await serve(size === '24mo' ? 28800 : 0)
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  const ctx = await browser.newContext({ viewport: device === 'phone' ? { width: 400, height: 860 } : { width: 1440, height: 900 } })
  const pg = await ctx.newPage()
  await pg.route(/api\.telegram\.org|fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '{}' }))
  await pg.addInitScript(probe)
  const errors = []
  pg.on('pageerror', (e) => errors.push(e.message))
  const quiet = device === 'phone' ? 1500 : 800
  if (device === 'phone') {
    const cdp = await ctx.newCDPSession(pg)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: -1, uploadThroughput: -1 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  }
  await pg.goto(`http://127.0.0.1:${port}/`)
  await pg.waitForSelector('input', { timeout: 60000 })
  await pg.fill('input', '1234')
  const t0 = await pg.evaluate(() => {
    window.__watch('today', () => !!document.querySelector('.td2 .thb'))
    return performance.now()
  })
  await pg.keyboard.press('Enter')
  await pg.waitForSelector('.td2 .thb', { timeout: 90000 })
  const s = await settle(pg, t0, quiet)
  const shown = (await pg.evaluate(() => window.__seen.today)) - t0
  const out = { case: name, todayShows: shown, todayUsable: Math.max(shown, s.end - t0), longTasksAfterPin: s.total, pages: {} }
  for (const p of pages) {
    // Off the page first (an app page has no main), so the old page can't count as the new one.
    await pg.evaluate(() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'money' })))
    await pg.waitForTimeout(p === 'money' ? 0 : 600)
    if (p === 'money') {
      await pg.evaluate(() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'history' })))
      await pg.waitForTimeout(600)
    }
    await settle(pg, await pg.evaluate(() => performance.now()), quiet)
    const t = await pg.evaluate(([id, sel]) => {
      const key = `p:${id}:${performance.now()}`
      const t = performance.now()
      window.dispatchEvent(new CustomEvent('life-open-page', { detail: id }))
      window.__watch(key, () => [...document.querySelectorAll(sel)].some((e) => e.getClientRects().length > 0 && !e.closest('[hidden]')))
      return { key, t }
    }, [p, ready[p]])
    await pg.waitForFunction((k) => !!window.__seen[k], t.key, { timeout: 30000 }).catch(() => {})
    const r = await settle(pg, t.t, quiet)
    const seen = (await pg.evaluate((k) => window.__seen[k], t.key)) ?? NaN
    out.pages[p] = { shows: seen - t.t, longTasks: r.total, settled: Math.max(seen, r.end) - t.t }
  }
  out.errors = errors.length
  await browser.close()
  stop()
  return out
}

const fmt = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(2)} s` : '—')
// PERF_RUNS=3: each case that many times, the middle value of each number (a busy machine is noisy).
const runs = Math.max(1, Number(process.env.PERF_RUNS || 1))
const mid = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const median = (rs) => {
  const out = { ...rs[0], pages: {} }
  for (const k of ['todayShows', 'todayUsable', 'longTasksAfterPin', 'errors']) out[k] = mid(rs.map((r) => r[k]))
  for (const p of Object.keys(rs[0].pages)) out.pages[p] = Object.fromEntries(Object.keys(rs[0].pages[p]).map((k) => [k, mid(rs.map((r) => r.pages[p][k]))]))
  return out
}
const results = []
for (const c of cases) {
  const each = []
  for (let i = 0; i < runs; i++) each.push(await run(c))
  const r = median(each)
  results.push(r)
  console.log(`\n${r.case}: Today shows ${fmt(r.todayShows)}, usable ${fmt(r.todayUsable)}, long tasks after PIN ${fmt(r.longTasksAfterPin)}${r.errors ? `, ${r.errors} page errors` : ''}`)
  for (const [p, v] of Object.entries(r.pages)) console.log(`  ${p.padEnd(11)} shows ${fmt(v.shows)}  settled ${fmt(v.settled)}  long tasks ${fmt(v.longTasks)}`)
}
if (process.env.PERF_JSON) console.log(JSON.stringify(results))
