// Helpers for the offline and two-device smoke steps (e2e/offline/steps.mjs):
// a made-up server of their own, "devices" (browser contexts) that can lose
// their connection, and a look into the server's database.
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** A fresh made-up server (e2e/server.mjs) at `clock` (ms); `env` adds settings such as E2E_NO_PIN. */
export async function startServer(clock = Date.now(), env = {}) {
  // Below 6000: the browser refuses that port (ERR_UNSAFE_PORT), which failed one run in 400.
  const port = 5800 + Math.floor(Math.random() * 190)
  const server = spawn(process.execPath, [join(repo, 'e2e/server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, E2E_NOW: String(clock), ...env } })
  await new Promise((ok, no) => {
    server.stdout.on('data', (d) => String(d).includes('e2e server') && ok())
    setTimeout(() => no(new Error('the offline steps\' server did not start')), 15000)
  })
  const base = `http://127.0.0.1:${port}`
  /** Reads the server's database directly (the fake Turso), as rows of cells. */
  const sql = async (sqlText, args = []) => {
    const r = await fetch(`${base}/v2/pipeline`, {
      method: 'POST',
      headers: { Authorization: 'Bearer fake-turso-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: sqlText, args: args.map((a) => (typeof a === 'number' ? { type: 'integer', value: String(a) } : { type: 'text', value: String(a) })) } }] })
    })
    const res = (await r.json()).results?.[0]
    if (res?.type === 'error') throw new Error(res.error?.message)
    return (res?.response?.result?.rows ?? []).map((row) => row.map((c) => c?.value ?? null))
  }
  return { port, base, sql, stop: () => server.kill() }
}

/**
 * One device: its own browser context (storage, service worker, offline
 * queue). `desktop`: the desktop app's local-first copy, with a stand-in for
 * the file on disk that survives reloads. goOffline / goOnline cut and bring
 * back its connection to the server.
 */
export async function newDevice(browser, srv, { desktop = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow' })
  await ctx.route(/api\.telegram\.org|fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, body: '{}' }))
  if (desktop) {
    let disk = null
    await ctx.exposeFunction('__dload', () => disk)
    await ctx.exposeFunction('__dsave', (b64) => { disk = b64 })
    await ctx.addInitScript(() => {
      // The desktop app's own files are on the PC: with no internet only the server is out of reach.
      // (goOffline cuts the server calls and flips this; the page's files keep loading.)
      Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => sessionStorage.getItem('e2e_offline') !== '1' })
      window.desktop = new Proxy({
        islandModule: () => {},
        load: async () => { const b = await window.__dload(); return b ? Uint8Array.from(atob(b), (c) => c.charCodeAt(0)) : null },
        save: async (bytes) => { const u = new Uint8Array(bytes); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); await window.__dsave(btoa(s)) },
        // Parts of the desktop app this stand-in does not have (the app then leaves them out).
        eyes: undefined,
        syncFolder: undefined
      }, { get: (t, k) => (k in t ? t[k] : typeof k !== 'string' || k === 'then' ? undefined : /^(on|island|show)/.test(k) ? () => () => {} : async () => null) })
    })
  }
  const pg = await ctx.newPage()
  const errors = []
  pg.on('pageerror', (e) => errors.push(e.message))
  const dev = { ctx, pg, errors, srv, mode: 'online' }
  await ctx.route(/\/(api\/(db|cron|todoist|google|ai|login)|v2\/pipeline)/, async (route) => {
    if (dev.mode === 'abort') return route.abort('internetdisconnected')
    return route.continue()
  })
  dev.goOffline = async () => {
    dev.mode = 'abort'
    if (desktop) await pg.evaluate(() => (sessionStorage.setItem('e2e_offline', '1'), window.dispatchEvent(new Event('offline'))))
    else await ctx.setOffline(true)
  }
  dev.goOnline = async () => {
    dev.mode = 'online'
    if (desktop) await pg.evaluate(() => sessionStorage.removeItem('e2e_offline'))
    else await ctx.setOffline(false)
    await pg.evaluate(() => window.dispatchEvent(new Event('online'))).catch(() => {})
  }
  return dev
}

export async function signIn(dev) {
  const { pg, srv } = dev
  await pg.goto(srv.base + '/')
  // The PIN screen, or already open (a device that needs no PIN). The screen may change between the look and the typing: look again.
  for (let i = 0; i < 3; i++) {
    await pg.waitForSelector('input.pin, .td2', { timeout: 20000 })
    if (await pg.$('.td2')) return
    try {
      await pg.fill('input.pin', '1234', { timeout: 5000 })
      await pg.keyboard.press('Enter')
      await pg.waitForSelector('.td2', { timeout: 20000 })
      return
    } catch (e) {
      if (i === 2) throw e
    }
  }
}

export const open = (pg, page) => pg.evaluate((p) => window.dispatchEvent(new CustomEvent('life-open-page', { detail: p })), page)
