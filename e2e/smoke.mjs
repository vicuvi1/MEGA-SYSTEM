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
await pg.route(/api\.telegram\.org|fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '{}' }))

try {
  await step('opens and signs in with the PIN', async () => {
    await pg.goto(`http://127.0.0.1:${port}/`)
    await pg.waitForSelector('input', { timeout: 20000 })
    await pg.fill('input', '1234')
    await pg.keyboard.press('Enter')
    await pg.waitForSelector('text=Good', { timeout: 20000 })
  })
  await step('Today shows Ben and the day', async () => {
    await pg.waitForSelector('.td2', { timeout: 10000 })
  })
  const open = (page) => pg.evaluate((p) => window.dispatchEvent(new CustomEvent('life-open-page', { detail: p })), page)
  for (const [page, name] of [['body', 'Sport Track'], ['money', 'Finance Helper'], ['sleep', 'Waky'], ['discipline', 'MAN']]) {
    await step(`${name} loads with its own content`, async () => {
      await open(page)
      await pg.waitForTimeout(3500)
      const src = await pg.evaluate(() => [...document.querySelectorAll('iframe, webview')].find((e) => e.offsetParent)?.getAttribute('src') ?? null)
      if (!src) throw new Error('no visible app frame')
      const frame = pg.frames().find((f) => f.url().includes(src))
      if (!frame) throw new Error(`frame ${src} not loaded`)
      const text = (await frame.locator('body').innerText()).trim()
      if (text.length < 40) throw new Error(`frame looks empty (${text.length} chars)`)
    })
  }
  await step('Settings opens (health, backups)', async () => {
    await open('settings')
    await pg.waitForSelector('text=Appearance', { timeout: 10000 })
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
