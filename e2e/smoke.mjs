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
// A fixed clock, so the smoke never depends on the real time of day: today at
// 08:30 local time (E2E_NOW=HH:MM picks another time today, or a full date-time).
// The browser and the made-up server both start there; the clock keeps ticking.
const clockAt = (() => {
  const v = process.env.E2E_NOW || '08:30'
  const hm = /^(\d\d?):(\d\d)$/.exec(v)
  if (!hm) {
    const t = new Date(v).getTime()
    if (!Number.isFinite(t)) throw new Error(`E2E_NOW: can't read "${v}"`)
    return t
  }
  const d = new Date()
  d.setHours(Number(hm[1]), Number(hm[2]), 0, 0)
  return d.getTime()
})()
const startedAt = Date.now()
// "Now" on the fixed clock (it started at clockAt and keeps going). Use this,
// never Date.now(), for any time the smoke hands to a page.
const fakeNow = () => clockAt + (Date.now() - startedAt)
// HH:MM on the fixed clock's date (local time).
const todayAt = (hm) => {
  const [h, m] = hm.split(':').map(Number)
  const d = new Date(fakeNow())
  d.setHours(h, m, 0, 0)
  return d.getTime()
}
console.log(`clock: ${new Date(clockAt).toString()}`)
const server = spawn(process.execPath, [join(repo, 'e2e/server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, E2E_NOW: String(clockAt) } })
await new Promise((ok, no) => {
  server.stdout.on('data', (d) => String(d).includes('e2e server') && ok())
  setTimeout(() => no(new Error('e2e server did not start')), 15000)
})

const fails = []
// What a failure was waiting for (Playwright's call log), so a red run says which part.
const waitedFor = (msg) => (String(msg).split('\n').find((l) => /waiting for/.test(l)) ?? '').trim()
const step = async (name, fn, { retries = 0 } = {}) => {
  // SMOKE_ONLY=<words>: run only the steps whose name has them (handy while working on one part).
  // The sign-in step always runs: every other step needs it.
  if (process.env.SMOKE_ONLY && !name.includes(process.env.SMOKE_ONLY) && !name.startsWith('opens and signs in')) return
  for (let attempt = 0; ; attempt++) {
    try {
      await fn()
      console.log(`✓ ${name}${attempt ? ` (passed on try ${attempt + 1})` : ''}`)
      return
    } catch (e) {
      const why = `${process.env.SMOKE_FULL ? e.message : e.message.split('\n')[0]}${process.env.SMOKE_FULL ? '' : ` ${waitedFor(e.message)}`}`
      // A step that drives a whole embedded app on a slow Windows runner may try once more from the start.
      if (attempt < retries) {
        console.log(`… ${name}: ${why.trim()}, trying once more`)
        continue
      }
      fails.push(name)
      console.log(`✗ ${name}: ${why.trim()}`)
      return
    }
  }
}
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
// Every page runs on the fixed clock. install() keeps timers and animations
// running in real time; only the date and time of day are moved.
{
  const newContext = browser.newContext.bind(browser)
  browser.newContext = async (opts) => {
    const ctx = await newContext(opts)
    await ctx.clock.install({ time: fakeNow() })
    // No slide-in reminder cards (water behind, an event soon, bedtime): they
    // come at some hours only and would sit on top of what a step clicks. Nothing
    // here checks them; the bell and the inbox still get every notification.
    await ctx.addInitScript(() => {
      try {
        const p = JSON.parse(localStorage.getItem('ls.ui') || '{}')
        if (p.notif?.popups !== false) localStorage.setItem('ls.ui', JSON.stringify({ ...p, notif: { ...p.notif, popups: false } }))
      } catch {
        /* no storage on this page */
      }
    })
    return ctx
  }
}
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
    if (process.env.PLAN_SHOTS) {
      await pg.waitForTimeout(1500)
      await pg.click('.td2 .ptabs [data-tab="plan"]')
      const cp = pg.locator('section.cp').first()
      if (await cp.count()) {
        await cp.locator('.pa-head').first().click().catch(() => {})
        await pg.setViewportSize({ width: 1440, height: 2300 })
        await cp.scrollIntoViewIfNeeded()
        await cp.screenshot({ path: `${process.env.PLAN_SHOTS}/today-plan.png` })
        await pg.setViewportSize({ width: 1440, height: 900 })
      }
    }
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
  // A step that needs a certain time of day sets it here (HH:MM today, local):
  // the page reloads at that time (nothing kept from the run's own clock), and
  // the run's clock comes back afterwards, pass or fail.
  const reloadApp = async () => {
    await pg.reload()
    await pg.waitForSelector('.td2, main.content, input', { timeout: 20000 })
    if (!(await pg.$('main.content'))) {
      await pg.fill('input', '1234')
      await pg.keyboard.press('Enter')
      await pg.waitForSelector('main.content', { timeout: 20000 })
    }
  }
  const atTime = async (hm, fn) => {
    await pg.context().clock.setSystemTime(todayAt(hm))
    await reloadApp()
    try {
      return await fn()
    } finally {
      await pg.context().clock.setSystemTime(fakeNow())
      await reloadApp()
    }
  }

  // The teacher's review: Today was one long scroll. Now a switch (Now · Plan · Tasks · Body · Week):
  // each tab about one laptop screen (1280×720, 150 % on a 1080p screen), the last tab remembered,
  // ←/→ on the switch and 1–5 on the page, Ctrl+K "water" opens Body.
  const tabFit = async (scope, id, limit = 1.75) => {
    await pg.click(`${scope} .ptabs [data-tab="${id}"]`)
    await pg.waitForFunction(([sc, t]) => document.querySelector(`${sc} .ptabs [data-tab="${t}"]`)?.getAttribute('aria-selected') === 'true', [scope, id], { timeout: 3000 })
    await pg.waitForTimeout(450)
    const r = await pg.evaluate(([sc, t]) => {
      const c = document.querySelector('main.content')
      const panel = [...document.querySelectorAll(`${sc} [role="tabpanel"], ${sc} .st-grid-tabs`)].find((e) => e.offsetParent) ?? document.querySelector(sc) // Rewards' tabs filter one list
      return { scroll: c.scrollHeight, view: c.clientHeight, text: (panel?.textContent ?? '').trim().length, sel: [...document.querySelectorAll(`${sc} .ptabs [aria-selected="true"]`)].map((b) => b.dataset.tab) }
    }, [scope, id])
    if (r.sel.join() !== id) throw new Error(`${id}: the switch shows ${r.sel.join()}`)
    if (r.text < 10) throw new Error(`${id} looks empty`)
    if (r.scroll > r.view * limit) throw new Error(`${id} needs ${(r.scroll / r.view).toFixed(2)} screens (over ${limit})`)
    return r
  }
  await step('Today tabs: each fits a laptop screen, keys and Ctrl+K switch, the last tab is remembered', async () => {
    await pg.setViewportSize({ width: 1280, height: 720 })
    await open('today')
    await pg.waitForSelector('.td2 .ptabs [data-tab="now"]', { timeout: 10000 })
    const ids = await pg.locator('.td2 .ptabs [role="tab"]').evaluateAll((bs) => bs.map((b) => b.dataset.tab))
    if (ids.join() !== 'now,plan,tasks,body,week') throw new Error(`tabs ${ids.join()}`)
    // Your day stays beside the tabs on a laptop (no Day tab there).
    if (!(await pg.locator('.td2 .cmd-side .ds').first().isVisible())) throw new Error('"Your day" is not beside the tabs')
    const sizes = []
    for (const id of ids) sizes.push(`${id} ${((await tabFit('.td2', id)).scroll / 654).toFixed(2)}`)
    // Sunday and Monday (the run follows the real date): "Pick your top 3 for this week" is one slim line on Now; Pick opens the chips.
    await pg.click('.td2 .ptabs [data-tab="now"]')
    const wk3 = pg.locator('[data-tabpanel="now"] .wk3')
    if (await wk3.count()) {
      if (!/wk3-slim/.test((await wk3.getAttribute('class')) ?? '')) throw new Error('the weekly top 3 card on Now is not one slim line')
      if ((await wk3.boundingBox()).height > 48) throw new Error(`the weekly top 3 line is ${(await wk3.boundingBox()).height}px tall`)
      await wk3.locator('button', { hasText: 'Pick' }).click()
      await pg.waitForSelector('[data-tabpanel="now"] .wk3:not(.wk3-slim) .wk3-chips', { timeout: 3000 })
      await pg.locator('[data-tabpanel="now"] .wk3 button', { hasText: 'Not now' }).click()
      await pg.waitForFunction(() => !document.querySelector('[data-tabpanel="now"] .wk3'), null, { timeout: 3000 })
    }
    // Sundays: Ben's body report on Body is one folded line ("Next week: …"), the whole report on tap.
    await pg.click('.td2 .ptabs [data-tab="body"]')
    await pg.waitForTimeout(300)
    const bw = await pg.locator('[data-tabpanel="body"] .bw-card').evaluateAll((els) => els.map((e) => `${e.className}${e.open ? ' open' : ''}`))
    if (bw.some((c) => !/bw-fold/.test(c) || / open$/.test(c))) throw new Error(`the Sunday body report on Body is not folded (${bw.join()})`)
    // Each thing once: must-dos on Now, the rest of today on Tasks, water on Body.
    await pg.click('.td2 .ptabs [data-tab="tasks"]')
    if (!(await pg.locator('.td2 .dl-tasks .dl-tabs').isVisible())) throw new Error('the task tabs are not on Tasks')
    if (await pg.locator('[data-tabpanel="now"] .dl-tabs').count()) throw new Error('the task tabs are also on Now')
    await pg.click('.td2 .ptabs [data-tab="body"]')
    if ((await pg.locator('[data-tabpanel="body"]', { hasText: /\d+\/\d+ ml/ }).count()) !== 1) throw new Error('water is not on Body')
    if (await pg.locator('[data-tabpanel="body"] .tb-parts', { hasText: /\d(\.\d)? of \d(\.\d)? L/ }).count()) throw new Error('the healthy-day card repeats the water amount')
    // Small counts on the tabs.
    if (!/\d+\/4/.test(await pg.locator('.td2 .ptabs [data-tab="body"]').innerText())) throw new Error('no healthy-day count on Body')
    if (!/\d/.test(await pg.locator('.td2 .ptabs [data-tab="tasks"]').innerText())) throw new Error('no count on Tasks')
    // Keyboard: ← / → on the switch, 1–5 on the page.
    await pg.focus('.td2 .ptabs [data-tab="body"]')
    await pg.keyboard.press('ArrowRight')
    await pg.waitForFunction(() => document.querySelector('.td2 .ptabs [data-tab="week"]')?.getAttribute('aria-selected') === 'true', null, { timeout: 2000 })
    if ((await pg.evaluate(() => document.activeElement?.dataset?.tab)) !== 'week') throw new Error('focus did not follow the arrow')
    await pg.locator('.td2 .ptab-panel:visible').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
    await pg.evaluate(() => document.activeElement?.blur?.())
    await pg.keyboard.press('2')
    await pg.waitForFunction(() => document.querySelector('.td2 .ptabs [data-tab="plan"]')?.getAttribute('aria-selected') === 'true', null, { timeout: 2000 })
    // Ctrl+K "water" opens Today on Body.
    await pg.keyboard.press('Control+k')
    await pg.waitForSelector('.palette input', { timeout: 3000 })
    await pg.fill('.palette input', 'water, reps')
    await pg.locator('.palette-item', { hasText: 'Water, reps and sleep' }).first().click()
    await pg.waitForFunction(() => document.querySelector('.td2 .ptabs [data-tab="body"]')?.getAttribute('aria-selected') === 'true', null, { timeout: 3000 })
    // Remembered on this device: a fresh page opens Today on Body again.
    const p2 = await pg.context().newPage()
    try {
      await p2.setViewportSize({ width: 1280, height: 720 })
      await p2.route(/api\.telegram\.org|fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '{}' }))
      await p2.goto(pg.url())
      await p2.waitForSelector('.td2, input', { timeout: 20000 })
      if (!(await p2.$('.td2'))) {
        await p2.fill('input', '1234')
        await p2.keyboard.press('Enter')
      }
      await p2.waitForSelector('.td2 .ptabs [data-tab="body"][aria-selected="true"]', { timeout: 20000 })
    } finally {
      await p2.close()
    }
    // A narrow window: "Your day" becomes its own tab in the same switch.
    await pg.setViewportSize({ width: 900, height: 720 })
    await pg.waitForSelector('.td2 .ptabs [data-tab="day"]', { timeout: 3000 })
    await pg.click('.td2 .ptabs [data-tab="day"]')
    await pg.waitForSelector('[data-tabpanel="day"] .ds', { timeout: 5000 })
    await pg.setViewportSize({ width: 1280, height: 720 })
    await pg.click('.td2 .ptabs [data-tab="now"]')
    await pg.setViewportSize({ width: 1440, height: 900 })
    console.log(`  Today screens: ${sizes.join(' · ')}`)
  })
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
  // Sport Track's Today: one hero with the next step, big exercise cards (one
  // quick-add, Done, ⋯), water with glass / bottle / undo; taps reach the one log.
  // UX5: a finished workout (Sport Track's SPORT_SUMMARY) gets Ben's one plain line, once.
  await step('Sport Track note: a workout summary makes one note from Ben, once', async () => {
    await pg.setViewportSize({ width: 1440, height: 900 })
    await open('body')
    await pg.locator('.seg-switch button').first().click()
    await pg.waitForTimeout(2500)
    const frame = pg.frames().find((f) => f.url().includes('/apps/sport/'))
    if (!frame) throw new Error('no Sport Track frame')
    await pg.evaluate(() => { window.__notes = []; window.addEventListener('life-workout-note', (e) => window.__notes.push(e.detail)) })
    const post = () => frame.evaluate(() => window.parent.postMessage({ type: 'LIFE_SYSTEM_BRIDGE', action: 'SPORT_SUMMARY', payload: { day: '2031-03-04', source: 'smoke', minutes: 20, at: 1, sets: 6, reps: 90, records: 0, levelUps: 1, exercises: [{ name: 'Push-ups', sets: [15, 15, 14], next: 'Next: 3×16' }] } }, location.origin))
    await post()
    await pg.waitForFunction(() => window.__notes.length > 0, null, { timeout: 15000 })
    const note = (await pg.evaluate(() => window.__notes))[0]
    if (!/level/i.test(note.text) || note.text.length > 140) throw new Error(`odd note: ${note.text}`)
    await post()
    await pg.waitForTimeout(1500)
    if ((await pg.evaluate(() => window.__notes.length)) !== 1) throw new Error('the same workout got a second note')
  })
  // Simple mode is the default: your own exercises, a big Log, +5/+10, Done and a small "Harder ▸" (+reps, +1 set, a harder version).
  await step('Sport Track simple Today: your own exercises, Harder raises a target, no coach UI', async () => {
    await pg.setViewportSize({ width: 1440, height: 900 })
    await open('body')
    await pg.locator('.seg-switch button').first().click()
    await pg.waitForTimeout(2500)
    const frame = pg.frames().find((f) => f.url().includes('/apps/sport/'))
    if (!frame) throw new Error('no Sport Track frame')
    await frame.click('.st-tab[data-tab="today"]')
    await frame.waitForSelector('.ex.simple', { timeout: 10000 })
    const names = (await frame.locator('.ex .ex-name').allInnerTexts()).join('|').toLowerCase()
    for (const n of ['push-ups', 'sit-ups', 'press']) if (!names.includes(n)) throw new Error(`simple Today does not list ${n} (got: ${names})`)
    for (const sel of ['.ex .log-big', '.ex [data-amount="5"]', '.ex [data-amount="10"]', '.ex [data-action="full"]', '.ex [data-action="harder-toggle"]', '.ex .ex-demo']) if (!(await frame.locator(sel).first().count())) throw new Error(`a simple card lacks ${sel}`)
    for (const sel of ['.ex .lv-big', '.ex [data-tune]', '#lv-strip', '#your-coach', '.ex .ex-effort', '#routine-section .hero-main']) if (await frame.locator(sel).first().isVisible().catch(() => false)) throw new Error(`simple mode still shows ${sel}`)
    if (process.env.SPORT_SHOTS) { await pg.addStyleTag({ content: '.toasts { display: none !important; }' }); await pg.locator('body').screenshot({ path: `${process.env.SPORT_SHOTS}/simple-today.png` }) }
    const card = (n) => frame.locator(`.ex.simple:has(.ex-name:text-is("${n}"))`)
    const targetOf = async (n) => Number((await card(n).locator('.ex-count span').innerText()).replace(/[^0-9]/g, ''))
    const t0 = await targetOf('Push-ups')
    const s0 = await targetOf('Sit-ups')
    // Harder ▸ +reps raises only that target.
    await card('Push-ups').locator('[data-action="harder-toggle"]').click()
    await card('Push-ups').locator('[data-action="harder"][data-kind="reps"]').click()
    await frame.waitForFunction(([t]) => [...document.querySelectorAll('.ex.simple')].some((c) => /Push-ups/.test(c.querySelector('.ex-name')?.textContent ?? '') && Number((c.querySelector('.ex-count span')?.textContent ?? '').replace(/[^0-9]/g, '')) === t + 5), [t0], { timeout: 5000 })
    if ((await targetOf('Sit-ups')) !== s0) throw new Error('Harder on push-ups changed sit-ups')
    // Easier ▸ goes back.
    await card('Push-ups').locator('[data-action="easier"]').click()
    await frame.waitForFunction(([t]) => [...document.querySelectorAll('.ex.simple')].some((c) => /Push-ups/.test(c.querySelector('.ex-name')?.textContent ?? '') && Number((c.querySelector('.ex-count span')?.textContent ?? '').replace(/[^0-9]/g, '')) === t), [t0], { timeout: 5000 })
    // Harder ▸ a harder version swaps only that one exercise.
    await card('Push-ups').locator('[data-action="harder-toggle"]').click()
    await card('Push-ups').locator('[data-action="harder"][data-kind="version"]').click()
    await frame.waitForFunction(() => !/(^|\|)push-ups(\||$)/.test([...document.querySelectorAll('.ex .ex-name')].map((n) => n.textContent.trim().toLowerCase()).join('|')), null, { timeout: 5000 })
    const swapped = (await frame.locator('.ex .ex-name').allInnerTexts()).join('|').toLowerCase()
    for (const n of ['sit-ups', 'press']) if (!swapped.includes(n)) throw new Error(`the swap changed ${n} too (got: ${swapped})`)
    // Easier ▸ brings the plain push-ups back.
    await frame.locator('.ex.simple [data-action="easier"]').first().click()
    await frame.waitForFunction(() => /(^|\|)push-ups(\||$)/.test([...document.querySelectorAll('.ex .ex-name')].map((n) => n.textContent.trim().toLowerCase()).join('|')), null, { timeout: 5000 })
    // The Plan tab holds the one switch; the rest of it stays hidden while it is off.
    await frame.click('.st-tab[data-tab="plan"]')
    await frame.waitForSelector('#coach-switch', { state: 'visible', timeout: 5000 })
    if (!/Coach mode \(levels, programs, auto-progression\)/.test(await frame.locator('#coach-switch').innerText())) throw new Error('no Coach mode switch')
    if (await frame.locator('#prog-card').isVisible()) throw new Error('coach programs show while Coach mode is off')
    await frame.click('.st-tab[data-tab="today"]')
  }, { retries: 1 })
  await step('Sport Track Today: hero, exercise cards, water, menus, fits laptop and phone', async () => {
    await pg.setViewportSize({ width: 1440, height: 900 }) // a retry starts from the usual size
    await open('body')
    await pg.locator('.seg-switch button').first().click()
    await pg.waitForTimeout(2500)
    let frame = pg.frames().find((f) => f.url().includes('/apps/sport/'))
    if (!frame) throw new Error('no Sport Track frame')
    // The coach steps below need Coach mode: it is off by default, one switch in the Plan tab.
    await frame.click('.st-tab[data-tab="plan"]')
    await frame.evaluate(() => { const c = document.getElementById('coach-mode-toggle'); if (!c.checked) c.click() })
    await frame.waitForSelector('#prog-card', { state: 'visible', timeout: 5000 })
    // The first-open best-set screen is its own step below; here it is skipped.
    await frame.waitForTimeout(900)
    if (await frame.locator('#modal-onboard.open').count()) await frame.click('#onboard-skip')
    await frame.click('.st-tab[data-tab="today"]')
    await frame.waitForSelector('#hero-ring .ring-fill', { timeout: 5000 })
    // SP3: on a rest day in the week plan, "Train anyway" brings the next workout.
    if (await frame.locator('#hero-next-btn[data-train="1"]').isVisible()) await frame.click('#hero-next-btn')
    await frame.waitForSelector('.ex', { timeout: 10000 }) // slower Windows runners
    if (!(await frame.locator('#btn-workout-mode').isVisible())) throw new Error('no Start workout button')
    // The default routine is back on Today: push-ups, sit-ups and press (your own exercises, not a generated plan).
    const names = (await frame.locator('.ex .ex-name').allInnerTexts()).join('|').toLowerCase()
    for (const n of ['push-ups', 'sit-ups', 'press']) if (!names.includes(n)) throw new Error(`Today does not list ${n} (got: ${names})`)
    // The coach card: level, today's target, one big log button (prefilled from last time), set chips and a typed box.
    for (const sel of ['.ex .lv-big, .ex .lvl, .ex .tag', '.ex .ex-target b', '.ex .log-big', '.ex .log-chips .chip', '.ex form.log-type input']) if (!(await frame.locator(sel).first().count())) throw new Error(`an exercise card lacks ${sel}`)
    // A library exercise shows its demo: two real photo frames, or the drawn figure (not an empty picture).
    await frame.waitForSelector('.ex .ex-demo svg.fig path[data-p="torso"][d], .ex .ex-demo .ph img.ph-b', { state: 'attached', timeout: 10000 })
    const shut = async () => { if (await frame.locator('#cel.open').count()) { await frame.click('#cel', { position: { x: 5, y: 5 } }); await frame.waitForSelector('#cel', { state: 'hidden', timeout: 5000 }) } }
    // A quick-add sends the change to Life System's log.
    await pg.evaluate(() => { window.__sportLog = []; window.addEventListener('message', (e) => e.data?.action === 'SPORT_LOG' && window.__sportLog.push(e.data.payload)) })
    // Quick log: type "15 14 12" on the first card; the coach answers with a line and the next target.
    await frame.fill('.ex form.log-type input', '15 14 12')
    await frame.press('.ex form.log-type input', 'Enter')
    await frame.waitForSelector('.ex .ex-fb', { timeout: 10000 })
    const fbText = await frame.locator('.ex .ex-fb').first().innerText()
    if (!/Next: \d+×\d+/.test(fbText) || !/(First log|more than last|Same as last|fewer than last|top of the range|Easier than usual)/.test(fbText)) throw new Error(`no coach feedback after logging 15 14 12 (got: ${fbText})`)
    if ((await frame.locator('.ex .ex-sets span').first().innerText()).trim() !== '15') throw new Error('the typed sets 15 14 12 were not logged as three sets')
    await shut()
    if (await frame.locator('#unlock.open').count()) await frame.click('#unlock-ok')
    await pg.waitForFunction(() => window.__sportLog.some((p) => p.changes.some((c) => c.kind.startsWith('reps:') && c.amount > 0)), null, { timeout: 10000 }) // slower Windows runners: the numbers roll and the demos draw
    // A set can finish an exercise or set a record: its celebration closes with a tap.
    await pg.waitForTimeout(600)
    await shut()
    // Water: a glass and its undo.
    const w0 = await frame.locator('#water-display-ml').innerText()
    await frame.click('#water-glass')
    await frame.waitForFunction((w) => document.querySelector('#water-display-ml')?.textContent !== w, w0, { timeout: 10000 }) // slower Windows runners: the numbers roll and the demos draw
    await frame.click('#water-undo')
    await frame.waitForFunction((w) => document.querySelector('#water-display-ml')?.innerText === w, w0, { timeout: 10000 }) // slower Windows runners: the numbers roll and the demos draw
    // Logging can earn a badge: it pops up with "Nice!" (checked a moment after a change).
    await pg.waitForTimeout(1000)
    await shut()
    if (await frame.locator('#unlock.open').count()) await frame.click('#unlock-ok')
    // The ⋯ menu opens and Esc closes it; the rest timer opens from it.
    await frame.locator('.ex .ex-more').first().click()
    await frame.waitForSelector('.ex-menu', { timeout: 2000 })
    await frame.locator('.ex-menu [data-open-rest]').click()
    await frame.waitForSelector('#modal-rest.open', { timeout: 2000 })
    await frame.locator('#btn-close-rest').click()
    if (await frame.$('.ex-menu')) throw new Error('the exercise menu stayed open')
    // The top ⋯ holds exercises & targets, settings, rest day and reset.
    await frame.click('#st-more-btn')
    await frame.waitForSelector('#st-more:not([hidden]) #btn-open-manage-modal', { timeout: 2000 })
    await frame.press('body', 'Escape')
    if (await frame.locator('#st-more').isVisible()) throw new Error('the top menu stayed open')
    // The demo opens the How-to sheet: steps, the common mistake, the ladder.
    await frame.locator('.ex .ex-demo').first().click()
    await frame.waitForSelector('#modal-howto.open #howto-name', { timeout: 10000 }) // slower Windows runners: the numbers roll and the demos draw
    if ((await frame.locator('#modal-howto .howto-steps li').count()) < 2) throw new Error('the How-to sheet has no steps')
    await frame.waitForSelector('#modal-howto .howto-warn', { timeout: 2000 })
    await frame.click('#btn-close-howto')
    // Library: groups of moves with demos; Badges: earned and still to get.
    await frame.click('.st-tab[data-tab="library"]')
    await frame.waitForSelector('.mv svg.fig path[data-p="torso"][d]', { state: 'attached', timeout: 5000 })
    if ((await frame.locator('.mv').count()) < 40) throw new Error('the library shows fewer than 40 moves')
    if ((await frame.locator('.mv .ph img').count()) < 40) throw new Error('fewer than 20 moves have photo demos') // two frames each
    // SP3: the week plan (7 days, a session that fits the minutes) and the Strength view.
    await frame.click('.st-tab[data-tab="plan"]')
    await frame.waitForSelector('#pg-week .pg-day', { timeout: 10000 })
    if ((await frame.locator('#pg-week .pg-day').count()) !== 7) throw new Error('the week plan does not show 7 days')
    await frame.click('#pg-minutes [data-min="20"]')
    await frame.waitForFunction(() => /20 min/.test(document.querySelector('#pg-meta')?.textContent ?? ''), null, { timeout: 5000 })
    await frame.click('.st-tab[data-tab="progress"]')
    // Progress → Levels: the rank, why each level, the level map and the forecast; then Charts and Records.
    await frame.waitForSelector('#lv-rank .rk h2', { timeout: 10000 })
    await frame.waitForSelector('#lv-why .why-row', { timeout: 5000 })
    await frame.waitForSelector('#lv-map .lm-row.cur', { timeout: 5000 })
    if ((await frame.locator('#lv-map .lm-row').count()) < 10) throw new Error('the level map shows fewer than 10 levels')
    await frame.click('#pr-sub [data-sub="records"]')
    await frame.waitForSelector('#rec-wall .rw-card', { timeout: 5000 })
    await frame.click('#pr-sub [data-sub="charts"]')
    await frame.waitForSelector('#cx-card .cx-svg', { timeout: 5000 })
    await frame.waitForSelector('#str-hero h2', { timeout: 10000 })
    await frame.waitForSelector('#str-muscles .mus-row', { timeout: 5000 })
    // Workout mode follows the sets: set 1 of 3, Set done, then the rest ring.
    await frame.click('.st-tab[data-tab="today"]')
    await frame.locator('.ex .ex-demo').first().waitFor({ timeout: 10000 })
    await frame.evaluate(() => openWM())
    await frame.waitForSelector('#wm-body #wm-set', { timeout: 10000 })
    if (await frame.locator('.wm-rest').count()) await frame.click('.wm-rest [data-rest="0"]') // the warm-up
    // A logged set is echoed back by Life System; the page must keep workout mode open (no reload).
    await frame.evaluate(() => { window.__noReload = true })
    await frame.click('#wm-set')
    await shut()
    await frame.waitForSelector('#wm-body .wm-rest, .wm-finish', { timeout: 20000 })
    await shut()
    // Wait for the log to reach Life System and its echo to settle, then check the page was not reloaded.
    await pg.waitForFunction(() => window.__sportLog.some((p) => p.changes.some((c) => c.kind.startsWith('reps:'))), null, { timeout: 20000 })
    await pg.waitForTimeout(1500)
    if (!(await frame.evaluate(() => window.__noReload === true && !document.getElementById('workout-mode').hidden))) throw new Error('Sport Track reloaded or closed workout mode after a set was logged')
    // Close with the page's own button.
    await frame.evaluate(() => (document.getElementById('wm-finish-ok') ?? document.getElementById('wm-close'))?.click())
    frame = pg.frames().find((f) => f.url().includes('/apps/sport/') && !f.isDetached()) ?? frame
    await frame.waitForSelector('#workout-mode', { state: 'hidden', timeout: 10000 })
    await frame.waitForSelector('.st-tab[data-tab="progress"]', { timeout: 10000 })
    // Four tabs only; Badges and History are inside Progress.
    if ((await frame.locator('.st-tab').count()) !== 4) throw new Error('Sport Track should have 4 tabs: Today, Plan, Progress, Library')
    // Plan: ready-made programs, the balance check and the easy week.
    await frame.click('.st-tab[data-tab="plan"]')
    await frame.waitForSelector('#prog-list .prog', { timeout: 5000 })
    if ((await frame.locator('#prog-list .prog').count()) !== 3) throw new Error('want 3 programs')
    await frame.click('#prog-list [data-prog="pick"] >> nth=0')
    await frame.waitForSelector('#prog-list .prog-ask [data-prog="add"]', { timeout: 3000 })
    await frame.click('#prog-list [data-prog="cancel"]')
    await frame.waitForSelector('#bal-card .bal-row', { timeout: 3000 })
    // Import from Telegram: a made-up export shows its days to pick (nothing is uploaded).
    await frame.click('.st-tab[data-tab="progress"]')
    await frame.click('#pr-sub [data-sub="history"]')
    const fake = '<div class="history"><div class="message default clearfix" id="message2"><div class="body"><div class="pull_right date details" title="02.02.2025 20:00:00 UTC+03:00">20:00</div><div class="from_name">Demo Bot</div><div class="text">Push-ups (30/40 reps)<br>Sit-ups (20/20 reps)</div></div></div></div>'
    await frame.setInputFiles('#tg-file', { name: 'messages.html', mimeType: 'text/html', buffer: Buffer.from(fake) })
    await frame.waitForSelector('#modal-tg.open .tg-day input[data-day="2025-02-02"]', { timeout: 10000 })
    await frame.click('#tg-cancel')
    await frame.click('#pr-sub [data-sub="badges"]')
    await frame.waitForSelector('.bd .medal', { timeout: 5000 })
    await frame.click('.st-tab[data-tab="today"]')
    // The rank and level strip: your rank, a big level per exercise, a best-set box; "Too easy" jumps a level, Undo brings it back.
    await frame.waitForSelector('#lv-strip .ls-rank-name', { timeout: 5000 })
    if (!/your rank/i.test(await frame.locator('#lv-strip').innerText())) throw new Error('the level strip has no rank')
    if (await frame.locator('#lv-strip [data-best-form]').count()) {
      if (await frame.locator('#lv-strip .ls-best').count()) await frame.click('#lv-strip .ls-best summary')
      await frame.selectOption('#lv-strip [data-best-form] select', 'pushup')
      await frame.fill('#lv-strip [data-best-form] input', '50')
      await frame.click('#lv-strip [data-best-form] button[type="submit"]')
    }
    await frame.waitForSelector('#lv-strip .lvb', { timeout: 5000 })
    const lvText = await frame.locator('#lv-strip').innerText()
    if (!/Level \d+/.test(lvText) || !/of \d+/.test(lvText) || !/(→|top rank)/.test(await frame.locator('#ls-rank-line').innerText())) throw new Error(`the level strip lacks the rank or levels (got: ${lvText})`)
    if (!(await frame.locator('.ex .lv-big').count()) || !(await frame.locator('.ex [data-tune="easy"]').count()) || !(await frame.locator('.ex [data-tune="hard"]').count())) throw new Error('cards lack the big level or the Too easy / Too hard buttons')
    if (process.env.SPORT_SHOTS) { await pg.addStyleTag({ content: '.toasts { display: none !important; }' }); await frame.locator('#lv-strip').screenshot({ path: `${process.env.SPORT_SHOTS}/today-hero.png` }) }
    const before = await frame.locator('.ex .ex-name').allInnerTexts()
    await frame.click('.ex [data-tune="easy"]')
    await frame.waitForFunction(() => /Level \d+|top of the ladder/.test(document.getElementById('toast-text')?.textContent ?? ''), null, { timeout: 5000 })
    const after = await frame.locator('.ex .ex-name').allInnerTexts()
    if (JSON.stringify(before) === JSON.stringify(after) && !/top of the ladder/.test(await frame.locator('#toast-text').innerText())) await frame.waitForTimeout(300)
    if (process.env.SPORT_SHOTS) await pg.locator('body').screenshot({ path: `${process.env.SPORT_SHOTS}/level-up-applied.png` })
    if (await frame.locator('#toast-undo').isVisible()) await frame.click('#toast-undo')
    // No sideways scroll at a laptop size or on a phone.
    for (const [w, h] of [[1280, 720], [390, 844]]) {
      await pg.setViewportSize({ width: w, height: h })
      await pg.waitForTimeout(400)
      const over = await frame.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      if (over > 1) throw new Error(`Sport Track scrolls sideways at ${w}px (${over}px)`)
    }
    await pg.setViewportSize({ width: 1440, height: 900 })
  }, { retries: 1 })
  // Best-set onboarding: one short screen on first open (and "Re-check my levels"); 50 push-ups starts on a harder variation.
  await step('Sport Track onboarding: a best set of 50 push-ups puts Today on a harder variation', async () => {
    await pg.setViewportSize({ width: 1440, height: 900 })
    await open('body')
    await pg.locator('.seg-switch button').first().click()
    await pg.waitForTimeout(2500)
    const frame = pg.frames().find((f) => f.url().includes('/apps/sport/'))
    if (!frame) throw new Error('no Sport Track frame')
    const K = 'life_sport_tracker_v1'
    // A fresh start for this step; the state is put back at the end.
    await frame.evaluate((k) => { if (!localStorage.getItem('smoke_sport_backup')) localStorage.setItem('smoke_sport_backup', localStorage.getItem(k) ?? ''); const s = JSON.parse(localStorage.getItem(k) || '{}'); delete s.onboarded; s.sportySettings = { ...(s.sportySettings || {}), coachMode: true }; localStorage.setItem(k, JSON.stringify(s)); location.reload() }, K)
    await frame.waitForSelector('#modal-onboard.open', { timeout: 10000 }).catch(async (e) => { throw new Error(e.message.split('\n')[0] + ' DEBUG ' + JSON.stringify(await frame.evaluate((k) => ({ ls: JSON.parse(localStorage.getItem(k) || '{}').sportySettings, on: typeof coachOn === 'function' ? coachOn() : 'n/a' }), K))) })
    if (process.env.SPORT_SHOTS) await pg.locator('body').screenshot({ path: `${process.env.SPORT_SHOTS}/onboarding.png` })
    await frame.fill('#onb-fields input[name="pushup"]', '50')
    await frame.click('#onb-go')
    await frame.waitForSelector('#modal-onboard:not(.open)', { state: 'attached', timeout: 5000 })
    await frame.waitForFunction(() => /(archer|decline|one-arm)/i.test(document.querySelector('#your-coach .cc-list')?.textContent ?? ''), null, { timeout: 10000 })
    const session = await frame.locator('#your-coach .cc-list').innerText()
    if (!/[45]×[5-8]\s+(archer|decline)/i.test(session)) throw new Error(`Today's session is not 4×5–8 of a hard variation (got: ${JSON.stringify(session)})`)
    if (process.env.SPORT_SHOTS) await pg.locator('body').screenshot({ path: `${process.env.SPORT_SHOTS}/today-after-onboarding.png` })
    // It does not come back by itself, and "Re-check my levels" reopens it with your answer.
    await frame.evaluate(() => location.reload())
    await frame.waitForSelector('#your-coach:not([hidden])', { timeout: 10000 })
    await frame.waitForTimeout(1200)
    if (await frame.locator('#modal-onboard.open').count()) throw new Error('onboarding came back after it was answered')
    await frame.click('#cc-recheck')
    await frame.waitForSelector('#modal-onboard.open', { timeout: 3000 })
    if ((await frame.inputValue('#onb-fields input[name="pushup"]')) !== '50') throw new Error('Re-check should show your last answer')
    await frame.click('#onboard-skip')
    // Put the state back.
    await frame.evaluate((k) => { const b = localStorage.getItem('smoke_sport_backup'); localStorage.removeItem('smoke_sport_backup'); if (b) localStorage.setItem(k, b); else localStorage.removeItem(k); location.reload() }, K)
    await frame.waitForTimeout(1200)
    if (await frame.locator('#modal-onboard.open').count()) await frame.click('#onboard-skip')
  }, { retries: 1 })
  // BD1–BD18: Body → Metrics & Workouts in four tabs. The protein ring and a quick log, readiness setting
  // Sport Track's dose, sets per muscle, the weight trend, measurements, progress photos that stay on this
  // device (made-up drawn silhouettes, never a real photo) and the weekly body card.
  // BODY_SHOTS=<dir> saves screenshots (E2E_BODY_DEMO=1 gives the made-up six weeks of data).
  await step('Body boost: protein ring and quick log, readiness dose, sets per muscle, weight trend, tape, photos on this device, weekly card', async () => {
    const shots = process.env.BODY_SHOTS
    const shot = async (sel, name) => {
      if (!shots) return
      await pg.addStyleTag({ content: '.toasts { display: none !important; }' })
      await pg.waitForTimeout(500)
      await pg.locator(sel).first().screenshot({ path: `${shots}/${name}.png` })
    }
    await open('body')
    await pg.locator('.seg-switch [role="tab"]').nth(1).click()
    await pg.waitForSelector('.body-page .ptabs [data-tab="food"]', { timeout: 20000 })
    // Food: "2 eggs" in the quick log puts 12 g on the ring; a quick pick adds more; Remove takes it off.
    await pg.click('.body-page .ptabs [data-tab="food"]')
    const food = '#ptp-body-food'
    await pg.waitForSelector(`${food} .pr-ring-num b`, { timeout: 20000 })
    const ringNow = () => pg.evaluate((p) => Number(document.querySelector(`${p} .pr-ring-num b`)?.textContent), food)
    const before = await ringNow()
    await pg.fill(`${food} .pr-quick input`, '2 eggs')
    await pg.waitForFunction((p) => /\+12 g/.test(document.querySelector(`${p} .pr-quick button`)?.textContent ?? ''), food, { timeout: 5000 })
    await pg.click(`${food} .pr-quick button`)
    await pg.waitForFunction(([p, b]) => Number(document.querySelector(`${p} .pr-ring-num b`)?.textContent) === b + 12, [food, before], { timeout: 15000 })
    await pg.locator(`${food} .pr-pick`).first().click()
    await pg.waitForFunction(([p, b]) => Number(document.querySelector(`${p} .pr-ring-num b`)?.textContent) > b + 12, [food, before], { timeout: 15000 })
    const n = await pg.locator(`${food} .pr-entries li`).count()
    if (n < 2) throw new Error(`today's protein list shows ${n} entries`)
    const withPick = await ringNow()
    await pg.locator(`${food} .pr-entries li`).last().locator('button').click()
    await pg.waitForFunction(([p, v]) => Number(document.querySelector(`${p} .pr-ring-num b`)?.textContent) < v, [food, withPick], { timeout: 15000 })
    await pg.locator(`${food} .pr-entries li.removed`).first().waitFor({ timeout: 5000 })
    await shot(`${food} .pr-card`, 'protein-ring-and-quick-log')
    // Today: readiness picks the dose; tapping Short tells Sport Track (life_body) and says it's your pick.
    await pg.click('.body-page .ptabs [data-tab="today"]')
    const today = '#ptp-body-today'
    await pg.waitForSelector(`${today} .rd-plan button[role="radio"] .rd-auto`, { timeout: 20000 })
    await pg.waitForSelector(`${today} .pr-card.compact .pr-ring`, { timeout: 10000 })
    if (process.env.E2E_BODY_DEMO) {
      // A made-up short night (5h25): a lighter day, progression on hold, chosen by itself.
      await pg.waitForSelector(`${today} .rd-hold`, { timeout: 10000 })
      await shot(`${today} .rd-card`, 'readiness-auto-lighter')
    }
    await pg.locator(`${today} .rd-plan button[role="radio"]`).nth(2).click()
    await pg.waitForFunction(() => JSON.parse(localStorage.getItem('life_body') || 'null')?.ready?.mode === 'short', null, { timeout: 15000 })
    await pg.waitForSelector(`${today} .rd-plan button[role="radio"].on`, { timeout: 5000 })
    if (!/You picked it|Short/.test(await pg.locator(`${today} .rd-card`).innerText())) throw new Error('the readiness card does not show the pick')
    await shot(`${today} .rd-card`, 'readiness-your-pick-short')
    await pg.click(`${today} .rd-plan .btn`) // back to automatic
    await pg.waitForFunction(() => JSON.parse(localStorage.getItem('life_body') || 'null')?.ready?.auto === true, null, { timeout: 15000 })
    // Training: hard sets per muscle (done / planned, 10–20) and the next step for each move.
    await pg.click('.body-page .ptabs [data-tab="training"]')
    await pg.waitForSelector('#ptp-body-training .mw-row', { timeout: 15000 })
    if ((await pg.locator('#ptp-body-training .mw-row').count()) !== 4) throw new Error('sets per muscle does not show 4 muscles')
    await pg.waitForSelector('#ptp-body-training .mw-moves li', { timeout: 5000 })
    await shot('#ptp-body-training .mw-card', 'sets-per-muscle')
    // Progress: the weight trend and its nudge, measurements, photos, the weekly card.
    await pg.click('.body-page .ptabs [data-tab="progress"]')
    const prog = '#ptp-body-progress'
    await pg.waitForSelector(`${prog} .wt-card .wt-nudge`, { timeout: 15000 })
    await shot(`${prog} .wt-card`, 'weight-trend-and-nudge')
    await pg.click(`${prog} .tp-card .card-head .btn`)
    await pg.fill(`${prog} .tp-form input >> nth=0`, '33')
    await pg.click(`${prog} .tp-form .btn`)
    await pg.waitForFunction((p) => /33 cm/.test(document.querySelector(`${p} .tp-grid`)?.textContent ?? ''), prog, { timeout: 15000 })
    await shot(`${prog} .tp-card`, 'measurements')
    await pg.waitForSelector(`${prog} .bw-card .bw-focus`, { timeout: 15000 })
    await shot(`${prog} .bw-card`, 'weekly-body-card')
    if (!/stay on this device/.test(await pg.locator(`${prog} .ph-lock`).innerText())) throw new Error('the photo card does not say photos stay on this device')
    // Two made-up drawn silhouettes in this device's photo store (8 weeks apart), then a new one: the ghost overlay.
    const drawn = await pg.evaluate(async (days) => {
      const figure = (broad, ink = '#c9d2e3') => {
        const c = document.createElement('canvas')
        c.width = 300
        c.height = 400
        const g = c.getContext('2d')
        const bg = g.createLinearGradient(0, 0, 0, 400)
        bg.addColorStop(0, '#2b3446')
        bg.addColorStop(1, '#151a24')
        g.fillStyle = bg
        g.fillRect(0, 0, 300, 400)
        g.fillStyle = ink
        const cx = 150
        const sh = 62 * broad
        g.beginPath()
        g.arc(cx, 70, 26, 0, Math.PI * 2)
        g.fill()
        g.fillRect(cx - 10, 92, 20, 16)
        g.beginPath()
        g.moveTo(cx - sh, 112)
        g.quadraticCurveTo(cx, 100, cx + sh, 112)
        g.lineTo(cx + 36, 230)
        g.lineTo(cx - 36, 230)
        g.closePath()
        g.fill()
        for (const s of [-1, 1]) {
          g.beginPath()
          g.moveTo(cx + s * sh, 114)
          g.lineTo(cx + s * (sh + 16 * broad), 120)
          g.lineTo(cx + s * (sh + 22), 236)
          g.lineTo(cx + s * (sh + 6), 236)
          g.closePath()
          g.fill()
          g.beginPath()
          g.moveTo(cx + s * 34, 228)
          g.lineTo(cx + s * 6, 228)
          g.lineTo(cx + s * 12, 380)
          g.lineTo(cx + s * 32, 380)
          g.closePath()
          g.fill()
        }
        return new Promise((ok) => c.toBlob(ok, 'image/png'))
      }
      const db = await new Promise((ok, no) => {
        const r = indexedDB.open('life-body-photos', 1)
        r.onupgradeneeded = () => r.result.objectStoreNames.contains('photos') || r.result.createObjectStore('photos', { keyPath: 'id' })
        r.onsuccess = () => ok(r.result)
        r.onerror = () => no(r.error)
      })
      const put = (p) => new Promise((ok, no) => {
        const t = db.transaction('photos', 'readwrite')
        t.objectStore('photos').put(p)
        t.oncomplete = ok
        t.onerror = () => no(t.error)
      })
      await put({ id: 'ph-demo-a', day: days[0], at: 1, blob: await figure(1), w: 300, h: 400 })
      await put({ id: 'ph-demo-b', day: days[1], at: 2, blob: await figure(1.07), w: 300, h: 400 })
      db.close()
      window.dispatchEvent(new CustomEvent('life-photos-changed'))
      const next = await figure(1.12, '#e9b27a')
      return Array.from(new Uint8Array(await next.arrayBuffer()))
    }, [70, 14].map((n) => new Date(fakeNow() - n * 864e5).toISOString().slice(0, 10)))
    await pg.waitForFunction((p) => document.querySelectorAll(`${p} .ph-strip li`).length === 2, prog, { timeout: 10000 })
    await pg.setInputFiles(`${prog} .ph-card input[type="file"]`, { name: 'checkin.png', mimeType: 'image/png', buffer: Buffer.from(drawn) })
    await pg.waitForSelector(`${prog} .ph-card .ph-ghost`, { timeout: 10000 })
    await pg.locator(`${prog} .ph-card`).scrollIntoViewIfNeeded()
    await shot(`${prog} .ph-card`, 'photo-checkin-ghost-overlay')
    await pg.click(`${prog} .ph-card .ph-actions .btn.primary`)
    await pg.waitForFunction((p) => document.querySelectorAll(`${p} .ph-strip li`).length === 3, prog, { timeout: 10000 })
    await pg.locator(`${prog} .ph-card .ph-actions .btn`, { hasText: 'Compare' }).click()
    await pg.waitForSelector(`${prog} .ph-card .ph-compare .ph-after`, { timeout: 5000 })
    await pg.locator(`${prog} .ph-card input[type="range"]`).fill('62')
    await shot(`${prog} .ph-card`, 'photo-compare-slider')
    await pg.locator(`${prog} .ph-card .ph-actions .btn`, { hasText: 'Done' }).click()
    // The photos never left this device: nothing image-like reached the (fake) server's database.
    const leaked = await pg.evaluate(async () => {
      const s = localStorage.getItem('life_web_session') ?? ''
      const r = await fetch('/api/db', { method: 'POST', headers: { Authorization: `Bearer ${s}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: "SELECT COUNT(*) FROM settings WHERE value LIKE '%image/%' OR value LIKE '%ph-demo%' OR key LIKE '%photo%' AND key != 'look_wallpaper_photo'", args: [] } }, { type: 'close' }] }) })
      const j = await r.json()
      return Number(j.results?.[0]?.response?.result?.rows?.[0]?.[0]?.value ?? -1)
    })
    if (leaked !== 0) throw new Error(`photo data reached the server (${leaked})`)
    // No sideways scroll at a laptop size or on a phone.
    for (const [w, h] of [[1280, 720], [390, 844]]) {
      await pg.setViewportSize({ width: w, height: h })
      await pg.waitForTimeout(400)
      const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      if (over > 1) throw new Error(`Body scrolls sideways at ${w}px (${over}px)`)
    }
    await pg.setViewportSize({ width: 1440, height: 900 })
    // Back to the tracker for the steps after this one.
    await pg.locator('.seg-switch [role="tab"]').nth(0).click()
  })
  // MN24: Discipline is one built-in page (no embedded MAN copy).
  await step('Discipline is one page with its own content', async () => {
    await open('discipline')
    await pg.waitForSelector('.discipline, .setup, .stealth-cover', { timeout: 10000 })
    if (await pg.evaluate(() => !![...document.querySelectorAll('iframe, webview')].find((e) => e.offsetParent && /man/.test(e.getAttribute('src') ?? '')))) throw new Error('MAN is still embedded')
    // Everything on one page, no tabs: hero, numbers, milestones, history, urge tools, settings.
    if (await pg.$('.discipline')) {
      if (await pg.$('.discipline .ptabs')) throw new Error('Discipline still has tabs')
      for (const sel of ['.dx-hero', '.dx-stats', '.dx-miles', '.dx-history .dx-heat', '.dx-tools', '.dx-settings']) if (!(await pg.$(sel))) throw new Error(`Discipline has no ${sel}`)
      // The urge crusher opens as one focused panel; "Stop the timer" closes it.
      await pg.click('.dx-crush')
      await pg.waitForSelector('.dx-urge .dx-breath', { timeout: 5000 })
      await pg.locator('.dx-urge button', { hasText: 'Stop the timer' }).click()
      await pg.waitForSelector('.dx-urge', { state: 'detached', timeout: 5000 })
    }
  })
  // Night 11: Rewards shows the wallet, Ben's line, the tabs and the reward cards.
  await step('Rewards: wallet, tabs and reward cards', async () => {
    await open('shop')
    await pg.waitForSelector('.rx-hero .rx-balance', { timeout: 10000 })
    await pg.waitForSelector('.rx-ben', { timeout: 5000 })
    await pg.click('.rx .ptabs [data-tab="all"]')
    await pg.waitForSelector('.rx-card .rx-title', { timeout: 5000 })
    // Rewards 2: suggestions from what you do, one tap adds one (with its limits and lock).
    await pg.click('.rx .ptabs [data-tab="now"]')
    // Suggested for you is folded by default: open it.
    if ((await pg.locator('.sh-shelf-head[aria-expanded="false"]', { hasText: 'Suggested for you' }).count()) > 0) await pg.click('.sh-shelf-head:has-text("Suggested for you")')
    await pg.waitForSelector('.rx-suggest .rx-sug', { timeout: 8000 })
    if ((await pg.locator('.rx-suggest .rx-sug').count()) < 4) throw new Error('fewer than 4 suggestions')
    if (!(await pg.locator('.rx-suggest .rx-sug-why').first().innerText()).trim()) throw new Error('a suggestion has no reason line')
    const sug = pg.locator('.rx-suggest .rx-sug').first()
    const title = (await sug.locator('.rx-title').innerText()).trim()
    await sug.locator('.rx-sug-add').click()
    await pg.waitForFunction((t) => ![...document.querySelectorAll('.rx-suggest .rx-sug .rx-title')].some((e) => e.textContent.trim() === t), title, { timeout: 8000 })
    await pg.click('.rx .ptabs [data-tab="all"]')
    await pg.waitForFunction((t) => [...document.querySelectorAll('.rx-grid .rx-card .rx-title')].some((e) => e.textContent.trim() === t), title, { timeout: 8000 })
    // Unlock by doing and Earn (where the points came from) show their own content.
    await pg.click('.rx .ptabs [data-tab="unlock"]')
    await pg.waitForSelector('.rx-unlock .rx-unlock-intro', { timeout: 5000 })
    await pg.click('.rx .ptabs [data-tab="earn"]')
    await pg.waitForSelector('.rx-earn .rx-from', { timeout: 8000 })
    await pg.click('.rx .ptabs [data-tab="now"]')
  })
  // One place each: the points and Settings live in the top bar only; the sidebar has neither.
  await step('Points and Settings show once (top bar), not in the sidebar', async () => {
    await open('today')
    // Today's top row lives on its Now tab.
    await pg.click('.td2 .ptabs [data-tab="now"]').catch(() => {})
    await pg.waitForSelector('aside.sb .sb-item', { timeout: 10000 })
    if (await pg.$('aside.sb .sb-me, aside.sb .sb-tools, aside.sb .sb-tool')) throw new Error('the sidebar still has a points card or a Settings tile')
    if (await pg.locator('aside.sb', { hasText: /points|Settings/i }).count()) throw new Error('the sidebar still mentions points or Settings')
    if (!(await pg.locator('header.topbar .tb-me').isVisible())) throw new Error('no points pill in the top bar')
    if ((await pg.$$('header.topbar button[aria-label="Settings"]')).length !== 1) throw new Error('not exactly one Settings button in the top bar')
    if (await pg.$('header.topbar button[aria-label="Coach"]')) throw new Error("the top bar repeats the sidebar's Coach button")
    // Today: the balance and the water are not repeated in the top row.
    await pg.waitForSelector('.thb', { timeout: 10000 })
    if (await pg.locator('.thb', { hasText: /\bpts\b|ml water/ }).count()) throw new Error("Today's top row repeats the points or the water")
    // A folded sidebar never slides out over the page on hover.
    await pg.keyboard.press('Control+b')
    await pg.waitForSelector('aside.sb.collapsed', { timeout: 3000 })
    const box = await pg.locator('aside.sb').boundingBox()
    await pg.mouse.move(box.x + box.width / 2, box.y + 200)
    await pg.waitForTimeout(700)
    const after = await pg.locator('aside.sb').boundingBox()
    const main = await pg.locator('.main').boundingBox()
    await pg.keyboard.press('Control+b')
    await pg.mouse.move(800, 500)
    if (after.x + after.width > main.x + 1) throw new Error(`the sidebar covers the page (${Math.round(after.x + after.width)} > ${Math.round(main.x)})`)
  })
  // Night 7: Ben's chat folds his automatic messages and shows cards and the Now card.
  // Ben offers "See the plan" for a plan waiting for approval only before 18:00, so this runs at 10:00.
  await step("Coach: Ben's chat with folded updates and cards", () => atTime('10:00', async () => {
    await open('coach')
    await pg.waitForSelector('.cf-col .cf-row', { timeout: 15000 })
    // Coach fix: Ben's automatic updates are folded away until you ask for them in the ⋯ menu.
    if (await pg.$('.cf-fold')) throw new Error('the folded updates show without being asked for')
    await pg.click('.cf-head-tools button[aria-label="More"]')
    await pg.locator('.cf-menu button', { hasText: "Ben's automatic updates" }).click()
    await pg.waitForSelector('.cf-fold', { timeout: 3000 })
    // One menu holds search and filters; the header has no separate search button.
    if (await pg.$('.cf-head-tools button[aria-label="Search the chat"]')) throw new Error('search is still its own button')
    // Under 1600 px the side panel starts folded.
    if (await pg.$('.cf-side')) throw new Error('the side panel is open by default at 1440 px')
    if (!(await pg.$('.cf-card'))) throw new Error('no card')
    if (!(await pg.$('.cf-head .ba-face'))) throw new Error("no face for Ben in the header")
    // Today's numbers in one place: no number pills in the header, just one "Today" button
    // (the side panel is folded at 1440 px); the start screen keeps the numbers meanwhile.
    if (await pg.$('.cf-head .cf-chips, .cf-head .p-water, .cf-head .p-must')) throw new Error("today's numbers still show as header pills")
    if ((await pg.$$('.cf-head .cf-side-open')).length !== 1) throw new Error('no single "Today" button in the header')
    // Approve only on the plan card: while the start screen (with "See my plan") shows, the row offers no second "See the plan".
    if (await pg.locator('.cf-rail .cf-now', { hasText: 'See the plan' }).count()) throw new Error('"See the plan" shows next to the start screen\'s "See my plan"')
    if (await pg.locator('.cf-rail', { hasText: /Approve/ }).count()) throw new Error('Approve shows in the suggestion row')
    // Coach UI v4: the start screen (greeting, numbers, four big asks), Ben beside the box, "Ben will…".
    await pg.waitForSelector('.ch-hero .ch-title', { timeout: 5000 })
    if ((await pg.$$('.ch-hero .ch-ask')).length !== 4) throw new Error('the start screen needs four big suggestions')
    // One live Ben on the page: the header's. Nothing beside the message box.
    if (await pg.$('.cf-compose-row .bl, .cf-compose-row .ba')) throw new Error('a second Ben sits beside the message box')
    await pg.fill('.cf-input textarea', 'water 500')
    await pg.waitForFunction(() => /Log 500 ml of water/.test(document.querySelector('.cf-will')?.textContent ?? ''), null, { timeout: 3000 })
    await pg.waitForSelector('.ch-hero', { state: 'detached', timeout: 3000 })
    await pg.fill('.cf-input textarea', '/wa')
    if (!(await pg.$('.cf-slash'))) throw new Error('no / shortcuts')
    await pg.fill('.cf-input textarea', '')
    // Exactly one animated Ben, and the chip bar sits above the box, flush with its left edge,
    // never on top of it (1280×720 is a 1920×1080 screen at 150%; and 1920 wide).
    const coachLayout = () =>
      pg.evaluate(() => {
        const roots = new Set()
        for (const a of document.getAnimations()) {
          if (a.playState !== 'running') continue
          let av = a.effect?.target?.closest?.('.ba, .bl')
          while (av?.parentElement?.closest('.ba, .bl')) av = av.parentElement.closest('.ba, .bl')
          if (av) roots.add(av)
        }
        const rail = document.querySelector('.cf-rail')?.getBoundingClientRect()
        const first = document.querySelector('.cf-rail > *')?.getBoundingClientRect()
        const box = document.querySelector('.cf-composer')?.getBoundingClientRect()
        return { animated: roots.size, rail: rail && { top: rail.top, bottom: rail.bottom, left: rail.left }, first: first && { left: first.left, bottom: first.bottom }, box: box && { top: box.top, left: box.left } }
      })
    for (const [w, h] of [[1280, 720], [1920, 1080], [1440, 900]]) {
      await pg.setViewportSize({ width: w, height: h })
      await pg.waitForSelector('.cf-rail > *', { timeout: 5000 })
      await pg.waitForTimeout(450)
      const l = await coachLayout()
      if (l.animated !== 1) throw new Error(`${l.animated} animated Ben avatars at ${w}×${h} (want exactly 1)`)
      if (!l.rail || !l.box || !l.first) throw new Error(`no chip bar or message box at ${w}×${h}`)
      if (l.rail.bottom > l.box.top + 0.5 || l.first.bottom > l.box.top + 0.5) throw new Error(`the chip bar overlaps the message box at ${w}×${h} (bar ends ${Math.round(l.rail.bottom)}, box starts ${Math.round(l.box.top)})`)
      if (Math.abs(l.first.left - l.box.left) > 2) throw new Error(`the chip bar is not aligned with the box at ${w}×${h} (chip ${Math.round(l.first.left)}, box ${Math.round(l.box.left)})`)
      if (process.env.COACH_SHOTS) await pg.screenshot({ path: `${process.env.COACH_SHOTS}/coach-${w}.png` })
    }
    // Coach UI v3: Ben's face once per group, results with Undo, the plan card, ↑ edits.
    await pg.waitForSelector('.cf-plan.live .pe-block', { timeout: 10000 })
    // Coach fix: last night's plan card is folded as expired; only today's card is live, with the one Approve.
    if (!/Expired · last night's draft/.test((await pg.locator('.cf-plan.expired').first().innerText().catch(() => '')) ?? '')) throw new Error("last night's plan card is not marked expired")
    if ((await pg.$$('.cf-plan.live')).length !== 1) throw new Error('more than one live plan card')
    if (await pg.locator('.cx-extras button', { hasText: /Approve/ }).count()) throw new Error('Approve shows twice (a reply button and the plan card)')
    // The day labels are light: a small pill on a see-through hairline, no band.
    const band = await pg.evaluate(() => {
      const d = document.querySelector('.cf-divider')
      return d ? getComputedStyle(d).backgroundImage + '|' + getComputedStyle(d).backgroundColor : null
    })
    if (band && !/^none\|rgba\(0, 0, 0, 0\)$/.test(band)) throw new Error(`the day label still has a band: ${band}`)
    // One suggestion row, three items at most.
    if ((await pg.$$('.cf-rail > *')).length > 3) throw new Error('more than three suggestions above the box')
    if (!(await pg.$('.cf-plan.live .cf-plan-track .bar i'))) throw new Error('no timeline on the plan card')
    if (!(await pg.locator('.cf-plan.live .cf-btns button', { hasText: 'Approve' }).count())) throw new Error('no Approve on the plan card')
    // DP1: the whole day: the reason, block tasks, and "Also today" with ticks that can be undone.
    const card = pg.locator('.cf-plan.live').last()
    if (!(await card.locator('.plan-why').count())) throw new Error('no reason line on the plan card')
    await card.locator('.pa-head', { hasText: 'Also today' }).waitFor({ timeout: 8000 })
    await card.locator('.pa-head', { hasText: 'Also today' }).click()
    await card.locator('.pa-list li').first().waitFor({ timeout: 5000 })
    if ((await card.locator('.pa-list li').count()) < 3) throw new Error('Also today lists too few tasks')
    // One thing = one row: a task in a block is not listed again in "Also today".
    const alsoRows = await card.locator('.pa-list li .pa-tx').allInnerTexts()
    // (Re-plan by itself may have taken a small-tasks block off this crowded made-up day: then its task is listed, once.)
    const blockTasks = (await card.locator('.pe-block .pe-task span').allInnerTexts()).map((t) => t.trim())
    if (alsoRows.some((t) => /in the \d\d:\d\d block/.test(t) || blockTasks.some((bt) => bt && t.startsWith(bt)))) throw new Error('a task in a block is listed again in Also today')
    if (!(await card.locator('.pa-later').count())) throw new Error('no tasks moved to tomorrow with a reason')
    if (process.env.PLAN_SHOTS) {
      await pg.setViewportSize({ width: 1440, height: 2300 })
      await pg.waitForTimeout(400)
      await card.scrollIntoViewIfNeeded()
      await card.screenshot({ path: `${process.env.PLAN_SHOTS}/plan-card.png` })
      await pg.setViewportSize({ width: 1440, height: 900 })
    }
    await card.locator('.pa-list li .pa-tick').first().click()
    await pg.locator('.toast button', { hasText: 'Undo' }).first().waitFor({ timeout: 4000 })
    await pg.locator('.toast button', { hasText: 'Undo' }).first().click()
    if (await card.locator('.pa-list li.done').count()) throw new Error('Undo did not untick the task')
    // One sticky day label at a time: each divider lives in its own section.
    if (await pg.$('.cf-col > .cf-divider')) throw new Error('a day divider is outside its section')
    if (process.env.PLAN_SHOTS) {
      await pg.evaluate(() => {
        const s = document.querySelector('.cf-stream')
        if (s) s.scrollTop = s.scrollHeight * 0.45
      })
      await pg.waitForTimeout(300)
      await pg.locator('.cx-chat').screenshot({ path: `${process.env.PLAN_SHOTS}/chat-one-sticky-label.png` })
    }
    if (!(await pg.$('.cf-result button'))) throw new Error('no result card with Undo')
    if (!(await pg.$('.cf-daycard'))) throw new Error('no day card')
    if (!(await pg.$('.cf-row.ben.first .cf-who-line'))) throw new Error("no name line at the start of Ben's messages")
    if (await pg.$('.cf-row.ben.grouped .cf-mark:not(.ghost)')) throw new Error("Ben's face repeats inside a group")
    await pg.evaluate(() => document.querySelector('.cf-stream')?.scrollTo({ top: 0 }))
    await pg.locator('.cf-now button', { hasText: 'See the plan' }).click()
    // Once the plan card is on screen, the row stops offering "See the plan" (one place to approve).
    await pg.waitForFunction(() => ![...document.querySelectorAll('.cf-rail .cf-now')].some((e) => /See the plan/.test(e.textContent ?? '')), null, { timeout: 4000 })
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
  }))
  // Coach fix: Ben's words flow as normal text (no box per word), during and after the reveal;
  // a reply that didn't come in time shows a friendly line with Try again, never the raw error.
  await step('Coach: a reply reads as flowing text and a failed one offers Try again', async () => {
    await open('coach')
    await pg.waitForSelector('.cf-input textarea', { timeout: 10000 })
    let fail = false
    await pg.route('**/api/coach', async (r) => {
      const b = JSON.parse(r.request().postData() || '{}')
      if (b.op || !b.text) return r.fallback()
      const body = fail
        ? JSON.stringify({ ok: false, retry: true, reply: "Sorry, I couldn't finish that answer in time.", done: [] })
        : JSON.stringify({ ok: true, reply: 'Yesterday went fine: lab intro done and 75 min of focus. Algebra slipped, so it goes first today at 09:00.', done: [], at: new Date(fakeNow()).toISOString(), buttons: [{ label: '▶ 25 min Algebra', do: 'focus:25:Algebra' }] })
      await r.fulfill({ status: 200, headers: { 'Content-Type': 'application/x-ndjson' }, body: `${JSON.stringify({ step: 'Read yesterday' })}\n${body}\n` })
    })
    const words = () =>
      pg.evaluate(() => {
        const rows = [...document.querySelectorAll('.cf-row.ben .cf-text')]
        const el = rows[rows.length - 1]
        if (!el) return null
        const spans = [...el.querySelectorAll('.cx-rich span, .cx-rich b')]
        const boxed = spans.filter((s) => {
          const cs = getComputedStyle(s)
          const bg = cs.backgroundColor
          return !(bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') || parseFloat(cs.paddingLeft) > 0 || parseFloat(cs.borderTopWidth) > 0 || cs.display === 'grid'
        })
        return { text: el.textContent, words: el.querySelectorAll('.cx-wd').length, boxed: boxed.length }
      })
    await pg.fill('.cf-input textarea', 'Review yesterday for me')
    await pg.keyboard.press('Enter')
    await pg.waitForFunction(() => /Algebra slipped/.test([...document.querySelectorAll('.cf-row.ben .cf-text')].pop()?.textContent ?? ''), null, { timeout: 8000 })
    const during = await words()
    if (!during || during.boxed) throw new Error(`${during?.boxed} words sit in their own box while they appear`)
    await pg.waitForTimeout(2200)
    const after = await words()
    if (!after || after.boxed || after.words) throw new Error(`after the reveal: ${after?.words} word spans, ${after?.boxed} boxed`)
    if (process.env.COACH_SHOTS) await pg.locator('.cx-chat').screenshot({ path: `${process.env.COACH_SHOTS}/review-answer.png` })
    // The newest message sits fully above the suggestion row and the message box (nothing hides it).
    await pg.waitForFunction(() => {
      const rows = document.querySelectorAll('.cf-col .cf-row')
      const last = rows[rows.length - 1]?.getBoundingClientRect()
      const stream = document.querySelector('.cf-stream')?.getBoundingClientRect()
      const dock = document.querySelector('.cf-dock')?.getBoundingClientRect()
      return !!last && !!stream && !!dock && last.top >= stream.top - 1 && last.bottom <= dock.top + 1 && last.bottom <= stream.bottom - 20
    }, null, { timeout: 4000 }).catch(async () => {
      const r = await pg.evaluate(() => {
        const rows = document.querySelectorAll('.cf-col .cf-row')
        const last = rows[rows.length - 1]?.getBoundingClientRect()
        return `last ${Math.round(last?.top)}-${Math.round(last?.bottom)}, chat ends ${Math.round(document.querySelector('.cf-stream')?.getBoundingClientRect().bottom)}, row starts ${Math.round(document.querySelector('.cf-dock')?.getBoundingClientRect().top)}`
      })
      throw new Error(`the newest message is partly hidden behind the suggestions (${r})`)
    })
    fail = true
    await pg.fill('.cf-input textarea', 'what now')
    await pg.keyboard.press('Enter')
    await pg.waitForSelector('.cx-failed button', { timeout: 8000 })
    const line = await pg.locator('.cx-failed').last().innerText()
    if (!/Try again/.test(line) || /took too long|Error|couldn't think/i.test(line)) throw new Error(`failed line: ${line}`)
    if (!(await pg.locator('.cf-row.me', { hasText: 'what now' }).count())) throw new Error('your message is gone')
    await pg.unroute('**/api/coach')
  })
  // Goals: made-up goals show as cards with a ring and a pace chart; a clear goal from plain words; a check-in.
  await step('Goals: cards with rings and pace lines, a new goal from words, a check-in, a habit day and a project step', async () => {
    await open('goals')
    await pg.waitForSelector('.gx-hero .gx-ring', { timeout: 15000 })
    await pg.waitForSelector('.gx-card .gx-chart svg polyline.plan', { timeout: 10000 })
    if ((await pg.$$('.gx-card')).length < 3) throw new Error('the made-up goals are missing')
    if (!(await pg.$('.gx-hour'))) throw new Error('no hour goal card')
    await pg.click('.gx-hero-act .btn.primary')
    await pg.fill('.gx-say input', 'read 12 books in 3 months')
    await pg.waitForFunction(() => /Got it/.test(document.querySelector('.gx-heard')?.textContent ?? ''), null, { timeout: 5000 })
    await pg.waitForSelector('.gx-preview .gx-chart', { timeout: 5000 })
    await pg.click('.gx-sheet-foot .btn.primary')
    await pg.waitForSelector('.gx-sheet', { state: 'detached', timeout: 8000 })
    await pg.waitForFunction(() => [...document.querySelectorAll('.gx-card h3')].some((h) => /12 books/.test(h.textContent ?? '')), null, { timeout: 8000 })
    await pg.click('.gx-card.due .gx-today .btn.primary')
    await pg.fill('.gx-check input', '2900')
    await pg.click('.gx-check .btn.primary')
    await pg.waitForFunction(() => [...document.querySelectorAll('.gx-card .gx-now b')].some((b) => /2,900/.test(b.textContent ?? '')), null, { timeout: 8000 })
    // The newer kinds: a habit's "Done today" fills a day, a project's step ticks, the detail opens.
    const habit = pg.locator('.gx-card.k-habit').first()
    const before = Number(await habit.locator('.gx-now b').innerText())
    await habit.locator('.gx-today .btn.primary').click()
    await pg.waitForFunction((n) => Number(document.querySelector('.gx-card.k-habit .gx-now b')?.textContent) === n + 1, before, { timeout: 8000 })
    const project = pg.locator('.gx-card.k-project').first()
    await project.locator('.gx-today .btn.primary').click()
    await pg.waitForFunction(() => /^4$/.test(document.querySelector('.gx-card.k-project .gx-now b')?.textContent ?? ''), null, { timeout: 8000 })
    for (let i = 0; i < 4 && (await pg.$('.gx-cel')); i++) await pg.keyboard.press('Escape')
    await project.click({ position: { x: 24, y: 24 } })
    await pg.waitForSelector('.gx-detail .gx-steps li.done', { timeout: 5000 })
    await pg.keyboard.press('Escape')
    await pg.waitForSelector('.gx-detail', { state: 'detached', timeout: 5000 })
    if (!(await pg.$('.gx-card.k-limit .gx-bars'))) throw new Error('the limit has no week bars')
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
  // Wallpaper (Settings → Look → Wallpaper): pick one; the layer sits behind the app with the
  // page-coloured shade that keeps text readable; "Only on Today" hides it elsewhere; None removes it.
  await step('Wallpaper: pick one, the layer and its readability shade are there', async () => {
    await open('settings')
    await pg.waitForSelector('.st-item', { timeout: 10000 })
    await pg.locator('.st-item', { hasText: 'Look' }).first().click()
    await pg.waitForSelector('.st-tabs .ptabs [data-tab="wallpaper"]', { timeout: 8000 })
    await pg.click('.st-tabs .ptabs [data-tab="wallpaper"]')
    await pg.waitForSelector('.wpg-grid .wpg-item[data-wp="ronin-moon"]', { timeout: 8000 })
    if ((await pg.locator('.wpg-grid .wpg-item').count()) < 22) throw new Error('fewer than 20 pictures in the gallery')
    await pg.click('.wpg-item[data-wp="ronin-moon"]')
    await pg.waitForSelector('.wp-layer[data-wp="ronin-moon"] .wp-art', { timeout: 5000 })
    const r = await pg.evaluate(() => {
      const layer = document.querySelector('.wp-layer')
      const art = layer.querySelector('.wp-art')
      const shade = layer.querySelector('.wp-shade')
      const cs = (el) => getComputedStyle(el)
      return {
        has: document.documentElement.classList.contains('has-wp'),
        z: cs(layer).zIndex,
        events: cs(layer).pointerEvents,
        bg: cs(art).backgroundImage,
        art: Number(cs(art).opacity),
        shade: shade ? Number(cs(shade).opacity) : -1,
        shadeColour: shade ? cs(shade).backgroundColor : '',
        page: cs(document.documentElement).backgroundColor,
        moving: !!layer.querySelector('.wp-fx')
      }
    })
    if (!r.has) throw new Error('html.has-wp is not set')
    if (r.z !== '-1' || r.events !== 'none') throw new Error(`the layer is not behind the app (z-index ${r.z}, pointer-events ${r.events})`)
    if (!/\.svg|data:image/.test(r.bg)) throw new Error(`no picture on the layer: ${r.bg.slice(0, 80)}`)
    if (r.shade < 0) throw new Error('no readability shade over the picture')
    // at most 40 % of the picture may reach the text (core/wallpaper.ts MAX_SHOW_THROUGH)
    if (r.art * (1 - r.shade) > 0.401) throw new Error(`too much picture shows through: ${r.art} × (1 − ${r.shade})`)
    if (r.shadeColour !== r.page) throw new Error(`the shade (${r.shadeColour}) is not the page colour (${r.page})`)
    if (r.moving) throw new Error('motion is on by default')
    await pg.locator('.wpg-tune button', { hasText: 'Only on Today' }).click()
    await pg.waitForFunction(() => !document.querySelector('.wp-layer'), null, { timeout: 5000 }).catch(() => {
      throw new Error('"Only on Today" still shows it in Settings')
    })
    await open('today')
    await pg.waitForSelector('.wp-layer[data-wp="ronin-moon"]', { timeout: 5000 })
    await open('settings')
    await pg.waitForSelector('.wpg-item[data-wp="none"]', { timeout: 8000 })
    await pg.locator('.wpg-tune button', { hasText: 'Everywhere' }).click()
    await pg.click('.wpg-item[data-wp="none"]')
    await pg.waitForFunction(() => !document.querySelector('.wp-layer') && !document.documentElement.classList.contains('has-wp'), null, { timeout: 5000 })
    // Leave Look on its first tab, as the later steps expect.
    await pg.click('.st-tabs .ptabs [data-tab="look"]')
  })
  // Life fit: Settings → Ben → My life (sleep, work window, how hard Ben pushes), Settings → Sound's
  // "Which sound for what", and the one-tap shift buttons. LIFEFIT_SHOTS=<dir> saves screenshots.
  await step('My life, how hard Ben pushes, which sound for what', async () => {
    const shots = process.env.LIFEFIT_SHOTS
    await open('settings')
    await pg.waitForSelector('.st-item', { timeout: 10000 })
    await pg.locator('.st-item', { hasText: 'Ben' }).first().click()
    await pg.waitForSelector('.st-tabs .ptabs [data-tab="life"]', { timeout: 8000 })
    await pg.click('.st-tabs .ptabs [data-tab="life"]')
    await pg.waitForSelector('.lf-panel', { timeout: 8000 })
    const workOn = pg.locator('.lf-panel > .toggle-row input[type="checkbox"]')
    if (!(await workOn.isChecked())) await workOn.check()
    await pg.waitForSelector('.lf-panel .lf-days', { timeout: 5000 })
    await pg.click('.lf-push button:has(b:text-is("Firm"))')
    await pg.waitForSelector('.lf-push button.on:has(b:text-is("Firm"))', { timeout: 5000 })
    await pg.click('.lf-push button:has(b:text-is("Push"))')
    await pg.waitForSelector('.lf-push button.on:has(b:text-is("Push"))', { timeout: 5000 })
    if (shots) {
      await pg.waitForTimeout(500)
      await pg.locator('.lf-panel').screenshot({ path: `${shots}/settings-my-life.png` })
    }
    // Ben 2 (Settings → Ben → Pushes): a push level per area (it started from the one above), and when Ben writes first.
    await pg.click('.st-tabs .ptabs [data-tab="pushes"]')
    await pg.waitForSelector('.bp-areas .bp-area[data-area="body"]', { timeout: 5000 })
    if ((await pg.$$('.bp-areas .bp-area')).length !== 6) throw new Error('want 6 areas: study, work, body, sleep, chores, money')
    if ((await pg.$$('.bp-area button.on')).length !== 6 || (await pg.$$('.bp-area button.on:text-is("Hard")')).length !== 6) throw new Error('every area should start at Hard (from Push)')
    await pg.click('.bp-area[data-area="body"] button:text-is("Soft")')
    await pg.waitForSelector('.bp-area[data-area="body"] button.on:text-is("Soft")', { timeout: 5000 })
    await pg.click('.bp-area[data-area="money"] button:text-is("Normal")')
    await pg.waitForSelector('.bp-area[data-area="money"] button.on:text-is("Normal")', { timeout: 5000 })
    for (const t of ['Check in when a planned block starts', 'Morning brief at', 'Evening shutdown before bed', 'Weekly check']) if (!(await pg.locator('.bp-settings .toggle-row', { hasText: t }).count())) throw new Error(`no "${t}" switch`)
    const b2 = process.env.BEN2_SHOTS
    if (b2) {
      // A tall window for the picture (the toasts gone, the section in the middle), then back.
      await pg.setViewportSize({ width: 1440, height: 1500 })
      await pg.waitForTimeout(3500)
      await pg.locator('.bp-settings').evaluate((el) => el.scrollIntoView({ block: 'center' }))
      await pg.waitForTimeout(400)
      await pg.locator('.bp-settings').screenshot({ path: `${b2}/settings-push-per-area.png` })
      await pg.setViewportSize({ width: 1440, height: 900 })
    }
    // Back to one level for all (the one switch in My life sets every area).
    await pg.click('.st-tabs .ptabs [data-tab="life"]')
    await pg.click('.lf-push button:has(b:text-is("Firm"))')
    await pg.click('.lf-push button:has(b:text-is("Push"))')
    await pg.click('.st-tabs .ptabs [data-tab="pushes"]')
    await pg.waitForSelector('.bp-area[data-area="body"] button.on:text-is("Hard")', { timeout: 5000 })
    await pg.waitForSelector('.bp-area[data-area="money"] button.on:text-is("Hard")', { timeout: 5000 })
    await pg.locator('.st-item', { hasText: 'Sound' }).first().click()
    await pg.waitForFunction(() => document.querySelector('.st-head h1')?.textContent === 'Sound', null, { timeout: 5000 })
    const n = await pg.locator('.sx-moment').count()
    if (n !== 17) throw new Error(`${n} sound rows, want 17`)
    await pg.click('button[aria-label="Sound for Water"]')
    await pg.waitForSelector('.ui-select-list [role=option]', { timeout: 3000 })
    await pg.locator('.ui-select-list [role=option]', { hasText: 'Pop' }).click()
    await pg.waitForFunction(() => document.querySelector('button[aria-label="Sound for Water"]')?.getAttribute('data-value') === 'pop', null, { timeout: 3000 })
    await pg.click('button[aria-label="Play the sound for Water"]')
    if (shots) {
      await pg.locator('.sx-moments').scrollIntoViewIfNeeded()
      await pg.waitForTimeout(500)
      await pg.locator('.sx-moments').screenshot({ path: `${shots}/settings-sounds.png` })
    }
    // Back to the default, so later steps hear what they always did.
    await pg.click('button[aria-label="Sound for Water"]')
    await pg.locator('.ui-select-list [role=option]', { hasText: 'Water drop' }).click()
  })
  // Laptop fixes: drop-down lists are readable in dark and light (the system list
  // of a plain <select> came out white with faint text on Windows), they open fully
  // on screen, and the app's own drop-down works with the keyboard.
  await step('Drop-downs: readable options in dark and light (also disabled ones), open on screen, keyboard works', async () => {
    // Contrast of two CSS colours (rgb()/rgba()/color(srgb …)); `under` is what shows through a see-through colour.
    const contrastIn = () => {
      const parse = (c) => {
        let m = c.match(/rgba?\(([^)]+)\)/)
        if (m) {
          const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
          return [p[0], p[1], p[2], p[3] ?? 1]
        }
        m = c.match(/color\(srgb ([^)]+)\)/)
        if (m) {
          const p = m[1].split(/[ /]+/).filter(Boolean).map(Number)
          return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]
        }
        return null
      }
      const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat(1)
      const lum = (c) => {
        const [r, g, b] = c.slice(0, 3).map((v) => {
          const s = v / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      window.__contrast = (fg, bg, under = 'rgb(255,255,255)') => {
        const u = parse(under)
        const b = over(parse(bg) ?? [0, 0, 0, 0], u)
        const f = over(parse(fg), b)
        const [L1, L2] = [lum(f), lum(b)].sort((x, y) => y - x)
        return (L1 + 0.05) / (L2 + 0.05)
      }
    }
    await pg.evaluate(contrastIn)
    await open('settings')
    await pg.waitForSelector('.st-item', { timeout: 10000 })
    const names = await pg.locator('.st-item b').allInnerTexts()
    let found = false
    for (const n of names) {
      await pg.locator('.st-item', { hasText: n }).first().click()
      await pg.waitForTimeout(300)
      if (await pg.locator('.st-body .ui-select:visible').count()) { found = true; break }
    }
    if (!found) throw new Error('no drop-down found in Settings')
    if (await pg.locator('.st-body select').count()) throw new Error('Settings still has a plain <select>')
    const sel = pg.locator('.st-body .ui-select:visible').first()
    const theme0 = await pg.evaluate(() => document.documentElement.dataset.theme)
    try {
      for (const theme of ['dark', 'light']) {
        await pg.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
        await sel.scrollIntoViewIfNeeded()
        await sel.click()
        await pg.waitForSelector('.ui-select-list [role=option]', { timeout: 3000 })
        const r = await pg.evaluate(() => {
          const list = document.querySelector('.ui-select-list')
          const lb = getComputedStyle(list).backgroundColor
          const box = list.getBoundingClientRect()
          const opts = [...list.querySelectorAll('[role=option]')].map((o) => {
            const cs = getComputedStyle(o)
            return { text: o.textContent, off: o.getAttribute('aria-disabled') === 'true', ratio: window.__contrast(cs.color, cs.backgroundColor, lb) }
          })
          return { opts, onScreen: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight, lb }
        })
        const bad = r.opts.filter((o) => o.ratio < (o.off ? 3 : 4.5))
        if (bad.length) throw new Error(`${theme}: hard to read: ${bad.map((o) => `${o.text} (${o.ratio.toFixed(1)})`).join(', ')}`)
        if (!r.onScreen) throw new Error(`${theme}: the list does not fit on the screen`)
        await pg.keyboard.press('Escape')
        await pg.waitForSelector('.ui-select-list', { state: 'detached', timeout: 2000 })
        // A plain <select> elsewhere (the embedded apps, the island) gets solid option colours too.
        const native = await pg.evaluate(() => {
          const s = document.createElement('select')
          s.innerHTML = '<option>Top left</option><option disabled>Docked right</option>'
          document.body.appendChild(s)
          const out = [...s.options].map((o) => {
            const cs = getComputedStyle(o)
            return { off: o.disabled, ratio: window.__contrast(cs.color, cs.backgroundColor), bg: cs.backgroundColor }
          })
          const scheme = getComputedStyle(document.documentElement).colorScheme
          s.remove()
          return { out, scheme }
        })
        const nbad = native.out.filter((o) => o.ratio < (o.off ? 3 : 4.5))
        if (nbad.length) throw new Error(`${theme}: plain drop-down options are hard to read (${nbad.map((o) => o.ratio.toFixed(1)).join(', ')})`)
        if (native.scheme !== theme) throw new Error(`${theme}: color-scheme is ${native.scheme}`)
      }
      // Keyboard: ↓ opens, ↓ moves, Escape closes without changing the choice.
      const before = await sel.getAttribute('data-value')
      await sel.focus()
      await pg.keyboard.press('ArrowDown')
      await pg.waitForSelector('.ui-select-list', { timeout: 2000 })
      if ((await sel.getAttribute('aria-expanded')) !== 'true') throw new Error('↓ did not open it')
      const a1 = await sel.getAttribute('aria-activedescendant')
      await pg.keyboard.press('End')
      const a2 = await sel.getAttribute('aria-activedescendant')
      if (!a1 || a1 === a2) throw new Error('End did not move the highlight')
      await pg.keyboard.press('Escape')
      await pg.waitForSelector('.ui-select-list', { state: 'detached', timeout: 2000 })
      if ((await sel.getAttribute('data-value')) !== before) throw new Error('Escape changed the choice')
    } finally {
      await pg.evaluate((t) => (t ? (document.documentElement.dataset.theme = t) : delete document.documentElement.dataset.theme), theme0)
    }
  })
  // Zoom (Settings → Look): − 100% +, a short "Zoom 110%" note, kept after a reload, Reset.
  await step('Zoom: Settings → Look zooms the app, says so, and keeps it after a reload', async () => {
    const zoomOf = () => pg.evaluate(() => getComputedStyle(document.documentElement).zoom)
    await open('settings')
    await pg.locator('.st-item', { hasText: 'Look' }).first().click()
    await pg.getByRole('button', { name: 'Zoom in' }).click()
    await pg.waitForSelector('.zoom-toast', { timeout: 2000 })
    if (!/Zoom 110%/.test(await pg.locator('.zoom-toast').innerText())) throw new Error('no "Zoom 110%" note')
    if (Number(await zoomOf()) !== 1.1) throw new Error(`zoom is ${await zoomOf()}`)
    if ((await pg.evaluate(() => localStorage.getItem('ls.zoom'))) !== '1.1') throw new Error('the zoom was not kept')
    // A fresh page in this browser starts at 110 %.
    const p2 = await pg.context().newPage()
    try {
      await p2.route(/api\.telegram\.org|fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '{}' }))
      await p2.goto(pg.url())
      await p2.waitForFunction(() => document.querySelector('#root')?.children.length, null, { timeout: 20000 })
      await p2.waitForTimeout(500)
      const z2 = await p2.evaluate(() => getComputedStyle(document.documentElement).zoom)
      if (Number(z2) !== 1.1) throw new Error(`a fresh page starts at zoom ${z2}`)
    } finally {
      await p2.close()
    }
    // At 110 % the page still has no sideways scroll.
    if (await pg.evaluate(() => document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1)) throw new Error('sideways scroll at 110 %')
    await open('settings')
    await pg.locator('.st-item', { hasText: 'Look' }).first().click()
    await pg.locator('.zoom-reset').click()
    await pg.waitForFunction(() => Number(getComputedStyle(document.documentElement).zoom) === 1, null, { timeout: 2000 })
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
    await pg.click('.mup .ptabs [data-tab="library"]')
    await pg.fill('.mu-add input', 'https://soundcloud.com/example-artist/sets/smoke-mix')
    await pg.locator('.mu-add .mu-btn').click()
    await pg.waitForSelector('.mup-manage li', { timeout: 5000 })
    if (!/Smoke mix/.test(await pg.locator('.mup-manage').innerText())) throw new Error('the new station is not listed')
  })
  // "Your SoundCloud": connect by username (a made-up profile) shows your Likes and tracks as cards.
  await step('Music: connect by username shows "Your SoundCloud" with Likes and tracks', async () => {
    await pg.click('.mup .ptabs [data-tab="options"]')
    await pg.fill('.ysc-connect input', 'https://soundcloud.com/example-listener/likes')
    await pg.locator('.ysc-connect .mu-btn').click()
    await pg.waitForSelector('.ysc-card', { timeout: 5000 })
    const t = await pg.locator('.ysc').first().innerText()
    if (!/@example-listener/.test(t) || !/Your likes/.test(t) || !/Your tracks/.test(t)) throw new Error(`the row shows ${t.slice(0, 120)}`)
    await pg.getByRole('button', { name: 'Disconnect' }).click()
    await pg.waitForSelector('.ysc-connect input', { timeout: 5000 })
  })
  await step('Calendar shows the week with its events', async () => {
    await open('calendar')
    await pg.waitForSelector('.cal-item', { timeout: 15000 })
    const n = await pg.locator('.cal-item').count()
    if (n < 3) throw new Error(`only ${n} events on the calendar`)
  })
  // The teacher's review: events at the same time must sit side by side (never
  // on top of each other), a click shows the details, and an edit saves.
  const boxesOf = (sel, titles) =>
    pg.evaluate(
      ([s, ts]) =>
        ts.map((t) => {
          const el = [...document.querySelectorAll(s)].find((x) => x.querySelector('b')?.textContent?.trim().startsWith(t))
          const r = el?.getBoundingClientRect()
          return r ? { t, x: r.left, y: r.top, w: r.width, h: r.height } : { t, missing: true }
        }),
      [sel, titles]
    )
  const noOverlap = (boxes) => {
    const miss = boxes.filter((b) => b.missing).map((b) => b.t)
    if (miss.length) throw new Error(`not on screen: ${miss.join(', ')}`)
    for (const a of boxes)
      for (const b of boxes) {
        if (a === b) continue
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (ox > 1 && oy > 1) throw new Error(`"${a.t}" covers "${b.t}"`)
      }
    for (const b of boxes) if (b.h < 20) throw new Error(`"${b.t}" is only ${Math.round(b.h)} px tall`)
  }
  const lastUpdate = () => pg.evaluate(async () => (await fetch('/api/google', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('life_web_session')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'lastUpdate' }) })).json())
  await step('Calendar: events at the same time sit side by side, a click shows the details, a click on empty time adds one', async () => {
    noOverlap(await boxesOf('.cal-item', ['Stand-up prep', 'Team stand-up', 'Sport (20 min)']))
    noOverlap(await boxesOf('.cal-item', ['AI study', 'Family call']))
    noOverlap(await boxesOf('.cal-item', ['Plan tomorrow', 'Read 10 min']))
    await pg.locator('.cal-item', { hasText: 'Team stand-up' }).first().click()
    await pg.waitForSelector('.ev-sheet', { timeout: 5000 })
    const txt = await pg.locator('.ev-sheet').innerText()
    if (!/Join the call/.test(txt) || !/4 people invited/.test(txt) || !/Repeats/.test(txt)) throw new Error(`the details show ${txt.slice(0, 160)}`)
    await pg.keyboard.press('Escape')
    await pg.waitForSelector('.ev-sheet', { state: 'detached', timeout: 3000 })
    // A click on an empty hour: the quick "New event" form, saved as a Life System block.
    const col = pg.locator('.cal-col').first()
    await col.scrollIntoViewIfNeeded()
    await pg.evaluate(() => (document.querySelector('.cal-scroll').scrollTop = 0))
    const box = await col.boundingBox()
    if (!box) throw new Error('no day column')
    await pg.mouse.click(box.x + box.width / 2, box.y + 30)
    await pg.waitForSelector('.cal-draft', { timeout: 3000 })
    await pg.fill('.cal-draft input[aria-label="Title"]', 'Smoke focus block')
    await pg.locator('.cal-draft-kind button', { hasText: 'Life System block' }).click()
    await pg.locator('.cal-draft button.primary').click()
    await pg.waitForSelector('.cal-item:has-text("Smoke focus block")', { timeout: 8000 })
  })
  await step('Today: events at the same time sit side by side, a click opens the details, an edit saves to Google', async () => {
    await open('today')
    await pg.waitForSelector('.ds-block', { timeout: 15000 })
    noOverlap(await boxesOf('.ds-block', ['Stand-up prep', 'Team stand-up', 'Sport (20 min)']))
    noOverlap(await boxesOf('.ds-block', ['AI study', 'Family call']))
    noOverlap(await boxesOf('.ds-block', ['Plan tomorrow', 'Read 10 min']))
    const block = pg.locator('.ds-block', { hasText: 'Stand-up prep' }).first()
    await block.scrollIntoViewIfNeeded()
    await block.click()
    await pg.waitForSelector('.ev-sheet', { timeout: 5000 })
    const txt = await pg.locator('.ev-sheet').innerText()
    if (!/Room 204/.test(txt) || !/16:45/.test(txt) || !/Look over yesterday/.test(txt)) throw new Error(`the details show ${txt.slice(0, 160)}`)
    await pg.locator('.ev-sheet button', { hasText: 'Edit' }).click()
    await pg.fill('.ev-sheet input[aria-label="Title"]', 'Stand-up notes')
    await pg.locator('.ev-sheet .ce-lens button', { hasText: '30 min' }).click()
    await pg.fill('.ev-sheet input[aria-label="Place"]', 'Room 101')
    await pg.locator('.ev-sheet button', { hasText: 'Save' }).click()
    await pg.waitForSelector('.ev-sheet', { state: 'detached', timeout: 3000 })
    // On screen at once, and Google got the change.
    await pg.waitForSelector('.ds-block:has-text("Stand-up notes")', { timeout: 3000 })
    let up = null
    for (let i = 0; i < 20 && up?.title !== 'Stand-up notes'; i++) {
      up = await lastUpdate()
      if (up?.title !== 'Stand-up notes') await pg.waitForTimeout(150)
    }
    if (up?.title !== 'Stand-up notes' || up?.location !== 'Room 101' || !up?.end) throw new Error(`Google got ${JSON.stringify(up)?.slice(0, 160)}`)
    const mins = (new Date(up.end).getTime() - new Date(up.start).getTime()) / 60000
    if (mins !== 30) throw new Error(`the new length is ${mins} min`)
    // Keys: Enter opens a focused block, Escape closes.
    await pg.locator('.ds-block', { hasText: 'Family call' }).first().focus()
    await pg.keyboard.press('Enter')
    await pg.waitForSelector('.ev-sheet', { timeout: 3000 })
    await pg.keyboard.press('Escape')
    await pg.waitForSelector('.ev-sheet', { state: 'detached', timeout: 3000 })
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
    // One water tap: one ripple and one label at most, both gone within ~1 s.
    await ip.waitForTimeout(400)
    await ip.click('.di-peek.alert .di-actions button')
    await ip.waitForTimeout(150)
    const fx = await ip.locator('[data-water-fx]').count()
    if (fx > 2) throw new Error(`one water tap left ${fx} animation elements`)
    await ip.screenshot({ path: process.env.WATER_SHOTS ? `${process.env.WATER_SHOTS}/frame-${Date.now()}.png` : '/dev/null' }).catch(() => {})
    await ip.waitForFunction(() => !document.querySelector('[data-water-fx]'), null, { timeout: 1000 })
    await ip.waitForSelector('.di-peek.alert', { timeout: 5000 }).catch(() => {})
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
  await step('Island visuals: dayState class, orbit dots, Ben face, hover peek shows the next 3 hours, a swipe logs water, the story can be skipped', async () => {
    const shots = process.env.ALIVE_SHOTS
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
        dayState: 'behind', top3: [{ title: 'A', done: true }, { title: 'B', done: false }, { title: 'C', done: false }],
        next3h: [{ at: now + 30 * 60_000, title: 'Gym', kind: 'event' }, { at: now + 100 * 60_000, title: 'Call mom', kind: 'remind' }],
        shield: { on: true, held: 3 }, story: { lines: ['A calm day.', 'Nice focus.'], stats: { focusMin: 90, waterMl: 1500, done: 4 } },
        gaming: { on: true, app: 'Fortnite', sessionMin: 42, todayMin: 60, weekMin: 200, limitMin: 50 }
      }
      window.__island = { actions: [], send: (name, v) => cbs[name]?.(v), snap }
      window.desktop = new Proxy({
        islandAction: (a) => { window.__island.actions.push(a) },
        setIslandPrefs: async () => null,
        onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
        onIslandHover: on('hover'), onIslandPrefs: on('prefs')
      }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
    })
    await ip.goto(`http://127.0.0.1:${port}/?island=1`)
    await ip.waitForSelector('.di.ds-behind .di-pill', { timeout: 15000 })
    if ((await ip.locator('.alive-dot').count()) !== 3 || (await ip.locator('.alive-dot.done').count()) !== 1) throw new Error('orbit dots wrong')
    await ip.waitForSelector('.alive-ben', { timeout: 3000 })
    if (!(await ip.locator('.alive-gaming.lv-near').count())) throw new Error('gaming counter should be amber near the limit')
    await ip.waitForTimeout(900)
    if (shots) await ip.screenshot({ path: `${shots}/pill.png`, clip: { x: 100, y: 0, width: 320, height: 60 } })
    await ip.evaluate(() => window.__island.send('hover', true))
    await ip.waitForSelector('.di-peek', { timeout: 3000 })
    await ip.waitForSelector('[data-peekcard]', { timeout: 3000 })
    const lis = await ip.locator('[data-peekcard] li').count()
    if (lis !== 2) throw new Error(`peek timeline items: ${lis}`)
    if (shots) await ip.screenshot({ path: `${shots}/peek.png` })
    const b = await ip.locator('[data-peekcard]').boundingBox()
    await ip.mouse.move(b.x + 20, b.y + b.height / 2)
    await ip.mouse.down()
    await ip.mouse.move(b.x + 90, b.y + b.height / 2, { steps: 5 })
    await ip.mouse.up()
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'water'), null, { timeout: 3000 })
    await ip.evaluate(() => window.__island.send('hover', false))
    await ip.evaluate(() => window.dispatchEvent(new Event('life-island-story')))
    await ip.waitForSelector('.alive-story', { timeout: 3000 })
    await ip.click('.alive-story-skip')
    await ip.waitForSelector('.alive-story', { state: 'detached', timeout: 3000 })
    await ip.context().close()
  })
  // Calm (the default on the desktop): hidden until the mouse rests on its spot,
  // new things peek as one slim line and then wait as a coloured dot.
  await step('Desktop island Calm: only a faint line at rest, hover brings the pill, a nudge peeks then waits as a dot, a quiet kind is only a dot, your reminder peeks, a dot opens its card', async () => {
    const shots = process.env.CALM_SHOTS
    const ip = await (await browser.newContext({ viewport: { width: 520, height: 680 } })).newPage()
    ip.on('pageerror', (e) => errors.push(`island calm: ${e.message}`))
    await ip.addInitScript(() => {
      const cbs = {}
      const on = (name) => (cb) => { cbs[name] = cb }
      const now = Date.now()
      const snap = {
        at: now, locked: false,
        ben: { face: '🙂', mood: 'chill', why: '', move: null, last: null, unread: 0, busy: false, steps: [] },
        running: null, now: null, next: { title: 'Study group', start: now + 40 * 60_000, end: now + 100 * 60_000 },
        mustdos: [], water: { ml: 500, target: 2000 }, reps: [], alert: null
      }
      window.__island = { take: [], actions: [], send: (name, v) => cbs[name]?.(v), snap }
      window.desktop = new Proxy({
        islandHot: () => {},
        islandTakeClicks: (on) => { window.__island.take.push(on) },
        islandAction: (a) => { window.__island.actions.push(a) },
        onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
        onIslandPrefs: (cb) => { cbs.prefs = cb; setTimeout(() => cb({ size: 'normal', mode: 'calm', calmRest: 'line', peekSec: 2, gapMin: 0 }), 60) },
        onIslandHover: on('hover'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle')
      }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
    })
    await ip.goto(`http://127.0.0.1:${port}/?island=1`)
    // A made-up browser tab strip behind it, so the screenshots show what sits under the island.
    if (shots) await ip.addStyleTag({ content: 'body::before { content: ""; position: fixed; inset: 0; z-index: -1; background: linear-gradient(#2b2d33 0 34px, #f4f5f7 34px); }' })
    await ip.waitForSelector('.di.calm-hidden .di-nub-wrap', { timeout: 15000 })
    if (await ip.$('.di-pill')) throw new Error('Calm at rest still shows the pill')
    const nub = await ip.locator('.di-nub').boundingBox()
    if (!nub || nub.width > 60 || nub.height > 6) throw new Error(`the resting line is ${nub?.width}×${nub?.height}`)
    if (shots) await ip.screenshot({ path: `${shots}/calm-rest-line.png`, clip: { x: 0, y: 0, width: 520, height: 90 } })
    // Passing the mouse over it quickly does nothing, and clicks keep passing through.
    await ip.mouse.move(nub.x + nub.width / 2, nub.y + 2)
    await ip.waitForTimeout(60)
    await ip.mouse.move(nub.x + nub.width / 2, 300)
    await ip.waitForTimeout(400)
    if (await ip.$('.di-pill')) throw new Error('a quick pass brought the pill out')
    if (await ip.evaluate(() => window.__island.take.includes(true))) throw new Error('the resting line took clicks')
    // Resting on it: the pill slides out.
    await ip.mouse.move(nub.x + nub.width / 2, nub.y + 2)
    await ip.waitForSelector('.di-pill.di-rest', { timeout: 3000 })
    if (shots) await ip.waitForTimeout(700)
    if (shots) await ip.screenshot({ path: `${shots}/calm-hover-pill.png`, clip: { x: 0, y: 0, width: 520, height: 120 } })
    // Staying on it does NOT open the panel (only a click does); away, it goes back to the line.
    await ip.waitForTimeout(1600)
    if (await ip.$('.di-panel')) throw new Error('the panel opened by itself on hover (it must wait for a click)')
    await ip.click('.di-pill.di-rest')
    await ip.waitForSelector('.di-panel', { timeout: 3000 })
    await ip.mouse.move(260, 600, { steps: 3 })
    await ip.waitForSelector('.di.calm-hidden .di-nub-wrap', { timeout: 8000 })
    if (await ip.$('.di-panel')) throw new Error('the panel stayed open')
    // An eye break (off in "Peek for"): no peek, only a green dot.
    await ip.evaluate(() => window.__island.send('state', { ...window.__island.snap, at: Date.now(), alert: { id: 'eyes:1', kind: 'eyes', title: 'Eye break', text: 'Look far away for 20 seconds', actions: [] } }))
    await ip.waitForSelector('.di-nub-dot.dot-green', { timeout: 5000 })
    await ip.waitForTimeout(500)
    if (await ip.$('.di-peek')) throw new Error('an eye break popped up in Calm')
    // Water (on): a slim one-line peek, never the panel, then a blue dot on the line.
    await ip.evaluate(() => window.__island.send('state', { ...window.__island.snap, at: Date.now() + 1, alert: { id: 'water:1', kind: 'water', title: 'Water', text: '2 glasses behind', actions: [{ label: '+250 ml', action: { kind: 'water', ml: 250 }, primary: true }] } }))
    await ip.waitForSelector('.di-peek.calm-peek', { timeout: 5000 })
    if (await ip.$('.di-panel') || await ip.$('.di-peek.alert')) throw new Error('the water nudge opened more than the slim peek')
    if (shots) await ip.waitForTimeout(700)
    if (shots) await ip.screenshot({ path: `${shots}/calm-peek.png`, clip: { x: 0, y: 0, width: 520, height: 120 } })
    await ip.waitForSelector('.di-peek', { state: 'detached', timeout: 6000 })
    await ip.waitForSelector('.di.calm-hidden .di-nub-dot.dot-blue', { timeout: 4000 })
    if (shots) await ip.screenshot({ path: `${shots}/calm-dot.png`, clip: { x: 0, y: 0, width: 520, height: 90 } })
    // A reminder you set still peeks by itself.
    await ip.evaluate(() => window.__island.send('state', { ...window.__island.snap, at: Date.now() + 2, alert: { id: 'remind:1', kind: 'remind', title: 'Reminder', text: 'Call the dentist', actions: [{ label: '✓ Done', action: { kind: 'dismiss', id: 'remind:1' }, primary: true }] } }))
    await ip.waitForSelector('.di-peek.calm-peek.kind-remind', { timeout: 5000 })
    await ip.waitForSelector('.di-peek', { state: 'detached', timeout: 6000 })
    await ip.waitForSelector('.di-nub-dot.dot-amber', { timeout: 4000 })
    // Hover, then tap its dot: the reminder's card with its buttons.
    const n2 = await ip.locator('.di-nub').boundingBox()
    await ip.mouse.move(n2.x + n2.width / 2, n2.y + 2)
    await ip.waitForSelector('.di-pill .di-calm-dot.dot-amber', { timeout: 3000 })
    // On a dot the panel doesn't open by itself (staying on the rest of the pill does).
    await ip.hover('.di-pill .di-calm-dot.dot-amber')
    await ip.waitForTimeout(1200)
    if (await ip.$('.di-panel')) throw new Error('the panel opened while the mouse was on a dot')
    if (shots) await ip.screenshot({ path: `${shots}/calm-pill-dot.png`, clip: { x: 0, y: 0, width: 520, height: 120 } })
    await ip.click('.di-pill .di-calm-dot.dot-amber')
    await ip.waitForSelector('.di-peek.alert.kind-remind [data-tap="peek:alert:✓ Done"]', { timeout: 4000 })
    if (shots) await ip.waitForTimeout(700)
    if (shots) await ip.screenshot({ path: `${shots}/calm-dot-card.png`, clip: { x: 0, y: 0, width: 520, height: 260 } })
    await ip.context().close()
  })
  await step('Desktop island reminders: one water peek in Calm and no to-do twice', async () => {
    const ip = await (await browser.newContext({ viewport: { width: 520, height: 760 } })).newPage()
    ip.on('pageerror', (e) => errors.push(`island reminders: ${e.message}`))
    await ip.addInitScript(() => {
      const cbs = {}
      const on = (name) => (cb) => { cbs[name] = cb }
      const now = Date.now()
      // The same to-dos sent from two feeds (must-do, top 3 and Todoist): each must show once.
      const snap = {
        at: now, locked: false,
        ben: { face: '🙂', mood: 'chill', why: '', move: null, last: null, unread: 0, busy: false, steps: [] },
        running: null, now: null, next: null,
        mustdos: [{ i: 0, text: 'Call the bank', done: false }, { i: 1, text: 'call the bank.', done: false }],
        week: { top: [{ i: 0, text: 'CALL THE BANK', done: false }, { i: 1, text: 'Finish essay', done: false }], parked: [] },
        tasks: [{ id: 't1', content: 'Finish essay', time: null }, { id: 't2', content: 'Buy milk', time: null }, { id: 't2', content: 'Buy milk', time: null }, { id: 't3', content: '🥛 buy milk', time: null }],
        water: { ml: 500, target: 2000 }, reps: [], alert: null
      }
      window.__island = { send: (name, v) => cbs[name]?.(v), snap }
      window.desktop = new Proxy({
        islandHot: () => {}, islandTakeClicks: () => {}, islandAction: () => {},
        onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
        onIslandPrefs: (cb) => { cbs.prefs = cb; setTimeout(() => cb({ size: 'normal', mode: 'calm', calmRest: 'line', peekSec: 2, gapMin: 0 }), 60) },
        onIslandHover: on('hover'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle')
      }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
    })
    await ip.goto(`http://127.0.0.1:${port}/?island=1`)
    await ip.waitForSelector('.di.calm-hidden .di-nub-wrap', { timeout: 15000 })
    // The water reminder (a default-settings kind) peeks once in Calm, then waits as a blue dot.
    await ip.evaluate(() => window.__island.send('state', { ...window.__island.snap, at: Date.now() + 1, alert: { id: 'water:r1', kind: 'water', title: 'A glass of water?', text: '0.5 of 2.0 L so far', actions: [{ label: '+250 ml', action: { kind: 'water', ml: 250 }, primary: true }] } }))
    await ip.waitForSelector('.di-peek.calm-peek', { timeout: 5000 })
    if ((await ip.locator('.di-peek.calm-peek').count()) !== 1) throw new Error('more than one water peek')
    await ip.waitForSelector('.di-peek', { state: 'detached', timeout: 6000 })
    await ip.waitForSelector('.di.calm-hidden .di-nub-dot.dot-blue', { timeout: 4000 })
    // Open the panel and count the to-do rows by their words.
    await ip.evaluate(() => window.__island.send('state', { ...window.__island.snap, at: Date.now() + 2, alert: null }))
    const nub = await ip.locator('.di-nub').boundingBox()
    await ip.mouse.move(nub.x + nub.width / 2, nub.y + 2)
    await ip.waitForSelector('.di-pill.di-rest', { timeout: 3000 })
    await ip.click('.di-pill.di-rest')
    await ip.waitForSelector('.di-panel', { timeout: 3000 })
    const rows = await ip.evaluate(() => [...document.querySelectorAll('.di-check span, .di-week3-row span, .di-task span')].map((e) => (e.textContent || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()))
    const dup = rows.filter((r, i) => rows.indexOf(r) !== i)
    if (dup.length) throw new Error(`to-dos shown twice: ${dup.join(', ')} (rows: ${rows.join(' | ')})`)
    await ip.context().close()
  })
  // Alive island (core/islandAlive.ts and core/gaming.ts, the real code, bundled here): accept the
  // preset, an hourly pulse peek, a countdown peek, the focus shield's held count and its one summary,
  // and the game counter with its end peek.
  await step('Desktop island alive: accept the preset, a pulse peek, a countdown peek, the shield held count, the game counter', async () => {
    const { build } = await import('rolldown')
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const dir = await mkdtemp(join(tmpdir(), 'alive-'))
    const entry = join(dir, 'entry.ts')
    await writeFile(entry, `export * from ${JSON.stringify(join(repo, 'src/core/islandAlive.ts'))}\nexport * as G from ${JSON.stringify(join(repo, 'src/core/gaming.ts'))}\n`)
    const out = await build({ input: entry, write: false, output: { format: 'esm' } })
    await writeFile(join(dir, 'alive.mjs'), out.output[0].code)
    const A = await import((await import('node:url')).pathToFileURL(join(dir, 'alive.mjs')).href)
    await rm(dir, { recursive: true, force: true })
    const at = (h, m = 0, s = 0) => new Date(2026, 10, 9, h, m, s).getTime()
    // The preset: Calm stays until accepted; accepting turns everything on, and Back to Calm restores.
    const before = { mode: 'calm', sound: 'subtle', coach: false, wins: false, push: 'gentle', brief: false, shutdown: true, peekAlive: false, alive: A.DEFAULT_ALIVE }
    if (!A.shouldOffer(A.EMPTY_PRESET, 'calm')) throw new Error('the preset card is not offered on Calm')
    const on = A.startPreset(A.EMPTY_PRESET, before, 'lively')
    if (on.apply.sound !== 'full' || !on.apply.coach || !on.apply.wins || on.apply.push !== 'firm' || !A.ALIVE_KINDS.every((k) => on.apply.alive[k])) throw new Error(`the preset sets ${JSON.stringify(on.apply)}`)
    if (JSON.stringify(A.restorePreset(on.state).apply) !== JSON.stringify(before)) throw new Error('Back to Calm did not restore the old values')
    const input = (now, o = {}) => ({ now, prefs: on.apply.alive, base: null, ctx: { meeting: false, focus: false, quiet: false, asleep: false }, stats: { mustDone: 2, mustTotal: 3, waterMl: 1200, focusMin: 45 }, blocks: [], streak: null, mirror: [], weather: null, hasKit: () => true, ...o })
    const pulse = A.aliveStep(input(at(14, 0, 10)), A.EMPTY_ALIVE).alert
    if (pulse?.kind !== 'pulse' || pulse.text !== '2/3 must-dos · 1.2 L · 45 min focus') throw new Error(`pulse: ${JSON.stringify(pulse)}`)
    const blocks = [{ title: 'Study', start: at(15, 0), end: at(16, 0) }]
    const count = A.aliveStep(input(at(14, 50), { blocks }), A.EMPTY_ALIVE).alert
    if (count?.kind !== 'countdown' || count.text !== 'Start the kit?') throw new Error(`countdown: ${JSON.stringify(count)}`)
    // The shield: two cards held during focus (counted), then one summary.
    const water = { id: 'water:1', kind: 'water', title: 'Time for water', text: '', actions: [] }
    const ben = { id: 'ben:1', kind: 'ben', title: "Ben's message", text: '', actions: [] }
    const foc = { meeting: false, focus: true, quiet: false, asleep: false }
    let r = A.aliveStep(input(at(16, 10), { base: water, ctx: foc }), A.EMPTY_ALIVE)
    r = A.aliveStep(input(at(16, 12), { base: ben, ctx: foc }), r.state)
    if (r.alert || r.held !== 2) throw new Error(`the shield held ${r.held}, alert ${JSON.stringify(r.alert)}`)
    const summary = A.aliveStep(input(at(16, 40)), r.state).alert
    if (!summary || !summary.title.startsWith('2 waited')) throw new Error(`no shield summary: ${JSON.stringify(summary)}`)
    // The game counter: Fortnite by its process name, 42 minutes, then the end peek.
    const game = A.G.gameOf('FortniteClient-Win64-Shipping.exe')
    if (game !== 'Fortnite') throw new Error(`Fortnite is "${game}"`)
    let gs = A.G.EMPTY_GAMING
    for (let t = at(18); t <= at(18, 42); t += 15_000) gs = A.G.gamingStep(gs, { now: t, game }).state
    const counter = A.G.counterText(A.G.gamingView(gs, { ...A.G.DEFAULT_GAMING, on: true }, at(18, 42)))
    if (!/^🎮 Fortnite · 4[23] min$/.test(counter)) throw new Error(`counter says "${counter}"`)
    let ended = null
    for (let t = at(18, 43); t <= at(18, 50); t += 15_000) {
      const g = A.G.gamingStep(gs, { now: t, game: null })
      gs = g.state
      ended = g.ended ?? ended
    }
    if (!ended) throw new Error('the game session did not end')
    const endPeek = A.G.endedAlert({ label: 'Fortnite', sessionMin: 70, todayMin: 70, weekMin: 200 }, at(19))

    const ip = await (await browser.newContext({ viewport: { width: 520, height: 680 } })).newPage()
    ip.on('pageerror', (e) => errors.push(`island alive: ${e.message}`))
    await ip.addInitScript(() => {
      const cbs = {}
      const on = (name) => (cb) => { cbs[name] = cb }
      const now = Date.now()
      const snap = {
        at: now, locked: false,
        ben: { face: '🙂', mood: 'chill', why: '', move: null, last: null, unread: 0, busy: false, steps: [] },
        running: null, now: null, next: null, mustdos: [], water: { ml: 1200, target: 2000 }, reps: [], alert: null
      }
      window.__island = { actions: [], send: (name, v) => cbs[name]?.(v), snap }
      window.desktop = new Proxy({
        islandHot: () => {}, islandTakeClicks: () => {}, islandAction: (a) => { window.__island.actions.push(a) },
        onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
        onIslandPrefs: (cb) => { cbs.prefs = cb; setTimeout(() => cb({ size: 'normal', mode: 'lively', peekSec: 3, gapMin: 0 }), 60) },
        onIslandHover: on('hover'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle')
      }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
    })
    await ip.goto(`http://127.0.0.1:${port}/?island=1`)
    await ip.waitForSelector('.di', { timeout: 15000 })
    // The island's first look at start-up peeks once; wait until it has gone, then send the cards.
    await ip.evaluate(() => window.__island.send('hover', false))
    await ip.waitForTimeout(6000)
    let tick = 0
    const send = (alert, more = {}) => ip.evaluate(([a, m, n]) => window.__island.send('state', { ...window.__island.snap, at: Date.now() + n, alert: a, ...m }), [alert, more, ++tick])
    // The pulse peek.
    await send(pulse)
    await ip.waitForSelector('.di-peek.kind-pulse', { timeout: 5000 })
    if (!(await ip.textContent('.di-peek.kind-pulse')).includes('2/3 must-dos')) throw new Error('the pulse peek has no numbers')
    await send(null)
    await ip.waitForSelector('.di-peek', { state: 'detached', timeout: 8000 })
    // The countdown peek with "Start the kit".
    await send(count)
    await ip.waitForSelector('.di-peek.kind-countdown', { timeout: 5000 })
    if (!(await ip.textContent('.di-peek.kind-countdown')).includes('Start the kit')) throw new Error('the countdown peek has no kit button')
    await send(null)
    await ip.waitForSelector('.di-peek', { state: 'detached', timeout: 8000 })
    // The shield: two held (no peek, the count rides in the snapshot), then the one summary.
    await send(null, { shield: { on: true, held: r.held } })
    await ip.waitForTimeout(400)
    if ((await ip.locator('.di-peek').count()) !== 0) throw new Error('a peek showed while the shield held')
    await send(summary, { shield: { on: false, held: 0 } })
    await ip.waitForSelector('.di-peek.kind-pulse', { timeout: 5000 })
    if (!(await ip.textContent('.di-peek.kind-pulse')).includes('2 waited while you focused')) throw new Error('no shield summary peek')
    await send(null)
    await ip.waitForSelector('.di-peek', { state: 'detached', timeout: 8000 })
    // The end of a game session.
    await send(endPeek)
    await ip.waitForSelector('.di-peek.kind-gaming', { timeout: 5000 })
    if (!(await ip.textContent('.di-peek.kind-gaming')).includes('1h 10m today')) throw new Error('the game end peek has no totals')
    await ip.context().close()
  })
  // Ben on your PC (core/pcCoach.ts, the real decision code, bundled here): made-up
  // activity → a praise peek after 50 min of coding, then a break card whose
  // "10 push-ups" button sends the tap (the app window logs it, only on that tap).
  // BD4–BD6, BD11, BD15: sleep care. Sleep shows the debt meter and logs a coffee
  // (the curfew line follows); the Grooming tile opens its checklist and a tick
  // sticks; the island's desk drill starts from its card, and the after-shift
  // checklist sends its tap.
  await step('Sleep care: the sleep debt meter and a coffee on Sleep, the Grooming checklist on Today, the desk drill and the after-shift checklist on the island', async () => {
    await open('sleep')
    await pg.locator('.seg-switch [role="tab"]', { hasText: 'Points & stats' }).click({ timeout: 15000 })
    await pg.waitForSelector('.sc-debt .sc-meter', { timeout: 15000 })
    const before = await pg.locator('.sc-day').innerText()
    if (!/Caffeine curfew/.test(before)) throw new Error('no caffeine curfew line')
    await pg.locator('.sc-day button', { hasText: 'Coffee now' }).click()
    await pg.waitForFunction(() => /\d+ today, last at/.test(document.querySelector('.sc-day')?.textContent ?? ''), null, { timeout: 8000 })
    await pg.locator('.sc-day button', { hasText: 'Undo' }).click()
    await pg.waitForFunction(() => /No coffee logged today/.test(document.querySelector('.sc-day')?.textContent ?? ''), null, { timeout: 8000 })
    await open('today')
    await pg.click('.td2 .ptabs [data-tab="now"]').catch(() => {})
    const tile = pg.locator('.hb-row[data-hb-id="skincare"]')
    await tile.waitFor({ timeout: 15000 })
    await tile.locator('.hb-hit').click()
    await pg.waitForSelector('.gr .gr-step', { timeout: 10000 })
    const first = pg.locator('.gr-step').first()
    const was = await first.getAttribute('aria-checked')
    await first.click()
    await pg.waitForFunction((w) => document.querySelector('.gr .gr-step')?.getAttribute('aria-checked') !== w, was, { timeout: 8000 })
    await first.click()
    await pg.waitForFunction((w) => document.querySelector('.gr .gr-step')?.getAttribute('aria-checked') === w, was, { timeout: 8000 })
    await pg.keyboard.press('Escape')
    await pg.waitForSelector('.gr', { state: 'detached', timeout: 5000 })

    const ip = await (await browser.newContext({ viewport: { width: 560, height: 520 } })).newPage()
    ip.on('pageerror', (e) => errors.push(`island care: ${e.message}`))
    await ip.addInitScript(() => {
      const cbs = {}
      const on = (name) => (cb) => { cbs[name] = cb }
      const snap = { at: Date.now(), locked: false, ben: { face: '🙂', mood: 'chill', why: '', move: null, last: null, unread: 0, busy: false, steps: [] }, running: null, now: null, next: null, mustdos: [], water: { ml: 0, target: 2000 }, reps: [], alert: null }
      window.__island = { actions: [], send: (name, v) => cbs[name]?.(v), snap }
      window.desktop = new Proxy({
        islandHot: () => {}, islandTakeClicks: () => {}, islandAction: (a) => { window.__island.actions.push(a) }, setIslandPrefs: async () => null,
        onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
        onIslandHover: on('hover'), onIslandPrefs: on('prefs'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle')
      }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
    })
    await ip.goto(`http://127.0.0.1:${port}/?island=1`)
    await ip.waitForSelector('.di-pill', { timeout: 15000 })
    await ip.evaluate(() => window.__island.send('prefs', { size: 'normal', gapMin: 0 }))
    // The first picture can land after ours (it comes 50 ms after start): send again until the card shows.
    const sendUntil = async (x, sel) => {
      for (let i = 0; ; i++) {
        await ip.evaluate((v) => window.__island.send('state', { ...window.__island.snap, at: Date.now() + 1, ...v }), x)
        if (await ip.waitForSelector(sel, { timeout: 2500 }).then(() => true, () => false)) return
        if (i >= 3) throw new Error(`the island never showed ${sel}`)
      }
    }
    await sendUntil({ alert: { id: 'posture:smoke', kind: 'move', title: 'Desk mobility · 60 s', text: 'Follow the figure.', face: '🧍', actions: [], nudge: { type: 'drill', kind: 'posture', seconds: 60 } } }, '.dr-strip figure')
    if ((await ip.locator('.dr-strip figure').count()) !== 4) throw new Error('the drill should show four moves')
    await ip.locator('.dr .primary').click()
    await ip.waitForSelector('.dr-run .dr-fig path', { timeout: 5000 })
    const d1 = await ip.locator('.dr-run .dr-body').getAttribute('d')
    await ip.waitForFunction((d) => document.querySelector('.dr-run .dr-body')?.getAttribute('d') !== d, d1, { timeout: 5000 })
    if (await ip.evaluate(() => window.__island.actions.some((a) => a.kind === 'nudge' && a.op.op === 'drill'))) throw new Error('the drill was logged without a tap')
    await ip.locator('.dr-run button', { hasText: 'Stop' }).click()
    await ip.waitForSelector('.dr-strip', { timeout: 5000 })
    await sendUntil({ afterShift: { minutesLeft: 14, lightsOut: '00:20' }, alert: { id: 'aftershift:smoke', kind: 'winddown', title: 'After the shift · lights out 00:20', text: '14 min', face: '🌙', actions: [{ label: '🌙 Going to bed', action: { kind: 'bed' } }], nudge: { type: 'checklist', kind: 'bed', minutesLeft: 14, lightsOut: '00:20', steps: [{ id: 'teeth', label: 'Teeth', done: false }, { id: 'skin', label: 'Skin', done: false }, { id: 'alarm', label: 'Alarm set', done: false }, { id: 'phone', label: 'Phone away', done: false }] } } }, '.di.aftershift .nd-check')
    await ip.locator('.nd-check button', { hasText: 'Alarm set' }).click()
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'care' && a.op.op === 'shiftStep' && a.op.step === 'alarm' && a.op.on), null, { timeout: 3000 })
    await ip.context().close()
  })
  await step('Ben on your PC: 50 min of coding peeks a praise line, an hour at the PC brings a break card with water and push-ups', async () => {
    const shots = process.env.COACH_SHOTS
    const { build } = await import('rolldown')
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const dir = await mkdtemp(join(tmpdir(), 'coach-'))
    const entry = join(dir, 'entry.ts')
    await writeFile(entry, `export { decideCoach, newCoachState, coachAlert } from ${JSON.stringify(join(repo, 'src/core/pcCoach.ts'))}\nexport { sessionize } from ${JSON.stringify(join(repo, 'src/core/activityStream.ts'))}\n`)
    const out = await build({ input: entry, write: false, output: { format: 'esm' } })
    await writeFile(join(dir, 'coach.mjs'), out.output[0].code)
    const C = await import((await import('node:url')).pathToFileURL(join(dir, 'coach.mjs')).href)
    await rm(dir, { recursive: true, force: true })
    const now = fakeNow()
    const day = new Date(now).toISOString().slice(0, 10)
    const input = (events, more = {}) => ({ now, day, on: true, desktop: true, sessions: C.sessionize(events, now), idleSec: 4, activeSince: now - 20 * 60_000, dayWork: { min: 0, by: {}, distractMin: 0 }, workGoalMin: 120, push: 'push', focus: null, block: null, workHour: false, meeting: false, bedTarget: '23:30', latestBed: '00:00', wakeTime: '06:30', bedLogged: false, nextUp: null, lastMoveAt: 0, morningShown: true, eveningAt: '21:00', ...more })
    const st = { ...C.newCoachState(day), morning: true }
    const praise = C.decideCoach(input([{ t: 'app', at: now - 52 * 60_000, label: 'VS Code', kind: 'work', context: 'coding', conf: 0.9 }]), st).reaction
    if (praise?.kind !== 'praise' || !/^50 min/.test(praise.text) || !praise.id.endsWith(':50')) throw new Error(`no 50-min praise: ${JSON.stringify(praise)}`)
    const brk = C.decideCoach(input([{ t: 'app', at: now - 70 * 60_000, label: 'Chrome', kind: 'neutral', context: 'browsing', conf: 0.6 }], { activeSince: now - 58 * 60_000 }), st).reaction
    if (brk?.kind !== 'break') throw new Error(`no break card: ${JSON.stringify(brk)}`)

    const ip = await (await browser.newContext({ viewport: { width: 520, height: 680 } })).newPage()
    ip.on('pageerror', (e) => errors.push(`island coach: ${e.message}`))
    await ip.addInitScript(() => {
      const cbs = {}
      const on = (name) => (cb) => { cbs[name] = cb }
      const now = Date.now()
      const snap = {
        at: now, locked: false,
        ben: { face: '😎', mood: 'hyped', why: '', move: null, last: null, unread: 0, busy: false, steps: [] },
        running: null, now: null, next: { title: 'Rust exercises', start: now + 40 * 60_000, end: now + 100 * 60_000 },
        mustdos: [], water: { ml: 750, target: 2000 }, reps: [], alert: null
      }
      window.__island = { actions: [], send: (name, v) => cbs[name]?.(v), snap }
      window.desktop = new Proxy({
        islandHot: () => {},
        islandTakeClicks: () => {},
        islandAction: (a) => { window.__island.actions.push(a) },
        onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
        onIslandPrefs: (cb) => { cbs.prefs = cb; setTimeout(() => cb({ size: 'normal', mode: 'calm', calmRest: 'line', peekSec: 3, gapMin: 0 }), 60) },
        onIslandHover: on('hover'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle')
      }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
    })
    await ip.goto(`http://127.0.0.1:${port}/?island=1`)
    if (shots) await ip.addStyleTag({ content: 'body::before { content: ""; position: fixed; inset: 0; z-index: -1; background: linear-gradient(#2b2d33 0 34px, #f4f5f7 34px); }' })
    await ip.waitForSelector('.di.calm-hidden .di-nub-wrap', { timeout: 15000 })
    // The praise line peeks by itself in Calm (its own "Peek for" switch is on by default).
    await ip.evaluate((a) => window.__island.send('state', { ...window.__island.snap, at: Date.now(), alert: a }), C.coachAlert(praise))
    await ip.waitForSelector('.di-peek.calm-peek.kind-praise', { timeout: 5000 })
    const said = await ip.textContent('.di-peek.calm-peek.kind-praise')
    if (!said.includes('50 min')) throw new Error(`the praise peek says "${said}"`)
    if (shots) await ip.waitForTimeout(700)
    if (shots) await ip.screenshot({ path: `${shots}/coach-praise-peek.png`, clip: { x: 0, y: 0, width: 520, height: 120 } })
    await ip.waitForSelector('.di-peek', { state: 'detached', timeout: 8000 })
    // An hour at the PC: the break card; tapping its peek opens the buttons.
    await ip.evaluate((a) => window.__island.send('state', { ...window.__island.snap, at: Date.now() + 1, alert: a }), C.coachAlert(brk))
    await ip.waitForSelector('.di-peek.calm-peek.kind-move', { timeout: 5000 })
    await ip.click('.di-peek.calm-peek.kind-move')
    const pushBtn = '.di-peek.alert.kind-move [data-tap="peek:alert:💪 10 push-ups"]'
    await ip.waitForSelector(pushBtn, { timeout: 4000 })
    for (const l of ['💧 Water', '🧍 Stretched', '⏰ 15 min']) if (!(await ip.$(`.di-peek.alert.kind-move [data-tap="peek:alert:${l}"]`))) throw new Error(`the break card has no "${l}"`)
    if (shots) await ip.waitForTimeout(700)
    if (shots) await ip.screenshot({ path: `${shots}/coach-break-card.png`, clip: { x: 0, y: 0, width: 520, height: 300 } })
    await ip.click(pushBtn)
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'coach' && a.op === 'pushups' && a.ck === 'break'), null, { timeout: 3000 })
    await ip.context().close()
  })
  // Ben 2: a planned block starts → "Lab 4 starts now, ready?" on the island with
  // Start / 10 min later / Skip (Start sends the tap), the morning brief and the
  // evening shutdown as island cards, and the weekly card on the Coach page.
  await step('Ben 2: a block check-in card on the island, the morning brief, the evening shutdown, the weekly card in Coach', async () => {
    const shots = process.env.BEN2_SHOTS
    const { build } = await import('rolldown')
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const dir = await mkdtemp(join(tmpdir(), 'ben2-'))
    const entry = join(dir, 'entry.ts')
    await writeFile(entry, `export * from ${JSON.stringify(join(repo, 'src/core/benPushes.ts'))}\n`)
    const out = await build({ input: entry, write: false, output: { format: 'esm' } })
    await writeFile(join(dir, 'b2.mjs'), out.output[0].code)
    const B = await import((await import('node:url')).pathToFileURL(join(dir, 'b2.mjs')).href)
    await rm(dir, { recursive: true, force: true })
    const now = fakeNow()
    const day = new Date(now).toISOString().slice(0, 10)
    const levels = B.cleanAreas(null, 'firm')
    const log = B.cleanPushLog(null, day)
    // A start on an even minute: the plain "starts now, ready?" line.
    const blockStart = Math.floor((now - 60_000) / 120_000) * 120_000
    const checkin = B.decideCheckin({ now, on: true, blocks: [{ id: 'demo1', title: 'Lab 4', start: blockStart, end: now + 89 * 60_000, focus: true }], running: false, meeting: false, quiet: false, levels, log, here: true })
    if (!checkin || checkin.text !== 'Lab 4 starts now, ready?') throw new Error(`no check-in: ${JSON.stringify(checkin)}`)
    const wake = new Date(now - 60_000).toTimeString().slice(0, 5)
    const brief = B.decideBrief({ now, day, wake, prefs: B.cleanPushPrefs(null), off: false, mustDos: ['Essay intro', 'Rust chapter 4', 'Call the dentist'], firstBlock: { title: 'Lab 4', start: now + 30 * 60_000 }, waterTargetMl: 2500, levels, log, here: true })
    if (!brief) throw new Error('no morning brief')
    const bed = new Date(now + 30 * 60_000).toTimeString().slice(0, 5)
    const shutdown = B.decideShutdown({ now, day, bed, prefs: B.cleanPushPrefs(null), closed: false, bedLogged: false, done: ['Essay intro', 'Gym'], open: [{ id: 'm:Rust chapter 4', text: 'Rust chapter 4', kind: 'mustdo' }, { id: 't:1', text: 'Reply to the club email', kind: 'todo', ref: '1' }], levels, log, here: true })
    if (!shutdown) throw new Error('no evening shutdown')

    const ip = await (await browser.newContext({ viewport: { width: 560, height: 720 } })).newPage()
    ip.on('pageerror', (e) => errors.push(`island ben2: ${e.message}`))
    await ip.addInitScript(() => {
      const cbs = {}
      const on = (name) => (cb) => { cbs[name] = cb }
      const now = Date.now()
      const snap = {
        at: now, locked: false,
        ben: { face: '😎', mood: 'hyped', why: '', move: null, last: null, unread: 0, busy: false, steps: [] },
        running: null, now: null, next: null,
        mustdos: [], water: { ml: 750, target: 2500 }, reps: [], alert: null
      }
      window.__island = { actions: [], send: (name, v) => cbs[name]?.(v), snap }
      window.desktop = new Proxy({
        islandHot: () => {},
        islandTakeClicks: () => {},
        islandAction: (a) => { window.__island.actions.push(a) },
        onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
        onIslandPrefs: (cb) => { cbs.prefs = cb; setTimeout(() => cb({ size: 'normal', mode: 'calm', calmRest: 'line', peekSec: 3, gapMin: 0 }), 60) },
        onIslandHover: on('hover'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle')
      }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
    })
    await ip.goto(`http://127.0.0.1:${port}/?island=1`)
    if (shots) await ip.addStyleTag({ content: 'body::before { content: ""; position: fixed; inset: 0; z-index: -1; background: linear-gradient(#2b2d33 0 34px, #f4f5f7 34px); }' })
    await ip.waitForSelector('.di.calm-hidden .di-nub-wrap', { timeout: 15000 })
    const card = async (p, kind, i) => {
      await ip.evaluate(([a, k]) => window.__island.send('state', { ...window.__island.snap, at: Date.now() + k, alert: a }), [B.pushAlert(p), i])
      // It peeks in Calm (a tap opens it); with the mouse still on the island it opens at once.
      await ip.waitForSelector(`.di-peek.kind-${kind}`, { timeout: 5000 })
      if (await ip.$(`.di-peek.calm-peek.kind-${kind}`)) await ip.click(`.di-peek.calm-peek.kind-${kind}`)
      await ip.waitForSelector(`.di-peek.alert.kind-${kind}`, { timeout: 4000 })
    }
    // The check-in peeks in Calm (it falls under "Ben's messages"), a tap opens Start / 10 min later / Skip.
    await card(checkin, 'checkin', 1)
    const startBtn = '.di-peek.alert.kind-checkin [data-tap="peek:alert:▶ Start · 89 min"]'
    await ip.waitForSelector(startBtn, { timeout: 4000 })
    for (const l of ['⏰ 10 min later', 'Skip']) if (!(await ip.$(`.di-peek.alert.kind-checkin [data-tap="peek:alert:${l}"]`))) throw new Error(`the check-in card has no "${l}"`)
    if (shots) await ip.waitForTimeout(700)
    if (shots) await ip.screenshot({ path: `${shots}/island-checkin-card.png`, clip: { x: 0, y: 0, width: 560, height: 300 } })
    await ip.click(startBtn)
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'benPush' && a.op === 'start' && a.arg === 'Lab 4' && a.key === 'checkin:demo1'), null, { timeout: 3000 })
    // The morning brief: 3 lines and Plan my day.
    await ip.waitForSelector('.di-peek', { state: 'detached', timeout: 8000 }).catch(() => {})
    await card(brief, 'brief', 2)
    const said = await ip.textContent('.di-peek.alert.kind-brief')
    for (const t of ['Must-dos: Essay intro', 'First block: Lab 4', 'Water goal: 2.5 L']) if (!said.includes(t)) throw new Error(`the brief has no "${t}"`)
    if (!(await ip.$('.di-peek.alert.kind-brief [data-tap="peek:alert:🗓 Plan my day"]'))) throw new Error('the brief has no Plan my day')
    if (shots) await ip.waitForTimeout(700)
    if (shots) await ip.screenshot({ path: `${shots}/island-morning-brief.png`, clip: { x: 0, y: 0, width: 560, height: 340 } })
    await ip.click('.di-peek.alert.kind-brief [data-tap="peek:alert:🗓 Plan my day"]')
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'benPush' && a.op === 'plan'), null, { timeout: 3000 })
    // The evening shutdown: done, open, bed; Shut down opens Today's flow.
    await ip.waitForSelector('.di-peek', { state: 'detached', timeout: 8000 }).catch(() => {})
    await card(shutdown, 'shutdown', 3)
    const sd = await ip.textContent('.di-peek.alert.kind-shutdown')
    for (const t of ['Done today: Essay intro, Gym', 'Rust chapter 4', `Bed at ${bed}`]) if (!sd.includes(t)) throw new Error(`the shutdown has no "${t}"`)
    if (shots) await ip.waitForTimeout(700)
    if (shots) await ip.screenshot({ path: `${shots}/island-evening-shutdown.png`, clip: { x: 0, y: 0, width: 560, height: 400 } })
    await ip.click('.di-peek.alert.kind-shutdown [data-tap="peek:alert:🌙 Shut down"]')
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'benPush' && a.op === 'shutdown'), null, { timeout: 3000 })
    await ip.context().close()

    // The weekly card on the Coach page (from last night's push): a score, 3 wins, 1 thing to fix.
    await open('coach')
    await pg.waitForSelector('.cf-col .cf-row', { timeout: 15000 })
    await pg.waitForSelector('.bp-card[data-push="weekly"]', { timeout: 8000 })
    // The start screen sits over the chat until you ask for it.
    if (await pg.locator('button', { hasText: 'Show the chat' }).count()) await pg.locator('button', { hasText: 'Show the chat' }).first().click()
    const wk = await pg.textContent('.bp-card[data-push="weekly"]')
    for (const t of ['72', 'Training: 4 of 4', 'One thing to fix', 'Wake-ups: 3 of 7']) if (!wk.includes(t)) throw new Error(`the weekly card has no "${t}"`)
    if (shots) {
      await pg.locator('.bp-card[data-push="weekly"]').scrollIntoViewIfNeeded()
      await pg.waitForTimeout(600)
      await pg.locator('.bp-card[data-push="weekly"]').screenshot({ path: `${shots}/coach-weekly-card.png` })
    }
  })
  // Focus boost (DX4, DX7, DX9, DX10, DX12, DX19, LF14, LF20): the push ladder's 3 steps and the morning
  // countdown on the island; in the app the session goal, Dojo (Esc leaves), Done / Half / Not at the end,
  // "why I'm stalling", a launch kit, workout-only music and the victory card. BOOST_SHOTS=<dir> saves pictures.
  await step('Focus boost: ladder steps and the morning countdown on the island, goal, Dojo, verdict, stalling fixes, launch kits, win music', async () => {
    const shots = process.env.BOOST_SHOTS
    const { build } = await import('rolldown')
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { pathToFileURL } = await import('node:url')
    const dir = await mkdtemp(join(tmpdir(), 'boost-'))
    const entry = join(dir, 'entry.ts')
    await writeFile(entry, ['pushLadder', 'morningLaunch'].map((m) => `export * from ${JSON.stringify(join(repo, `src/core/${m}.ts`))}\n`).join(''))
    const out = await build({ input: entry, write: false, output: { format: 'esm' } })
    await writeFile(join(dir, 'boost.mjs'), out.output[0].code)
    const L = await import(pathToFileURL(join(dir, 'boost.mjs')).href)
    await rm(dir, { recursive: true, force: true })
    const now = fakeNow()
    // The ladder's steps as boost/boostFeed.ts makes them (made-up block "Lab 4").
    const trig = { key: 'demo1', title: 'Lab 4', why: 'late', since: now - 20 * 60_000 }
    const ladderAlert = (f) => ({
      id: `ladder:${f.key}:${f.step}`, kind: `push${f.step}`, title: `${f.head} · step ${f.step}`, text: f.text, face: f.face,
      actions: [
        { label: '▶ Start now', primary: true, action: { kind: 'boost', op: 'ladderStart', alertId: `ladder:${f.key}`, arg: f.title, minutes: 25 } },
        { label: '⏰ 10 min', action: { kind: 'boost', op: 'ladderSnooze', alertId: `ladder:${f.key}`, arg: f.key } },
        { label: 'Skip it', action: { kind: 'boost', op: 'ladderSkip', alertId: `ladder:${f.key}`, arg: f.key } }
      ]
    })
    let state = null
    const fires = []
    for (const m of [0, 8, 16]) {
      const r = L.ladderTick({ now: trig.since + m * 60_000, prefs: L.cleanLadder(null), level: 'normal', trigger: trig, started: false, quiet: false, meeting: false, state })
      state = r.state
      if (r.fire) fires.push(r.fire)
    }
    if (fires.map((f) => f.sound).join() !== 'push1,push2,push3') throw new Error(`ladder steps: ${fires.map((f) => f.sound).join()}`)
    if (!fires[2].telegram || !fires[2].voice) throw new Error('step 3 has no Telegram message or voice line')
    const day = new Date(now).toISOString().slice(0, 10)
    let run = L.morningBegin({ run: null, day, now, prefs: L.cleanMorning(null), wokeAt: now - 3 * 60_000, briefOpenedAt: null })
    const launchAlert = (c) => ({ id: c.id, kind: 'launch', title: c.title, text: c.text, face: c.face, actions: c.buttons.map((b) => ({ label: b.label, primary: !!b.primary, action: { kind: 'boost', op: `m:${b.op}`, alertId: c.id, arg: c.step } })) })

    const ip = await (await browser.newContext({ viewport: { width: 560, height: 720 } })).newPage()
    ip.on('pageerror', (e) => errors.push(`island boost: ${e.message}`))
    await ip.addInitScript(() => {
      const cbs = {}
      const on = (name) => (cb) => { cbs[name] = cb }
      const snap = { at: Date.now(), locked: false, ben: { face: '😎', mood: 'hyped', why: '', move: null, last: null, unread: 0, busy: false, steps: [] }, running: null, now: null, next: null, mustdos: [], water: { ml: 500, target: 2500 }, reps: [], alert: null }
      window.__island = { actions: [], send: (name, v) => cbs[name]?.(v), snap }
      window.desktop = new Proxy({
        islandHot: () => {}, islandTakeClicks: () => {}, islandAction: (a) => { window.__island.actions.push(a) },
        onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
        onIslandPrefs: (cb) => { cbs.prefs = cb; setTimeout(() => cb({ size: 'normal', mode: 'calm', calmRest: 'line', peekSec: 3, gapMin: 0 }), 60) },
        onIslandHover: on('hover'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle')
      }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
    })
    await ip.goto(`http://127.0.0.1:${port}/?island=1`)
    if (shots) await ip.addStyleTag({ content: 'body::before { content: ""; position: fixed; inset: 0; z-index: -1; background: linear-gradient(#2b2d33 0 34px, #f4f5f7 34px); }' })
    await ip.waitForSelector('.di.calm-hidden .di-nub-wrap', { timeout: 20000 })
    const show = async (alert, kind, i) => {
      await ip.waitForSelector('.di-peek', { state: 'detached', timeout: 8000 }).catch(() => {})
      await ip.evaluate(([a, k]) => window.__island.send('state', { ...window.__island.snap, at: Date.now() + k, alert: a }), [alert, i])
      await ip.waitForSelector(`.di-peek.kind-${kind}`, { timeout: 8000 })
      if (await ip.$(`.di-peek.calm-peek.kind-${kind}`)) await ip.click(`.di-peek.calm-peek.kind-${kind}`)
      await ip.waitForSelector(`.di-peek.alert.kind-${kind}`, { timeout: 8000 })
      if (shots) await ip.waitForTimeout(700)
    }
    for (const [n, f] of fires.entries()) {
      await show(ladderAlert(f), `push${f.step}`, n + 1)
      for (const l of ['▶ Start now', '⏰ 10 min', 'Skip it']) if (!(await ip.$(`.di-peek.alert.kind-push${f.step} [data-tap="peek:alert:${l}"]`))) throw new Error(`ladder step ${f.step} has no "${l}"`)
      if (shots) await ip.screenshot({ path: `${shots}/island-ladder-step${f.step}.png`, clip: { x: 0, y: 0, width: 560, height: 300 } })
    }
    await ip.click('.di-peek.alert.kind-push3 [data-tap="peek:alert:⏰ 10 min"]')
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'boost' && a.op === 'ladderSnooze' && a.arg === 'demo1'), null, { timeout: 4000 })
    // The morning countdown: water → push-ups → the first must-do in 2 minutes (with its kit).
    const prefs = L.cleanMorning(null)
    await show(launchAlert(L.launchCard({ run, now, prefs, mustdo: 'Essay intro', kit: 'Writing' })), 'launch', 10)
    if (!/Launch 1\/3 · Water/.test(await ip.textContent('.di-peek.alert.kind-launch'))) throw new Error('the countdown does not start with water')
    if (shots) await ip.screenshot({ path: `${shots}/island-morning-water.png`, clip: { x: 0, y: 0, width: 560, height: 300 } })
    await ip.click('.di-peek.alert.kind-launch [data-tap="peek:alert:💧 Drank it · 250 ml"]')
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'boost' && a.op === 'm:water'), null, { timeout: 4000 })
    run = L.markStep(L.markStep(run, 'water', 'done', now), 'pushups', 'done', now + 1000)
    await show(launchAlert(L.launchCard({ run, now: now + 31_000, prefs, mustdo: 'Essay intro', kit: 'Writing' })), 'launch', 11)
    const mt = await ip.textContent('.di-peek.alert.kind-launch')
    if (!/Launch 3\/3 · 1:30/.test(mt) || !/Writing kit/.test(mt)) throw new Error(`the must-do step reads "${mt}"`)
    if (shots) await ip.screenshot({ path: `${shots}/island-morning-countdown.png`, clip: { x: 0, y: 0, width: 560, height: 300 } })
    await ip.click('.di-peek.alert.kind-launch [data-tap="peek:alert:▶ Open it + kit"]')
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'boost' && a.op === 'm:open'), null, { timeout: 4000 })
    await ip.context().close()

    // The app: a station marked "workout only" (DX12), a launch kit, win music.
    await open('music')
    // The Music page keeps its last tab: wait for its tabs, not the player hero.
    await pg.waitForSelector('.mup .ptabs [data-tab="library"]', { timeout: 20000 })
    await pg.click('.mup .ptabs [data-tab="library"]')
    await pg.waitForSelector('.mu-add input', { timeout: 10000 })
    if (!(await pg.locator('.mup-manage li', { hasText: 'Smoke mix' }).count())) {
      await pg.fill('.mu-add input', 'https://soundcloud.com/example-artist/sets/smoke-mix')
      await pg.locator('.mu-add .mu-btn').click()
      await pg.waitForSelector('.mup-manage li', { timeout: 8000 })
    }
    const chip = pg.locator('.mup-manage li', { hasText: 'Smoke mix' }).locator('[data-only]')
    await chip.click()
    await pg.waitForFunction(() => document.querySelector('.mup-manage [data-only]')?.getAttribute('data-only') === 'workout', null, { timeout: 5000 })
    await chip.click()
    await chip.click()
    await pg.waitForFunction(() => document.querySelector('.mup-manage [data-only]')?.getAttribute('data-only') === 'any', null, { timeout: 5000 })

    await open('settings')
    await pg.waitForSelector('.st-item', { timeout: 10000 })
    await pg.locator('.st-item', { hasText: 'Ben' }).first().click()
    await pg.waitForSelector('.st-tabs .ptabs [data-tab="boost"]', { timeout: 8000 })
    await pg.click('.st-tabs .ptabs [data-tab="boost"]')
    await pg.waitForSelector('.fbs-panel[data-boost="settings"] .fbs-step', { timeout: 8000 })
    if ((await pg.locator('.fbs-step').count()) !== 3) throw new Error('the ladder should show 3 steps')
    await pg.locator('.fbs-panel[data-boost="kits"] button', { hasText: '+ Add a kit' }).click()
    await pg.waitForSelector('.fbs-kit', { timeout: 5000 })
    const kit = pg.locator('.fbs-kit').first()
    await kit.locator('input[aria-label="Kit name"]').fill('Coding')
    await kit.locator('textarea').nth(0).fill('VS Code\nObsidian')
    await kit.locator('textarea').nth(1).fill('C:\\Projects\\demo-app')
    await kit.locator('textarea').nth(2).fill('https://example.com/ctf-practice\nhttps://example.com/docs')
    await kit.locator('input[aria-label="Kit name"]').click()
    await pg.waitForFunction(() => /VS Code, Obsidian, 1 folder, 2 links/.test(document.querySelector('.fbs-kit')?.textContent ?? ''), null, { timeout: 5000 })
    if (shots) {
      await pg.waitForTimeout(400)
      await pg.locator('.fbs-panel[data-boost="kits"]').screenshot({ path: `${shots}/settings-launch-kit.png` })
    }
    await pg.click('.fbs-panel[data-boost="wins"] button[role="switch"][aria-label="Win music"]')
    await pg.click('.fbs-panel[data-boost="wins"] [aria-label="Victory track"]')
    await pg.waitForSelector('.ui-select-list [role=option]', { timeout: 3000 })
    await pg.locator('.ui-select-list [role=option]', { hasText: 'Smoke mix' }).first().click()
    await pg.waitForFunction(() => document.querySelector('.fbs-panel[data-boost="wins"] [aria-label="Victory track"]')?.textContent?.includes('Smoke mix'), null, { timeout: 5000 })

    // A focus timer starts → the one-line goal.
    await open('today')
    await pg.waitForSelector('.td2', { timeout: 15000 })
    await pg.click('.tb-log')
    await pg.fill('input[placeholder^="Type anything"]', 'focus 25 Essay intro')
    await pg.keyboard.press('Enter')
    await pg.waitForSelector('.fb-card[data-boost="goal"]', { timeout: 25000 })
    await pg.fill('#fb-goal', 'The intro paragraph, 150 words')
    if (shots) {
      await pg.waitForTimeout(600)
      await pg.locator('.fb-card[data-boost="goal"]').screenshot({ path: `${shots}/session-goal.png` })
    }
    await pg.keyboard.press('Enter')
    await pg.waitForSelector('.fb-card[data-boost="goal"]', { state: 'detached', timeout: 8000 })
    // Dojo: the scene, the ink ring and the goal; Esc leaves (the timer keeps running).
    await pg.evaluate(() => window.dispatchEvent(new CustomEvent('life-dojo')))
    await pg.waitForSelector('.dojo .dojo-clock', { timeout: 8000 })
    if (!/The intro paragraph/.test(await pg.textContent('.dojo-goal'))) throw new Error('Dojo does not show the goal')
    if (shots) {
      await pg.waitForTimeout(1200)
      await pg.screenshot({ path: `${shots}/dojo-scene.png` })
    }
    await pg.keyboard.press('Escape')
    await pg.waitForSelector('.dojo', { state: 'detached', timeout: 5000 })
    // The timer ends → Done / Half / Not.
    await pg.context().clock.fastForward(20 * 60_000)
    const stop = pg.getByRole('button', { name: /Stop & log/ }).first()
    await stop.waitFor({ timeout: 15000 })
    await stop.click()
    await pg.waitForSelector('.fb-card[data-boost="verdict"]', { timeout: 25000 })
    if (!/The intro paragraph/.test(await pg.textContent('.fb-card[data-boost="verdict"]'))) throw new Error('the verdict does not repeat the goal')
    if (shots) {
      await pg.waitForTimeout(600)
      await pg.locator('.fb-card[data-boost="verdict"]').screenshot({ path: `${shots}/session-verdict.png` })
    }
    await pg.locator('.fb-card[data-boost="verdict"] button', { hasText: 'Done' }).click()
    await pg.waitForSelector('.fb-card[data-boost="verdict"]', { state: 'detached', timeout: 8000 })
    // Why I'm stalling: five reasons, each with its fix.
    await pg.evaluate(() => window.dispatchEvent(new CustomEvent('life-stall', { detail: { subject: 'Lab 4' } })))
    await pg.waitForSelector('.fb-card[data-boost="stall"] .fb-reason', { timeout: 8000 })
    if ((await pg.locator('.fb-reason').count()) !== 5) throw new Error('want 5 reasons')
    if (shots) {
      await pg.waitForTimeout(500)
      await pg.locator('.fb-card[data-boost="stall"]').screenshot({ path: `${shots}/stalling-sheet.png` })
    }
    await pg.locator('.fb-reason', { hasText: 'Tired' }).click()
    await pg.waitForSelector('.fb-card[data-boost="fix"]', { timeout: 8000 })
    if (!/10 min, light/.test(await pg.textContent('.fb-card[data-boost="fix"]'))) throw new Error('the tired fix is not the light version')
    if (shots) await pg.locator('.fb-card[data-boost="fix"]').screenshot({ path: `${shots}/stalling-fix.png` })
    await pg.locator('.fb-card[data-boost="fix"] button', { hasText: 'Not now' }).click()
    // A big win: the victory card while the clip plays (a stand-in SoundCloud player here).
    await pg.route(/soundcloud\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title>' }))
    await pg.evaluate(() => {
      const fire = {}
      window.SC = { Widget: Object.assign(() => ({
        bind: (ev, fn) => { fire[ev] = fn; if (ev === 'ready') setTimeout(fn, 20) },
        play: () => setTimeout(() => fire.play?.(), 10), pause: () => fire.pause?.(), setVolume: () => {}, load: () => {}, seekTo: () => {},
        getCurrentSound: (cb) => cb({ title: 'Made-up victory theme', permalink_url: 'https://soundcloud.com/example-artist/victory', user: { username: 'Example' }, duration: 180000 }),
        getCurrentSoundIndex: (cb) => cb(0), getSounds: (cb) => cb([])
      }), { Events: { READY: 'ready', PLAY: 'play', PAUSE: 'pause', FINISH: 'finish', ERROR: 'error', PLAY_PROGRESS: 'progress', SEEK: 'seek' } }) }
      window.dispatchEvent(new CustomEvent('life-win', { detail: { kind: 'workout' } }))
    })
    await pg.waitForSelector('.fb-win', { timeout: 8000 })
    if (!/Workout done/.test(await pg.textContent('.fb-win'))) throw new Error('the victory card does not name the win')
    if (shots) {
      await pg.waitForTimeout(500)
      await pg.screenshot({ path: `${shots}/victory-moment.png`, clip: { x: 420, y: 40, width: 600, height: 160 } })
    }
    await pg.unroute(/soundcloud\.com/)
    // Win music off again, so later steps hear nothing new.
    await open('settings')
    await pg.waitForSelector('.st-item', { timeout: 10000 })
    await pg.locator('.st-item', { hasText: 'Ben' }).first().click()
    await pg.click('.st-tabs .ptabs [data-tab="boost"]')
    await pg.click('.fbs-panel[data-boost="wins"] button[role="switch"][aria-label="Win music"]')
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
    // IM2: a running timer fills the outline of the peek (the resting pill draws no lines).
    if (await ip.$('.di-border')) throw new Error('the resting pill draws the timer outline')
    await ip.evaluate(() => window.__island.send('hover', true))
    await ip.waitForSelector('.di-peek', { timeout: 4000 })
    await ip.waitForSelector('.di-border .di-border-fg', { timeout: 4000 })
    await ip.evaluate(() => window.__island.send('hover', false))
    await ip.waitForSelector('.di-peek', { state: 'detached', timeout: 4000 })
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
    // Times from the page's own (fixed) clock, never the real one.
    await ip.evaluate(() => { const t = Date.now(); window.__setSnap({ running: { subject: 'Essay', startedAt: t - 60_000, endsAt: t + 600_000 }, next: { title: 'Dentist', start: t + 5 * 60_000, end: t + 3600_000 }, ben: { ...window.__island.snap.ben, busy: false, unread: 1 } }) })
    // At rest the pill holds them (one main thing, one small extra); the stack fans out on hover.
    await ip.waitForSelector('.di-rest .rest-secondary', { timeout: 3000 })
    await ip.evaluate(() => window.__island.send('hover', true))
    await ip.waitForFunction(() => document.querySelectorAll('.di-stack-b[data-hot]').length === 2, null, { timeout: 3000 })
    await ip.evaluate(() => window.__island.send('hover', false))
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
      await ip.click('.di-shape', { position: { x: (await ip.locator('.di-shape').boundingBox()).width / 2, y: 14 } })
      await ip.waitForSelector('.di-panel', { timeout: 5000 })
    }
    await ip.context().close()
  })
  // HD: your healthy day on the island: the ring on the pill and the Day page, the reminder card with Done / Snooze,
  // wind-down mode (dimmed, the countdown, calm music) and Sunday's weekly card. Made-up data.
  await step('Desktop island healthy day: the ring, a reminder with Done, wind-down mode, the weekly card', async () => {
    const ip = await (await browser.newContext({ viewport: { width: 640, height: 900 } })).newPage()
    ip.on('pageerror', (e) => errors.push(`island: ${e.message}`))
    await ip.addInitScript(() => {
      const cbs = {}
      const on = (name) => (cb) => { cbs[name] = cb }
      const now = Date.now()
      const parts = (w, m, b, sl) => [
        { id: 'water', icon: '💧', label: 'Water', done: w >= 1, pct: Math.min(1, w), text: `${(2.5 * w).toFixed(1)} of 2.5 L` },
        { id: 'move', icon: '💪', label: 'Moves', done: m >= 3, pct: Math.min(1, m / 3), text: `${m} of 3 move breaks` },
        { id: 'breaks', icon: '👁️', label: 'Breaks', done: b >= 3, pct: Math.min(1, b / 3), text: `${b} of 3 screen breaks` },
        { id: 'sleep', icon: '🌙', label: 'Sleep', done: sl, pct: sl ? 1 : 0, text: sl ? 'In bed on time last night' : 'Late to bed last night' }
      ]
      const health = { score: 79, met: 2, parts: parts(0.64, 3, 2, true), streak: 4, bonus: false, line: 'Body today: 1.6 of 2.5 L water, 3 of 3 move breaks, 2 of 3 screen breaks, bed on time last night. 2 of 4 healthy.' }
      const snap = {
        at: now, locked: false,
        ben: { face: '🙂', mood: 'chill', why: '', move: null, last: null, unread: 0, busy: false, steps: [] },
        running: null, now: null, next: null, mustdos: [{ i: 0, text: 'Algebra problem set', done: true }], water: { ml: 1600, target: 2500 }, reps: [],
        alert: { id: 'remind:r1', kind: 'remind', title: 'call mom', text: 'Your reminder for 18:00.', face: '⏰', actions: [{ label: '✓ Done', action: { kind: 'remind', op: 'done', id: 'r1' }, primary: true }, { label: '10 min', action: { kind: 'remind', op: 'snooze', id: 'r1', minutes: 10 } }, { label: '1 hour', action: { kind: 'remind', op: 'snooze', id: 'r1', minutes: 60 } }] },
        today: { focusMin: 50, focusGoal: 100 },
        health: { today: health, week: null }
      }
      window.__island = { actions: [], snap, parts, send: (name, v) => cbs[name]?.(v) }
      window.__setSnap = (patch) => { window.__island.snap = { ...window.__island.snap, at: Date.now(), ...patch }; cbs.state?.(window.__island.snap) }
      window.desktop = new Proxy({
        islandAction: (a) => { window.__island.actions.push(a); if (a.id) setTimeout(() => cbs.ack?.({ id: a.id, ok: true, tookMs: 5 }), 100) },
        islandHot: () => {}, islandTakeClicks: () => {},
        onIslandAck: on('ack'),
        onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
        onIslandHover: on('hover'), onIslandPrefs: on('prefs'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle')
      }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
    })
    await ip.goto(`http://127.0.0.1:${port}/?island=1`)
    await ip.waitForSelector('.di-pill.di-rest:not(.kind-locked)', { timeout: 15000 })
    // "When nothing is happening, show: Healthy day": the ring alone on the resting pill.
    const alert0 = await ip.evaluate(() => window.__island.snap.alert)
    await ip.evaluate(() => window.__setSnap({ alert: null, widgets: { installed: [], look: { rest: 'health' } } }))
    await ip.waitForSelector('.di-pill .hd-badge', { timeout: 5000 })
    await ip.evaluate((a) => window.__setSnap({ alert: a }), alert0)
    await ip.click('.di-pill')
    await ip.waitForSelector('.di-panel .hd-card', { timeout: 5000 })
    if (!/Healthy day/.test(await ip.locator('.hd-card').innerText())) throw new Error('no Healthy day card on the Day page')
    // The reminder you set: Done sends the answer.
    await ip.waitForSelector('.di-panel .di-alert.kind-remind', { timeout: 5000 })
    const shots = process.env.HEALTH_SHOTS
    if (shots) {
      await ip.locator('.hd-card').scrollIntoViewIfNeeded()
      await ip.waitForTimeout(700)
      await ip.locator('.di-panel').screenshot({ path: `${shots}/healthy-day-ring.png` })
    }
    await ip.click('.di-panel .di-alert.kind-remind button.primary')
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'remind' && a.op === 'done' && a.id === 'r1'), null, { timeout: 3000 })
    // All four done: the ring is full and says so.
    await ip.evaluate(() => window.__setSnap({ alert: null, water: { ml: 2500, target: 2500 }, health: { today: { score: 100, met: 4, parts: window.__island.parts(1, 4, 3, true), streak: 5, bonus: true, line: 'Body today: 2.5 of 2.5 L water, 4 of 3 move breaks, 3 of 3 screen breaks, bed on time last night. All four: a healthy day. 💚' }, week: null } }))
    await ip.waitForSelector('.hd-card.hd-all', { timeout: 3000 })
    // Wind-down mode: dimmed, the countdown, calm music and Going to bed.
    await ip.evaluate(() => window.__setSnap({ windDown: { bedAt: '23:00', minutesLeft: 42 }, windMode: { phase: 'wind', minutes: 42, bedAt: '23:00', title: 'Wind down · bed at 23:00', line: 'Finish what you are on, then close the laptop.', music: true }, sleep: { bed: true, wake: false, target: '23:00' } }))
    await ip.waitForSelector('.di.windmode .hd-wind', { timeout: 3000 })
    if (!/Bed in 0:42/.test(await ip.locator('.hd-wind').innerText())) throw new Error('no wind-down countdown')
    if (shots) {
      await ip.locator('.hd-wind').scrollIntoViewIfNeeded()
      await ip.waitForTimeout(700)
      await ip.locator('.di-panel').screenshot({ path: `${shots}/wind-down-mode.png` })
    }
    await ip.click('[data-tap="wind:music"]')
    // Sunday: the weekly card.
    await ip.evaluate(() => window.__setSnap({ windDown: null, windMode: null, sleep: null, health: { ...window.__island.snap.health, week: { days: 7, waterAvgMl: 2240, waterDaysMet: 4, moves: 23, breaks: 17, bedOnTime: 5, bedNights: 7, bedSpreadMin: 50, healthyDays: 3, lines: ['💧 Water: 2.2 L a day on average, goal reached 4 of 7 days', '💪 Moves: 23 move breaks · 👁️ 17 screen breaks', '🌙 Bedtime: on time 5 of 7 nights · a bit all over (0h50 between earliest and latest)', '💚 Healthy days: 3 of 7'] } } }))
    await ip.waitForSelector('.hd-week', { timeout: 3000 })
    if (shots) {
      await ip.locator('.hd-week').scrollIntoViewIfNeeded()
      await ip.waitForTimeout(700)
      await ip.locator('.di-panel').screenshot({ path: `${shots}/weekly-health-card.png` })
    }
    // Life fit: the week's top 3 (the rest parked) and tonight's shift on the Day page.
    await ip.evaluate(() => window.__setSnap({ health: null, week: { top: [{ i: 0, text: 'Finish the essay', done: true }, { i: 1, text: 'Side project: login page', done: false }, { i: 2, text: 'Run 3 times', done: false }], parked: ['Read 4 books', 'Learn Spanish'] }, work: { from: '17:00', to: '22:00', mode: 'normal' } }))
    await ip.waitForSelector('.di-week-chip', { timeout: 3000 })
    if (!/1\/3/.test(await ip.locator('.di-week-chip').innerText())) throw new Error('the week top 3 should be a small 1/3 chip')
    const lists = await ip.evaluate(() => ({ today: document.querySelectorAll('.di-today').length, old: document.querySelectorAll('.di-tasks, .di-plan, .di-week3').length }))
    if (lists.today !== 1 || lists.old) throw new Error(`the Day page should show one to-do list: ${JSON.stringify(lists)}`)
    await ip.click('[data-tap="shift:short"]')
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'shift' && a.mode === 'short'), null, { timeout: 3000 })
    if (process.env.LIFEFIT_SHOTS) {
      await ip.locator('.di-today').scrollIntoViewIfNeeded()
      await ip.waitForTimeout(500)
      await ip.locator('.di-panel').screenshot({ path: `${process.env.LIFEFIT_SHOTS}/island-day-top3.png` })
    }
    await ip.context().close()
  })
  // World clock: two zones in the island look; a tap on the clock shows the next one (no panel), with a
  // label and a day marker; T on the pill does the same; it goes back to your time after 30 s; the panel
  // lists them all. The page is in Tokyo at 08:30, so New York and London are still on yesterday.
  await step('Desktop island world clock: tap the clock for the next time zone, no panel, back to your time', async () => {
    const shots = process.env.WORLDCLOCK_SHOTS
    const ctx = await browser.newContext({ viewport: { width: 640, height: 900 }, timezoneId: 'Asia/Tokyo' })
    const day = new Date(fakeNow())
    await ctx.clock.setSystemTime(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 30))
    const ip = await ctx.newPage()
    ip.on('pageerror', (e) => errors.push(`island: ${e.message}`))
    await ip.addInitScript(() => {
      const cbs = {}
      const on = (name) => (cb) => { cbs[name] = cb }
      const snap = {
        at: Date.now(), locked: false,
        ben: { face: '🙂', mood: 'chill', why: '', move: null, last: null, unread: 0, busy: false, steps: [] },
        running: null, now: null, next: null, mustdos: [], water: { ml: 1200, target: 2500 }, reps: [], alert: null,
        widgets: { installed: [], look: { rest: 'time', clock: 'simple', zones: [{ tz: 'America/New_York', label: 'NYC' }, { tz: 'Europe/London', label: '' }, { tz: 'Not/AZone', label: 'x' }] } }
      }
      window.__island = { actions: [], snap, send: (name, v) => cbs[name]?.(v) }
      window.desktop = new Proxy({
        islandAction: (a) => { window.__island.actions.push(a); if (a.id) setTimeout(() => cbs.ack?.({ id: a.id, ok: true, tookMs: 5 }), 50) },
        islandHot: () => {}, islandTakeClicks: () => {},
        onIslandAck: on('ack'),
        onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
        onIslandHover: on('hover'), onIslandPrefs: on('prefs'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle')
      }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
    })
    await ip.goto(`http://127.0.0.1:${port}/?island=1`)
    await ip.waitForSelector('.di-pill.di-rest .di-wclock', { timeout: 15000 })
    // Opens on a click only (the mouse resting on it doesn't grow it into the peek between taps).
    await ip.evaluate(() => window.__island.send('prefs', { size: 'normal', opacity: 1, look: 'black', mode: 'balanced', openOn: 'click' }))
    const tag = () => ip.evaluate(() => document.querySelector('.di-pill .di-wclock-tag')?.textContent ?? '')
    const noPanel = async (when) => {
      await ip.waitForTimeout(350)
      if (await ip.$('.di-panel')) throw new Error(`the panel opened ${when}`)
    }
    if (await tag()) throw new Error('a zone label before any tap')
    if (shots) {
      await ip.mouse.move(600, 880)
      await ip.waitForTimeout(500)
      await ip.locator('.di-shape').screenshot({ path: `${shots}/pill-local.png` })
    }
    // Tap: New York, a day behind; the panel stays shut.
    await ip.click('.di-wclock')
    await ip.waitForFunction(() => /NYC/.test(document.querySelector('.di-pill .di-wclock-tag')?.textContent ?? ''), null, { timeout: 3000 })
    if (!(await tag()).includes('−1')) throw new Error(`no day marker for New York: "${await tag()}"`)
    await noPanel('on the first tap')
    if (shots) {
      await ip.mouse.move(600, 880)
      await ip.waitForTimeout(500)
      await ip.locator('.di-shape').screenshot({ path: `${shots}/pill-nyc-minus-day.png` })
    }
    // Tap again: London (no label set: the city's name); the made-up zone was dropped. Then your time.
    await ip.click('.di-wclock')
    await ip.waitForFunction(() => /London/.test(document.querySelector('.di-pill .di-wclock-tag')?.textContent ?? ''), null, { timeout: 3000 })
    await noPanel('on the second tap')
    await ip.click('.di-wclock')
    await ip.waitForFunction(() => !document.querySelector('.di-pill .di-wclock-tag'), null, { timeout: 3000 })
    await noPanel('on the third tap')
    // Resting the mouse on it lists every zone.
    // (the pill can shift a little as the mouse comes onto it, so it goes to the clock twice)
    await ip.mouse.move(600, 880)
    await ip.hover('.di-wclock')
    await ip.waitForTimeout(300)
    await ip.hover('.di-wclock')
    await ip.waitForSelector('.di-wclock-all', { timeout: 3000 })
    const all = await ip.locator('.di-wclock-all').innerText()
    if (!/^Local \d\d:\d\d · NYC \d\d:\d\d −1 · London \d\d:\d\d −1$/.test(all)) throw new Error(`the list of zones says "${all}"`)
    if (shots) await ip.locator('.di-shape').screenshot({ path: `${shots}/pill-tooltip.png` })
    await ip.mouse.move(600, 880)
    // The panel: one time per zone, yours first.
    await ip.focus('.di-pill')
    await ip.keyboard.press('Enter')
    await ip.waitForSelector('.di-panel .di-world', { timeout: 5000 })
    const row = await ip.$$eval('.di-world-z small', (e) => e.map((x) => x.textContent))
    if (row.join(',') !== 'Local,NYC,London') throw new Error(`the world clock row has ${row.join(', ')}`)
    if (shots) {
      await ip.waitForTimeout(900)
      await ip.locator('.di-world').screenshot({ path: `${shots}/panel-world-row.png` })
    }
    await ip.keyboard.press('Escape')
    await ip.waitForSelector('.di-panel', { state: 'detached', timeout: 5000 })
    // T on the pill: the next zone too; after 30 s it goes back to your time.
    await ip.focus('.di-pill')
    await ip.keyboard.press('t')
    await ip.waitForFunction(() => /NYC/.test(document.querySelector('.di-pill .di-wclock-tag')?.textContent ?? ''), null, { timeout: 3000 })
    await ctx.clock.fastForward(31_000)
    await ip.waitForFunction(() => !document.querySelector('.di-pill .di-wclock-tag'), null, { timeout: 3000 })
    await ctx.close()
    // Settings → Widgets → Island look: find a zone, add it, then take it out again.
    await open('settings')
    await pg.waitForSelector('.st-item', { timeout: 10000 })
    await pg.locator('.st-item', { hasText: 'Widgets' }).first().click()
    await pg.waitForSelector('.st-tabs .ptabs [data-tab="look"]', { timeout: 8000 })
    await pg.click('.st-tabs .ptabs [data-tab="look"]')
    await pg.waitForSelector('.wg-zone-search', { timeout: 5000 })
    await pg.fill('.wg-zone-search', 'tokyo')
    await pg.click('.wg-zone-hits button:has-text("Tokyo")')
    await pg.waitForSelector('.wg-zone:not(.here) >> text=Tokyo', { timeout: 3000 })
    await pg.fill('.wg-zone-label', 'Office')
    await pg.keyboard.press('Enter')
    await pg.fill('.wg-zone-search', 'new y')
    await pg.waitForSelector('.wg-zone-hits button:has-text("New York")', { timeout: 3000 })
    if (shots) await pg.locator('.wg-zones-row').screenshot({ path: `${shots}/settings-zone-picker.png` })
    await pg.fill('.wg-zone-search', '')
    await pg.click('.wg-zone button[aria-label="Remove Tokyo"]')
    await pg.waitForSelector('.wg-zone:not(.here)', { state: 'detached', timeout: 3000 })
    // Leave Widgets on its first tab (the page remembers the last one).
    await pg.click('.st-tabs .ptabs [data-tab="gallery"]')
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
    // The first picture has arrived (not the locked pill).
    await ip.waitForSelector('.di-pill.di-rest:not(.kind-locked)', { timeout: 15000 })
    if (await ip.$('.di-pill .nd-badge')) throw new Error('the resting pill still shows the movement ring')
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
  // The resting island: one main thing and at most one small extra, nothing empty
  // (no 0% ring, no empty circle, no grey dash), and no stray lines under the notch.
  await step('Resting island: at most 2 items, no empty placeholders, no stray lines (notch and capsule, dark and light)', async () => {
    for (const style of ['notch', 'capsule']) for (const theme of ['dark', 'light']) {
      const ctx = await browser.newContext({ viewport: { width: 640, height: 220 }, colorScheme: theme })
      // The made-up class starts later today, so this needs an afternoon (not the last minutes before midnight).
      await ctx.clock.setSystemTime(todayAt('15:00'))
      const ip = await ctx.newPage()
      ip.on('pageerror', (e) => errors.push(`island: ${e.message}`))
      await ip.addInitScript(([style, theme]) => {
        const cbs = {}
        const on = (name) => (cb) => { cbs[name] = cb }
        const now = Date.now()
        const d = new Date(now)
        const later = Math.min(now + 78 * 60_000, new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 50).getTime())
        const parts = [{ id: 'water', icon: '💧', label: 'Water', done: false, pct: 0.48, text: '' }, { id: 'move', icon: '💪', label: 'Moves', done: false, pct: 0, text: '' }]
        // Made-up: the busy day that used to cram the pill (water, an empty movement ring, a 20% ring, a dot).
        const snap = {
          at: now, locked: false,
          ben: { face: '🙂', mood: 'chill', why: '', move: null, last: null, unread: 0, busy: false, steps: [] },
          running: null, now: null, next: { title: 'Made-up class', start: later, end: later + 3600_000, kind: 'event' }, mustdos: [], water: { ml: 1300, target: 2700 }, reps: [], alert: null,
          health: { today: { score: 20, met: 0, parts, streak: 0, bonus: false, line: '' }, week: null },
          move: { done: 0, goal: 100, unit: 'reps', breaks: 0, streak: 1, best: 3, challenge: { name: 'Push-ups', done: 0, target: 100 }, plus: null },
          widgets: { installed: [], look: { style, theme } }
        }
        window.__island = { send: (name, v) => cbs[name]?.(v), snap }
        window.__setSnap = (patch) => { window.__island.snap = { ...window.__island.snap, at: Date.now(), ...patch }; cbs.state?.(window.__island.snap) }
        window.desktop = new Proxy({
          islandHot: () => {}, islandTakeClicks: () => {}, islandAction: () => {}, setIslandPrefs: async () => null,
          onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
          onIslandHover: on('hover'), onIslandPrefs: on('prefs'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle')
        }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
      }, [style, theme])
      await ip.goto(`http://127.0.0.1:${port}/?island=1`)
      await ip.waitForSelector('.di-pill.di-rest', { timeout: 15000 })
      await ip.mouse.move(600, 210)
      const check = async (what, kind) => {
        await ip.waitForSelector(`.di-pill.di-rest.kind-${kind}`, { timeout: 4000 })
        await ip.waitForTimeout(700)
        const r = await ip.evaluate(() => {
          const shown = (e) => {
            const b = e.getBoundingClientRect()
            const cs = getComputedStyle(e)
            return b.width > 0.5 && b.height > 0.5 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05
          }
          const pill = document.querySelector('.di-pill.di-rest')
          // The alive layer (Ben's face, liquid timer, top-3 dots) is decoration on the pill, not a thing to read.
          const items = [...pill.children].filter((e) => !/\balive-(ben|liquid|orbit)\b/.test(e.className.baseVal ?? e.className)).filter(shown).map((e) => e.className.baseVal ?? e.className)
          // A ring with nothing in it: a progress circle drawn at 0%.
          const zero = [...pill.querySelectorAll('circle[stroke-dasharray]')].filter((c) => shown(c) && Math.abs(parseFloat(c.getAttribute('stroke-dasharray')) - parseFloat(c.getAttribute('stroke-dashoffset') ?? '0')) < 0.01).length
          const placeholders = [...pill.querySelectorAll('.nd-badge, .nd-chbar, .di-today, .di-cap, .di-dot, .di-dots, .sm-pill-cpu')].filter(shown).map((e) => e.className.baseVal ?? e.className)
          // Lines: anything thin and wide under or around the shape (a progress line, dots, an outline fill).
          const lines = [...document.querySelectorAll('.di *')].filter((e) => {
            if (!shown(e) || e.closest('.di-pill') || e.closest('.di-ears')) return false
            const b = e.getBoundingClientRect()
            return b.height <= 3 && b.width >= 12
          }).map((e) => e.className.baseVal ?? e.className)
          const extra = [...document.querySelectorAll('.di-sweep, .di-border, .di-beside > *')].filter(shown).length
          const sh = document.querySelector('.di-shape').getBoundingClientRect()
          return { items, zero, placeholders, lines, extra, top: sh.top, h: sh.height, ears: !!document.querySelector('.di-ears') }
        })
        const where = `${style}, ${theme}, ${what}`
        if (r.items.length > 2) throw new Error(`${where}: the resting pill shows ${r.items.length} things: ${r.items.join(', ')}`)
        if (r.zero) throw new Error(`${where}: an empty (0%) ring on the resting pill`)
        if (r.placeholders.length) throw new Error(`${where}: placeholders on the resting pill: ${r.placeholders.join(', ')}`)
        if (r.lines.length || r.extra) throw new Error(`${where}: stray lines around the island: ${r.lines.join(', ')} (${r.extra} beside)`)
        if (style === 'notch' && (r.top !== 0 || r.h < 26 || r.h > 34 || !r.ears)) throw new Error(`${where}: the notch is not flush with the top edge (${r.top}, ${r.h}px, shoulders ${r.ears})`)
      }
      await check('a calm day', 'next')
      await ip.evaluate(() => window.__setSnap({ ben: { ...window.__island.snap.ben, unread: 1 } }))
      await check('a new message', 'alert')
      if ((await ip.getAttribute('.di-rest .rest-primary', 'class')).includes('alert') && !/new message/.test(await ip.getAttribute('.di-pill.di-rest', 'title'))) throw new Error('the message dot says nothing')
      await ip.evaluate(() => { const t = Date.now(); window.__setSnap({ running: { subject: 'Made-up focus', startedAt: t - 60_000, endsAt: t + 600_000 }, next: { title: 'Made-up class', start: t + 8 * 60_000, end: t + 3600_000 } }) })
      await check('a timer, an event soon and a message', 'timer')
      await ip.evaluate(() => window.__setSnap({ running: null, ben: { ...window.__island.snap.ben, unread: 0 }, next: null }))
      await check('nothing left today', 'time')
      await ctx.close()
    }
  })
  // The thin Indicator (a window is maximized): ONE small capsule on the top edge. The timer fills it,
  // music adds an equalizer, nothing else is drawn as a second line; hover grows it into the pill.
  await step('Island Indicator: one bar while a window is maximized, the timer fills it, music shows, hover opens the pill', async () => {
    const shots = process.env.INDICATOR_SHOTS
    for (const theme of ['dark', 'light']) {
      const ctx = await browser.newContext({ viewport: { width: 640, height: 220 }, deviceScaleFactor: 2, colorScheme: theme })
      const ip = await ctx.newPage()
      ip.on('pageerror', (e) => errors.push(`island: ${e.message}`))
      // The SoundCloud player frame never loads here; a stand-in widget says "playing".
      await ip.route(/soundcloud\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title>' }))
      await ip.addInitScript((theme) => {
        const cbs = {}
        const on = (name) => (cb) => { cbs[name] = cb }
        const now = Date.now()
        const snap = {
          at: now, locked: false,
          ben: { face: '🙂', mood: 'chill', why: '', move: null, last: null, unread: 0, busy: false, steps: [] },
          running: null, now: { title: 'Read chapter 3', start: now - 20 * 60_000, end: now + 40 * 60_000, kind: 'focus' }, next: null, mustdos: [], water: { ml: 750, target: 2000 }, reps: [], alert: null,
          widgets: { installed: [], look: { style: 'notch', theme } }
        }
        let fire = {}
        window.SC = { Widget: Object.assign(() => ({
          bind: (ev, fn) => { fire[ev] = fn; if (ev === 'ready') setTimeout(fn, 20) },
          play: () => setTimeout(() => fire.play?.(), 10), pause: () => fire.pause?.(), setVolume: () => {}, load: () => {},
          getCurrentSound: (cb) => cb({ title: 'Made-up track', permalink_url: 'https://soundcloud.com/someone/a-track', user: { username: 'Someone' }, duration: 180000 }),
          getCurrentSoundIndex: (cb) => cb(0), getSounds: (cb) => cb([])
        }), { Events: { READY: 'ready', PLAY: 'play', PAUSE: 'pause', FINISH: 'finish', ERROR: 'error', PLAY_PROGRESS: 'progress', SEEK: 'seek' } }) }
        window.__island = { send: (name, v) => cbs[name]?.(v), snap, bar: [] }
        window.desktop = new Proxy({
          islandHot: () => {}, islandTakeClicks: () => {}, islandAction: () => {},
          islandBar: (on) => window.__island.bar.push(on),
          onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) },
          onIslandHover: on('hover'), onIslandPrefs: on('prefs'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle')
        }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
      }, theme)
      await ip.goto(`http://127.0.0.1:${port}/?island=1`)
      await ip.waitForSelector('.di .di-pill', { timeout: 15000 })
      // Every visible thing that could read as a bar or a line on the top edge.
      const bars = () => ip.$$eval('.di-ind, .di-bar, .di-sweep, .di-border, .di-dots, .di-pill, .di-beside > *', (els) => els.filter((e) => {
        const r = e.getBoundingClientRect()
        const cs = getComputedStyle(e)
        return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05
      }).map((e) => e.className.baseVal ?? e.className))
      const one = async (what) => {
        await ip.mouse.move(600, 200)
        await ip.waitForSelector('.di.is-bar:not(.moving) .di-ind', { timeout: 6000 })
        await ip.waitForTimeout(300)
        const list = await bars()
        if (list.length !== 1 || !/di-ind/.test(list[0])) throw new Error(`${theme}, ${what}: the Indicator should be one bar, saw ${JSON.stringify(list)}`)
        const box = await ip.evaluate(() => {
          const r = document.querySelector('.di-ind').getBoundingClientRect()
          return { top: Math.min(r.top, document.querySelector('.di-shape').getBoundingClientRect().top), h: r.height, w: r.width, mid: r.left + r.width / 2 }
        })
        if (box.top !== 0) throw new Error(`${theme}, ${what}: the Indicator is ${box.top}px below the top edge`)
        if (box.h < 6 || box.h > 8 || box.w < 120 || box.w > 160) throw new Error(`${theme}, ${what}: the Indicator is ${box.w}×${box.h}`)
        if (Math.abs(box.mid - 320) > 1) throw new Error(`${theme}, ${what}: the Indicator is not centred (${box.mid})`)
      }
      // Screenshots: a desktop-like backdrop behind the see-through window (only when asked for).
      if (shots) await ip.addStyleTag({ content: `body::before { content: ''; position: fixed; inset: 0; z-index: -1; background: ${theme === 'dark' ? 'linear-gradient(#20242e, #11131a)' : 'linear-gradient(#f3f5f9, #dde2ea)'}; }` })
      const shot = (name) => shots ? ip.screenshot({ path: `${shots}/${name}-${theme}.png`, clip: name.endsWith('hover') ? { x: 20, y: 0, width: 600, height: 90 } : { x: 170, y: 0, width: 300, height: 48 } }) : null
      // A window is maximized: the island turns into the Indicator and tells the desktop (top centre).
      await ip.evaluate(() => window.__island.send('quiet', { until: 0, call: false, fullscreen: false, maximized: true }))
      await one('idle')
      if (!(await ip.evaluate(() => window.__island.bar.at(-1) === true))) throw new Error('the desktop was not told the bar is on')
      await shot('indicator-idle')
      // A timer: the capsule itself fills (one fill, no outline, no bottom line).
      await ip.evaluate(() => { const n = Date.now(); window.__island.snap = { ...window.__island.snap, at: n, running: { subject: 'Deep work', startedAt: n - 15 * 60_000, endsAt: n + 10 * 60_000, pausedAt: null } }; window.__island.send('state', window.__island.snap) })
      await one('timer')
      const fill = await ip.$eval('.di-ind-fill', (e) => e.style.transform)
      if (!/scaleX\(0\.[56]/.test(fill)) throw new Error(`${theme}: the timer fill is ${fill}`)
      await shot('indicator-timer')
      // Music: a tiny equalizer inside the same capsule.
      await ip.evaluate(() => new BroadcastChannel('life-music').postMessage({ t: 'cmd', c: { op: 'play', station: { id: 'x', name: 'Lofi', url: 'https://soundcloud.com/someone/sets/lofi' } } }))
      await ip.waitForSelector('.di-ind .di-ind-eq', { timeout: 5000 })
      await one('music')
      await shot('indicator-music')
      // Hover: it grows into the pill (flush with the top), and goes back when the mouse leaves.
      await ip.mouse.move(320, 3)
      await ip.waitForSelector('.di.in-bar:not(.is-bar) .di-pill', { timeout: 4000 })
      await ip.waitForTimeout(700)
      const pill = await ip.$eval('.di-shape', (e) => e.getBoundingClientRect().top)
      if (pill !== 0) throw new Error(`${theme}: the opened pill is ${pill}px below the top edge`)
      await shot('indicator-hover')
      await one('after hover')
      // The window is no longer maximized: back to the normal island; the desktop is told.
      await ip.evaluate(() => window.__island.send('quiet', { until: 0, call: false, fullscreen: false, maximized: false }))
      await ip.waitForSelector('.di:not(.in-bar) .di-pill', { timeout: 4000 })
      if (!(await ip.evaluate(() => window.__island.bar.at(-1) === false))) throw new Error('the desktop was not told the bar is off')
      await ctx.close()
    }
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
  // Today → Now, the simple version: one slim top line (its ⋯ has Plan, Shut down and Life mode),
  // the Top 3 (the must-dos), Other tasks, and the habits as one list (or a grid).
  await step('Today Now: slim top line, Top 3, other tasks, habit tracker (tick, auto, skip, add, grid)', async () => {
    await pg.setViewportSize({ width: 1280, height: 720 })
    await open('today')
    await pg.click('.td2 .ptabs [data-tab="now"]')
    await pg.waitForSelector('.hb .hb-row', { timeout: 15000 })
    const now = pg.locator('[data-tabpanel="now"]')
    // Decluttered: no score/focus/must-dos tiles, no separate NEXT strip, Life mode only in the ⋯ menu.
    await pg.waitForSelector('[data-tabpanel="now"] .thb.slim', { timeout: 10000 })
    if (await now.locator('.thb-nums, .nub, .lm-open').count()) throw new Error('the old tiles, NEXT strip or Life mode strip are still on Now')
    if (await now.locator('.hb-group, .hb-tile').count()) throw new Error('the habits are still in Morning/Day/Evening boxes')
    await pg.click('[data-tabpanel="now"] .thb-more')
    for (const b of ['Plan my day', 'Shut down my day', 'Life mode']) if (!(await pg.locator('.thb-menu button', { hasText: b }).count())) throw new Error(`no "${b}" in the ⋯ menu`)
    await pg.locator('.thb-menu button', { hasText: 'Life mode' }).click()
    await pg.waitForSelector('[data-tabpanel="now"] .lm-card', { timeout: 3000 })
    await pg.locator('[data-tabpanel="now"] .lm-card button', { hasText: 'Cancel' }).click()
    await pg.waitForFunction(() => !document.querySelector('[data-tabpanel="now"] .lm-card'), null, { timeout: 3000 })

    const row = (name) => pg.locator('.hb-row', { hasText: name }).first()
    const cls = async (name) => (await row(name).getAttribute('class')) ?? ''
    const count = async () => {
      const m = /(\d+) of (\d+)/.exec(await pg.locator('.hb-head h2').innerText())
      if (!m) throw new Error('no "N of M" in the habits header')
      return [Number(m[1]), Number(m[2])]
    }
    for (const n of ['Morning oath', 'Workout', 'Grooming', 'Log spending']) if (!(await row(n).count())) throw new Error(`no ${n} row`)
    if ((await row('Grooming').locator('.hb-dots .dot').count()) !== 7) throw new Error('a habit row does not show the last 7 days')
    // An auto habit: the tap opens the spending line and the row stays open (no points for a tap).
    if (!/\bauto\b/.test(await cls('Log spending'))) throw new Error('Log spending is not marked auto')
    // (The Money step may have logged spending already: then it ticked by itself, from Finance.)
    if (!/s-done/.test(await cls('Log spending'))) {
      await row('Log spending').locator('.hb-hit').click()
      await pg.waitForSelector('.spend-line input', { timeout: 3000 })
      await pg.locator('.spend-line input').press('Escape')
      if (/s-done/.test(await cls('Log spending'))) throw new Error('a tap ticked an auto habit')
    }
    // A habit with steps (Grooming): a tap opens its checklist; done and paid once every step is ticked; opening it again pays nothing.
    const [d0, t0] = await count()
    await row('Grooming').locator('.hb-hit').click()
    await pg.waitForSelector('.gr .gr-step', { timeout: 10000 })
    for (let k = 0; k < 12; k++) {
      const open = pg.locator('.gr-step[aria-checked="false"]').filter({ hasNotText: 'if sunny' })
      if (!(await open.count())) break
      const before = await open.count()
      await open.first().click()
      await pg.waitForFunction((b) => [...document.querySelectorAll('.gr-step[aria-checked="false"]')].filter((x) => !x.textContent.includes('if sunny')).length < b, before, { timeout: 8000 })
    }
    await pg.waitForFunction(() => /All done today/.test(document.querySelector('.gr-sum')?.textContent ?? ''), null, { timeout: 8000 })
    await pg.keyboard.press('Escape')
    await pg.waitForSelector('.gr', { state: 'detached', timeout: 5000 })
    const rowHas = (name, re) => pg.waitForFunction(([n, r]) => new RegExp(r).test([...document.querySelectorAll('.hb-row')].find((t) => t.textContent.includes(n))?.[r === 's-done' ? 'className' : 'textContent'] ?? ''), [name, re], { timeout: 8000 })
    await rowHas('Grooming', 's-done').catch(() => {
      throw new Error('Skincare did not tick')
    })
    await rowHas('Grooming', '\\+\\d+ paid').catch(() => {
      throw new Error('Skincare does not say what it paid')
    })
    const [d1, t1] = await count()
    if (d1 !== d0 + 1 || t1 !== t0) throw new Error(`count went ${d0}/${t0} → ${d1}/${t1}`)
    // Compare the points number itself once it stopped counting up (not the whole top bar: its "+N Skincare
    // routine" pop stays 2.6 s, so comparing the bar raced with the pop's timer).
    const coins = () => pg.evaluate(() => document.querySelector('.topbar .tb-coins')?.textContent?.trim() ?? '')
    const settled = async () => {
      let v = await coins()
      for (let k = 0; k < 20; k++) {
        await pg.waitForTimeout(400)
        const b = await coins()
        if (b === v) return v
        v = b
      }
      return v
    }
    await pg.waitForTimeout(800)
    const bal = await settled()
    if (!/\d/.test(bal)) throw new Error(`no balance in the top bar (${bal})`)
    await row('Grooming').locator('.hb-hit').click({ force: true })
    await pg.waitForSelector('.gr .gr-step', { timeout: 10000 })
    await pg.keyboard.press('Escape')
    await pg.waitForTimeout(2500) // a payment would land and count up by now
    const after = await settled()
    if (after !== bal) throw new Error(`a second tap paid again: ${bal} → ${after}`)
    // Skip today from the ⋯ menu: no points, out of the count; and back on.
    await row('Clean day').hover()
    await row('Clean day').locator('.hb-dots-btn').click()
    await pg.locator('.hb-menu button', { hasText: 'Skip today' }).click()
    await pg.waitForFunction((t) => new RegExp(`of ${t}\\b`).test(document.querySelector('.hb-head h2')?.textContent ?? ''), t1 - 1, { timeout: 8000 }).catch(() => {
      throw new Error('a skipped habit still counts')
    })
    if (!/s-skipped/.test(await cls('Clean day'))) throw new Error('Clean day does not show as skipped')
    // (a toast may sit over the row's ⋯ on a small screen: click it directly)
    await row('Clean day').locator('.hb-dots-btn').evaluate((b) => b.click())
    await pg.locator('.hb-menu button', { hasText: 'Back on for today' }).click()
    await pg.waitForFunction(() => !/s-skipped/.test([...document.querySelectorAll('.hb-row')].find((t) => t.textContent.includes('Clean day'))?.className ?? 's-skipped'), null, { timeout: 8000 }).catch(() => {
      throw new Error('Clean day did not come back')
    })
    // The add sheet: name, icon, colour, how often, time of day, and what it pays.
    await pg.locator('.hb-add').click()
    await pg.waitForSelector('.hb-sheet', { timeout: 3000 })
    if (!/Pays|no points/.test(await pg.locator('.hb-sheet .hb-pays').innerText())) throw new Error('the add sheet does not say what it pays')
    await pg.fill('.hb-sheet input[aria-label="Habit name"]', 'Smoke stretch')
    await pg.locator('.hb-sheet .hb-icons button[aria-label="leaf"]').click()
    await pg.locator('.hb-sheet .hb-seg button', { hasText: 'Evening' }).click()
    await pg.locator('.hb-sheet button', { hasText: 'Add habit' }).click()
    await pg.waitForFunction(() => [...document.querySelectorAll('.hb-row')].some((t) => t.textContent.includes('Smoke stretch')), null, { timeout: 8000 }).catch(() => {
      throw new Error('the new habit is not in the list')
    })
    await row('Smoke stretch').locator('.hb-hit').click()
    await rowHas('Smoke stretch', 's-done').catch(() => {
      throw new Error('the new habit did not tick')
    })
    await pg.waitForTimeout(1300) // a ticked row glides to the end first
    await row('Smoke stretch').locator('.hb-dots-btn').evaluate((b) => b.click())
    await pg.locator('.hb-menu button', { hasText: 'Undo today' }).click()
    await pg.waitForFunction(() => !/s-done/.test([...document.querySelectorAll('.hb-row')].find((t) => t.textContent.includes('Smoke stretch'))?.className ?? 's-done'), null, { timeout: 8000 }).catch(() => {
      throw new Error('Undo today did not take it back')
    })
    // The same habits as a compact grid, and back to the list.
    await pg.click('.hb-more')
    await pg.locator('.hb-menu button', { hasText: 'Show as a grid' }).click()
    await pg.waitForSelector('.hb.grid .hb-row', { timeout: 3000 })
    await pg.click('.hb-more')
    await pg.locator('.hb-menu button', { hasText: 'Show as a list' }).click()
    await pg.waitForSelector('.hb.list .hb-row', { timeout: 3000 })

    // Top 3: typed in (when there is room), ticked with a strike-through.
    const slot = pg.locator('.t3-add input')
    if (await slot.count()) {
      await slot.fill('Smoke must-do')
      await slot.press('Enter')
      await pg.locator('.t3-item', { hasText: 'Smoke must-do' }).waitFor({ timeout: 8000 })
    }
    const open3 = pg.locator('.t3-item:not(.done)').first()
    const text3 = (await open3.locator('.t3-t').innerText()).trim()
    await open3.locator('.t3-check').click()
    await pg.waitForFunction((t) => [...document.querySelectorAll('.t3-item')].some((l) => l.textContent.includes(t) && l.classList.contains('done')), text3, { timeout: 8000 }).catch(() => {
      throw new Error('the Top 3 item did not tick')
    })
    if (!/\+\d+ each/.test(await pg.locator('.t3-head').innerText())) throw new Error('the Top 3 does not say what it pays')
    // Other tasks: today's Todoist in one list, ☆ moves one up to the Top 3, one line adds a task.
    await pg.waitForSelector('.ot .ot-item', { timeout: 10000 })
    const first = (await pg.locator('.ot .ot-item .ot-t').first().innerText()).trim()
    await pg.locator('.ot .ot-item').first().hover()
    await pg.locator('.ot .ot-item').first().locator('.ot-star').click()
    await pg.waitForFunction((t) => [...document.querySelectorAll('.t3-item')].some((l) => l.textContent.includes(t)), first, { timeout: 8000 }).catch(() => {
      throw new Error('☆ did not move the task to the Top 3')
    })
    if (!(await pg.locator('.ot form.ot-add input[placeholder="Add a task…"]').count())) throw new Error('no "Add a task…" line under Other tasks')
    await pg.setViewportSize({ width: 1440, height: 900 })
  })
  // A free day: "No spending today" ticks Log spending once, a second tap does nothing, undo takes it back.
  await step('No spending: a free day ticks Log spending once, no second pay, undo takes it back', async () => {
    await pg.setViewportSize({ width: 1280, height: 720 })
    // Its own state: the list view (an earlier step may leave the grid), a fresh page, Today → Now.
    await pg.evaluate(() => localStorage.setItem('ls.hbView', 'list'))
    await reloadApp()
    await open('today')
    await pg.click('.td2 .ptabs [data-tab="now"]')
    await pg.waitForSelector('.hb .hb-row', { timeout: 15000 })
    const row = pg.locator('.hb-row', { hasText: 'Log spending' }).first()
    if (!(await row.count())) {
      // Hidden by an earlier step: show it again from the board's ⋯ menu.
      await pg.locator('.hb-head .hb-more, .hb-head [aria-label*="More"]').first().click().catch(() => {})
      throw new Error('the Log spending row is not on the board (hidden or removed)')
    }
    const coins = () => pg.evaluate(() => document.querySelector('.topbar .tb-coins')?.textContent?.trim() ?? '')
    const settled = async () => {
      let v = await coins()
      for (let k = 0; k < 20; k++) {
        await pg.waitForTimeout(400)
        const b = await coins()
        if (b === v) return v
        v = b
      }
      return v
    }
    // The made-up Finance data has spending every day: this device's copy has none today.
    const keptFinance = await pg.evaluate(() => {
      const old = localStorage.getItem('finance-helper.state')
      localStorage.setItem('finance-helper.state', JSON.stringify({ settings: { currency: 'MDL', categories: [], accounts: [] }, tx: [] }))
      return old
    })
    const already = /s-done/.test((await row.getAttribute('class')) ?? '')
    // The same way a home-screen shortcut opens the spending line (a ticked row has no tap target).
    await pg.evaluate(() => window.dispatchEvent(new Event('life-open-spend')))
    await pg.waitForSelector('.spend-line', { timeout: 3000 })
    const btn = pg.locator('.spend-line [data-testid="free-day"]')
    await btn.waitFor({ timeout: 3000 })
    if (!/No spending today/.test(await btn.innerText())) throw new Error('no "No spending today" button in the spending line')
    if (already) {
      // Spending was already paid earlier in this run: a free day must not pay a second time.
      const was = await settled()
      await btn.click()
      await pg.waitForTimeout(1500)
      if ((await settled()) !== was) throw new Error('a free day paid again on a day that was already paid')
      await pg.evaluate((old) => (old === null ? localStorage.removeItem('finance-helper.state') : localStorage.setItem('finance-helper.state', old)), keptFinance)
      return
    }
    const before = await settled()
    await btn.click()
    await pg.waitForTimeout(1500)
    const said = (await pg.locator('.toasts').innerText().catch(() => '')).replace(/\s+/g, ' ')
    await pg.waitForFunction(() => [...document.querySelectorAll('.hb-row')].some((r) => /Log spending/.test(r.textContent) && /s-done/.test(r.className)), null, { timeout: 8000 }).catch(async () => {
      throw new Error(`"No spending today" did not tick Log spending (toast: ${said})`)
    })
    await pg.waitForFunction(() => /✓ No spending today/.test(document.querySelector('.spend-line [data-testid="free-day"]')?.textContent ?? ''), null, { timeout: 5000 })
    await pg.waitForTimeout(800)
    const after = await settled()
    if (after === before) throw new Error(`a free day paid no points (${before})`)
    // A second tap is Undo, not a second pay: undo takes the points back and un-ticks the habit.
    await btn.click()
    await pg.waitForFunction(() => [...document.querySelectorAll('.hb-row')].some((r) => /Log spending/.test(r.textContent) && !/s-done/.test(r.className)), null, { timeout: 8000 }).catch(() => {
      throw new Error('undo did not un-tick Log spending')
    })
    await pg.waitForTimeout(800)
    if ((await settled()) !== before) throw new Error('undo did not take the points back')
    // Tap again for the screenshot and leave the day free.
    await pg.locator('.spend-line [data-testid="free-day"]').click()
    await pg.waitForFunction(() => /✓ No spending today/.test(document.querySelector('.spend-line [data-testid="free-day"]')?.textContent ?? ''), null, { timeout: 5000 })
    if (process.env.NOSPEND_SHOTS) await pg.waitForFunction(() => !document.querySelector('.toasts .toast'), null, { timeout: 10000 }).catch(() => {})
    if (process.env.NOSPEND_SHOTS) await pg.screenshot({ path: join(process.env.NOSPEND_SHOTS, 'free-day.png') })
    await pg.evaluate((old) => (old === null ? localStorage.removeItem('finance-helper.state') : localStorage.setItem('finance-helper.state', old)), keptFinance)
  })
  // Career (made-up data): the job board with its weekly quota, a flashcard review,
  // the portfolio export, an essay planned backward, pay yourself first, the letter.
  await step('Career: apply to a job, grade a flashcard, export the portfolio, plan an essay, pay yourself first, the monthly letter', async () => {
    await pg.setViewportSize({ width: 1440, height: 900 })
    await open('career')
    await pg.waitForSelector('.cr .cr-board .cr-job', { timeout: 15000 })
    const until = async (fn, what, ms = 10000) => {
      const end = Date.now() + ms
      for (;;) {
        if (await fn().catch(() => false)) return
        if (Date.now() > end) throw new Error(what)
        await new Promise((ok) => setTimeout(ok, 200))
      }
    }
    const tab = async (id) => {
      await pg.click(`.cr .ptabs [data-tab="${id}"]`)
      await pg.waitForSelector(`.cr .ptabs [data-tab="${id}"][aria-selected="true"]`, { timeout: 5000 })
    }
    await tab('jobs')
    const sent = async () => Number((await pg.locator('.cr-quota .cr-ring-in b').innerText()).split('/')[0])
    const before = await sent()
    await pg.fill('.cr-add input[aria-label="Company"]', 'Made-up Robotics')
    await pg.fill('.cr-add input[aria-label="Role"]', 'Security intern')
    await pg.locator('.cr-add [aria-label="Stage"]').click()
    await pg.locator('.ui-select-list [role=option]', { hasText: 'Applied already' }).click()
    await pg.click('.cr-add .btn.primary')
    await until(async () => (await sent()) === before + 1, 'the new application did not count for the week')
    await pg.locator('.cr-col.s-applied .cr-job', { hasText: 'Made-up Robotics' }).waitFor({ timeout: 5000 })
    // Move it on with its button: it lands in Interview.
    await pg.locator('.cr-col.s-applied .cr-job', { hasText: 'Made-up Robotics' }).locator('.btn', { hasText: 'Interview' }).click()
    await pg.locator('.cr-col.s-interview .cr-job', { hasText: 'Made-up Robotics' }).waitFor({ timeout: 5000 })
    // Flashcards: Space shows the answer, 3 grades it Good, the queue gets shorter.
    await tab('cards')
    await pg.waitForSelector('.cr-face', { timeout: 5000 })
    const left = async () => Number(/(\d+) left today/.exec(await pg.locator('.cr-flash > small').innerText())?.[1] ?? -1)
    const n0 = await left()
    await pg.click('.cr-face')
    await pg.waitForSelector('.cr-grades', { timeout: 5000 })
    await pg.locator('.cr-g.good').click()
    await until(async () => (await left()) === n0 - 1 || (n0 === 1 && (await pg.locator('.cr-review .cr-empty').count()) > 0), 'grading a card did not move the queue on')
    // Portfolio: the markdown export has the public entries and not the private one.
    await tab('portfolio')
    await pg.locator('.cr-exp-btns .btn', { hasText: 'Export markdown' }).click()
    const md = await pg.locator('.cr-sheet .cr-md').innerText({ timeout: 5000 })
    if (!/## CTF writeups/.test(md) || /Study packs for quiet moments/.test(md)) throw new Error('the markdown export is wrong')
    await pg.click('.cr-sheet header .cr-x')
    await pg.waitForSelector('.cr-sheet', { state: 'detached', timeout: 5000 })
    // An essay is planned backward into steps, the last on the due day.
    await tab('study')
    const due = await pg.evaluate(() => {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })
    await pg.fill('.cr-essays input[aria-label="Title"]', 'Made-up essay on ethics')
    await pg.fill('.cr-essays input[aria-label="Due date"]', due)
    await pg.fill('.cr-essays input[aria-label="Words"]', '900')
    await pg.click('.cr-essays .btn.primary')
    const essay = pg.locator('.cr-essay', { hasText: 'Made-up essay on ethics' })
    await essay.waitFor({ timeout: 5000 })
    if ((await essay.locator('.cr-steps li').count()) < 4) throw new Error('the essay has too few steps')
    // Pay yourself first: the waiting income is answered and the streak grows.
    await tab('money')
    await pg.waitForSelector('.cr-ef .cr-ring', { timeout: 5000 })
    const streak = async () => Number(/(\d+) in a row/.exec(await pg.locator('.cr-pay .cr-pill').innerText())?.[1] ?? 0)
    const s0 = await streak()
    if (await pg.locator('.cr-asks li').count()) {
      await pg.locator('.cr-asks li').first().locator('.btn.primary').click()
      await until(async () => (await streak()) === s0 + 1, 'paying yourself first did not grow the streak')
    }
    if (!(await pg.locator('.cr-note', { hasText: 'not financial advice' }).count())) throw new Error('the investing plan has no "not financial advice" note')
    // The monthly letter.
    await tab('review')
    await pg.waitForSelector('.cr-letter ul li', { timeout: 5000 })
    await pg.click('.cr .ptabs [data-tab="jobs"]')
  })
  // The same switch on every long page: each tab about one laptop screen.
  // Run at 10:00: how long Insights → Week is depends on what's left of today's calendar.
  await step('Long pages: Insights, Goals, Career, Money, Music, Rewards and long Settings sections fit by tabs', () => atTime('10:00', async () => {
    await pg.setViewportSize({ width: 1280, height: 720 })
    const report = []
    const pages = [
      ['progress', '.pg', ['week', 'areas', 'streaks', 'focus', 'look'], { week: 2.2 }],
      ['goals', '.gx', ['goals', 'week', 'hours', 'path'], { goals: 2.6 }],
      ['career', '.cr', ['jobs', 'portfolio', 'cards', 'study', 'money', 'review'], { money: 2 }],
      ['money', '.mh', ['today', 'month', 'goals'], {}],
      ['music', '.mup', ['player', 'library', 'options'], {}],
      ['shop', '.rx', ['now', 'unlock', 'all', 'history', 'earn'], { now: 2, all: 2, earn: 2 }]
    ]
    for (const [page, scope, ids, wide] of pages) {
      await open(page)
      // Money: its own hub (an earlier step opened the Finance Helper app).
      if (page === 'money') await pg.locator('.seg-switch [role="tab"]', { hasText: 'Money hub' }).click({ timeout: 5000 }).catch(() => {})
      await pg.waitForSelector(`${scope} .ptabs [data-tab="${ids[0]}"]`, { timeout: 15000 })
      const got = await pg.locator(`${scope} .ptabs [role="tab"]`).evaluateAll((bs) => bs.map((b) => b.dataset.tab))
      if (got.slice(0, ids.length).join() !== ids.join()) throw new Error(`${page} tabs ${got.join()}`)
      const sizes = []
      // (the week plan, the goal cards and all rewards are lists that grow with you)
      for (const id of ids) sizes.push(`${id} ${((await tabFit(scope, id, wide[id] ?? 1.75)).scroll / 654).toFixed(2)}`)
      // Remembered when you come back.
      await open('today')
      await pg.waitForSelector('.td2', { timeout: 10000 })
      await open(page)
      await pg.waitForSelector(`${scope} .ptabs [data-tab="${ids[ids.length - 1]}"][aria-selected="true"]`, { timeout: 5000 })
      await pg.click(`${scope} .ptabs [data-tab="${ids[0]}"]`)
      report.push(`${page}: ${sizes.join(', ')}`)
    }
    await open('settings')
    await pg.waitForSelector('.st-item', { timeout: 10000 })
    for (const [sec, name, ids] of [['look', 'Look', ['look', 'today']], ['ben', 'Ben', ['life', 'pushes', 'brain', 'talk', 'notes', 'memory']], ['connections', 'Connections', ['accounts', 'bots', 'telegram']], ['widgets', 'Widgets', ['gallery', 'pages', 'look']], ['ai-apps', 'Connect an AI app', ['connect', 'how']], ['automation', 'PC & automation', ['push', 'n8n', 'hooks', 'auto', 'mcp']]]) {
      await pg.locator('.st-item', { hasText: name }).first().click()
      await pg.waitForFunction((n) => document.querySelector('.st-head h1')?.textContent === n, name, { timeout: 5000 })
      await pg.waitForSelector(`.st-tabs .ptabs [data-tab="${ids[0]}"]`, { timeout: 8000 })
      const sizes = []
      // (the Telegram bots card, the Today screen card and the widget gallery are one long card each;
      // the gallery grows with every widget and measures a bit taller on the Windows runner's fonts)
      const oneCard = { 'connections.telegram': 3.8, 'look.today': 2.4, 'widgets.gallery': 2.4 }
      for (const id of ids) {
        if (!(await pg.waitForSelector(`.st-tabs .ptabs [data-tab="${id}"]`, { timeout: 8000 }).catch(() => null))) {
          const heads = await pg.evaluate(() => [...document.querySelectorAll('.st-grid-tabs > *')].map((e) => (e.querySelector('h2, h3')?.textContent ?? '').trim().slice(0, 24)))
          throw new Error(`settings ${sec}: no "${id}" tab (cards: ${heads.join(' | ')})`)
        }
        sizes.push(`${id} ${((await tabFit('.st-body', id, oneCard[`${sec}.${id}`] ?? 2)).scroll / 654).toFixed(2)}`)
      }
      report.push(`settings ${sec}: ${sizes.join(', ')}`)
      await pg.click(`.st-tabs .ptabs [data-tab="${ids[0]}"]`)
    }
    await pg.setViewportSize({ width: 1440, height: 900 })
    console.log(`  ${report.join('\n  ')}`)
  }))
  // Runs after the long-pages step on purpose: it adds starter rewards, which make the All tab longer.
  // The Rewards shop: goal bar, combo, monthly budget meter, shelves, rarity, a buy that spends exactly the price, and it fits laptop and phone.
  await step('Rewards: shop shelves, budget meter and buy', async () => {
    await open('shop')
    await pg.waitForSelector('[data-testid="goal-bar"], .sh-goal', { timeout: 10000 })
    await pg.waitForSelector('[data-testid="combo"]', { timeout: 5000 })
    const meter = (await pg.locator('[data-testid="budget-meter"]').innerText()).replace(/\s+/g, ' ')
    if (!/Spent this month \d+ \/ \d+ lei/.test(meter)) throw new Error(`budget meter reads: ${meter}`)
    await pg.click('.rx .ptabs [data-tab="now"]')
    await pg.waitForSelector('.sh-shelf', { timeout: 5000 })
    if ((await pg.locator('.sh-shelf').count()) < 6) throw new Error('fewer than 6 shelves')
    // The skincare shelf opens, and an empty one adds its starter items in one tap (saved rewards stay as they are).
    if ((await pg.locator('.sh-shelf[data-shelf="skin"].shut').count()) > 0) await pg.click('.sh-shelf[data-shelf="skin"] .sh-shelf-head')
    await pg.waitForSelector('.sh-shelf[data-shelf="skin"].open', { timeout: 3000 })
    const starter = pg.locator('.sh-shelf[data-shelf="skin"] .sh-empty .rx-btn.primary')
    if (await starter.count()) {
      await starter.click()
      await pg.waitForSelector('.sh-shelf[data-shelf="skin"] .rx-card', { timeout: 8000 })
      if (!(await pg.locator('.sh-shelf[data-shelf="skin"] .rx-title', { hasText: 'SPF 50 sunscreen' }).count())) throw new Error('starter skincare items missing')
    }
    if (!(await pg.locator('.rx-card .sh-rar').count())) throw new Error('no rarity label on the cards')
    // Buy: hold a ready card; the balance drops by exactly its price (when something is ready).
    // The pill may also show a floating "-60" for a moment: read only its first number.
    const bal = async () => Number(((await pg.locator('header.topbar .tb-me').first().innerText()).match(/\d[\d,. ]*/)?.[0] ?? '').replace(/\D/g, ''))
    const ready = pg.locator('.sh-shelf .rx-card.ready').first()
    if (await ready.count()) {
      const price = Number((await ready.locator('.rx-price').first().innerText()).split('·')[0].replace(/\D/g, ''))
      const before = await bal()
      await ready.locator('.rx-hold').scrollIntoViewIfNeeded()
      const box = await ready.locator('.rx-hold').boundingBox()
      await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await pg.mouse.down()
      await pg.waitForTimeout(1200)
      await pg.mouse.up()
      // A reward with a real cost first asks what you paid: accept the suggested amount.
      await pg.getByRole('button', { name: 'Buy it', exact: true }).click({ timeout: 2500 }).catch(() => {})
      // Past the fun budget a sheet says so; "Buy anyway" is its own explicit tap (the budget only warns).
      await pg.getByRole('button', { name: 'Buy anyway', exact: true }).click({ timeout: 1500 }).catch(() => {})
      for (let i = 0; i < 30 && (await bal()) >= before; i++) await pg.waitForTimeout(250)
      if ((await bal()) >= before) {
        await pg.screenshot({ path: '/tmp/claude-0/-home-user-MEGA-SYSTEM/67731d19-5483-525e-a142-84be5af4f362/scratchpad/dbg.png' })
        throw new Error(`the balance did not drop after the buy (${before} now ${await bal()}, price ${price})`)
      }
      await pg.waitForTimeout(600)
      const after = await bal()
      if (before - after !== price) throw new Error(`buy spent ${before - after}, price was ${price}`)
      await pg.click('.rx .ptabs [data-tab="history"]')
      await pg.waitForSelector('.rx-history li', { timeout: 5000 })
      await pg.click('.rx .ptabs [data-tab="now"]')
    }
    // Fits the laptop and the phone: no sideways scroll.
    for (const [w, h] of [[1280, 720], [390, 800]]) {
      await pg.setViewportSize({ width: w, height: h })
      await pg.waitForTimeout(250)
      const over = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      if (over > 1) throw new Error(`Rewards scrolls sideways by ${over}px at ${w}px`)
    }
    await pg.setViewportSize({ width: 1440, height: 900 })
  })
  // PE1–PE3, PE7: the plan is edited right in its card; an approved block's new time goes to Google and Todoist.
  // Plan trust: the audit runs before the card shows (one plain line for what has no room), each block
  // says why it is there, and a block the clock passed without a start moves by itself, with a note and Undo.
  await step('Plan trust: the plan card shows the audit line and why lines, and re-plans by itself after a late block (note + Undo)', async () => {
    await pg.setViewportSize({ width: 1440, height: 900 })
    await open('today')
    await pg.waitForSelector('.td2 .ptabs [data-tab="plan"]', { timeout: 15000 })
    await pg.click('.td2 .ptabs [data-tab="plan"]')
    await pg.locator('section.cp .pe-block').first().waitFor({ timeout: 15000 })
    // The audit's one line: tasks with no room are listed (never silently dropped), with one tap to move them.
    const line = pg.locator('section.cp .pe-audit').first()
    await line.waitFor({ timeout: 10000 })
    if (!/didn't fit: .+ Move (it|them) to tomorrow\?/.test(await line.innerText())) throw new Error(`audit line: ${await line.innerText()}`)
    if (!(await line.locator('button', { hasText: 'Move to tomorrow' }).count())) throw new Error('no "Move to tomorrow" on the audit line')
    // Why lines from real data (the made-up lab report task is overdue and P1 in Todoist).
    await pg.locator('section.cp .pe-block .pe-why').first().waitFor({ timeout: 10000 })
    const whys = await pg.$$eval('section.cp .pe-block .pe-why', (els) => els.map((e) => e.textContent || ''))
    if (!whys.some((w) => /overdue|from Todoist|must-do|pinned|due /.test(w))) throw new Error(`why lines: ${whys.join(' | ')}`)
    await pg.locator('section.cp').first().screenshot({ path: '/tmp/claude-0/-home-user-MEGA-SYSTEM/67731d19-5483-525e-a142-84be5af4f362/scratchpad/plan/plan-card.png' }).catch(() => {})
    // A draft block still ahead: the clock passes its start and nobody starts it.
    await new Promise((ok) => setTimeout(ok, 1000))
    const drafts = await pg.$$eval('section.cp .pe-block.draft', (els) => els.map((el) => ({ title: el.querySelector('.pe-name')?.textContent?.trim() || '', start: (el.querySelector('.pe-time')?.textContent || '').slice(0, 5) })))
    const nowHm = new Date(fakeNow()).toTimeString().slice(0, 5)
    const late = drafts.filter((d) => d.start > nowHm && d.start < '21:00').sort((a, b) => a.start.localeCompare(b.start))[0]
    if (!late) throw new Error(`no draft block ahead to make late: ${JSON.stringify(drafts)}`)
    const [h, m] = late.start.split(':').map(Number)
    const t15 = h * 60 + m + 15
    const laterHm = `${String(Math.floor(t15 / 60)).padStart(2, '0')}:${String(t15 % 60).padStart(2, '0')}`
    await pg.evaluate(() => localStorage.removeItem('ls.planAuto'))
    await atTime(laterHm, async () => {
      await open('today')
      await pg.waitForSelector('.td2 .ptabs [data-tab="plan"]', { timeout: 15000 })
      await pg.click('.td2 .ptabs [data-tab="plan"]')
      const note = pg.locator('section.cp .pe-auto').first()
      await note.waitFor({ timeout: 15000 })
      const text = await note.innerText()
      if (!/didn't start at \d\d:\d\d|because .+ (ran long|moved|was added)|because of /.test(text)) throw new Error(`re-plan note: ${text}`)
      // Undo takes the automatic re-plan back.
      await note.locator('button', { hasText: 'Undo' }).click()
      await pg.waitForFunction(() => !document.querySelector('section.cp .pe-auto'), null, { timeout: 8000 })
      // The block is back where it was, and the undone plan is saved before the clock goes back.
      await pg.locator('section.cp .pe-block', { hasText: late.title }).first().waitFor({ timeout: 8000 })
      await new Promise((ok) => setTimeout(ok, 1500))
    })
  })
  await step('plan editor: approve one block, drag it, Google and Todoist get the new time, undo', async () => {
    await pg.setViewportSize({ width: 1440, height: 900 })
    await open('today')
    await pg.waitForSelector('.td2 .ptabs [data-tab="plan"]', { timeout: 15000 })
    await pg.click('.td2 .ptabs [data-tab="plan"]')
    const blk = pg.locator('section.cp .pe-block', { hasText: 'Draft the networking lab report' }).first()
    await blk.waitFor({ timeout: 15000 })
    const api = async (n, op) => (await fetch(`http://127.0.0.1:${port}/api/${n}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op }) })).json()
    // Waits for a condition (slow Windows runners: generous, polling).
    const until = async (fn, what, ms = 20000) => {
      const end = Date.now() + ms
      for (;;) {
        if (await fn().catch(() => false)) return
        if (Date.now() > end) throw new Error(what)
        await new Promise((ok) => setTimeout(ok, 250))
      }
    }
    const hmAdd = (hm, m) => {
      const t = Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5)) + m
      return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
    }
    // Approve just this block: it goes into the calendar, the rest stays a draft.
    await blk.locator('.pe-ok').check()
    await until(async () => (await api('google', 'log')).some((x) => x.op === 'create' && /Draft the networking lab report$/.test(x.title)), 'approving one block made no calendar event')
    await blk.locator('.pe-st', { hasText: '✓' }).waitFor({ timeout: 15000 })
    // Drag it 30 minutes later (78 px an hour: 39 px), in small steps like a hand.
    const before = (await blk.locator('.pe-time').innerText()).slice(0, 5)
    const want = hmAdd(before, 30)
    await blk.scrollIntoViewIfNeeded()
    const box = await blk.boundingBox()
    const x = box.x + box.width * 0.6
    await pg.mouse.move(x, box.y + 12)
    await pg.mouse.down()
    for (let i = 1; i <= 6; i++) await pg.mouse.move(x, box.y + 12 + i * 6.5)
    await pg.mouse.up()
    await until(async () => (await blk.locator('.pe-time').innerText()).startsWith(want), `the block did not move to ${want}`)
    const dayOf = await pg.evaluate(() => {
      const d = new Date()
      if (d.getHours() < 4) d.setDate(d.getDate() - 1)
      return d.toDateString()
    })
    const isoAt = (hm) => {
      const d = new Date(dayOf)
      d.setHours(Number(hm.slice(0, 2)), Number(hm.slice(3, 5)), 0, 0)
      return d.toISOString()
    }
    await until(async () => (await api('google', 'log')).some((x) => x.op === 'update' && x.start === isoAt(want)), `Google Calendar got no move to ${want}`)
    await until(async () => (await api('todoist', 'peek')).some((t) => t.id === 't4' && t.dueTime === want), `Todoist got no ${want} for the task`)
    // Undo: the block, the event and the task go back.
    await pg.locator('section.cp .pe-btn', { hasText: 'Undo' }).click()
    await until(async () => (await blk.locator('.pe-time').innerText()).startsWith(before), 'Undo did not move the block back')
    await until(async () => (await api('google', 'log')).some((x) => x.op === 'update' && x.start === isoAt(before)), 'Undo did not move the calendar event back')
    await until(async () => (await api('todoist', 'peek')).some((t) => t.id === 't4' && t.dueTime === before), 'Undo did not put the task time back')
  })
  await step('Sync: approving the whole plan makes one event per block; a task added in Todoist shows after Sync', async () => {
    await pg.setViewportSize({ width: 1440, height: 900 })
    await open('today')
    await pg.waitForSelector('.td2 .ptabs [data-tab="plan"]', { timeout: 15000 })
    await pg.click('.td2 .ptabs [data-tab="plan"]')
    await pg.locator('section.cp .pe-block').first().waitFor({ timeout: 15000 })
    const call = async (n, body) => (await fetch(`http://127.0.0.1:${port}/api/${n}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
    const until = async (fn, what, ms = 20000) => {
      const end = Date.now() + ms
      for (;;) {
        if (await fn().catch(() => false)) return
        if (Date.now() > end) throw new Error(what)
        await new Promise((ok) => setTimeout(ok, 250))
      }
    }
    // Approve every block at once (the editor and the approval both write: the calendar must still get each block once).
    await pg.locator('section.cp .pe-approve input[type="time"]').fill('23:45')
    await pg.locator('section.cp .pe-approve .pe-btn', { hasText: 'Approve until' }).click()
    const plain = (t) => t.replace(/^(?:\p{Extended_Pictographic}\uFE0F?)+\s*/u, '').trim()
    const hm = (iso) => new Date(iso).toTimeString().slice(0, 5)
    const blocks = async () =>
      pg.$$eval('section.cp .pe-block:not(.past)', (els) => els.map((el) => ({ title: (el.querySelector('.pe-name')?.textContent || '').replace(/^💪\s*/u, '').trim(), start: (el.querySelector('.pe-time')?.textContent || '').slice(0, 5) })))
    const count = async () => {
      const evs = await call('google', { op: 'peek' })
      return (await blocks()).map((b) => evs.filter((e) => plain(e.title) === b.title && hm(e.start) === b.start).length)
    }
    await until(async () => (await count()).every((n) => n >= 1), 'not every approved block reached the calendar')
    // Give a second write time to land, then count again: exactly one each (N events, not 2N).
    await new Promise((ok) => setTimeout(ok, 1500))
    const n = await count()
    if (!n.length || n.some((x) => x !== 1)) throw new Error(`events per block: ${n.join(', ')}`)
    // A task added in Todoist itself shows up on Today → Now after Sync.
    await call('todoist', { op: 'testAdd', content: 'Water the balcony plants' })
    await pg.click('.td2 .ptabs [data-tab="now"]')
    const sync = pg.locator('.ot-head .sync-btn button').first()
    await sync.waitFor({ timeout: 15000 })
    await sync.click()
    await pg.locator('.ot-list .ot-t', { hasText: 'Water the balcony plants' }).first().waitFor({ timeout: 15000 })
    await pg.locator('.ot-head .sync-at', { hasText: /Synced \d\d:\d\d/ }).first().waitFor({ timeout: 10000 })
  })
  await step('Sync button: the plan card shows Sync and the auto-sync status; a click updates the Synced time', async () => {
    await pg.setViewportSize({ width: 1440, height: 900 })
    await open('today')
    await pg.waitForSelector('.td2 .ptabs [data-tab="plan"]', { timeout: 15000 })
    await pg.click('.td2 .ptabs [data-tab="plan"]')
    const bar = pg.locator('section.cp [data-sync-bar]').first()
    await bar.waitFor({ timeout: 15000 })
    await bar.locator('.plan-sync-auto', { hasText: /Auto-sync on/ }).waitFor({ timeout: 10000 })
    await bar.locator('button', { hasText: 'Sync' }).click()
    await bar.locator('.plan-sync-auto', { hasText: /last checked \d\d:\d\d/ }).waitFor({ timeout: 15000 })
    await bar.locator('.sync-at', { hasText: /Synced \d\d:\d\d/ }).waitFor({ timeout: 15000 })
    await pg.screenshot({ path: '/tmp/claude-0/-home-user-MEGA-SYSTEM/67731d19-5483-525e-a142-84be5af4f362/scratchpad/sync/plan-sync.png' })
  })
  await step('Tasks sync: priority and due today reach Todoist, the row says saved, a Todoist change shows after Sync', async () => {
    await pg.setViewportSize({ width: 1440, height: 900 })
    const call = async (n, body) => (await fetch(`http://127.0.0.1:${port}/api/${n}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
    const until = async (fn, what, ms = 15000) => {
      const end = Date.now() + ms
      for (;;) {
        if (await fn().catch(() => false)) return
        if (Date.now() > end) throw new Error(what)
        await new Promise((ok) => setTimeout(ok, 250))
      }
    }
    await open('tasks')
    const row = pg.locator('.ta-task', { hasText: 'Read chapter 4' }).first()
    await row.waitFor({ timeout: 15000 })
    // P1 from the flag menu.
    await row.hover()
    await row.locator('button[aria-label="Priority"]').click()
    await row.locator('.ta-pop-item', { hasText: 'P1' }).click()
    await row.locator('.ta-flag', { hasText: 'P1' }).waitFor({ timeout: 5000 })
    // Due today from the date menu.
    await row.hover()
    await row.locator('button[aria-label="Date"]').click()
    await row.locator('.ta-pop-item', { hasText: 'Today' }).click()
    await row.locator('.ta-due', { hasText: 'today' }).waitFor({ timeout: 5000 })
    // The fake Todoist got both, each as its own field (priority 4 = P1, the date as a date).
    const day = await pg.evaluate(() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })
    await until(async () => {
      const t = (await call('todoist', { op: 'peek' })).find((x) => x.id === 't3')
      return t.priority === 4 && t.due === day
    }, 'Todoist did not get P1 and due today')
    await row.locator('.ta-save[data-state="saved"]', { hasText: '✓ saved' }).waitFor({ timeout: 10000 })
    if (process.env.TASKS_SHOT) await pg.screenshot({ path: process.env.TASKS_SHOT })
    // A change made in Todoist itself shows after Sync.
    await call('todoist', { op: 'testEdit', id: 't1', content: 'Pay the internet bill (online)', priority: 3 })
    await pg.locator('.ta-sync button', { hasText: 'Sync' }).first().click()
    await pg.locator('.ta-task', { hasText: 'Pay the internet bill (online)' }).first().waitFor({ timeout: 15000 })
  })
  // Planner upgrades: time limits (Coach → Daily rhythm), deadlines planned backward, the week plan (Today → Week).
  await step('Plan limits: set limits in Coach, the plan keeps them, deadline sessions and the week plan show', async () => {
    await pg.setViewportSize({ width: 1440, height: 900 })
    const limitsBox = async () => {
      await open('coach')
      await pg.locator('button[aria-label="More"]').first().click({ timeout: 15000 })
      await pg.locator('[role="menuitem"]', { hasText: 'Plan, goals and about you' }).click()
      await pg.locator('.bd-tabs [role="tab"]', { hasText: 'Plan' }).click()
      await pg.locator('.bd-more summary', { hasText: "Today's plan & daily rhythm" }).waitFor({ timeout: 15000 })
      if (!(await pg.locator('[data-plan-limits]').first().isVisible().catch(() => false))) await pg.locator('.bd-more summary', { hasText: "Today's plan & daily rhythm" }).click()
      const box = pg.locator('[data-plan-limits]').first()
      await box.waitFor({ timeout: 15000 })
      return box
    }
    const saved = async () => {
      await pg.locator('.toast', { hasText: 'Limits saved' }).last().waitFor({ timeout: 8000 })
      await new Promise((ok) => setTimeout(ok, 400))
    }
    const box = await limitsBox()
    // The made-up "Rust book" deadline: planned backward into sessions, or said plainly how short it is.
    const dl = pg.locator('[data-deadline-plan]').first()
    await dl.waitFor({ timeout: 15000 })
    if (!/session|short/.test(await dl.innerText())) throw new Error(`deadline line: ${await dl.innerText()}`)
    await box.locator('[data-limit-focus]').fill('3')
    await box.locator('[data-limit-focus]').blur()
    await saved()
    await box.locator('[data-limit-off]').fill('20:00')
    await saved()
    await box.locator('[data-protect-add]').click()
    await box.locator('[data-protect-title]').fill('Training')
    await box.locator('[data-protect-start]').fill('17:00')
    await box.locator('[data-protect-min]').fill('45')
    await box.locator('.pl-add button', { hasText: 'Add' }).click()
    await box.locator('[data-protect-row]', { hasText: 'Training' }).waitFor({ timeout: 8000 })
    // Today → Plan: the draft keeps the limits (at most 3h of work, nothing after 20:00, the protected time shown).
    await open('today')
    await pg.waitForSelector('.td2 .ptabs [data-tab="plan"]', { timeout: 15000 })
    await pg.click('.td2 .ptabs [data-tab="plan"]')
    await pg.locator('section.cp .pe-block').first().waitFor({ timeout: 15000 })
    await pg.locator('section.cp .pe-ev.protected').first().waitFor({ state: 'attached', timeout: 10000 })
    await pg.waitForFunction(() => {
      const bs = [...document.querySelectorAll('section.cp .pe-block.draft:not(.locked)')]
      const work = bs.filter((b) => b.getAttribute('data-work')).reduce((t, b) => t + Number(b.getAttribute('data-min')), 0)
      const late = bs.some((b) => {
        const [h, m] = (b.getAttribute('data-start') || '00:00').split(':').map(Number)
        return h * 60 + m + Number(b.getAttribute('data-min')) > 20 * 60
      })
      // Approved blocks are yours and stay (earlier steps approve the plan): only the drafts must keep the limits.
      return work <= 180 && !late
    }, null, { timeout: 15000 })
    await pg.locator('section.cp').first().screenshot({ path: '/tmp/claude-0/-home-user-MEGA-SYSTEM/67731d19-5483-525e-a142-84be5af4f362/scratchpad/planwork/plan-limits.png' }).catch(() => {})
    // Today → Week: the next 7 days with planned hours against the 3h limit, and the deadline's coverage.
    await pg.click('.td2 .ptabs [data-tab="week"]')
    const wk = pg.locator('[data-week-plan]').first()
    await wk.waitFor({ timeout: 15000 })
    if ((await wk.locator('[data-week-day]').count()) !== 7) throw new Error('the week plan does not show 7 days')
    if (!/\/ 3h/.test(await wk.locator('[data-week-day]').first().innerText())) throw new Error(`no limit on the day: ${await wk.locator('[data-week-day]').first().innerText()}`)
    await wk.locator('[data-week-deadlines]', { hasText: 'Rust book' }).waitFor({ timeout: 10000 })
    if (!(await wk.locator('[data-week-session]').count())) throw new Error('no deadline sessions in the next 7 days')
    // Tomorrow becomes a heavy study day (only the days ahead change), then back to normal.
    const tomorrow = wk.locator('[data-week-day]').nth(1)
    await tomorrow.locator('[data-week-type]').click()
    await tomorrow.locator('[data-week-type]', { hasText: 'Heavy study' }).waitFor({ timeout: 8000 })
    await wk.screenshot({ path: '/tmp/claude-0/-home-user-MEGA-SYSTEM/67731d19-5483-525e-a142-84be5af4f362/scratchpad/planwork/week-plan.png' }).catch(() => {})
    await tomorrow.locator('[data-week-type]').click()
    await tomorrow.locator('[data-week-type]', { hasText: 'Light' }).waitFor({ timeout: 8000 })
    await tomorrow.locator('[data-week-type]').click()
    await tomorrow.locator('[data-week-type]', { hasText: 'Normal' }).waitFor({ timeout: 8000 })
    // Back to no limits, so later steps see the plain planner.
    const box2 = await limitsBox()
    await box2.locator('[data-limit-focus]').fill('')
    await box2.locator('[data-limit-focus]').blur()
    await saved()
    await box2.locator('[data-limit-off]').fill('')
    await saved()
    await box2.locator('[data-protect-row] .pl-x').first().click()
    await pg.waitForFunction(() => !document.querySelector('[data-protect-row]'), null, { timeout: 8000 })
  })
  // LF1, LF4–LF7, LF12, LF15, LF18: one Season page for the arc, the vision board, identity votes, wins, adventures and the life wheel.
  await step('Season: pick a theme, the intro plays, the boss has HP, every tab has its content', async () => {
    await pg.setViewportSize({ width: 1440, height: 900 })
    await open('season')
    await pg.waitForSelector('.sg .ptabs [data-tab="season"]', { timeout: 15000 })
    await pg.click('.sg .ptabs [data-tab="season"]')
    await pg.waitForSelector('.sg-theme-card', { state: 'visible', timeout: 10000 })
    await pg.locator('.sg-themes .sg-theme-card', { hasText: 'Shadow Code' }).first().click()
    await pg.waitForSelector('.sg-sheet .sg-form', { timeout: 5000 })
    await pg.locator('.sg-sheet .btn.primary', { hasText: 'Begin the season' }).click()
    await pg.waitForSelector('.cn-intro', { timeout: 8000 })
    await pg.keyboard.press('Escape')
    await pg.waitForSelector('.cn-intro', { state: 'detached', timeout: 5000 })
    await pg.waitForSelector('.sg-hero .sg-title', { timeout: 10000 })
    if (!/Shadow Code/.test(await pg.locator('.sg-hero .sg-title').innerText())) throw new Error('the season title is missing')
    const hp = await pg.locator('.sg-hp').getAttribute('aria-valuenow')
    if (!(Number(hp) > 0 && Number(hp) <= 100)) throw new Error(`boss HP is ${hp}`)
    if ((await pg.locator('.sg-quest').count()) !== 3) throw new Error('not three main quests')
    for (const [id, sel] of [['vision', '.sg-vcard.add'], ['identity', '.sg-id-add'], ['wins', '.sg-wins-head'], ['adventures', '.sg-side'], ['wheel', '.sg-wheel']]) {
      await pg.click(`.sg .ptabs [data-tab="${id}"]`)
      await pg.waitForSelector(sel, { state: 'visible', timeout: 8000 })
    }
    // A life-wheel rating saves and the tab no longer asks for it.
    await pg.locator('.sg-wheel-side .btn.primary').click()
    await pg.waitForFunction(() => !/!/.test(document.querySelector('.sg .ptabs [data-tab="wheel"]')?.textContent ?? '!'), null, { timeout: 8000 })
    await pg.click('.sg .ptabs [data-tab="season"]')
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
