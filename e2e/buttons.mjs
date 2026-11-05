// Button crawler: clicks every visible button on every page of the real app
// (website build, made-up data from e2e/server.mjs), in every Settings
// section, and on every tab of each embedded app (Waky, Sport Track, Finance
// Helper, MAN), and reports the ones that break or do nothing.
//
//   npm run build:web
//   node e2e/buttons.mjs                       # everything (about 20 minutes)
//   node e2e/buttons.mjs sleep:app settings    # only these places
//   CHROMIUM_PATH=/path/to/chrome node e2e/buttons.mjs
//
// Place names: chrome (the top bar and the sidebar), today, calendar, tasks,
// coach, goals, progress, shop, sleep, body, money, discipline, notebook,
// history, connected, bots, settings, settings › <section>, sleep:app,
// body:app, money:app, man:app (and "<app> › <tab>" for one tab).
//
// It behaves like the desktop app (Electron) for browser pop-ups:
// window.prompt returns null and confirm/alert do nothing, and each call is
// reported as a "NATIVE DIALOG" problem, because a button that relies on them
// does nothing on the desktop.
//
// After each click it records: uncaught page errors, console errors, failed
// requests (4xx/5xx), native dialogs, and whether anything happened (the page
// changed, a request went out, a new window or a download opened). A button
// that changes nothing and logs nothing is listed as "quiet": look at it in
// the code (often it's fine, for example a tab that is already open).
// Buttons that would wipe data, sign you out or replace your data are
// skipped and listed. Between clicks the page is reloaded when needed (and
// the browser's storage put back), so one click can't hide the next button.
// Exit code 1 when there is any problem (quiet buttons don't count).
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = 5800 + Math.floor(Math.random() * 500)
const base = `http://127.0.0.1:${port}`
const only = process.argv.slice(2)

// Life System's own pages: [name, page id, view]. Settings is crawled section
// by section, and each embedded app tab by tab (see places() below).
const PAGES = [
  ['today', 'today'],
  ['calendar', 'calendar'],
  ['tasks', 'tasks'],
  ['coach', 'coach'],
  ['goals', 'goals'],
  ['progress', 'progress'],
  ['shop', 'shop'],
  ['sleep', 'sleep', 'system'],
  ['body', 'body', 'system'],
  ['money', 'money', 'system'],
  ['discipline', 'discipline'],
  ['notebook', 'notebook'],
  ['history', 'history'],
  ['connected', 'connected'],
  ['bots', 'bots'],
  ['settings', 'settings']
]

// Never clicked: they wipe data, sign out or replace your data.
const DESTRUCTIVE = /delete everything|sign out|log ?out|reset all|reset everything|erase|wipe|restore|forget (this|all)|remove all|delete all|clear all|factory|start over|lock now|uninstall|disconnect|revoke|import (a )?backup|change pin/i
// Fine to fail here: the stand-in server has no cron jobs, no AI coach and no
// Telegram bot setup (those need real keys), and nothing outside is reachable.
const EXPECTED_FAIL = /\/api\/(cron|coach|bot-setup)\b|api\.telegram\.org|fonts\.(googleapis|gstatic)|favicon|\/version\.json|exchangerate|frankfurter|binance|coingecko/i
// Buttons that hide or put things away go last, so the rest are still there.
const later = (b) => (/\bhide|fold|dismiss|not now|skip|close|remove|delete|clear|turn off/i.test(b.label) ? 2 : /^(complete|done|mark all|log everything)|all done|what's left/i.test(b.label) ? 1 : 0)

const server = spawn(process.execPath, [join(repo, 'e2e/server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] })
process.on('exit', () => server.kill())
server.on('exit', (code, sig) => console.log(`\n!! the e2e server stopped (${code ?? sig})`))
await new Promise((ok, no) => {
  server.stdout.on('data', (d) => String(d).includes('e2e server') && ok())
  setTimeout(() => no(new Error('e2e server did not start')), 15000)
})

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
await ctx.addInitScript(() => {
  // Every visible, enabled, clickable thing in a scope, with a stable key.
  window.__crawlFind = (scope) => {
    const roots = scope ? [...document.querySelectorAll(scope)] : [document.body]
    const seen = new Map()
    const out = []
    for (const root of roots)
      for (const el of root.querySelectorAll('button, a[href], [role=button], [role=tab], [role=menuitem], [role=switch], summary, input[type=checkbox], input[type=radio]')) {
        const r = el.getBoundingClientRect()
        const st = getComputedStyle(el)
        if (!r.width || !r.height || st.pointerEvents === 'none' || el.matches(':disabled') || el.closest('[aria-disabled=true], [hidden], [inert]')) continue
        if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) continue
        const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60)
        const sig = `${el.tagName.toLowerCase()}|${label}|${el.id || ''}`
        const n = seen.get(sig) ?? 0
        seen.set(sig, n + 1)
        const cls = typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : ''
        out.push({ el, sig, n, label: label || `(${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls})`, href: el.getAttribute('href') })
      }
    return out
  }
  // A short fingerprint of what the page shows (text, elements, the button's own state).
  window.__crawlLook = () => {
    const t = document.body?.innerText ?? ''
    let h = 0
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0
    const el = document.querySelector('[data-crawl]')
    return [h, document.querySelectorAll('*').length, el?.className, el?.getAttribute('aria-pressed'), el?.getAttribute('aria-expanded'), el?.checked, document.activeElement?.tagName === 'INPUT'].join('|')
  }
  // Electron's pop-ups: prompt gives null, confirm false, alert nothing. In every frame.
  const say = (kind, msg) => console.error(`NATIVE DIALOG ${kind}(${String(msg ?? '').slice(0, 80)})`)
  window.prompt = (m) => (say('prompt', m), null)
  window.confirm = (m) => (say('confirm', m), false)
  window.alert = (m) => say('alert', m)
})
await ctx.route(/api\.telegram\.org|fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '{}' }))
let popups = 0
const pg = await ctx.newPage()
ctx.on('page', (p) => {
  if (p !== pg) {
    popups++
    p.close().catch(() => {})
  }
})

// What happened since the last reset.
let ev = { errors: [], requests: 0, downloads: 0 }
const note = (s) => ev.errors.push(s.slice(0, 220))
pg.on('pageerror', (e) => note(`page error: ${e.message}`))
pg.on('console', (m) => {
  const t = m.text()
  if (/NATIVE DIALOG/.test(t)) note(t)
  // (No camera in a headless browser: the push-up camera test can't find one.)
  else if (m.type() === 'error' && !/Failed to load resource|favicon|ERR_|net::|DevTools|\[vite\]|Requested device not found/i.test(t)) note(`console error: ${t}`)
})
pg.on('request', (r) => !/\.(js|css|png|svg|woff2?|webp|ico|json)$/.test(new URL(r.url()).pathname) && ev.requests++)
pg.on('response', (r) => {
  if (r.status() >= 400 && !EXPECTED_FAIL.test(r.url())) note(`HTTP ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`)
})
pg.on('requestfailed', (r) => {
  const f = r.failure()?.errorText ?? ''
  // Only our own server counts: nothing outside is reachable from here.
  if (r.url().startsWith(base) && !/ERR_ABORTED|ERR_FAILED/.test(f) && !EXPECTED_FAIL.test(r.url())) note(`request failed: ${new URL(r.url()).pathname} ${f}`)
})
pg.on('download', (d) => {
  ev.downloads++
  d.cancel().catch(() => {})
})

const report = { places: 0, clicked: 0, skipped: [], problems: [], quiet: [], blocked: [] }

// The browser's storage right after signing in: put back before each page so
// a click that changes a look setting (a hidden card, a day view) is undone.
let saved = []
async function signIn() {
  await pg.goto(`${base}/`)
  await pg.waitForSelector('input', { timeout: 20000 })
  await pg.fill('input', '1234')
  await pg.keyboard.press('Enter')
  await pg.waitForSelector('.td2', { timeout: 20000 })
  await pg.waitForTimeout(1500)
  saved = await pg.evaluate(() => Object.entries(localStorage))
}

// Waits until the page has filled in: the number of buttons stops changing.
async function settled(frame, scope) {
  let last = -1
  let same = 0
  for (let i = 0; i < 20 && same < 2; i++) {
    await pg.waitForTimeout(400)
    const n = await frame.evaluate((scope) => window.__crawlFind(scope).length, scope).catch(() => -1)
    same = n === last && n > 0 ? same + 1 : 0
    last = n
  }
}

// Opens a page fresh (a reload, so a previous click can't leave a mess).
// view 'app' gives the embedded app's frame.
async function openPage(id, view) {
  await pg
    .evaluate((saved) => {
      try {
        const keep = Object.entries(localStorage).filter(([k]) => /session|token|device|auth|notif/i.test(k))
        localStorage.clear()
        for (const [k, v] of [...saved, ...keep]) localStorage.setItem(k, v)
      } catch {}
    }, saved)
    .catch(() => {})
  await pg.goto(`${base}/`)
  // A reload asks for the PIN again.
  await pg.waitForSelector('.topbar, input', { timeout: 20000 })
  if (!(await pg.$('.topbar'))) {
    await pg.fill('input', '1234')
    await pg.keyboard.press('Enter')
    await pg.waitForSelector('.topbar', { timeout: 20000 })
  }
  await pg.evaluate((p) => window.dispatchEvent(new CustomEvent('life-open-page', { detail: p })), id)
  await pg.waitForTimeout(600)
  if (view) {
    const tabs = pg.locator('.seg-switch button')
    if ((await tabs.count()) === 2) await tabs.nth(view === 'app' ? 0 : 1).click()
  }
  if (view !== 'app') {
    await settled(pg.mainFrame(), 'main.content')
    return pg.mainFrame()
  }
  await pg.waitForTimeout(2500)
  const src = await pg.evaluate(() => [...document.querySelectorAll('iframe, webview')].find((e) => e.offsetParent)?.getAttribute('src') ?? null)
  const frame = src && pg.frames().find((f) => f.url().includes(src))
  if (!frame) throw new Error(`no app frame on ${id}`)
  await settled(frame, null)
  return frame
}

// MAN is opened on its own (it is not embedded any more).
async function openMan() {
  await pg.goto(`${base}/apps/man/index.html`)
  await settled(pg.mainFrame(), null)
  return pg.mainFrame()
}

// The embedded apps and their tab bars: each tab is crawled as its own screen.
const APPS = [
  ['sleep:app', () => openPage('sleep', 'app'), '.tab[data-view]'],
  ['body:app', () => openPage('body', 'app'), '.st-tab[data-tab]'],
  ['money:app', () => openPage('money', 'app'), 'a[data-tab]'],
  ['man:app', openMan, '.nav-tab[data-tab]']
]

// Every place to crawl: { name, open() → frame, scope, tabSel }.
async function places() {
  const out = []
  const want = (n) => !only.length || only.some((o) => n === o || n.startsWith(o + ' ›'))
  if (want('chrome')) out.push({ name: 'chrome', open: () => openPage('today'), scope: 'header.topbar, aside.sb' })
  for (const [name, id, view] of PAGES) if (want(name)) out.push({ name, open: () => openPage(id, view), scope: 'main.content' })
  if (only.length === 0 || only.some((o) => o.startsWith('settings'))) {
    await openPage('settings')
    for (const section of await pg.locator('.st-item b').allInnerTexts()) {
      const name = `settings › ${section}`
      if (!want(name)) continue
      out.push({
        name,
        scope: '.st-grid',
        open: async () => {
          await openPage('settings')
          await pg.locator('.st-item', { hasText: section }).first().click()
          await settled(pg.mainFrame(), '.st-grid')
          return pg.mainFrame()
        }
      })
    }
  }
  for (const [name, open, tabSel] of APPS) {
    if (only.length && !only.some((o) => o === name || o.startsWith(name + ' ›'))) continue
    const frame = await open()
    // Each tab once (Finance Helper inside Life has a strip of tabs plus its hidden sidebar).
    const tabs = [...new Set(await frame.locator(tabSel).evaluateAll((els) => els.map((e) => e.getAttribute('data-view') || e.getAttribute('data-tab'))))]
    for (const tab of tabs.length ? tabs : [null]) {
      const place = tab ? `${name} › ${tab}` : name
      if (!want(place)) continue
      out.push({
        name: place,
        scope: null,
        tabSel,
        open: async () => {
          const f = await open()
          if (tab) {
            const links = f.locator(`${tabSel}[data-view="${tab}"], ${tabSel}[data-tab="${tab}"]`)
            let shown = null
            for (let i = 0; i < (await links.count()); i++) if (await links.nth(i).isVisible()) { shown = links.nth(i); break }
            // A section only behind "More" (its sidebar link is hidden): go by its address.
            if (shown) await shown.click({ timeout: 3000 })
            else await f.evaluate((t) => { location.hash = '#' + t }, tab)
            await settled(f, null)
          }
          return f
        }
      })
    }
  }
  return out
}

// The buttons in a scope, each with a key that finds it again after a reload.
const listButtons = (frame, scope) => frame.evaluate((scope) => window.__crawlFind(scope).map(({ el, ...b }) => b), scope)

// Marks one button (by key) so Playwright can click it, and starts counting
// what changes on the page; false when the button is gone.
async function mark(frame, scope, b) {
  // Pages fill in after a reload: give the button a moment to appear.
  for (let i = 0; i < 4; i++) {
    if (await markOnce(frame, scope, b).catch(() => false)) return true
    await pg.waitForTimeout(500)
  }
  return false
}
const markOnce = (frame, scope, b) =>
  frame.evaluate(
    async ([scope, sig, n]) => {
      document.querySelectorAll('[data-crawl]').forEach((e) => e.removeAttribute('data-crawl'))
      const hit = window.__crawlFind(scope).find((x) => x.sig === sig && x.n === n)
      if (!hit) return false
      hit.el.setAttribute('data-crawl', '1')
      window.__crawlMut = 0
      window.__crawlObs?.disconnect()
      // Animations only change style: count everything else.
      window.__crawlObs = new MutationObserver((m) => (window.__crawlMut += m.filter((x) => x.attributeName !== 'style').length))
      window.__crawlObs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
      // What changes by itself (clocks, timers) in 300 ms, before the click.
      await new Promise((r) => setTimeout(r, 300))
      window.__crawlBase = window.__crawlMut
      window.__crawlMut = 0
      window.__crawlUrl = location.href
      window.__crawlSig = window.__crawlLook()
      return true
    },
    [scope, b.sig, b.n]
  )

const changed = (frame) =>
  frame
    .evaluate(() => ({ mut: (window.__crawlLook() !== window.__crawlSig ? 1 : 0) + Math.max(0, (window.__crawlMut ?? 0) - (window.__crawlBase ?? 0) * 2), nav: location.href !== window.__crawlUrl }))
    .catch(() => ({ mut: 1, nav: true }))

// Why Playwright could not click it (covered, not visible, moving...).
const why = (e) => {
  const lines = e.message.split('\n')
  return (lines.find((l) => /intercepts pointer|not visible|not stable|outside of the viewport|not enabled|detached/.test(l)) ?? lines[0]).replace(/\x1b\[\d+m/g, '').trim().slice(0, 160)
}

// Closes whatever a click opened: our "are you sure?" sheet (Cancel), dialogs,
// menus, and Life System's notification cards (they sit over the top right).
async function settle(frame) {
  await pg.locator('.nt-card .nt-x').evaluateAll((xs) => xs.forEach((x) => x.click())).catch(() => {})
  for (const f of [frame, pg.mainFrame()]) {
    const cancel = f.locator('.cs-back .btn.ghost, dialog[open] button[value=cancel]')
    if (await cancel.count().catch(() => 0)) await cancel.first().click({ timeout: 1000 }).catch(() => {})
  }
  await pg.keyboard.press('Escape').catch(() => {})
}

async function crawl({ name, open, scope, tabSel }) {
  report.places++
  ev = { errors: [], requests: 0, downloads: 0 }
  let frame = await open()
  const opened = ev.errors.splice(0)
  if (opened.length) report.problems.push({ where: name, button: '(when it opens)', issues: opened })
  let buttons = (await listButtons(frame, scope)).sort((a, b) => later(a) - later(b))
  // An app's own tab bar: the tabs are opened as places of their own.
  if (tabSel) {
    const tabKeys = await frame.locator(tabSel).evaluateAll((els) => els.map((e) => `${e.tagName.toLowerCase()}|${(e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)}|${e.id || ''}`))
    buttons = buttons.filter((b) => !tabKeys.includes(b.sig))
  }
  console.log(`\n▶ ${name}: ${buttons.length} buttons`)
  for (const b of buttons) {
    if (DESTRUCTIVE.test(b.label)) {
      report.skipped.push(`${name} → ${b.label}`)
      continue
    }
    if (b.href && /^(https?:|mailto:|tel:)/.test(b.href) && !b.href.startsWith(base)) {
      report.skipped.push(`${name} → ${b.label} (a link to ${b.href.slice(0, 50)})`)
      continue
    }
    // Up to two tries: the second after a reload (a sheet or menu left open
    // by the last click can cover the button).
    let clicked = false
    let last = ''
    let pops = 0
    let url = ''
    for (let attempt = 0; attempt < 2 && !clicked; attempt++) {
      if (attempt) frame = await open()
      if (!(await mark(frame, scope, b).catch(() => false))) {
        last = 'not there after a reload (it shows only in some states)'
        continue
      }
      await pg.locator('.nt-card .nt-x').evaluateAll((xs) => xs.forEach((x) => x.click())).catch(() => {})
      ev = { errors: [], requests: 0, downloads: 0 }
      pops = popups
      url = pg.url()
      try {
        // A button that never stops moving (an animated one) gets a plain click.
        await frame.locator('[data-crawl="1"]').click({ timeout: 2500, force: /not stable/.test(last) })
        clicked = true
      } catch (e) {
        last = why(e)
        await settle(frame)
      }
    }
    if (!clicked) {
      report.blocked.push(`${name} → ${b.label}: ${last}`)
      continue
    }
    report.clicked++
    await pg.waitForTimeout(500)
    const c = await changed(frame)
    const navigated = c.nav || pg.url() !== url
    const issues = ev.errors.splice(0)
    if (issues.length) {
      report.problems.push({ where: name, button: b.label, issues })
      console.log(`\n  ✗ ${b.label}: ${issues.join(' | ')}`)
    } else if (!c.mut && !ev.requests && popups === pops && !ev.downloads && !navigated) report.quiet.push(`${name} → ${b.label}`)
    process.stdout.write(issues.length ? '✗' : '.')
    await settle(frame)
    if (navigated || frame.isDetached()) frame = await open()
  }
}

try {
  await signIn()
  for (const place of await places()) {
    try {
      await crawl(place)
    } catch (e) {
      report.problems.push({ where: place.name, button: '(the page itself)', issues: [e.message.split('\n')[0]] })
      console.log(`\n  ✗ ${place.name}: ${e.message.split('\n')[0]}`)
    }
  }
} finally {
  await browser.close()
  server.kill()
}

console.log('\n\n=== Button crawl ===')
console.log(`${report.places} places, ${report.clicked} buttons clicked, ${report.problems.length} with problems, ${report.quiet.length} quiet, ${report.skipped.length} skipped, ${report.blocked.length} not clickable`)
if (report.problems.length) {
  console.log('\nProblems:')
  for (const p of report.problems) console.log(`  ✗ ${p.where} → ${p.button}\n      ${p.issues.join('\n      ')}`)
}
if (report.blocked.length) console.log('\nNot clickable:\n  ' + report.blocked.join('\n  '))
if (report.quiet.length) console.log('\nQuiet (nothing changed, look at them):\n  ' + report.quiet.join('\n  '))
if (report.skipped.length) console.log('\nSkipped on purpose:\n  ' + report.skipped.join('\n  '))
process.exit(report.problems.length ? 1 : 0)
