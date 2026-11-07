// Screenshots of the Season page on made-up data (not part of the smoke test):
//   npm run build:web && SAGA_SHOTS=<dir> node e2e/sagaShots.mjs
// Dark and light, 1920×1080 and 1280×720 at 150 %: the season with its boss,
// the season intro, the vision board, the side quest and adventures map,
// identity votes, the level-up cinematic (three frames), Ben's chapter
// unlock and path, the wins wall and the life wheel.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.SAGA_SHOTS || join(repo, 'saga-shots')
mkdirSync(out, { recursive: true })
const only = process.env.SAGA_ONLY ? process.env.SAGA_ONLY.split(',') : null
const want = (name) => !only || only.some((o) => name.includes(o))

/** Freezes every running animation on the page at `ms` from its start (delays included). */
const freezeAt = (pg, ms) => pg.evaluate((t) => document.getAnimations().forEach((a) => { a.currentTime = t; a.pause() }), ms)
const settle = (pg) => pg.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish() } catch { /* endless ones */ } }))

const run = async ([w, h, scale]) => {
  const port = 6300 + Math.floor(Math.random() * 400)
  const server = spawn(process.execPath, [join(repo, 'e2e/server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, E2E_NOW: String(new Date().setHours(10, 0, 0, 0)), E2E_SAGA_DEMO: '1' } })
  await new Promise((ok, no) => {
    server.stdout.on('data', (d) => String(d).includes('e2e server') && ok())
    setTimeout(() => no(new Error('e2e server did not start')), 15000)
  })
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  try {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale })
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('ls.ui', JSON.stringify({ notif: { popups: false }, layoutV: 7 }))
        localStorage.setItem('ls.tab.season', 'season')
      } catch {}
    })
    const pg = await ctx.newPage()
    pg.on('pageerror', (e) => console.log('page error:', e.message))
    await pg.route(/api\.telegram\.org|fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '{}' }))
    await pg.goto(`http://127.0.0.1:${port}/`)
    await pg.waitForSelector('input', { timeout: 20000 })
    await pg.fill('input', '1234')
    await pg.keyboard.press('Enter')
    await pg.waitForSelector('.td2', { timeout: 20000 })
    await pg.evaluate(() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'season' })))
    await pg.waitForSelector('.sg-hero', { timeout: 15000 })
    const tag0 = `${w}x${h}`
    const shot = async (name, theme) => {
      if (!want(name)) return
      await pg.screenshot({ path: join(out, `${name}-${tag0}-${theme}.png`) })
    }
    const both = async (name, before) => {
      for (const theme of ['dark', 'light']) {
        await pg.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
        if (before) await before()
        await pg.waitForTimeout(450)
        await settle(pg)
        await shot(name, theme)
      }
    }
    const tab = async (id, sel) => {
      await pg.click(`.sg .ptabs [data-tab="${id}"]`)
      await pg.waitForFunction((t) => document.querySelector(`.sg .ptabs [data-tab="${t}"]`)?.getAttribute('aria-selected') === 'true', id, { timeout: 5000 })
      if (sel) await pg.waitForSelector(sel, { state: 'visible', timeout: 8000 })
      await pg.evaluate(() => document.querySelector('.content')?.scrollTo(0, 0))
    }

    // Ben's chapter unlock: the demo has a chapter he hasn't seen, so the page opens with the reveal.
    const reveal = await pg.waitForSelector('.cn-reveal', { timeout: 4000 }).catch(() => null)
    if (reveal) {
      await pg.waitForTimeout(500)
      await both('ben-unlock')
      await pg.keyboard.press('Escape')
      await pg.waitForSelector('.cn-arc', { state: 'detached', timeout: 4000 })
    }
    await pg.waitForTimeout(800)

    await both('season')
    // Ben's path (no reveal now).
    await pg.click('.sg-arc-card')
    await pg.waitForSelector('.cn-chapters', { timeout: 5000 })
    await both('ben-path')
    await pg.keyboard.press('Escape')
    await pg.waitForSelector('.cn-arc', { state: 'detached', timeout: 4000 })

    // The season intro, its end frame.
    for (const theme of ['dark', 'light']) {
      await pg.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
      await pg.click('.sg-hero-actions .btn')
      await pg.waitForSelector('.cn-intro', { timeout: 5000 })
      await pg.waitForTimeout(300)
      await freezeAt(pg, 2200)
      await shot('intro-title', theme)
      await freezeAt(pg, 9000)
      await shot('intro', theme)
      await pg.keyboard.press('Escape')
      await pg.waitForSelector('.cn-intro', { state: 'detached', timeout: 4000 })
    }

    // The level-up cinematic: the blade, the flash, the title.
    for (const theme of ['dark', 'light']) {
      await pg.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
      await pg.evaluate(() => window.dispatchEvent(new CustomEvent('life-cinematic', { detail: { id: 'demo', kind: 'rank', over: 'New rank · Level 22', title: 'Shadow Vanguard', sub: 'B-Rank Hunter', color: '#38d8ff', badge: '🗡️' } })))
      await pg.waitForSelector('.cn-level', { timeout: 5000 })
      for (const [n, ms] of [[1, 820], [2, 1330], [3, 3200]]) {
        await freezeAt(pg, ms)
        await shot(`cinematic-${n}`, theme)
      }
      await pg.evaluate(() => document.getAnimations().forEach((a) => a.play()))
      await pg.keyboard.press('Escape')
      await pg.waitForSelector('.cn-level', { state: 'detached', timeout: 6000 })
    }
    // A season moment cinematic (boss defeated).
    await pg.evaluate((t) => (document.documentElement.dataset.theme = t), 'dark')
    await pg.evaluate(() => window.dispatchEvent(new CustomEvent('life-cinematic', { detail: { id: 'demo2', kind: 'boss-won', over: 'Victory', title: 'Boss defeated', sub: 'Weekend CTF: finish in the top half', color: '#ff3ea5', badge: '🏆' } })))
    await pg.waitForSelector('.cn-level', { timeout: 5000 })
    await freezeAt(pg, 3200)
    await shot('cinematic-boss', 'dark')
    await pg.evaluate(() => document.getAnimations().forEach((a) => a.play()))
    await pg.keyboard.press('Escape')
    await pg.waitForSelector('.cn-level', { state: 'detached', timeout: 6000 })

    await tab('vision', '.sg-vcard')
    await both('vision')
    await tab('identity', '.sg-id')
    await both('identity')
    await tab('wins', '.sg-win')
    await both('wins')
    await tab('adventures', '.sg-side')
    await both('side-quest')
    await tab('wheel', '.sg-wheel')
    await both('life-wheel')
    await tab('season', '.sg-hero')
    await ctx.close()
  } finally {
    await browser.close()
    server.kill()
  }
}
for (const v of [[1920, 1080, 1], [1280, 720, 1.5]]) await run(v)
console.log(`screenshots in ${out}`)
