// Screenshots of the Career page on made-up data (not part of the smoke test):
//   npm run build:web && CAREER_SHOTS=<dir> node e2e/careerShots.mjs
// Dark and light, 1920×1080 and 1280×720 at 150 %: the job board, a portfolio
// entry and its export, a flashcard review, the study kit and essay planner,
// the emergency fund and investing projection, the monthly letter, and the
// shift study kit on the desktop island.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.CAREER_SHOTS || join(repo, 'career-shots')
mkdirSync(out, { recursive: true })
const port = 5900 + Math.floor(Math.random() * 400)
// 19:30: tonight's (made-up) shift is on, so the study kit is live.
const server = spawn(process.execPath, [join(repo, 'e2e/server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, E2E_NOW: String(new Date().setHours(19, 30, 0, 0)), E2E_CAREER_DEMO: '1' } })
await new Promise((ok, no) => {
  server.stdout.on('data', (d) => String(d).includes('e2e server') && ok())
  setTimeout(() => no(new Error('e2e server did not start')), 15000)
})
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const shot = async (pg, name) => {
  await pg.waitForTimeout(450)
  await pg.screenshot({ path: join(out, `${name}.png`) })
  console.log(`  ${name}.png`)
}
try {
  for (const [w, h, scale] of [[1920, 1080, 1], [1280, 720, 1.5]]) {
    for (const theme of ['dark', 'light']) {
      const tag = `${w}x${h}-${theme}`
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, colorScheme: theme })
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem('ls.ui', JSON.stringify({ notif: { popups: false } }))
          localStorage.setItem('ls.tab.career', 'jobs')
        } catch {}
      })
      const pg = await ctx.newPage()
      await pg.route(/api\.telegram\.org|fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '{}' }))
      await pg.goto(`http://127.0.0.1:${port}/`)
      await pg.waitForSelector('input', { timeout: 20000 })
      await pg.fill('input', '1234')
      await pg.keyboard.press('Enter')
      await pg.waitForSelector('.td2', { timeout: 20000 })
      await pg.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
      await pg.evaluate(() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'career' })))
      await pg.waitForSelector('.cr .cr-board .cr-job', { timeout: 15000 })
      await pg.waitForTimeout(1200)
      const tab = async (id) => {
        await pg.click(`.cr .ptabs [data-tab="${id}"]`)
        await pg.waitForSelector(`.cr .ptabs [data-tab="${id}"][aria-selected="true"]`, { timeout: 5000 })
      }
      await shot(pg, `career-jobs-${tag}`)
      await tab('portfolio')
      await pg.waitForSelector('.cr-proof', { timeout: 5000 })
      await shot(pg, `career-portfolio-${tag}`)
      await pg.locator('.cr-exp-btns .btn', { hasText: 'Export markdown' }).click()
      await pg.waitForSelector('.cr-sheet .cr-md', { timeout: 5000 })
      await shot(pg, `career-portfolio-markdown-${tag}`)
      await pg.click('.cr-sheet header .cr-x')
      await pg.locator('.cr-exp-btns .btn', { hasText: 'Clean page' }).click()
      await pg.waitForSelector('.cr-sheet .cr-page-prev', { timeout: 5000 })
      await shot(pg, `career-portfolio-page-${tag}`)
      await pg.click('.cr-sheet header .cr-x')
      await tab('cards')
      await pg.waitForSelector('.cr-face', { timeout: 5000 })
      await pg.click('.cr-face')
      await pg.waitForSelector('.cr-grades', { timeout: 5000 })
      await shot(pg, `career-flashcards-${tag}`)
      await tab('study')
      await pg.waitForSelector('.cr-kit .cr-pack li', { timeout: 5000 })
      await shot(pg, `career-study-essays-${tag}`)
      await tab('money')
      await pg.waitForSelector('.cr-proj svg', { timeout: 5000 })
      await shot(pg, `career-money-${tag}`)
      await pg.evaluate(() => document.querySelector('.cr-invest')?.scrollIntoView({ block: 'center' }))
      await shot(pg, `career-investing-${tag}`)
      await pg.evaluate(() => window.scrollTo(0, 0))
      await tab('review')
      await pg.waitForSelector('.cr-letter ul li', { timeout: 5000 })
      await shot(pg, `career-letter-${tag}`)
      await pg.click('.cr .ptabs [data-tab="jobs"]')
      await ctx.close()
    }
  }
  // The desktop island (its own page, a stand-in desktop bridge) on the Study page, during the shift.
  for (const theme of ['dark', 'light']) {
    for (const [w, h, scale] of [[1920, 1080, 1], [1280, 720, 1.5]]) {
      const ctx = await browser.newContext({ viewport: { width: Math.round(w * 0.36), height: Math.round(h * 0.72) }, deviceScaleFactor: scale, colorScheme: theme })
      const ip = await ctx.newPage()
      await ip.addInitScript((theme) => {
        try {
          localStorage.setItem('ls.theme', theme)
        } catch {}
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
          now: { title: 'Evening shift', start: now - 2.5 * 3600_000, end: now + 4.5 * 3600_000 },
          next: null,
          mustdos: [{ i: 0, text: 'Send one application', done: true }],
          water: { ml: 1500, target: 2200 },
          reps: [],
          alert: null,
          work: { from: '17:00', to: '24:00', mode: 'normal' },
          study: {
            shift: true,
            due: 5,
            packsWeek: 3,
            pack: {
              minutes: 20,
              items: [
                { kind: 'cards', text: '5 flashcards due', minutes: 3 },
                { kind: 'essay', text: 'Write one paragraph of "Made-up essay: privacy in smart cities"', minutes: 10 },
                { kind: 'ctf', text: 'Try one hint: Practice CTF: a format string warm-up', minutes: 7 }
              ]
            },
            card: { id: 'dc1', front: 'Which port does SSH use?', back: '22', deck: 'Ports', left: 5, ivls: { again: '1d', hard: '4d', good: '8d', easy: '10d' } }
          }
        }
        window.__island = { send: (name, v) => cbs[name]?.(v), snap, actions: [] }
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
      }, theme)
      await ip.goto(`http://127.0.0.1:${port}/?island=1`)
      await ip.waitForSelector('.di-pill', { timeout: 15000 })
      await ip.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
      await ip.click('.di-pill')
      await ip.waitForSelector('.di-panel', { timeout: 5000 })
      await ip.locator('.ip-dots [role="tab"]', { hasText: 'Study' }).click()
      await ip.waitForSelector('.is-study .is-pack', { timeout: 5000 })
      await ip.click('.is-face')
      await ip.waitForSelector('.is-grades', { timeout: 5000 })
      await shot(ip, `island-study-${w}x${h}-${theme}`)
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  server.kill()
}
console.log(`screenshots in ${out}`)
