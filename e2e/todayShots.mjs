// Screenshots of Today → Now on made-up data (not part of the smoke test):
//   npm run build:web && TODAY_SHOTS=<dir> [TAG=after] node e2e/todayShots.mjs
// Dark and light, 1920×1080 and 1280×720 at 150 %: the Now tab as it opens,
// then with a Top 3 item and a habit ticked, and the habits as a grid.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.TODAY_SHOTS || join(repo, 'today-shots')
const tag0 = process.env.TAG || 'after'
mkdirSync(out, { recursive: true })
const at = new Date().setHours(Number(process.env.HOUR || 10), 0, 0, 0)
// A fresh made-up server for each picture set, so every set starts from the same day.
let server = null
const startServer = async () => {
  server?.kill()
  const port = 5900 + Math.floor(Math.random() * 400)
  server = spawn(process.execPath, [join(repo, 'e2e/server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, E2E_NOW: String(at) } })
  await new Promise((ok, no) => {
    server.stdout.on('data', (d) => String(d).includes('e2e server') && ok())
    setTimeout(() => no(new Error('e2e server did not start')), 15000)
  })
  return port
}
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
try {
  for (const [w, h, scale] of [[1920, 1080, 1], [1280, 720, 1.5]]) {
    for (const theme of ['dark', 'light']) {
      const port = await startServer()
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale })
      await ctx.clock.install({ time: at })
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem('ls.ui', JSON.stringify({ notif: { popups: false } }))
          localStorage.setItem('ls.tab.today', 'now')
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
      await pg.waitForTimeout(3500)
      const tag = `${tag0}-${w}x${h}-${theme}`
      await pg.screenshot({ path: join(out, `now-${tag}.png`) })
      if (tag0 === 'after') {
        // Add a Top 3 item, tick one (caught mid-check), then tick a habit.
        const slot = pg.locator('.t3-add input')
        if (await slot.count()) {
          await slot.fill('Send the lab report')
          await slot.press('Enter')
          await pg.waitForSelector('.t3 li.t3-item', { timeout: 15000 })
          await pg.waitForTimeout(600)
        }
        await pg.locator('.t3 li.t3-item:not(.done) .t3-check').first().click()
        await pg.waitForTimeout(260)
        await pg.screenshot({ path: join(out, `now-ticking-${tag}.png`) })
        await pg.locator('.hb-row:not(.auto):not(.s-done) .hb-hit').first().click()
        await pg.waitForTimeout(1800)
        await pg.screenshot({ path: join(out, `now-ticked-${tag}.png`) })
        // The compact grid view of the habits.
        await pg.click('.hb-more')
        await pg.locator('.hb-menu button', { hasText: 'Show as a grid' }).click()
        await pg.waitForTimeout(700)
        await pg.screenshot({ path: join(out, `now-grid-${tag}.png`) })
        await pg.click('.hb-more')
        await pg.locator('.hb-menu button', { hasText: 'Show as a list' }).click()
      }
      await ctx.close()
    }
  }
} finally {
  await browser.close()
  server?.kill()
}
console.log(`screenshots in ${out}`)
