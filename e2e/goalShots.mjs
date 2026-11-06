// Screenshots of the Goals page on made-up data (not part of the smoke test):
//   npm run build:web && GOAL_SHOTS=<dir> node e2e/goalShots.mjs
// Dark and light, 1920×1080 and 1280×720 at 150 %: the page with goals of
// every kind, a goal's detail, the edit sheet with steps and its data source,
// a milestone celebration, and (E2E_NO_GOALS) the empty page.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.GOAL_SHOTS || join(repo, 'goal-shots')
mkdirSync(out, { recursive: true })
const run = async (empty) => {
  const port = 5900 + Math.floor(Math.random() * 400)
  const server = spawn(process.execPath, [join(repo, 'e2e/server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, E2E_NOW: String(new Date().setHours(10, 0, 0, 0)), ...(empty ? { E2E_NO_GOALS: '1' } : {}) } })
  await new Promise((ok, no) => {
    server.stdout.on('data', (d) => String(d).includes('e2e server') && ok())
    setTimeout(() => no(new Error('e2e server did not start')), 15000)
  })
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  try {
    for (const [w, h, scale] of [[1920, 1080, 1], [1280, 720, 1.5]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale })
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem('ls.ui', JSON.stringify({ notif: { popups: false } }))
          localStorage.setItem('ls.goalSound', '0')
          localStorage.setItem('ls.tab.goals', 'goals')
        } catch {}
      })
      const pg = await ctx.newPage()
      await pg.route(/api\.telegram\.org|fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '{}' }))
      await pg.goto(`http://127.0.0.1:${port}/`)
      await pg.waitForSelector('input', { timeout: 20000 })
      await pg.fill('input', '1234')
      await pg.keyboard.press('Enter')
      await pg.waitForSelector('.td2', { timeout: 20000 })
      await pg.evaluate(() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'goals' })))
      await pg.waitForSelector(empty ? '.gx-empty' : '.gx-card', { timeout: 15000 })
      for (const theme of ['dark', 'light']) {
        const tag = `${w}x${h}-${theme}`
        await pg.evaluate((t) => (document.documentElement.dataset.theme = t), theme)
        await pg.waitForTimeout(2200)
        if (empty) {
          await pg.screenshot({ path: join(out, `empty-${tag}.png`) })
          continue
        }
        await pg.screenshot({ path: join(out, `goals-${tag}.png`) })
        await pg.setViewportSize({ width: w, height: 2400 })
        await pg.waitForTimeout(500)
        await pg.screenshot({ path: join(out, `goals-full-${tag}.png`) })
        await pg.setViewportSize({ width: w, height: h })
        await pg.click('.gx .ptabs [data-tab="week"]')
        await pg.waitForTimeout(600)
        await pg.screenshot({ path: join(out, `week-${tag}.png`) })
        await pg.click('.gx .ptabs [data-tab="goals"]')
        // the detail of the project, then its edit sheet
        await pg.locator('.gx-card', { hasText: 'Security+' }).first().click({ position: { x: 30, y: 30 } })
        await pg.waitForSelector('.gx-detail', { timeout: 5000 })
        await pg.waitForTimeout(700)
        await pg.screenshot({ path: join(out, `detail-${tag}.png`) })
        await pg.click('.gx-detail .gx-sheet-foot .btn.primary')
        await pg.waitForSelector('.gx-edit', { timeout: 5000 })
        await pg.waitForTimeout(500)
        await pg.screenshot({ path: join(out, `edit-steps-${tag}.png`) })
        await pg.evaluate(() => document.querySelector('.gx-edit')?.scrollTo(0, 99999))
        await pg.waitForTimeout(300)
        await pg.screenshot({ path: join(out, `edit-look-${tag}.png`) })
        await pg.keyboard.press('Escape')
        await pg.waitForTimeout(200)
        if (await pg.$('.gx-detail')) await pg.keyboard.press('Escape')
        await pg.waitForTimeout(200)
        // the limit's edit sheet: its data source
        await pg.locator('.gx-card', { hasText: 'Gaming' }).first().locator('.gx-menu-btn').click()
        await pg.locator('.gx-menu-list button', { hasText: 'Edit' }).click()
        await pg.waitForSelector('.gx-edit', { timeout: 5000 })
        await pg.evaluate(() => document.querySelector('.gx-edit .gx-fsec:nth-of-type(2)')?.scrollIntoView())
        await pg.waitForTimeout(400)
        await pg.screenshot({ path: join(out, `edit-source-${tag}.png`) })
        await pg.keyboard.press('Escape')
        // a celebration: forget what this device saw for the project, so it reached 25 % "just now"
        await pg.evaluate(() => {
          const s = JSON.parse(localStorage.getItem('ls.goalSeen') || '{}')
          for (const k of Object.keys(s)) if (/^\d+$/.test(s[k])) s[k] = '0'
          localStorage.setItem('ls.goalSeen', JSON.stringify(s))
          window.dispatchEvent(new CustomEvent('life-goals-changed'))
        })
        await pg.waitForSelector('.gx-cel', { timeout: 8000 })
        await pg.waitForTimeout(480)
        // freeze the confetti mid-air for the picture (it is gone in under 2 s)
        await pg.evaluate(() => document.querySelectorAll('.gx-confetti i').forEach((i) => i.getAnimations().forEach((x) => ((x.currentTime = 360), x.pause()))))
        await pg.screenshot({ path: join(out, `celebration-${tag}.png`) })
        for (let i = 0; i < 6 && (await pg.$('.gx-cel')); i++) {
          await pg.keyboard.press('Escape')
          await pg.waitForTimeout(250)
        }
      }
      await ctx.close()
    }
  } finally {
    await browser.close()
    server.kill()
  }
}
await run(false)
await run(true)
console.log(`screenshots in ${out}`)
