// Screenshots of Body → Progress on made-up data (not part of the smoke test):
//   npm run build:web && BODY_PROGRESS_SHOTS=<dir> node e2e/bodyProgressShots.mjs
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = process.env.BODY_PROGRESS_SHOTS || join(repo, 'body-progress-shots')
mkdirSync(out, { recursive: true })
const at = new Date().setHours(10, 0, 0, 0)
const port = 6600 + Math.floor(Math.random() * 300)
const server = spawn(process.execPath, [join(repo, 'e2e/server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, E2E_NOW: String(at), E2E_BODY_DEMO: '1' } })
await new Promise((ok, no) => {
  server.stdout.on('data', (d) => String(d).includes('e2e server') && ok())
  setTimeout(() => no(new Error('e2e server did not start')), 15000)
})
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  await ctx.clock.install({ time: at })
  const pg = await ctx.newPage()
  await pg.route(/api\.telegram\.org|fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '{}' }))
  await pg.goto(`http://127.0.0.1:${port}/`)
  await pg.waitForSelector('input', { timeout: 20000 })
  await pg.fill('input', '1234')
  await pg.keyboard.press('Enter')
  await pg.waitForSelector('.td2', { timeout: 20000 })
  await pg.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
  await pg.evaluate(async () => {
    const figure = (broad) => {
      const c = document.createElement('canvas')
      c.width = 300
      c.height = 400
      const g = c.getContext('2d')
      g.fillStyle = '#222b3b'
      g.fillRect(0, 0, 300, 400)
      g.fillStyle = '#c9d2e3'
      g.beginPath()
      g.arc(150, 70, 26, 0, Math.PI * 2)
      g.fill()
      g.fillRect(150 - 62 * broad, 112, 124 * broad, 120)
      g.fillRect(120, 232, 24, 150)
      g.fillRect(156, 232, 24, 150)
      return new Promise((ok) => c.toBlob(ok, 'image/png'))
    }
    const db = await new Promise((ok, no) => {
      const r = indexedDB.open('life-body-photos', 1)
      r.onupgradeneeded = () => r.result.objectStoreNames.contains('photos') || r.result.createObjectStore('photos', { keyPath: 'id' })
      r.onsuccess = () => ok(r.result)
      r.onerror = () => no(r.error)
    })
    const put = (p) => new Promise((ok) => { const t = db.transaction('photos', 'readwrite'); t.objectStore('photos').put(p); t.oncomplete = ok })
    await put({ id: 'a', day: '2026-09-01', at: 1, blob: await figure(0.95), w: 300, h: 400 })
    await put({ id: 'b', day: '2026-11-01', at: 2, blob: await figure(1.1), w: 300, h: 400 })
    db.close()
  })
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('life-open-page', { detail: 'body' })))
  await pg.locator('.seg-switch [role="tab"]').nth(1).click()
  await pg.click('.body-page .ptabs [data-tab="progress"]')
  await pg.waitForSelector('.bpg-hero .bpg-line', { timeout: 20000 })
  await pg.waitForSelector('.bpg-ph-frame .after', { timeout: 10000 })
  await pg.addStyleTag({ content: '.toasts { display: none !important; }' })
  await pg.waitForTimeout(800)
  await pg.screenshot({ path: join(out, 'body-progress-1-top.png') })
  await pg.evaluate(() => {
    document.querySelector('section[aria-label="Personal records"]').scrollIntoView({ block: 'start' })
    for (let e = document.querySelector('.bpg'); e; e = e.parentElement) if (e.scrollTop > 0) e.scrollTop -= 150
  })
  await pg.waitForTimeout(400)
  await pg.screenshot({ path: join(out, 'body-progress-2-records-photos.png') })
  console.log('saved to', out)
} finally {
  await browser.close()
  server.kill()
}
