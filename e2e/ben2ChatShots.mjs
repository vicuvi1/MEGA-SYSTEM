// Screenshots of Ben's chat tools on made-up data (not part of the smoke test):
//   npm run build:web && BEN2_CHAT_SHOTS=<dir> node e2e/ben2ChatShots.mjs
// Answer chips, chat search, the pinned strip, a link turned into tasks, the
// money coach, an email draft, 👍/👎 with a reason and the weekly misses, the
// offline chip, the cost line and the budget setting, Telegram plan buttons
// (drawn as a mock message) and push-to-talk on the island.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.BEN2_CHAT_SHOTS || join(repo, 'ben2-chat-shots')
mkdirSync(out, { recursive: true })
const at = new Date().setHours(10, 0, 0, 0)
const iso = (minAgo) => new Date(at - minAgo * 60_000).toISOString()
const port = 6300 + Math.floor(Math.random() * 300)
const server = spawn(process.execPath, [join(repo, 'e2e/server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, E2E_NOW: String(at) } })
await new Promise((ok, no) => {
  server.stdout.on('data', (d) => String(d).includes('e2e server') && ok())
  setTimeout(() => no(new Error('e2e server did not start')), 15000)
})
const sql = (q) => fetch(`http://127.0.0.1:${port}/api/_e2e`, { method: 'POST', body: JSON.stringify({ op: 'sql', sql: q }) }).then((r) => r.json())
const put = (key, v) => sql(`INSERT OR REPLACE INTO settings (key, value) VALUES ('${key}', '${JSON.stringify(v).replace(/'/g, "''")}')`)

// ---- made-up chat ----
const me = (min, text) => ({ role: 'me', bot: 'mega', via: 'app', text, at: iso(min) })
const ben = (min, text, extra = {}) => ({ role: 'coach', bot: 'mega', via: 'app', text, at: iso(min), mood: 'chill', ...extra })
const long = "Honestly, the week was better than it felt. You did 9 hours of focus against 10, all 4 workouts, and 15 of 21 must-dos. The slip is mornings: you were up on time 3 days out of 7, and on the late days the first block moved to the afternoon and never happened. For next week, keep one rule: the first block starts within 30 minutes of waking, even if it's only 25 minutes. Everything else can stay as it is."
const draft = "Subject: Missed lab on Monday\n\nDear Ms Popa,\n\nI'm sorry I missed Monday's networking lab; I was ill and stayed home. Could I make it up during Thursday's open lab, or is there another time that works for you?\n\nI have already read the lab sheet and can send the pre-lab answers today.\n\nKind regards,\nVictor"
const money = '🟢 Yes, headphones for 600 lei fits.\n• Budget left this month: 2,000 lei of 6,000 lei (16 days left, 125 lei a day).\n• Fun budget: 1,100 lei left of 1,500 lei.\n• Savings rate (last 3 months): 20% of income, about 2,000 lei a month.\n• It fits the fun budget: 500 lei would be left.\n• Goal "New laptop": 3 months away now, 3.3 months after this buy (+9 days).'
const log = [
  me(300, 'How was my week, honestly?'),
  ben(299, long, { chips: ['Think harder'] }),
  me(200, 'make tasks from this https://example.edu/course/networking/week-3'),
  ben(199, 'Done: 3 tasks from that page, each with the date it gives. The quiz is the one to start first.', { done: ['📝 Task: Read chapter 4 · Friday', '📝 Task: Submit lab 2 · Thursday', '📝 Task: Revise for the quiz · Monday'], undo: [{ op: 'demo' }, { op: 'demo' }, { op: 'demo' }] }),
  me(120, 'can I buy headphones for 600 lei'),
  ben(119, money, { chips: ['Log it when I buy'] }),
  me(60, "write an email to my teacher about missing Monday's lab"),
  ben(59, draft),
  me(20, 'Plan my day'),
  ben(19, "Here's today's plan, starting 10:05: 3 blocks, 2h 40m of focus, 3 must-dos. Look it over, then approve it or tell me what to change.", { show: ['plan'] })
]
const meta = {
  [iso(299)]: { model: 'deepseek-v4.1-pro', calls: 2, tokens: 6400, cost: 0.0021 },
  [iso(199)]: { model: 'deepseek-v4.1-flash', calls: 1, tokens: 4100, cost: 0.0006 },
  [iso(119)]: { model: 'answered in code', calls: 0, tokens: 0, cost: 0, code: true },
  [iso(59)]: { model: 'deepseek-v4.1-flash', calls: 1, tokens: 3300, cost: 0.0005 },
  [iso(19)]: { model: 'answered in code', calls: 0, tokens: 0, cost: 0, code: true }
}
const feedback = [
  { at: iso(60 * 24 * 2), kind: 'down', reason: 'long', text: 'A long answer about how to plan the study week with every block explained.' },
  { at: iso(60 * 24 * 3), kind: 'down', reason: 'notdone', text: 'Sure, I can move the gym to the evening for you.' },
  { at: iso(60 * 24 * 4), kind: 'long', text: 'Here is a detailed look at your sleep this week, night by night.' },
  { at: iso(60 * 24 * 1), kind: 'up', text: 'Water 1.2 of 2.5 L. Two glasses before lunch.' }
]
const pins = [
  { at: iso(119), role: 'coach', text: money, pinnedAt: iso(100) },
  { at: iso(59), role: 'coach', text: draft, pinnedAt: iso(50) }
]
await put('coach_log', log)
await put('coach_answer_meta', meta)
await put('coach_feedback', feedback)
await put('coach_pins', pins)

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
const shots = []
const shot = async (target, name, opts = {}) => {
  const path = join(out, `${name}.png`)
  await target.screenshot({ path, ...opts })
  shots.push(path)
}
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1300 }, deviceScaleFactor: 1 })
  await ctx.clock.install({ time: at })
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('ls.ui', JSON.stringify({ notif: { popups: false } }))
      localStorage.setItem('ls.coachSide2', '1')
      localStorage.setItem('ls.coachPinsOpen', '0')
    } catch {}
  })
  const pg = await ctx.newPage()
  await pg.route(/api\.telegram\.org|fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '{}' }))
  await pg.goto(`http://127.0.0.1:${port}/`)
  await pg.waitForSelector('input', { timeout: 20000 })
  await pg.fill('input', '1234')
  await pg.keyboard.press('Enter')
  await pg.waitForSelector('main.content', { timeout: 20000 })
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'coach' })))
  await pg.waitForSelector('.cf-col .cf-row', { timeout: 15000 })
  if (await pg.locator('button', { hasText: 'Show the chat' }).count()) await pg.locator('button', { hasText: 'Show the chat' }).first().click()
  await pg.waitForTimeout(1500)
  const row = (text) => pg.locator('.cf-row.ben', { hasText: text }).last()

  // CH2: chips by answer type (a quick answer to a big question; the plan).
  await row('better than it felt').scrollIntoViewIfNeeded()
  await pg.waitForTimeout(400)
  await shot(row('better than it felt'), '01-answer-chips-long-answer')
  await row("Here's today's plan").scrollIntoViewIfNeeded()
  await pg.waitForTimeout(600)
  await row("Here's today's plan").locator('.ak-bar').scrollIntoViewIfNeeded()
  await pg.waitForTimeout(300)
  await shot(row("Here's today's plan").locator('.ak-bar'), '01b-answer-chips-plan')

  // TL4: a link turned into tasks.
  await row('3 tasks from that page').scrollIntoViewIfNeeded()
  await pg.waitForTimeout(300)
  const linkMe = pg.locator('.cf-row.me', { hasText: 'example.edu' }).last()
  const box1 = await linkMe.boundingBox()
  const box2 = await row('3 tasks from that page').boundingBox()
  await shot(pg, '04-link-turned-into-tasks', { clip: { x: Math.min(box1.x, box2.x) - 8, y: box1.y - 8, width: 900, height: box2.y + box2.height - box1.y + 16 } })

  // TL6: the money coach.
  await row('headphones for 600 lei fits').scrollIntoViewIfNeeded()
  await pg.waitForTimeout(300)
  await shot(row('headphones for 600 lei fits'), '05-money-coach')

  // TL8: the email draft card.
  await row('Missed lab on Monday').scrollIntoViewIfNeeded()
  await pg.waitForTimeout(300)
  await shot(row('Missed lab on Monday'), '06-email-draft')

  // QA4: the cost line on hover.
  await row('better than it felt').scrollIntoViewIfNeeded()
  await row('better than it felt').hover()
  await pg.waitForTimeout(400)
  await shot(row('better than it felt'), '11-cost-line-on-hover')

  // QA2: 👎 with a reason, and the side panel's weekly list.
  await row('Missed lab on Monday').scrollIntoViewIfNeeded()
  await row('Missed lab on Monday').locator('.ak-rate button[title="Not good"]').click()
  await pg.waitForSelector('.ak-why', { timeout: 4000 })
  await pg.waitForTimeout(300)
  await shot(row('Missed lab on Monday').locator('.ak-bar'), '09-thumbs-down-with-reason')
  await row('Missed lab on Monday').locator('.ak-why button', { hasText: 'Too long' }).click()
  await pg.waitForTimeout(300)
  await shot(row('Missed lab on Monday').locator('.ak-bar'), '09b-reason-noted')
  if (await pg.locator('.ak-misses').count()) await shot(pg.locator('.ak-misses'), '09c-what-ben-got-wrong-this-week')

  // CH4: the pinned strip, open.
  await pg.locator('.ak-pins-head').click()
  await pg.waitForTimeout(300)
  await shot(pg.locator('.ak-pins'), '03-pinned-strip')
  await pg.locator('.ak-pins-head').click()

  // CH3: search with highlighted hits.
  await pg.locator('.cf-head-tools .icon-btn', { hasText: '⋯' }).click()
  await pg.locator('.cf-menu button', { hasText: 'Search the chat' }).click()
  await pg.fill('.ak-search input', 'lab')
  await pg.waitForSelector('.ak-hits li', { timeout: 4000 })
  await pg.waitForTimeout(300)
  await shot(pg, '02-search-results', { clip: { x: 0, y: 0, width: 1440, height: 520 } })
  await pg.locator('.ak-hits li button').first().click()
  await pg.waitForTimeout(800)
  await pg.locator('.ak-search .icon-btn[aria-label="Close search"]').click()

  // QA3: offline → basic mode; "water 500" is still logged at once.
  await ctx.setOffline(true)
  await pg.waitForSelector('.ak-basic', { timeout: 5000 })
  await pg.fill('.cf-input textarea', 'water 500')
  await pg.keyboard.press('Enter')
  await pg.waitForSelector('.cf-basic-note', { timeout: 8000 })
  await pg.fill('.cf-input textarea', 'how should I split the essay into parts?')
  await pg.keyboard.press('Enter')
  await pg.waitForTimeout(800)
  await shot(pg, '10-offline-basic-mode', { clip: { x: 260, y: 640, width: 1180, height: 660 } })
  await ctx.setOffline(false)

  // QA4: the budget in Settings → Ben's brain.
  await pg.evaluate(() => {
    localStorage.setItem('ls.settingsTab', 'ben')
    window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'settings' }))
  })
  await pg.waitForTimeout(1200)
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('life-settings-tab', { detail: 'ben' })))
  await pg.waitForTimeout(800)
  const brainTab = pg.locator('[role="tab"]', { hasText: /brain/i })
  if (await brainTab.count()) await brainTab.first().click()
  await pg.waitForSelector('.brain-budget', { timeout: 10000 })
  await pg.locator('.brain-budget').scrollIntoViewIfNeeded()
  await pg.waitForTimeout(400)
  await shot(pg.locator('.brain-budget'), '11b-monthly-budget-setting')
  await ctx.close()

  // TV1: Telegram plan buttons (the real message text and keyboard, drawn as a mock chat).
  const dir = await mkdtemp(join(tmpdir(), 'ben2c-'))
  const entry = join(dir, 'entry.ts')
  await writeFile(entry, `export { planKeyboard, receiptLine, withReceipt } from ${JSON.stringify(join(repo, 'src/core/tgPlan.ts'))}\nexport { proposalText } from ${JSON.stringify(join(repo, 'src/core/rhythm.ts'))}\n`)
  const { build } = await import('rolldown')
  const b = await build({ input: entry, write: false, output: { format: 'esm' }, resolve: { alias: { '@core': join(repo, 'src/core') } } })
  await writeFile(join(dir, 't.mjs'), b.output[0].code)
  const T = await import(pathToFileURL(join(dir, 't.mjs')).href)
  await rm(dir, { recursive: true, force: true })
  const plan = { day: '2026-11-07', headline: 'Essay first, lab after lunch', mustdos: ['Essay intro', 'Lab 2 report', 'Call the dentist'], blocks: [{ title: 'Deep work: essay intro', start: '10:05', minutes: 60 }, { title: 'Lab 2 report', start: '14:00', minutes: 50 }, { title: 'Rust chapter 4', start: '16:30', minutes: 45 }], training: { time: '18:30', what: 'Gym · 45 min' }, waterMl: 2500, why: 'Your best focus is before noon, so the hardest thing goes first.' }
  const text = T.withReceipt(T.proposalText(plan), T.receiptLine({ op: 'move', i: 1, delta: 30 }, { title: 'Lab 2 report', start: '13:30' }))
  const kb = T.planKeyboard(plan, { marks: { 0: 'done' } })
  const tp = await (await browser.newContext({ viewport: { width: 520, height: 900 }, deviceScaleFactor: 1.5 })).newPage()
  const esc = (s) => s.replace(/&(?!amp;|lt;|gt;)/g, '&amp;')
  await tp.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0;background:#0e1621;font:15px/1.4 -apple-system,'Segoe UI',Roboto,sans-serif;color:#f5f5f5}
    .top{display:flex;gap:10px;align-items:center;padding:10px 14px;background:#17212b}.av{width:38px;height:38px;border-radius:50%;background:#c8f560;color:#111;display:grid;place-items:center;font-weight:700}
    .top small{display:block;color:#6d7f8f}.wrap{padding:14px}.msg{background:#182533;border-radius:12px 12px 12px 4px;padding:9px 12px;white-space:pre-wrap;max-width:430px}
    .kb{display:grid;gap:4px;margin-top:4px;max-width:454px}.row{display:flex;gap:4px}.row button{flex:1;background:#24384a;color:#fff;border:0;border-radius:6px;padding:8px 4px;font:inherit;font-size:13px}
  </style><div class="top"><div class="av">B</div><div><b>Ben</b><small>bot</small></div></div><div class="wrap"><div class="msg">${esc(text)}</div><div class="kb">${kb.inline_keyboard.map((r) => `<div class="row">${r.map((x) => `<button>${x.text}</button>`).join('')}</div>`).join('')}</div></div>`)
  await shot(tp, '07-telegram-plan-buttons', { fullPage: true })
  await tp.context().close()

  // TV3: hold to talk on the island (the 🎤 held: listening).
  const ip = await (await browser.newContext({ viewport: { width: 620, height: 640 } })).newPage()
  await ip.addInitScript(() => {
    const cbs = {}
    const on = (name) => (cb) => { cbs[name] = cb }
    const now = Date.now()
    const snap = { at: now, locked: false, ben: { face: '😎', mood: 'hyped', why: '', move: null, last: { text: 'Lab report first. 50 minutes, then a break.', at: new Date(now - 60000).toISOString() }, unread: 0, busy: false, steps: [] }, running: null, now: null, next: null, mustdos: [{ i: 0, text: 'Essay intro', done: true }, { i: 1, text: 'Lab 2 report', done: false }], water: { ml: 1250, target: 2500 }, reps: [], alert: null }
    window.__island = { send: (name, v) => cbs[name]?.(v), snap }
    window.desktop = new Proxy({ islandHot: () => {}, islandTakeClicks: () => {}, islandAction: () => {}, onIslandState: (cb) => { cbs.state = cb; setTimeout(() => cb(snap), 50) }, onIslandPrefs: (cb) => { cbs.prefs = cb; setTimeout(() => cb({ size: 'normal', mode: 'lively' }), 60) }, onIslandHover: on('hover'), onIslandQuiet: on('quiet'), onIslandToggle: on('toggle') }, { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) })
  })
  await ip.goto(`http://127.0.0.1:${port}/?island=1`)
  await ip.waitForTimeout(1500)
  await ip.evaluate(() => window.__island.send('toggle', true))
  await ip.waitForTimeout(800)
  // The 🎤 sits in the island's command bar ("/").
  await ip.keyboard.press('/')
  await ip.waitForSelector('.di-mic', { timeout: 5000 }).catch(() => null)
  const mic = ip.locator('.di-mic')
  if (await mic.count()) {
    const mb = await mic.boundingBox()
    await ip.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2)
    await ip.mouse.down()
    await ip.waitForTimeout(900)
    await shot(ip, '08-island-push-to-talk-held')
    await ip.mouse.up()
  } else await shot(ip, '08-island-push-to-talk-held')
  await ip.context().close()
} finally {
  await browser.close()
  server.kill()
}
console.log(shots.join('\n'))
