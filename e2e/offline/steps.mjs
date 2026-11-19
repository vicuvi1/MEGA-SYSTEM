// Offline and two-device smoke steps (offline audit, 2026-11-18). Run by
// e2e/smoke.mjs (SMOKE_ONLY="Offline" runs only these). Each group has its own
// made-up server and its own browser contexts ("devices"), so nothing here
// touches the data of the other steps.
//   1. one device: honest top bar while offline, the backup tried again after
//      reconnect, the toast that never says "saved" for a change only in memory;
//   2. two devices offline (website, then desktop): the same night and the
//      day's must-dos, reconnect in either order;
//   3. a must-do removed with Undo;
//   4. the first PIN (no default PIN): the one-time setup with the server's key.
import { newDevice, signIn, startServer } from './lib.mjs'
import * as O from './ops.mjs'

const until = async (fn, ms, what) => {
  let last
  for (const end = Date.now() + ms; Date.now() < end; ) {
    try {
      last = await fn()
      if (last) return last
    } catch (e) {
      last = e.message
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${what} (last: ${JSON.stringify(last)?.slice(0, 200)})`)
}
const chip = (pg) => pg.evaluate(() => document.querySelector('[data-testid="save-chip"]')?.textContent?.trim() ?? '')
const toasts = (pg) => pg.evaluate(() => [...document.querySelectorAll('.toasts .toast')].map((e) => e.textContent).join(' | '))
/** Unlocks after a reload (the PIN screen, or already open on a trusted device). */
const unlock = async (pg) => {
  await pg.waitForSelector('input.pin, .td2, main.content', { timeout: 20000 })
  if (await pg.$('input.pin')) {
    await pg.fill('input.pin', '1234')
    await pg.keyboard.press('Enter')
  }
  await pg.waitForSelector('main.content', { timeout: 20000 })
}

export async function offlineSteps({ step, browser, clock }) {
  // SMOKE_ONLY: a group (its server, its devices) is only set up when one of its steps would run.
  const only = process.env.SMOKE_ONLY
  const wanted = (...names) => !only || names.some((n) => only.split('|').some((w) => n.includes(w)))
  const ONE = ['Offline: the top bar never says "Backed up"', 'Offline: a must-do can be removed, and Undo', 'Offline: with the storage full the toast']

  // ---- 1 + 3: one device -----------------------------------------------------
  if (wanted(...ONE)) {
    const srv = await startServer(clock())
    const d = await newDevice(browser, srv)
    const pg = d.pg
    try {
      await step('Offline: the top bar never says "Backed up" while offline or while changes wait, and turns green again after reconnect', async () => {
        await signIn(d)
        await O.openNow(pg)
        await until(async () => (await chip(pg)) === 'Backed up', 30000, 'the first backup never showed as saved')
        await d.goOffline('abort')
        await pg.evaluate(() => window.dispatchEvent(new Event('offline')))
        await until(async () => /Offline|waiting/.test(await chip(pg)), 8000, 'the chip still says it is backed up while offline')
        await O.addMust(pg, 'read 20 pages')
        await until(async () => /\d+ waiting/.test(await chip(pg)), 8000, 'the chip does not count the waiting change')
        if (/Backed up/.test(await chip(pg))) throw new Error('"Backed up" while a change waits')
        // Reload with no internet: the app opens with this device's own PIN copy and still shows the change and the count.
        await pg.goto(srv.base + '/').catch(() => {})
        await unlock(pg)
        await O.openNow(pg)
        await until(async () => (await O.musts(pg)).some((m) => m.includes('read 20 pages')), 10000, 'the must-do made offline is gone after a reload')
        await until(async () => /\d+ waiting|Offline/.test(await chip(pg)), 10000, 'after an offline reload the chip is not honest')
        // Back online: the change goes out, today's backup is tried again by itself, the chip is green.
        await d.goOnline()
        await until(async () => (await srv.sql('SELECT items FROM day_plans')).some((r) => String(r[0]).includes('read 20 pages')), 30000, 'the must-do never reached the server')
        await until(async () => (await chip(pg)) === 'Backed up', 45000, 'the chip never turned green after reconnect ("Backup missed" stuck)')
        if (!(await srv.sql('SELECT day FROM cloud_snapshots')).length) throw new Error('no cloud backup was saved after reconnect')
      })

      await step('Offline: a must-do can be removed, and Undo puts it back', async () => {
        await O.openNow(pg)
        await O.addMust(pg, 'math 40 min')
        await pg.click('[data-testid="three-numbers"] .tn-list li:has-text("math 40 min") .tn-del')
        await until(async () => !(await O.musts(pg)).some((m) => m.includes('math 40 min')), 8000, 'the removed must-do is still shown')
        await until(async () => !(await srv.sql('SELECT items FROM day_plans')).some((r) => String(r[0]).includes('math 40 min')), 15000, 'the removed must-do is still on the server')
        await pg.click('.toasts .toast:has-text("Removed: math 40 min") .toast-act')
        await until(async () => (await O.musts(pg)).some((m) => m.includes('math 40 min')), 8000, 'Undo did not put the must-do back')
        await until(async () => (await srv.sql('SELECT items FROM day_plans')).some((r) => String(r[0]).includes('math 40 min')), 15000, 'the must-do put back never reached the server')
        // Still at most 3 shown, and the place can be filled again.
        if ((await O.musts(pg)).length > 3) throw new Error('more than 3 must-dos shown')
      })

      await step('Offline: with the storage full the toast says "not saved yet", never "saved"', async () => {
        await O.openNow(pg)
        await d.goOffline('abort')
        // Fill this browser's storage to the last bytes (made-up filler).
        await pg.evaluate(() => {
          const big = 'x'.repeat(200000)
          const small = 'y'.repeat(500)
          try { for (let n = 0; ; n++) localStorage.setItem('zz_fill_' + n, big) } catch { /* full */ }
          try { for (let n = 0; ; n++) localStorage.setItem('zz_fine_' + n, small) } catch { /* full */ }
        })
        // The waiting changes are kept in IndexedDB now, so a full localStorage alone no longer loses them:
        // the store takes a write and keeps it.
        const kept = await pg.evaluate(async () => {
          const s = window.__lifeStore
          s.setItem('life_sync_app_sync_smoke', 'kept with the small storage full')
          await s.flush()
          const inSmall = localStorage.getItem('life_sync_app_sync_smoke')
          const where = s.status().keys.find((k) => k.key === 'life_sync_app_sync_smoke')?.where
          s.removeItem('life_sync_app_sync_smoke')
          await s.flush()
          return { inSmall, where }
        })
        if (kept.where !== 'indexeddb' || kept.inSmall != null) throw new Error(`with localStorage full a big copy was not kept in IndexedDB (${JSON.stringify(kept)})`)
        // "Not saved yet" is for when the device can store it nowhere: IndexedDB refuses too (made to, here).
        await pg.evaluate(() => {
          window.__realPut = IDBObjectStore.prototype.put
          IDBObjectStore.prototype.put = function (...args) {
            if (this.transaction?.db?.name === 'life-big-store') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
            return window.__realPut.apply(this, args)
          }
        })
        if (!(await pg.locator('[data-testid="tn-sleep-form"]').count())) await pg.click('[data-testid="tn-sleep-open"]')
        await pg.fill('[data-testid="tn-sleep-form"] input[aria-label="Asleep at"]', '23:05')
        await pg.fill('[data-testid="tn-sleep-form"] input[aria-label="Up at"]', '06:35')
        await pg.click('[data-testid="tn-sleep-form"] button[type="submit"]')
        await until(async () => /Not saved yet/.test(await toasts(pg)), 8000, 'no "Not saved yet" toast')
        if (/Last night saved/.test(await toasts(pg))) throw new Error('the toast still says "Last night saved"')
        // Space again and back online: the change that waited in memory still arrives.
        await pg.evaluate(() => { IDBObjectStore.prototype.put = window.__realPut; for (const k of Object.keys(localStorage)) if (/^zz_/.test(k)) localStorage.removeItem(k) })
        await d.goOnline()
        await until(async () => (await srv.sql('SELECT bed_time, wake_time FROM sleep_logs')).some((r) => r[0] === '23:05' && r[1] === '06:35'), 30000, 'the night typed with a full storage never reached the server')
        if (d.errors.length) throw new Error(`page errors: ${d.errors.slice(0, 2).join(' | ')}`)
      })
    } finally {
      await d.ctx.close().catch(() => {})
      srv.stop()
    }
  }

  // ---- 2: two devices, both offline, the same night and the same day's must-dos --
  for (const [mode, order] of [['website', 'AB'], ['desktop', 'BA']]) {
    if (!wanted(`Offline: two devices (${mode}, reconnect ${order})`)) continue
    const srv = await startServer(clock())
    const A = await newDevice(browser, srv, { desktop: mode === 'desktop' })
    const B = await newDevice(browser, srv, { desktop: mode === 'desktop' })
    try {
      await step(`Offline: two devices (${mode}, reconnect ${order}): the later night wins whole, both must-dos are kept, both devices show the same`, async () => {
        await signIn(A)
        await signIn(B)
        await O.openNow(A.pg)
        await O.openNow(B.pg)
        await A.goOffline('abort')
        await B.goOffline('abort')
        await O.logSleep(A.pg, '23:00', '06:30')
        await O.addMust(A.pg, 'alpha 20 pages')
        await A.pg.waitForTimeout(1300)
        await O.logSleep(B.pg, '23:40', '06:55') // typed later: it must win, whole
        await O.addMust(B.pg, 'beta 30 pages')
        const [first, second] = order === 'AB' ? [A, B] : [B, A]
        await first.goOnline()
        await until(async () => (await srv.sql('SELECT bed_time FROM sleep_logs'))[0]?.[0] === (first === A ? '23:00' : '23:40'), 30000, 'the first device never sent its night')
        await second.goOnline()
        await until(async () => {
          const plans = (await srv.sql('SELECT items FROM day_plans')).map((r) => r[0]).join(' ')
          return /alpha 20 pages/.test(plans) && /beta 30 pages/.test(plans)
        }, 40000, 'a must-do of one device is missing on the server')
        const night = await until(async () => {
          const rows = await srv.sql('SELECT bed_time, wake_time FROM sleep_logs')
          return rows.length === 1 && rows[0][0] === '23:40' && rows[0][1] === '06:55' ? rows : null
        }, 30000, 'the night on the server is not the later entry, whole (23:40 / 06:55)')
        if (night.length !== 1) throw new Error('more than one row for the night')
        // Both devices show the same, soon (coming back to the window is enough; no manual sync).
        for (const d of [A, B]) {
          await d.pg.evaluate(() => window.dispatchEvent(new Event('focus')))
          await until(async () => {
            const m = (await O.musts(d.pg)).join(' ')
            const s = await d.pg.textContent('[data-testid="tn-sleep-result"]')
            return /alpha 20 pages/.test(m) && /beta 30 pages/.test(m) && /23:40/.test(s ?? '') && /06:55/.test(s ?? '')
          }, 40000, `device ${d === A ? 'A' : 'B'} does not show both must-dos and the later night`)
        }
        const errs = [...A.errors, ...B.errors]
        if (errs.length) throw new Error(`page errors: ${errs.slice(0, 2).join(' | ')}`)
      })
    } finally {
      await A.ctx.close().catch(() => {})
      await B.ctx.close().catch(() => {})
      srv.stop()
    }
  }

  // ---- 4: no default PIN: the first PIN needs the server's setup key ------------
  if (wanted('Offline: sign-in with no PIN set')) {
    const srv = await startServer(clock(), { E2E_NO_PIN: '1', CRON_SECRET: 'made-up-setup-key' })
    const d = await newDevice(browser, srv)
    const pg = d.pg
    try {
      await step('Offline: sign-in with no PIN set: no default PIN opens the app, the first PIN is set with the server key', async () => {
        await pg.goto(srv.base + '/')
        await pg.waitForSelector('input.pin', { timeout: 20000 })
        // The old default opens nothing: the one-time setup is shown instead.
        await pg.fill('input.pin', '2007')
        await pg.keyboard.press('Enter')
        await pg.waitForSelector('[data-testid="first-pin"]', { timeout: 15000 })
        if (await pg.$('main.content')) throw new Error('the app opened with the old default PIN')
        const fill = async (key, pin) => {
          await pg.fill('[data-testid="first-pin"] input[aria-label="Setup key"]', key)
          await pg.fill('[data-testid="first-pin"] input[aria-label="New PIN"]', pin)
          await pg.fill('[data-testid="first-pin"] input[aria-label="New PIN again"]', pin)
          await pg.click('[data-testid="first-pin"] button.primary')
        }
        await fill('not-the-key', '4821')
        await pg.waitForFunction(() => /Wrong setup key/.test(document.querySelector('[data-testid="first-pin"] .err')?.textContent ?? ''), null, { timeout: 15000 })
        await fill('made-up-setup-key', '4821')
        await pg.waitForSelector('main.content', { timeout: 20000 })
        const stored = await srv.sql("SELECT value FROM sys_auth WHERE key = 'pin_hash'")
        if (!/^[0-9a-f]{32}:[0-9a-f]{64}$/.test(String(stored[0]?.[0]))) throw new Error('the PIN is not stored as a hash in sys_auth')
        // The setup is closed for good: the key cannot replace the PIN now.
        const again = await pg.evaluate(async () => (await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setup: 'made-up-setup-key', pin: '9999' }) })).status)
        if (again !== 409) throw new Error(`a second setup answered ${again}, not 409`)
      })
    } finally {
      await d.ctx.close().catch(() => {})
      srv.stop()
    }
  }
}
