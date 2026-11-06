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
  // SMOKE_ONLY=<words>: run only the steps whose name has them (handy while working on one part).
  if (process.env.SMOKE_ONLY && !name.includes(process.env.SMOKE_ONLY)) return
  try {
    await fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    fails.push(name)
    console.log(`✗ ${name}: ${process.env.SMOKE_FULL ? e.message : e.message.split('\n')[0]}`)
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
    await pg.click('.rx .ptabs [data-tab="all"]')
    await pg.waitForSelector('.rx-card .rx-title', { timeout: 5000 })
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
  await step("Coach: Ben's chat with folded updates and cards", async () => {
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
    if (!(await pg.$('.cf-compose-row .bl .ba-face'))) throw new Error("no live Ben beside the message box")
    await pg.fill('.cf-input textarea', 'water 500')
    await pg.waitForFunction(() => /Log 500 ml of water/.test(document.querySelector('.cf-will')?.textContent ?? ''), null, { timeout: 3000 })
    await pg.waitForSelector('.ch-hero', { state: 'detached', timeout: 3000 })
    await pg.fill('.cf-input textarea', '/wa')
    if (!(await pg.$('.cf-slash'))) throw new Error('no / shortcuts')
    await pg.fill('.cf-input textarea', '')
    // Coach UI v3: Ben's face once per group, results with Undo, the plan card, ↑ edits.
    await pg.waitForSelector('.cf-plan.live .cf-plan-list li', { timeout: 10000 })
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
    if ((await card.locator('.pa-list li').count()) < 6) throw new Error('Also today lists too few tasks')
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
  })
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
        : JSON.stringify({ ok: true, reply: 'Yesterday went fine: lab intro done and 75 min of focus. Algebra slipped, so it goes first today at 09:00.', done: [], at: new Date().toISOString(), buttons: [{ label: '▶ 25 min Algebra', do: 'focus:25:Algebra' }] })
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
  await step('Goals: cards with rings and pace lines, a new goal from words, a check-in', async () => {
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
    await pg.click('.gx-card.due .gx-card-foot .btn.primary')
    await pg.fill('.gx-check input', '2900')
    await pg.click('.gx-check .btn.primary')
    await pg.waitForFunction(() => [...document.querySelectorAll('.gx-card .gx-now b')].some((b) => /2,900/.test(b.textContent ?? '')), null, { timeout: 8000 })
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
    if (!(await pg.locator('.lf-panel input[type="checkbox"]').isChecked())) await pg.locator('.lf-panel input[type="checkbox"]').check()
    await pg.waitForSelector('.lf-panel .lf-days', { timeout: 5000 })
    await pg.click('.lf-push button:has(b:text-is("Firm"))')
    await pg.waitForSelector('.lf-push button.on:has(b:text-is("Firm"))', { timeout: 5000 })
    await pg.click('.lf-push button:has(b:text-is("Push"))')
    await pg.waitForSelector('.lf-push button.on:has(b:text-is("Push"))', { timeout: 5000 })
    if (shots) {
      await pg.waitForTimeout(500)
      await pg.locator('.lf-panel').screenshot({ path: `${shots}/settings-my-life.png` })
    }
    await pg.locator('.st-item', { hasText: 'Sound' }).first().click()
    await pg.waitForFunction(() => document.querySelector('.st-head h1')?.textContent === 'Sound', null, { timeout: 5000 })
    const n = await pg.locator('.sx-moment').count()
    if (n !== 11) throw new Error(`${n} sound rows, want 11`)
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
    const t = Date.now()
    await ip.evaluate((t) => window.__setSnap({ running: { subject: 'Essay', startedAt: t - 60_000, endsAt: t + 600_000 }, next: { title: 'Dentist', start: t + 5 * 60_000, end: t + 3600_000 }, ben: { ...window.__island.snap.ben, busy: false, unread: 1 } }), t)
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
      await ip.click('.di-shape', { position: { x: 24, y: 14 } })
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
    await ip.waitForSelector('.di-week3', { timeout: 3000 })
    if (!/Parked: Read 4 books/.test(await ip.locator('.di-week3').innerText())) throw new Error('no parked line on the Day page')
    await ip.click('[data-tap="shift:short"]')
    await ip.waitForFunction(() => window.__island.actions.some((a) => a.kind === 'shift' && a.mode === 'short'), null, { timeout: 3000 })
    if (process.env.LIFEFIT_SHOTS) {
      await ip.locator('.di-week3').scrollIntoViewIfNeeded()
      await ip.waitForTimeout(500)
      await ip.locator('.di-panel').screenshot({ path: `${process.env.LIFEFIT_SHOTS}/island-day-top3.png` })
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
          const items = [...pill.children].filter(shown).map((e) => e.className.baseVal ?? e.className)
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
      const t = Date.now()
      await ip.evaluate((t) => window.__setSnap({ running: { subject: 'Made-up focus', startedAt: t - 60_000, endsAt: t + 600_000 }, next: { title: 'Made-up class', start: t + 8 * 60_000, end: t + 3600_000 } }), t)
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
  // The same switch on every long page: each tab about one laptop screen.
  await step('Long pages: Insights, Goals, Money, Discipline, Music, Rewards and long Settings sections fit by tabs', async () => {
    await pg.setViewportSize({ width: 1280, height: 720 })
    const report = []
    const pages = [
      ['progress', '.pg', ['week', 'areas', 'streaks', 'focus', 'look'], { week: 2.2 }],
      ['goals', '.gx', ['goals', 'hours', 'path'], { goals: 2.6 }],
      ['money', '.mh', ['today', 'month', 'goals'], {}],
      ['discipline', '.discipline', ['today', 'milestones', 'history'], {}],
      ['music', '.mup', ['player', 'library', 'options'], {}],
      ['shop', '.rx', ['now', 'saving', 'all', 'history', 'earn'], { all: 2 }]
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
    for (const [sec, name, ids] of [['look', 'Look', ['look', 'today']], ['ben', 'Ben', ['life', 'brain', 'talk', 'notes']], ['connections', 'Connections', ['accounts', 'bots', 'telegram']], ['widgets', 'Widgets', ['gallery', 'pages', 'look']], ['ai-apps', 'Connect an AI app', ['connect', 'how']], ['automation', 'PC & automation', ['push', 'n8n', 'hooks', 'auto', 'mcp']]]) {
      await pg.locator('.st-item', { hasText: name }).first().click()
      await pg.waitForFunction((n) => document.querySelector('.st-head h1')?.textContent === n, name, { timeout: 5000 })
      await pg.waitForSelector(`.st-tabs .ptabs [data-tab="${ids[0]}"]`, { timeout: 8000 })
      const sizes = []
      // (the Telegram bots card and the Today screen card are one long card each)
      const oneCard = { 'connections.telegram': 3.8, 'look.today': 2.4 }
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
