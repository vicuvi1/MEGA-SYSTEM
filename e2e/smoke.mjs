// Smoke test of the real app (website build): sign in, Today, the four apps
// show their own content (not blank), Settings. Fails (exit 1) on anything
// broken or any uncaught page error. Runs in CI on every push and before
// every desktop release.
//   npm run build:web && node e2e/smoke.mjs
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = 5299 + Math.floor(Math.random() * 500)
const server = spawn(process.execPath, [join(repo, 'e2e/server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise((ok, no) => {
  server.stdout.on('data', (d) => String(d).includes('e2e server') && ok())
  setTimeout(() => no(new Error('e2e server did not start')), 15000)
})

const fails = []
const step = async (name, fn) => {
  try {
    await fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    fails.push(name)
    console.log(`✗ ${name}: ${e.message.split('\n')[0]}`)
  }
}
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const pg = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors = []
pg.on('pageerror', (e) => errors.push(e.message))
// LT3: anything the Content-Security-Policy blocks is a failure too (main page and the apps).
pg.on('console', (m) => /Content.Security.Policy|Refused to (load|execute|connect|frame|apply)/i.test(m.text()) && errors.push(`CSP: ${m.text().slice(0, 200)}`))
await pg.route(/api\.telegram\.org|fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '{}' }))

try {
  await step('opens and signs in with the PIN', async () => {
    const res = await pg.goto(`http://127.0.0.1:${port}/`)
    if (!/frame-ancestors 'none'/.test(res?.headers()['content-security-policy'] ?? '')) throw new Error('no Content-Security-Policy header')
    await pg.waitForSelector('input', { timeout: 20000 })
    await pg.fill('input', '1234')
    await pg.keyboard.press('Enter')
    await pg.waitForSelector('.td2', { timeout: 20000 })
  })
  await step('Today shows Ben and the day', async () => {
    await pg.waitForSelector('.thb', { timeout: 15000 })
  })
  // LT3: a 14-day session (renewed while in use), and the backups can't be wiped from a page (LT1).
  await step('the session lasts 14 days and the cloud backups are read-only', async () => {
    const r = await pg.evaluate(async () => {
      const s = localStorage.getItem('life_web_session') ?? ''
      const exp = JSON.parse(atob(s.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).exp
      const post = (body) => fetch('/api/db', { method: 'POST', headers: { Authorization: `Bearer ${s}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const del = await post({ requests: [{ type: 'execute', stmt: { sql: 'DELETE FROM cloud_snapshots', args: [] } }, { type: 'close' }] })
      const read = await post({ requests: [{ type: 'execute', stmt: { sql: 'SELECT COUNT(*) FROM cloud_snapshots', args: [] } }, { type: 'close' }] })
      return { days: (exp - Date.now()) / 864e5, del: del.status, read: read.status }
    })
    if (r.days > 14.1 || r.days < 13.9) throw new Error(`session lasts ${r.days.toFixed(1)} days`)
    if (r.del !== 403) throw new Error(`deleting the backups answered ${r.del}`)
    if (r.read !== 200) throw new Error(`reading the backups answered ${r.read}`)
  })

  const open = (page) => pg.evaluate((p) => window.dispatchEvent(new CustomEvent('life-open-page', { detail: p })), page)
  for (const [page, name] of [['body', 'Sport Track'], ['money', 'Finance Helper'], ['sleep', 'Waky']]) {
    await step(`${name} loads with its own content`, async () => {
      await open(page)
      await pg.waitForTimeout(3500)
      const src = await pg.evaluate(() => [...document.querySelectorAll('iframe, webview')].find((e) => e.offsetParent)?.getAttribute('src') ?? null)
      if (!src) throw new Error('no visible app frame')
      const frame = pg.frames().find((f) => f.url().includes(src))
      if (!frame) throw new Error(`frame ${src} not loaded`)
      const text = (await frame.locator('body').innerText()).trim()
      if (text.length < 40) throw new Error(`frame looks empty (${text.length} chars)`)
    })
  }
  // MN24: Discipline is one built-in page (no embedded MAN copy).
  await step('Discipline is one page with its own content', async () => {
    await open('discipline')
    await pg.waitForSelector('.discipline, .setup, .stealth-cover', { timeout: 10000 })
    if (await pg.evaluate(() => !![...document.querySelectorAll('iframe, webview')].find((e) => e.offsetParent && /man/.test(e.getAttribute('src') ?? '')))) throw new Error('MAN is still embedded')
  })
  // Night 7: Ben's chat folds his automatic messages and shows cards and the Now card.
  await step("Coach: Ben's chat with folded updates and cards", async () => {
    await open('coach')
    await pg.waitForSelector('.cf-col .cf-row', { timeout: 15000 })
    if (!(await pg.$('.cf-fold'))) throw new Error('no folded updates line')
    if (!(await pg.$('.cf-card'))) throw new Error('no card')
    await pg.fill('.cf-input textarea', '/wa')
    if (!(await pg.$('.cf-slash'))) throw new Error('no / shortcuts')
    await pg.fill('.cf-input textarea', '')
  })
  await step('Settings: every section opens with content', async () => {
    await open('settings')
    await pg.waitForSelector('.st-item', { timeout: 10000 })
    const names = await pg.locator('.st-item b').allInnerTexts()
    if (names.length < 5) throw new Error(`only ${names.length} sections`)
    for (const name of names) {
      await pg.locator('.st-item', { hasText: name }).first().click()
      await pg.waitForFunction((n) => document.querySelector('.st-head h1')?.textContent === n, name, { timeout: 5000 })
      const ok = await pg
        .waitForFunction(() => (document.querySelector('.st-grid')?.textContent ?? '').trim().length >= 20, null, { timeout: 8000 })
        .then(() => true)
        .catch(() => false)
      if (!ok) throw new Error(`${name} looks empty`)
    }
  })
  await step('Settings: connect an AI app (make a token, see it listed, it opens the tools)', async () => {
    await pg.locator('.st-item', { hasText: 'Connect an AI app' }).first().click()
    await pg.waitForSelector('.ai-input', { timeout: 8000 })
    await pg.fill('.ai-input', 'Smoke test app')
    await pg.getByRole('button', { name: 'Make a token' }).click()
    await pg.waitForSelector('.ai-new pre', { timeout: 10000 })
    const tok = await pg.locator('.ai-new pre').innerText()
    if (!/^lsm_[0-9a-f]{12}_/.test(tok.trim())) throw new Error(`odd token: ${tok.slice(0, 12)}`)
    await pg.waitForSelector('.ai-list li', { timeout: 8000 })
    if (!(await pg.locator('.ai-list li', { hasText: 'Smoke test app' }).count())) throw new Error('the new connection is not listed')
    const init = await pg.evaluate(async (t) => (await fetch('/api/mcp', { method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).json(), tok.trim())
    if (!init?.result?.tools?.some((x) => x.name === 'get_today')) throw new Error('the token does not open the MCP tools')
  })
  await step('Notebook opens with your starter notes', async () => {
    await open('notebook')
    await pg.waitForSelector('.nb-item', { timeout: 15000 })
    const titles = await pg.locator('.nb-item b').allInnerTexts()
    if (!titles.some((t) => t.includes('About me'))) throw new Error(`no About me note (${titles.join(', ')})`)
  })
  await step('Calendar shows the week with its events', async () => {
    await open('calendar')
    await pg.waitForSelector('.cal-item', { timeout: 15000 })
    const n = await pg.locator('.cal-item').count()
    if (n < 3) throw new Error(`only ${n} events on the calendar`)
  })
  // IP6: the desktop island on its own page, with a stand-in for the desktop
  // bridge: the pill, a click opens the panel, Escape closes it, hover peeks,
  // a right click opens the quiet menu, a reminder drops down.
  await step('Desktop island: pill → click → panel → Escape → pill, hover peeks, takes clicks on the shape, Stop & log on release, reminders drop down', async () => {
    const ip = await (await browser.newContext({ viewport: { width: 520, height: 680 } })).newPage()
    ip.on('pageerror', (e) => errors.push(`island: ${e.message}`))
    await ip.addInitScript(() => {
      const cbs = {}
      const on = (name) => (cb) => { cbs[name] = cb }
      const now = Date.now()
      const snap = {
        at: now, locked: false,
        ben: { face: '🙂', mood: 'chill', why: '', move: null, last: { text: 'Nice work this morning', at: new Date(now - 60_000).toISOString(), face: '🙂' }, unread: 0, busy: false, steps: [] },
        running: { subject: 'Write the essay', startedAt: now - 5 * 60_000, endsAt: now + 20 * 60_000 },
        now: null, next: { title: 'Gym', start: now + 2 * 3600_000, end: now + 3 * 3600_000 },
        mustdos: [{ i: 0, text: 'Call the bank', done: false }], water: { ml: 500, target: 2000 }, reps: [], alert: null
      }
      window.__island = { hot: 0, take: [], actions: [], send: (name, v) => cbs[name]?.(v), snap }
      window.desktop = new Proxy({
        islandHot: () => { window.__island.hot++ },
        islandTakeClicks: (on) => { window.__island.take.push(on) },
        islandAction: (a) => { window.__island.actions.push(a) },
        onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
        onIslandHover: on('hover'), onIslandPrefs: on('prefs'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle')
      }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
    })
    await ip.goto(`http://127.0.0.1:${port}/?island=1`)
    await ip.waitForSelector('.di-pill.kind-timer', { timeout: 15000 })
    if (!(await ip.evaluate(() => window.__island.hot > 0))) throw new Error('the island never reported its click area')
    await ip.click('.di-pill')
    await ip.waitForSelector('.di-panel', { timeout: 5000 })
    await ip.keyboard.press('Escape')
    await ip.waitForSelector('.di-panel', { state: 'detached', timeout: 5000 })
    await ip.waitForSelector('.di-pill', { timeout: 5000 })
    // The mouse rests on it (the desktop says so): it peeks, and goes back when the mouse leaves.
    await ip.evaluate(() => window.__island.send('hover', true))
    await ip.waitForSelector('.di-peek', { timeout: 3000 })
    await ip.evaluate(() => window.__island.send('hover', false))
    await ip.waitForSelector('.di-peek', { state: 'detached', timeout: 4000 })
    // Right click: the quiet menu (the default).
    await ip.click('.di-pill', { button: 'right' })
    await ip.waitForSelector('.di-quiet', { timeout: 5000 })
    await ip.keyboard.press('Escape')
    await ip.waitForSelector('.di-panel', { state: 'detached', timeout: 5000 })
    // IC1: the page itself takes clicks as soon as the pointer comes onto the shape.
    await ip.mouse.move(8, 640)
    await ip.evaluate(() => { window.__island.take = [] })
    const pill = await ip.locator('.di-pill').boundingBox()
    await ip.mouse.move(pill.x + pill.width / 2, pill.y + pill.height / 2, { steps: 5 })
    await ip.waitForFunction(() => window.__island.take.includes(true), null, { timeout: 3000 })
    // IC4: "Stop & log" in the peek fires on release and sends a stop (and doesn't open the panel).
    await ip.evaluate(() => window.__island.send('hover', true))
    await ip.waitForSelector('.di-peek [data-tap="peek:stop"]', { timeout: 4000 })
    await ip.waitForTimeout(400)
    await ip.click('.di-peek [data-tap="peek:stop"]')
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'stop'), null, { timeout: 3000 })
    if (await ip.$('.di-panel')) throw new Error('Stop & log also opened the panel')
    // A release whose press got lost (Windows can swallow it) still fires the button.
    await ip.waitForTimeout(300)
    const n = await ip.evaluate(() => {
      window.__island.actions = []
      const b = document.querySelector('.di-peek [data-tap="peek:stop"]')?.getBoundingClientRect()
      if (!b) return -1
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 0, bubbles: true }))
      return window.__island.actions.filter((a) => a.kind === 'stop').length
    })
    if (n !== 1) throw new Error(`a release without a press fired ${n} stops`)
    // Off the shape: clicks pass through again (after the short shield).
    await ip.mouse.move(8, 640, { steps: 3 })
    await ip.waitForFunction(() => window.__island.take[window.__island.take.length - 1] === false, null, { timeout: 3000 })
    await ip.evaluate(() => window.__island.send('hover', false))
    await ip.waitForSelector('.di-peek', { state: 'detached', timeout: 4000 })
    // A reminder drops down by itself, and Escape puts it away.
    await ip.evaluate(() => window.__island.send('state', { ...window.__island.snap, at: Date.now(), alert: { id: 'water:1', kind: 'water', title: 'Water', text: 'A glass of water?', actions: [{ label: '+250 ml', action: { kind: 'water', ml: 250 }, primary: true }] } }))
    await ip.waitForSelector('.di-peek.alert', { timeout: 5000 })
    await ip.keyboard.press('Escape')
    await ip.waitForSelector('.di-peek.alert', { state: 'detached', timeout: 5000 })
    // Smart island: a suggestion drops down with Accept / Not now / Never, and each sends its answer.
    const sg = (answer, run) => ({ kind: 'suggest', sid: 'back:a1', sk: 'back', answer, ...(run ? { run } : {}) })
    await ip.evaluate((acts) => {
      window.__island.actions = []
      // No 3-minute gap after the water reminder, for the test.
      window.__island.send('prefs', { size: 'normal', gapMin: 0 })
      window.__island.send('state', { ...window.__island.snap, running: null, at: Date.now() + 1, alert: { id: 'sg:back:a1', kind: 'suggest', title: 'Algorithms block · 20 min left', text: '4 min of video. Back to it?', face: '↩️', actions: acts } })
    }, [
      { label: '↩ Back', action: sg('accept', { kind: 'start', subject: 'Algorithms', minutes: 20 }), primary: true },
      { label: 'Not now', action: sg('later') },
      { label: 'Never', action: sg('never') }
    ])
    await ip.waitForSelector('.di-peek.alert.kind-suggest', { timeout: 8000 })
    const labels = await ip.$$eval('.di-peek.alert .di-actions button', (bs) => bs.map((b) => b.textContent))
    if (labels.join('|') !== '↩ Back|Not now|Never') throw new Error(`suggestion buttons: ${labels.join('|')}`)
    await ip.waitForTimeout(400)
    await ip.click('.di-peek.alert [data-tap="peek:alert:Not now"]')
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'suggest' && a.answer === 'later'), null, { timeout: 3000 })
    await ip.context().close()
  })
  await step('no uncaught page errors', async () => {
    if (errors.length) throw new Error(errors.slice(0, 3).join(' | '))
  })
} finally {
  await browser.close()
  server.kill()
}
if (fails.length) {
  console.log(`\n${fails.length} smoke check(s) failed`)
  process.exit(1)
}
console.log('\nSmoke test passed')
