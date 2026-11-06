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
  // Night 11: Money opens on its own hub (Finance Helper's synced numbers), with quick add.
  await step('Money hub: safe to spend, quick add into Finance Helper, insights', async () => {
    await open('money')
    await pg.waitForSelector('.mh-hero .mh-big', { timeout: 15000 })
    for (const sel of ['.mh-quick input', '.mh-donut', '.mh-forecast-line', '.mh-goal', '.mh-open']) if (!(await pg.$(sel))) throw new Error(`no ${sel}`)
    if (!/At this pace you end/.test(await pg.locator('.mh-forecast-line').innerText())) throw new Error('no forecast line')
    await pg.fill('.mh-quick input', '45 smoke lunch')
    await pg.waitForSelector('.mq-preview b', { timeout: 5000 })
    await pg.keyboard.press('Enter')
    await pg.waitForFunction(() => /smoke lunch/.test(document.querySelector('.mh-recent')?.textContent ?? ''), null, { timeout: 8000 })
  })
  for (const [page, name] of [['body', 'Sport Track'], ['money', 'Finance Helper'], ['sleep', 'Waky']]) {
    await step(`${name} loads with its own content`, async () => {
      await open(page)
      if (page === 'money') await pg.click('.mh-open')
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
  // Night 11: Rewards shows the wallet, Ben's line, the tabs and the reward cards.
  await step('Rewards: wallet, tabs and reward cards', async () => {
    await open('shop')
    await pg.waitForSelector('.rx-hero .rx-balance', { timeout: 10000 })
    await pg.waitForSelector('.rx-ben', { timeout: 5000 })
    await pg.click('.rx-tabs button:nth-child(3)')
    await pg.waitForSelector('.rx-card .rx-title', { timeout: 5000 })
  })
  // Night 7: Ben's chat folds his automatic messages and shows cards and the Now card.
  await step("Coach: Ben's chat with folded updates and cards", async () => {
    await open('coach')
    await pg.waitForSelector('.cf-col .cf-row', { timeout: 15000 })
    if (!(await pg.$('.cf-fold'))) throw new Error('no folded updates line')
    if (!(await pg.$('.cf-card'))) throw new Error('no card')
    if (!(await pg.$('.cf-head .ba-face'))) throw new Error("no face for Ben in the header")
    if (!(await pg.$('.cf-rail .cf-now'))) throw new Error('no Now pill above the message box')
    await pg.fill('.cf-input textarea', '/wa')
    if (!(await pg.$('.cf-slash'))) throw new Error('no / shortcuts')
    await pg.fill('.cf-input textarea', '')
    // Coach UI v3: Ben's face once per group, results with Undo, the plan card, ↑ edits.
    await pg.waitForSelector('.cf-plan.live .cf-plan-list li', { timeout: 10000 })
    if (!(await pg.$('.cf-plan.live .cf-plan-track .bar i'))) throw new Error('no timeline on the plan card')
    if (!(await pg.locator('.cf-plan.live .cf-btns button', { hasText: 'Approve' }).count())) throw new Error('no Approve on the plan card')
    if (!(await pg.$('.cf-result button'))) throw new Error('no result card with Undo')
    if (!(await pg.$('.cf-daycard'))) throw new Error('no day card')
    if (!(await pg.$('.cf-row.ben.first .cf-who-line'))) throw new Error("no name line at the start of Ben's messages")
    if (await pg.$('.cf-row.ben.grouped .cf-mark:not(.ghost)')) throw new Error("Ben's face repeats inside a group")
    await pg.evaluate(() => document.querySelector('.cf-stream')?.scrollTo({ top: 0 }))
    await pg.locator('.cf-now button', { hasText: 'See the plan' }).click()
    await pg.waitForFunction(() => {
      const cards = document.querySelectorAll('.cf-col .cf-plan.live')
      const r = cards[cards.length - 1]?.getBoundingClientRect()
      return !!r && r.bottom > 0 && r.top < window.innerHeight
    }, null, { timeout: 5000 })
    await pg.click('.cf-input textarea')
    await pg.keyboard.press('ArrowUp')
    if (!/Rename Deep block 1/.test(await pg.inputValue('.cf-input textarea'))) throw new Error('↑ did not bring back the last message')
    await pg.keyboard.press('Escape')
    if (await pg.inputValue('.cf-input textarea')) throw new Error('Escape did not clear the edit')
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
  // MU: the Music page opens without SoundCloud (nothing loads until play) and adds a station.
  await step('Music: the page opens, adds a station, nothing loads from SoundCloud until play', async () => {
    await open('music')
    await pg.waitForSelector('.mup-hero', { timeout: 15000 })
    if (await pg.$('iframe[src*="soundcloud"]')) throw new Error('the player loaded before play')
    // Nothing playing: "Pick a vibe" with the starter stations and "Play something for now".
    await pg.waitForSelector('.vb-card', { timeout: 5000 })
    if (!(await pg.$('.vb-now'))) throw new Error('no "Play something for now" button')
    if ((await pg.locator('.vb-card').count()) < 6) throw new Error('fewer than 6 starter stations')
    await pg.fill('.mu-add input', 'https://soundcloud.com/example-artist/sets/smoke-mix')
    await pg.locator('.mu-add .mu-btn').click()
    await pg.waitForSelector('.mup-manage li', { timeout: 5000 })
    if (!/Smoke mix/.test(await pg.locator('.mup-manage').innerText())) throw new Error('the new station is not listed')
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
      window.__island = { hot: 0, take: [], actions: [], prefs: [], send: (name, v) => cbs[name]?.(v), snap }
      window.desktop = new Proxy({
        islandHot: () => { window.__island.hot++ },
        islandTakeClicks: (on) => { window.__island.take.push(on) },
        islandAction: (a) => { window.__island.actions.push(a) },
        setIslandPrefs: async (p) => { window.__island.prefs.push(p); return null },
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
    // Right click: the menu for what the pill shows (IC7, the default): the timer's Pause, +5, +15, Stop, Rename.
    await ip.click('.di-pill', { button: 'right' })
    await ip.waitForSelector('.di-actmenu', { timeout: 5000 })
    const items = await ip.$$eval('.di-actmenu > button[role="menuitem"]', (b) => b.map((x) => x.textContent))
    if (!items.some((t) => /Pause/.test(t)) || !items.some((t) => /Rename/.test(t))) throw new Error(`the timer's menu has ${items.join(', ')}`)
    await ip.keyboard.press('Escape')
    await ip.waitForSelector('.di-actmenu', { state: 'detached', timeout: 5000 })
    // IC1: the page itself takes clicks as soon as the pointer comes onto the shape.
    await ip.mouse.move(8, 640)
    await ip.evaluate(() => { window.__island.take = [] })
    const pill = await ip.locator('.di-pill').boundingBox()
    await ip.mouse.move(pill.x + pill.width / 2, pill.y + pill.height / 2, { steps: 5 })
    await ip.waitForFunction(() => window.__island.take.includes(true), null, { timeout: 3000 })
    await ip.evaluate(() => window.__island.send('hover', true))
    await ip.waitForSelector('.di-peek [data-tap="q:done"]', { timeout: 4000 })
    await ip.waitForTimeout(400)
    // A release whose press got lost (Windows can swallow it) still fires the button (here: +5).
    const n = await ip.evaluate(() => {
      window.__island.actions = []
      const b = document.querySelector('.di-peek [data-tap="q:ext5"]')?.getBoundingClientRect()
      if (!b) return -1
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 0, bubbles: true }))
      return window.__island.actions.filter((a) => a.kind === 'extend').length
    })
    if (n !== 1) throw new Error(`a release without a press fired ${n} taps`)
    // IC4: "✓ Done" (Stop & log) in the peek fires on release and sends a stop (and doesn't open the panel).
    await ip.waitForTimeout(600)
    await ip.click('.di-peek [data-tap="q:done"]')
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'stop'), null, { timeout: 3000 })
    if (await ip.$('.di-panel')) throw new Error('Stop & log also opened the panel')
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
  // The island's controls (IC1–IC4, IC10): pause from the peek (it shows at once,
  // and shakes back when the app says no), the round menu, live suggestions in
  // the command bar, and undo after a log.
  await step('Desktop island controls: pause on the peek, hold for the round menu, command suggestions, undo a log', async () => {
    const ip = await (await browser.newContext({ viewport: { width: 520, height: 680 } })).newPage()
    ip.on('pageerror', (e) => errors.push(`island: ${e.message}`))
    await ip.addInitScript(() => {
      const cbs = {}
      const on = (name) => (cb) => { cbs[name] = cb }
      const now = Date.now()
      const snap = {
        at: now, locked: false,
        ben: { face: '🙂', mood: 'chill', why: '', move: null, last: null, unread: 0, busy: false, steps: [] },
        running: { subject: 'Write the essay', startedAt: now - 5 * 60_000, endsAt: now + 20 * 60_000, dots: { n: 3, at: 0 } },
        now: null, next: null,
        mustdos: [{ i: 0, text: 'Call the bank', done: false }], water: { ml: 500, target: 2000 },
        reps: [{ id: 'push', name: 'Pushups', done: 10, target: 50 }], alert: null,
        tasks: [{ id: 't1', content: 'Write the lab report', time: null }]
      }
      // The stand-in app window answers every tap: ok, except a "pause" while __island.refuse is set.
      window.__island = { actions: [], refuse: false, send: (name, v) => cbs[name]?.(v), snap }
      window.desktop = new Proxy({
        islandAction: (a) => {
          window.__island.actions.push(a)
          if (a.id) setTimeout(() => cbs.ack?.({ id: a.id, ok: !(window.__island.refuse && a.kind === 'pause'), error: 'Not now', tookMs: 5 }), 120)
        },
        islandHot: () => {},
        islandTakeClicks: () => {},
        onIslandAck: on('ack'),
        onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
        onIslandHover: on('hover'), onIslandPrefs: on('prefs'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle')
      }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
    })
    await ip.goto(`http://127.0.0.1:${port}/?island=1`)
    await ip.waitForSelector('.di-pill.kind-timer', { timeout: 15000 })
    // Stage dots of the focus → break → next flow.
    if (!(await ip.$('.di-pill .di-stages'))) throw new Error('no stage dots on a flow timer')
    // IC1: the peek's quick buttons for the timer: Pause, +5, Done.
    await ip.evaluate(() => window.__island.send('hover', true))
    await ip.waitForSelector('.di-peek .di-quick [data-tap="q:pause"]', { timeout: 4000 })
    const labels = await ip.$$eval('.di-peek .di-quick button', (b) => b.map((x) => x.textContent))
    if (labels.join('|') !== '⏸ Pause|+5|✓ Done') throw new Error(`quick buttons: ${labels.join(', ')}`)
    await ip.waitForTimeout(400)
    // IC2: Pause shows "Paused" at once (before any new snapshot), then Resume.
    await ip.click('[data-tap="q:pause"]')
    await ip.waitForSelector('.di.is-paused [data-tap="q:resume"]', { timeout: 3000 })
    if (!(await ip.evaluate(() => window.__island.actions.some((a) => a.kind === 'pause')))) throw new Error('Pause sent no pause')
    await ip.screenshot({ path: process.env.ISLAND_SHOTS ? `${process.env.ISLAND_SHOTS}/controls-paused.png` : '/dev/null' }).catch(() => {})
    // The app window's next snapshot says paused too; then a pause that fails rolls back.
    await ip.evaluate(() => window.__island.send('state', { ...window.__island.snap, at: Date.now() }))
    await ip.waitForSelector('[data-tap="q:pause"]', { timeout: 3000 })
    await ip.evaluate(() => { window.__island.refuse = true })
    await ip.waitForTimeout(300)
    await ip.click('[data-tap="q:pause"]')
    await ip.waitForSelector('.di-toast.err', { timeout: 3000 })
    await ip.waitForSelector('.di:not(.is-paused) [data-tap="q:pause"]', { timeout: 3000 })
    await ip.evaluate(() => { window.__island.refuse = false })
    await ip.evaluate(() => window.__island.send('hover', false))
    await ip.waitForSelector('.di-peek', { state: 'detached', timeout: 4000 })
    // IC3: hold the pill: the round menu opens; slide to Water and let go: +250 ml.
    await ip.waitForTimeout(300)
    const pill = await ip.locator('.di-pill').boundingBox()
    const cx = pill.x + pill.width / 2
    const cy = pill.y + pill.height / 2
    await ip.mouse.move(cx, cy)
    await ip.mouse.down()
    await ip.waitForSelector('.di-ringmenu', { timeout: 3000 })
    const water = await ip.locator('.di-ring-item').nth(1).boundingBox()
    await ip.mouse.move(water.x + water.width / 2, water.y + water.height / 2, { steps: 4 })
    await ip.waitForSelector('.di-ring-item.on', { timeout: 2000 })
    await ip.screenshot({ path: process.env.ISLAND_SHOTS ? `${process.env.ISLAND_SHOTS}/controls-ring.png` : '/dev/null' }).catch(() => {})
    await ip.mouse.up()
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'water' && a.ml === 250), null, { timeout: 3000 })
    await ip.waitForSelector('.di-ringmenu', { state: 'detached', timeout: 3000 })
    if (await ip.$('.di-panel')) throw new Error('the round menu also opened the panel')
    // IC10: after a log, "↶ Undo" in the toast sends an undo for that tap.
    await ip.waitForSelector('.di-toast .di-undo', { timeout: 3000 })
    const waterId = await ip.evaluate(() => window.__island.actions.find((a) => a.kind === 'water')?.id)
    await ip.click('.di-toast .di-undo')
    await ip.waitForFunction((id) => window.__island.actions.some((a) => a.kind === 'undo' && a.of === id), waterId, { timeout: 3000 })
    // IC4: the command bar suggests while you type: "water 500" → Log 500 ml, Enter logs it.
    await ip.mouse.move(8, 640)
    await ip.click('.di-pill')
    await ip.waitForSelector('.di-panel', { timeout: 5000 })
    // The command bar lives in the "/" palette: a letter typed anywhere on the open island opens it with that letter.
    await ip.waitForTimeout(250)
    await ip.keyboard.type('w')
    await ip.waitForSelector('.di-panel .dw-pal .di-cmd input', { timeout: 5000 })
    if ((await ip.inputValue('.di-cmd input')) !== 'w') throw new Error('typing on the island did not go into the palette')
    await ip.fill('.di-cmd input', 'water 500')
    await ip.waitForSelector('.di-suggest button.on', { timeout: 3000 })
    const first = await ip.textContent('.di-suggest button.on')
    if (!/Log 500 ml/.test(first ?? '')) throw new Error(`first suggestion: ${first}`)
    await ip.fill('.di-cmd input', 'lab report')
    await ip.waitForFunction(() => /Done: Write the lab report/.test(document.querySelector('.di-suggest button.on')?.textContent ?? ''), null, { timeout: 3000 })
    await ip.screenshot({ path: process.env.ISLAND_SHOTS ? `${process.env.ISLAND_SHOTS}/controls-suggest.png` : '/dev/null' }).catch(() => {})
    await ip.fill('.di-cmd input', 'water 500')
    await ip.waitForSelector('.di-suggest button.on', { timeout: 3000 })
    await ip.press('.di-cmd input', 'Enter')
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'water' && a.ml === 500), null, { timeout: 3000 })
    if (await ip.evaluate(() => window.__island.actions.some((a) => a.kind === 'chat'))) throw new Error('Enter sent the line to Ben instead of logging the water')
    await ip.context().close()
  })
  // The island's motion and live widgets (IM1–IM13, IC5, IC13–IC17) on made-up data.
  await step('Desktop island: progress border, bedtime countdown, a celebration, Ben thinking, the stack, the evening story, edit the pill', async () => {
    const ip = await (await browser.newContext({ viewport: { width: 520, height: 680 } })).newPage()
    ip.on('pageerror', (e) => errors.push(`island: ${e.message}`))
    await ip.addInitScript(() => {
      const cbs = {}
      const on = (name) => (cb) => { cbs[name] = cb }
      const now = Date.now()
      const snap = {
        at: now, locked: false,
        ben: { face: '🙂', mood: 'chill', why: '', move: null, last: { text: 'Nice work', at: new Date(now - 60_000).toISOString(), face: '🙂' }, unread: 0, busy: false, steps: [] },
        running: { subject: 'Write the essay', startedAt: now - 5 * 60_000, endsAt: now + 20 * 60_000 },
        now: null, next: null, mustdos: [{ i: 0, text: 'Call the bank', done: false }, { i: 1, text: 'Pay rent', done: true }],
        water: { ml: 500, target: 2000 }, reps: [], alert: null, today: { focusMin: 40, focusGoal: 120 }
      }
      window.__island = { prefs: [], snap, send: (name, v) => cbs[name]?.(v) }
      window.__setSnap = (patch) => { window.__island.snap = { ...window.__island.snap, at: Date.now(), ...patch }; cbs.state?.(window.__island.snap) }
      window.desktop = new Proxy({
        setIslandPrefs: async (p) => { window.__island.prefs.push(p); return null },
        onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
        onIslandHover: on('hover'), onIslandPrefs: on('prefs'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle')
      }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
    })
    await ip.goto(`http://127.0.0.1:${port}/?island=1`)
    await ip.waitForSelector('.di-pill.kind-timer', { timeout: 15000 })
    // IM2: a running timer fills the outline.
    await ip.waitForSelector('.di-border .di-border-fg', { timeout: 4000 })
    // IM4: all must-dos done: the pill stretches with what happened.
    await ip.evaluate(() => window.__setSnap({ mustdos: window.__island.snap.mustdos.map((m) => ({ ...m, done: true })) }))
    await ip.waitForSelector('.di-moment', { timeout: 3000 })
    if (!/Both done/.test(await ip.locator('.di-moment').innerText())) throw new Error('the celebration did not say what happened')
    await ip.waitForSelector('.di-moment', { state: 'detached', timeout: 5000 })
    // IC13: the hour before bed: a countdown.
    await ip.evaluate(() => window.__setSnap({ running: null, windDown: { bedAt: '23:00', minutesLeft: 42 }, sleep: { bed: true, wake: false, target: '23:00' } }))
    await ip.waitForSelector('.di-pill.kind-winddown .di-crescent', { timeout: 3000 })
    const bed = await ip.evaluate(() => { const e = document.querySelector('.di-pill-time.moon'); return e?.getAttribute('aria-label') ?? e?.textContent ?? '' })
    if (!/^0:4[12]$/.test(bed)) throw new Error(`no bedtime countdown (${bed})`)
    // IM3: Ben thinking: the wave.
    await ip.evaluate(() => window.__setSnap({ windDown: null, sleep: null, ben: { ...window.__island.snap.ben, busy: true, steps: ['reading your day'] } }))
    await ip.waitForSelector('.di-pill.kind-think .di-think', { timeout: 3000 })
    // IC15: a timer, a meeting in 5 minutes and Ben's message: the other two stack beside the pill.
    const t = Date.now()
    await ip.evaluate((t) => window.__setSnap({ running: { subject: 'Essay', startedAt: t - 60_000, endsAt: t + 600_000 }, next: { title: 'Dentist', start: t + 5 * 60_000, end: t + 3600_000 }, ben: { ...window.__island.snap.ben, busy: false, unread: 1 } }), t)
    await ip.waitForFunction(() => document.querySelectorAll('.di-stack-b[data-hot]').length === 2, null, { timeout: 3000 })
    // IC14: the evening story.
    await ip.evaluate(() => window.__setSnap({ alert: { id: 'recap:x', kind: 'recap', title: 'Your day', text: '1 of 2 must-dos', recap: { mustDone: 1, mustTotal: 2, waterMl: 1500, waterTarget: 2000, focusMin: 80, focusGoal: 120 }, actions: [{ label: 'Nice', action: { kind: 'dismiss', id: 'recap:x' } }] } }))
    await ip.waitForSelector('.di-peek.alert .ev-scene', { timeout: 4000 })
    await ip.click('.ev-scene')
    await ip.waitForSelector('.ev-all', { timeout: 3000 })
    await ip.keyboard.press('Escape')
    await ip.evaluate(() => window.__setSnap({ alert: null }))
    // IC17: edit the pill in the panel: hide an item and it is saved.
    await ip.click('.di-pill')
    await ip.waitForSelector('.di-panel', { timeout: 5000 })
    await ip.click('.di-edit-open')
    await ip.waitForSelector('.di-edit-item', { timeout: 3000 })
    await ip.click('[data-tap="edit:points"]')
    await ip.click('[data-tap="edit:done"]')
    await ip.waitForFunction(() => window.__island.prefs.some((p) => p.pillOrder?.find((x) => x.id === 'points')?.on === true), null, { timeout: 3000 })
    // Calm and Off: still opens and closes, no celebrations.
    for (const motion of ['calm', 'off']) {
      await ip.evaluate((m) => window.__island.send('prefs', { size: 'normal', opacity: 1, look: 'black', motion: m }), motion)
      await ip.keyboard.press('Escape')
      await ip.waitForSelector('.di-panel', { state: 'detached', timeout: 5000 })
      // The mouse is still on it, so it may already peek: a click on the shape opens it either way.
      await ip.waitForTimeout(400)
      await ip.click('.di-shape', { position: { x: 24, y: 14 } })
      await ip.waitForSelector('.di-panel', { timeout: 5000 })
    }
    await ip.context().close()
  })
  // Island 2: a move break you pick and count (−/+), logged with ↶ Undo; an eye break counts down on the pill.
  await step('Desktop island nudges: pick the count, log it, undo it, the eye break countdown', async () => {
    const ip = await (await browser.newContext({ viewport: { width: 520, height: 680 } })).newPage()
    ip.on('pageerror', (e) => errors.push(`island: ${e.message}`))
    await ip.addInitScript(() => {
      const cbs = {}
      const on = (name) => (cb) => { cbs[name] = cb }
      const now = Date.now()
      const snap = {
        at: now, locked: false,
        ben: { face: '🙂', mood: 'chill', why: '', move: null, last: null, unread: 0, busy: false, steps: [] },
        running: null, now: null, next: null, mustdos: [], water: { ml: 500, target: 2000 }, reps: [], alert: null,
        move: { done: 40, goal: 100, unit: 'reps', breaks: 2, streak: 3, best: 3, challenge: { name: 'Push-ups', done: 40, target: 100 }, plus: null }
      }
      window.__island = { actions: [], send: (name, v) => cbs[name]?.(v), snap }
      window.desktop = new Proxy({
        islandAction: (a) => { window.__island.actions.push(a); if (a.id) setTimeout(() => cbs.ack?.({ id: a.id, ok: true, tookMs: 5 }), 100) },
        islandHot: () => {}, islandTakeClicks: () => {},
        onIslandAck: on('ack'),
        onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
        onIslandHover: on('hover'), onIslandPrefs: on('prefs'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle')
      }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
    })
    await ip.goto(`http://127.0.0.1:${port}/?island=1`)
    await ip.waitForSelector('.di-pill .nd-badge', { timeout: 15000 })
    const op = (o) => ({ kind: 'nudge', op: o })
    await ip.evaluate((op) => {
      window.__island.send('prefs', { size: 'normal', gapMin: 0 })
      window.__island.send('state', { ...window.__island.snap, at: Date.now() + 1, alert: { id: 'move:1', kind: 'move', title: '60 min at the PC', text: '2-minute break: 20 squats?', face: '🏃', actions: [{ label: '✓ 20 Squats', action: op, primary: true }], nudge: { type: 'move', kind: 'move', options: [{ ex: 'squat', name: 'Squats', n: 20, left: 40 }, { ex: 'push', name: 'Push-ups', n: 10, left: 60 }], pick: 'squat', count: 20, hint: null, level: 'peek', postponed: 0, coins: 3, tidy: false, snooze: [{ c: '5', label: '5 min' }, { c: '15', label: '15 min' }], challenge: null } } })
    }, op({ op: 'move', ex: 'squat', name: 'Squats', n: 20, alertId: 'move:1' }))
    await ip.waitForSelector('.di-peek [data-tap="nd:move:1:plus"]', { timeout: 6000 })
    await ip.waitForTimeout(400)
    await ip.click('.di-peek [data-tap="nd:move:1:ex:push"]')
    await ip.waitForTimeout(300)
    await ip.click('.di-peek [data-tap="nd:move:1:plus"]')
    await ip.waitForTimeout(300)
    await ip.click('.di-peek [data-tap="nd:move:1:log"]')
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'nudge' && a.op.op === 'move'), null, { timeout: 3000 })
    const sent = await ip.evaluate(() => window.__island.actions.find((a) => a.kind === 'nudge' && a.op.op === 'move').op)
    if (sent.ex !== 'push' || sent.n !== 12) throw new Error(`the break sent ${sent.n} ${sent.ex}`)
    // A logged break can be taken back (↶ Undo for a few seconds).
    await ip.waitForSelector('.di-toast .di-undo', { timeout: 3000 })
    await ip.click('.di-toast .di-undo')
    await ip.waitForFunction((id) => window.__island.actions.some((a) => a.kind === 'undo' && a.of === id), await ip.evaluate(() => window.__island.actions.find((a) => a.kind === 'nudge' && a.op.op === 'move').id), { timeout: 3000 })
    // The eye break: a 20-second countdown on the pill; tap stops it without noting it.
    await ip.evaluate(() => window.__island.send('state', { ...window.__island.snap, at: Date.now() + 2, alert: { id: 'eyes:1', kind: 'eyes', title: '20-20-20', text: 'Look 6 m away for 20 seconds.', actions: [], nudge: { type: 'timer', kind: 'eyes', seconds: 20, postponed: 0, snooze: [] } } }))
    await ip.waitForSelector('[data-tap="nd:eyes:1:go"]', { timeout: 6000 })
    await ip.waitForTimeout(400)
    await ip.click('[data-tap="nd:eyes:1:go"]')
    await ip.waitForSelector('.di.nudge-eyes .nd-count-pill', { timeout: 4000 })
    await ip.waitForTimeout(400)
    await ip.click('.nd-count-pill')
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'nudge' && a.op.op === 'close' && a.op.alertId === 'eyes:1'), null, { timeout: 3000 })
    await ip.context().close()
  })
  // MT1–MT3: in a call, Caption starts captions; the strip shows the newest lines; Stop wipes them.
  await step('Desktop island meetings: Caption in a call, the caption strip, Stop', async () => {
    const ip = await (await browser.newContext({ viewport: { width: 560, height: 520 } })).newPage()
    ip.on('pageerror', (e) => errors.push(`island: ${e.message}`))
    await ip.addInitScript(() => {
      const cbs = {}
      const on = (name) => (cb) => { cbs[name] = cb }
      const now = Date.now()
      const snap = { at: now, locked: false, ben: { face: '🙂', mood: 'chill', why: '', move: null, last: null, unread: 0, busy: false, steps: [] }, running: null, now: null, next: null, call: { title: 'Study group', end: now + 40 * 60_000 }, mustdos: [], water: { ml: 500, target: 2000 }, reps: [], alert: null }
      let st = { windows: true, live: true, inCall: true, captioning: false, starting: false, lines: [], words: 0, startedAt: 0, note: '', replyApp: null, private: false }
      window.__meet = { cbs, calls: [] }
      window.desktop = new Proxy({
        islandHot: () => {}, islandTakeClicks: () => {}, islandAction: () => {}, setIslandPrefs: async () => null,
        onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
        onIslandHover: on('hover'), onIslandPrefs: on('prefs'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle'),
        meetings: {
          status: async () => st,
          start: async (title) => { window.__meet.calls.push(['start', title]); st = { ...st, captioning: true, startedAt: Date.now(), words: 9, lines: ['Okay everyone, let us look at the second question.'] }; setTimeout(() => cbs.meet?.(st), 50); return { ok: true, said: '' } },
          stop: async () => { window.__meet.calls.push(['stop']); st = { ...st, captioning: false, words: 0, lines: [] }; setTimeout(() => cbs.meet?.(st), 50); return true },
          transcript: async () => null,
          readReply: async () => ({ ok: false, said: 'no' }),
          onState: (cb) => { cbs.meet = cb }
        }
      }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
    })
    await ip.goto(`http://127.0.0.1:${port}/?island=1`)
    await ip.waitForSelector('.di-pill, .di-moon-pill', { timeout: 15000 })
    await ip.evaluate(() => window.__meet.cbs.hover?.(true))
    await ip.waitForSelector('[data-tap="meet:caption"]', { timeout: 5000 })
    await ip.waitForTimeout(400)
    await ip.click('[data-tap="meet:caption"]')
    await ip.waitForSelector('.di-meet-strip p.now', { timeout: 4000 })
    if (!(await ip.evaluate(() => window.__meet.calls.some((c) => c[0] === 'start' && c[1] === 'Study group')))) throw new Error('Caption did not start with the meeting title')
    if (!/second question/.test(await ip.textContent('.di-meet-strip'))) throw new Error('the strip does not show the caption')
    await ip.click('[data-tap="meet:stop"]')
    await ip.waitForSelector('.di-meet-strip', { state: 'detached', timeout: 4000 })
    await ip.context().close()
  })
  // PL1–PL6: pages in the opened island, widgets running in their sandboxed boxes,
  // a call that needs a permission refused, an add confirmed by you on the island.
  await step('Island widgets: pages by the dots and Ctrl+arrows, widgets run sandboxed, permissions checked, adds confirmed', async () => {
    const { readFileSync } = await import('node:fs')
    const hashes = Object.fromEntries(JSON.parse(readFileSync(join(repo, 'widgets/gallery.json'), 'utf8')).widgets.map((w) => [w.id, w.sha256]))
    const ip = await (await browser.newContext({ viewport: { width: 520, height: 760 } })).newPage()
    ip.on('pageerror', (e) => errors.push(`island: ${e.message}`))
    ip.on('console', (m) => /Content.Security.Policy/i.test(m.text()) && errors.push(`island CSP: ${m.text().slice(0, 200)}`))
    await ip.addInitScript((hashes) => {
      const cbs = {}
      const on = (name) => (cb) => { cbs[name] = cb }
      const now = Date.now()
      const day = new Date(now + 23 * 864e5).toISOString().slice(0, 10)
      const snap = {
        at: now, locked: false,
        ben: { face: '🙂', mood: 'chill', why: '', move: null, last: null, unread: 0, busy: false, steps: [] },
        running: null, now: null, next: null, mustdos: [], water: { ml: 2000, target: 2000 }, reps: [], alert: null,
        streak: { days: 12, kind: 'sport', atRisk: false },
        widgets: { installed: [
          { id: 'countdown', version: '1.0.0', sha256: hashes.countdown, grants: {}, page: 'home', config: { date: day, label: 'Exam' } },
          { id: 'streak', version: '1.0.0', sha256: hashes.streak, grants: { read: true }, page: 'home', config: {} },
          { id: 'pomodoro', version: '1.0.0', sha256: hashes.pomodoro, grants: { add: true }, page: 'fun', config: {} },
          { id: 'quote', version: '1.0.0', sha256: '0'.repeat(64), grants: {}, page: 'fun', config: {} }
        ], look: { style: 'notch', clock: 'segment' } }
      }
      window.__island = { actions: [], send: (name, v) => cbs[name]?.(v), snap }
      window.desktop = new Proxy({
        islandAction: (a) => { window.__island.actions.push(a); if (a.id) setTimeout(() => (cbs.acks ?? []).forEach((f) => f({ id: a.id, ok: true, tookMs: 5 })), 50) },
        islandHot: () => {}, islandTakeClicks: () => {},
        // Like the real desktop: every listener hears every answer.
        onIslandAck: (cb) => { (cbs.acks ??= []).push(cb) },
        onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
        onIslandHover: on('hover'), onIslandPrefs: on('prefs'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle')
      }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
    }, hashes)
    await ip.goto(`http://127.0.0.1:${port}/?island=1`)
    await ip.waitForSelector('.di.style-notch .di-pill .di-clock.seg', { timeout: 15000 })
    await ip.click('.di-pill')
    await ip.waitForSelector('.ip-dots', { timeout: 5000 })
    const titles = await ip.$$eval('.ip-dots button', (b) => b.map((x) => x.title))
    for (const t of ['Day', 'Music', 'Home', 'PC', 'Fun']) if (!titles.includes(t)) throw new Error(`no ${t} page (${titles.join(', ')})`)
    await ip.click('.ip-dots button[title="Home"]')
    await ip.waitForFunction(() => document.querySelectorAll('.wf:not(.is-loading) iframe[sandbox="allow-scripts"]').length === 2, null, { timeout: 8000 })
    const box = ip.frames().find((f) => f.url().includes('/widgets/frame.html'))
    if (!box) throw new Error('no widget frame')
    const iso = await box.evaluate(() => {
      let parent = 'open'
      try { void window.parent.document } catch { parent = 'blocked' }
      let storage = 'open'
      try { void localStorage.length } catch { storage = 'blocked' }
      return { parent, storage, text: document.body.innerText }
    })
    if (iso.parent !== 'blocked' || iso.storage !== 'blocked') throw new Error(`the widget box is not locked: ${JSON.stringify(iso)}`)
    if (!/days to Exam|12 days/.test(iso.text)) throw new Error(`widget did not draw: ${iso.text}`)
    // Ctrl+→ to the next page, then Fun: the changed widget (wrong hash) refuses to run.
    await ip.keyboard.press('Control+ArrowRight')
    await ip.waitForFunction(() => document.querySelector('.ip-dots button.on')?.title === 'PC', null, { timeout: 3000 })
    // "/" opens the palette over the island; it reaches the pages too (Esc closes it, not the island).
    await ip.keyboard.press('/')
    await ip.waitForSelector('.dw-pal [data-tap="pal:page:day"]', { timeout: 3000 })
    await ip.keyboard.press('Escape')
    await ip.waitForSelector('.dw-pal', { state: 'detached', timeout: 3000 })
    if (!(await ip.$('.di-panel'))) throw new Error('Esc in the palette closed the island too')
    // 1–9 jump to a page: 5 is Fun.
    await ip.keyboard.press('5')
    await ip.waitForFunction(() => document.querySelector('.ip-dots button.on')?.title === 'Fun', null, { timeout: 3000 })
    await ip.waitForFunction(() => /changed since you installed it/.test(document.querySelector('.wg-grid')?.textContent ?? ''), null, { timeout: 8000 })
    await ip.waitForFunction(() => document.querySelectorAll('.wf:not(.is-loading) iframe').length === 1, null, { timeout: 8000 })
    const pomo = ip.frames().find((f) => f.url().includes('/widgets/frame.html'))
    const refused = await pomo.evaluate(() => window.widget.fetch('https://api.good-site.io/').then(() => 'ok', (e) => e.message))
    if (!/Network is off/.test(refused)) throw new Error(`a fetch without permission answered: ${refused}`)
    const added = pomo.evaluate(() => window.widget.addNote('Pomodoro done').then(() => 'added', (e) => e.message))
    await ip.waitForSelector('.wg-confirm', { timeout: 3000 })
    await ip.click('.wg-confirm button.primary')
    const addedSays = await added
    if (addedSays !== 'added') throw new Error(`the confirmed note was not added: ${addedSays}`)
    if (!(await ip.evaluate(() => window.__island.actions.some((a) => a.kind === 'widget' && a.op === 'addNote' && a.widget === 'pomodoro')))) throw new Error('no addNote action')
    await ip.context().close()
  })
  await step('Settings → Widgets: the gallery runs the four widgets in their boxes and Install asks for permissions', async () => {
    await open('settings')
    await pg.locator('.st-item', { hasText: 'Widgets' }).first().click()
    await pg.waitForFunction(() => document.querySelectorAll('.wg-card .wf:not(.is-loading) iframe').length === 4, null, { timeout: 10000 })
    await pg.locator('.wg-card', { hasText: 'Streak ring' }).getByRole('button', { name: 'Install' }).click()
    await pg.waitForSelector('.wg-ask', { timeout: 3000 })
    if (!/today’s plan/.test(await pg.locator('.wg-ask').innerText())) throw new Error('the install ask does not say what it reads')
    await pg.locator('.wg-ask').getByRole('button', { name: 'Cancel' }).click()
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
