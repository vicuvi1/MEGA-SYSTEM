// Screenshots of sleep care on made-up data (not part of the smoke test):
//   npm run build:web && CARE_SHOTS=<dir> node e2e/careShots.mjs
// The Sleep page (sleep debt meter, nap guard, light and caffeine), the
// Grooming habit on Today and its checklist, and the island cards: morning
// light, the caffeine curfew, the after-shift wind-down (dim and warm), the
// 60-second desk drill and the eye break. The made-up data comes from the
// e2e server (E2E_CARE_DEMO); the island's cards are what the app window's
// chain makes (core/sleepCare.ts, afterShift.ts, deskMobility.ts, eyeCare.ts).
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.CARE_SHOTS || join(repo, 'care-shots')
mkdirSync(out, { recursive: true })
const today = (hm) => {
  const d = new Date()
  const [h, m] = hm.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}
const port = 6300 + Math.floor(Math.random() * 300)
const server = spawn(process.execPath, [join(repo, 'e2e/server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, E2E_NOW: String(today('11:00')), E2E_CARE_DEMO: '1' } })
await new Promise((ok, no) => {
  server.stdout.on('data', (d) => String(d).includes('e2e server') && ok())
  setTimeout(() => no(new Error('e2e server did not start')), 15000)
})
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const shots = []
const shot = async (el, name) => {
  const path = join(out, `${name}.png`)
  await el.screenshot({ path })
  shots.push(path)
}

try {
  // ---- the app: Sleep page and Today's Grooming ----
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
  await ctx.clock.install({ time: today('11:00') })
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('ls.ui', JSON.stringify({ notif: { popups: false } }))
    } catch {}
  })
  const pg = await ctx.newPage()
  await pg.route(/api\.telegram\.org|fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '{}' }))
  await pg.goto(`http://127.0.0.1:${port}/`)
  await pg.waitForSelector('input', { timeout: 20000 })
  await pg.fill('input', '1234')
  await pg.keyboard.press('Enter')
  await pg.waitForSelector('.td2', { timeout: 20000 })
  await pg.evaluate(() => (document.documentElement.dataset.theme = 'dark'))

  // Grooming: the tile, then its checklist.
  await pg.click('.td2 .ptabs [data-tab="now"]').catch(() => {})
  const tile = pg.locator('.hb-row[data-hb-id="skincare"]')
  await tile.waitFor({ timeout: 15000 })
  await pg.waitForFunction(() => /steps/.test(document.querySelector('.hb-row[data-hb-id="skincare"] .hb-meta')?.textContent ?? ''), null, { timeout: 10000 })
  await shot(pg.locator('.hb').first(), 'grooming-habit-tile')
  await tile.locator('.hb-hit').click()
  await pg.waitForSelector('.gr .gr-step', { timeout: 10000 })
  await pg.locator('.gr-step', { hasText: 'Hair / beard' }).click()
  await pg.waitForFunction(() => document.querySelectorAll('.gr-step.on').length >= 4, null, { timeout: 5000 })
  await pg.waitForTimeout(300)
  await shot(pg.locator('.hb-sheet'), 'grooming-checklist')
  await pg.keyboard.press('Escape')

  // Sleep: the system view (debt meter, nap guard, light and caffeine).
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'sleep' })))
  await pg.locator('.seg-switch [role="tab"]', { hasText: 'Points & stats' }).click({ timeout: 15000 })
  await pg.waitForSelector('.sc-debt', { timeout: 15000 }).catch(async (e) => {
    await pg.screenshot({ path: join(out, 'debug-sleep.png') })
    throw e
  })
  await pg.waitForTimeout(600)
  await shot(pg.locator('.sc'), 'sleep-debt-meter')
  // The caffeine curfew passed: the same panel at 15:10 after a late coffee.
  await ctx.clock.setSystemTime(today('15:10'))
  await pg.locator('.sc-day button', { hasText: 'Coffee now' }).click()
  await pg.waitForFunction(() => /after the curfew/.test(document.querySelector('.sc-day')?.textContent ?? ''), null, { timeout: 8000 })
  await pg.waitForTimeout(400)
  await shot(pg.locator('.sc-day'), 'caffeine-curfew-sleep-page')
  await ctx.close()

  // ---- the island: cards from a stand-in desktop bridge ----
  const ictx = await browser.newContext({ viewport: { width: 560, height: 520 }, deviceScaleFactor: 2 })
  const ip = await ictx.newPage()
  await ip.addInitScript(() => {
    const cbs = {}
    const on = (name) => (cb) => {
      cbs[name] = cb
    }
    const now = Date.now()
    const snap = {
      at: now,
      locked: false,
      ben: { face: '🙂', mood: 'chill', why: '', move: null, last: null, unread: 0, busy: false, steps: [] },
      running: null,
      now: null,
      next: null,
      mustdos: [],
      water: { ml: 1250, target: 2500 },
      reps: [],
      alert: null
    }
    window.__island = { actions: [], send: (name, v) => cbs[name]?.(v), snap }
    window.desktop = new Proxy(
      {
        islandHot: () => {},
        islandTakeClicks: () => {},
        islandAction: (a) => window.__island.actions.push(a),
        setIslandPrefs: async () => null,
        onIslandState: (cb) => {
          cbs.state = cb
          setTimeout(() => cb(snap), 50)
        },
        onIslandHover: on('hover'),
        onIslandPrefs: on('prefs'),
        onIslandQuiet: on('quiet'),
        onIslandToggle: on('toggle')
      },
      { get: (t, k) => (k in t ? t[k] : typeof k === 'string' && /^(on|island|show)/.test(k) ? () => {} : undefined) }
    )
  })
  await ip.goto(`http://127.0.0.1:${port}/?island=1`)
  await ip.waitForSelector('.di-pill', { timeout: 15000 })
  await ip.evaluate(() => window.__island.send('prefs', { size: 'normal', gapMin: 0 }))
  await ip.waitForTimeout(300)
  const card = async (extra, name, wait) => {
    for (let i = 0; ; i++) {
      await ip.evaluate((x) => window.__island.send('state', { ...window.__island.snap, at: Date.now(), ...x }), extra)
      if (await ip.waitForSelector(wait ?? '.di-peek.alert', { timeout: 2500 }).then(() => true, () => false)) break
      if (i >= 3) throw new Error(`the island never showed ${wait}`)
    }
    await ip.waitForTimeout(700)
    await shot(ip.locator('.di'), name)
  }
  const care = (op, id) => ({ kind: 'care', op, alertId: id })
  // Morning light (07:05, a cloudy morning: 15 min).
  await card(
    {
      alert: {
        id: 'light:demo',
        kind: 'morning',
        title: 'Morning light · 15 min outside',
        text: "It's a cloudy morning, so 15 min today. Daylight in your eyes now sets tonight's sleep: you fall asleep faster and wake up sharper. No sunglasses, a window doesn't count.",
        face: '☀️',
        actions: [
          { label: '✓ I got my light', action: care({ op: 'light' }, 'light:demo'), primary: true },
          { label: 'In 30 min', action: { kind: 'dismiss', id: 'light:demo', snoozeMin: 30 } },
          { label: 'Not today', action: { kind: 'dismiss', id: 'light:demo', snoozeMin: 720 } }
        ]
      }
    },
    'island-morning-light'
  )
  // The caffeine curfew (14:05, two coffees today).
  await card(
    {
      alert: {
        id: 'caffeine:curfew:demo',
        kind: 'suggest',
        title: 'Caffeine curfew · 14:00',
        text: 'No more coffee today: bed at 23:30. 2 today, last at 12:40.',
        face: '☕',
        actions: [{ label: 'Got it', action: { kind: 'dismiss', id: 'caffeine:curfew:demo', snoozeMin: 1440 }, primary: true }]
      }
    },
    'island-caffeine-curfew'
  )
  // After the shift (00:06): dim, warm, the checklist.
  await card(
    {
      afterShift: { minutesLeft: 14, lightsOut: '00:20' },
      windMode: { phase: 'wind', minutes: 14, bedAt: '00:20', title: 'After the shift · lights out 00:20', line: 'Teeth, skin, alarm, phone away. No new tabs.', music: true },
      alert: {
        id: 'aftershift:demo',
        kind: 'winddown',
        title: 'After the shift · lights out 00:20',
        text: '14 min: screens dim, 2 left. No new tabs.',
        face: '🌙',
        actions: [
          { label: '🌙 Going to bed', action: { kind: 'bed' } },
          { label: 'Later', action: { kind: 'dismiss', id: 'aftershift:demo', snoozeMin: 10 } }
        ],
        nudge: { type: 'checklist', kind: 'bed', minutesLeft: 14, lightsOut: '00:20', steps: [{ id: 'teeth', label: 'Teeth', done: true }, { id: 'skin', label: 'Skin', done: true }, { id: 'alarm', label: 'Alarm set', done: false }, { id: 'phone', label: 'Phone away', done: false }] }
      }
    },
    'island-after-shift-wind-down',
    '.nd-check'
  )
  // The desk drill: the offer, then 20 s in (the doorway chest stretch).
  const drill = {
    afterShift: null,
    windMode: null,
    alert: { id: 'posture:demo', kind: 'move', title: 'Desk mobility · 60 s', text: 'Long sit: chin tucks, chest, hips, wall angels. Follow the figure.', face: '🧍', actions: [], nudge: { type: 'drill', kind: 'posture', seconds: 60 } }
  }
  await card(drill, 'island-desk-drill-offer', '.dr-strip')
  await ip.locator('.dr .primary').click()
  await ip.waitForSelector('.dr-run', { timeout: 5000 })
  await ip.waitForTimeout(19500)
  await shot(ip.locator('.di'), 'island-desk-drill-running')
  // The eye break: blink and look far, scaled to 6h40 on screens today; then its pill blinking.
  await card(
    {
      alert: {
        id: 'eyes:demo',
        kind: 'eyes',
        title: 'Eyes · blink and look far',
        text: '10 slow, full blinks, then look 6 m away for 20 s. 6h40 on screens today.',
        face: '👁️',
        actions: [],
        nudge: { type: 'timer', kind: 'eyes', seconds: 20, postponed: 0, snooze: [{ c: '10', label: '10 min' }, { c: '30', label: '30 min' }], tip: 'blink' }
      }
    },
    'island-eye-care',
    '.nd-timer'
  )
  await card(
    {
      alert: {
        id: 'eyes:demo2',
        kind: 'eyes',
        title: 'Eyes · warm screen now',
        text: 'The sun is down: turn on Night light (warm screen) so your eyes and your sleep get a break. 7h05 on screens today.',
        face: '👁️',
        actions: [],
        nudge: { type: 'timer', kind: 'eyes', seconds: 20, postponed: 0, snooze: [{ c: '10', label: '10 min' }, { c: '30', label: '30 min' }], tip: 'warm' }
      }
    },
    'island-eye-care-warm-screen',
    '.nd-timer'
  )
  await ip.locator('.nd-timer .primary').click()
  await ip.waitForSelector('.nd-eye', { timeout: 5000 })
  await ip.waitForTimeout(1250)
  await shot(ip.locator('.di'), 'island-eye-break-blink')
  await ictx.close()
} finally {
  await browser.close()
  server.kill()
}
console.log(shots.join('\n'))
