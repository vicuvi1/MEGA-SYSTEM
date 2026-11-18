// Two devices change the same night and the same day's must-dos while both
// are offline, then reconnect in either order (offline audit, 2026-11-18).
// The website replays its queued statements as they are; the desktop merges
// rows. Both must end the same: the newer entry wins, nothing only one device
// has is lost. Made-up data only.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from './fakeTurso'
import { Mirror, type MirrorStore } from './mirror'
import { TursoHttp } from './tursoHttp'
import { SleepService } from '../../../main/sleep'
import { FocusService } from '../../../main/focus'
import { Wallet } from '../../../main/wallet'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-13T08:30:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const DAY = '2026-11-13'
const at = (hm: string) => vi.setSystemTime(new Date(`${DAY}T${hm}:00Z`))

function world(desktop: boolean) {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  const down = new Set<string>()
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    if ([...down].some((h) => String(url).includes(h))) throw new TypeError('Failed to fetch')
    const json = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  const mem = new Map<string, string>()
  // Each website device has its own queue: the stored one is switched off (the queue stays in the Mirror's memory).
  // (Only the "couldn't sync" list is read back; both devices share it here.)
  vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'life_sync_failed' ? mem.get(k) ?? null : null), setItem: (k: string, v: string) => void mem.set(k, v), removeItem: () => {}, key: () => null, length: 0 })
  vi.stubGlobal('window', { addEventListener: () => {}, dispatchEvent: () => true })
  vi.stubGlobal('navigator', { onLine: true })
  const device = async (name: string) => {
    let bytes: Uint8Array | null = null
    const store: MirrorStore = { load: async () => bytes, save: async (v) => void (bytes = v.slice()) }
    const m = new Mirror(SQL, new TursoHttp(`https://${name}.turso.io`, 't'), desktop ? store : null, desktop)
    await m.ready
    const svc = (db: unknown) => {
      const wallet = new Wallet(db as any, 'UTC')
      return { sleep: new SleepService(db as any, wallet), focus: new FocusService(db as any, wallet), wallet }
    }
    return {
      m,
      write: <T>(fn: (s: ReturnType<typeof svc>) => T) => m.write((db) => fn(svc(db))),
      read: <T>(fn: (s: ReturnType<typeof svc>) => T) => m.read((db) => fn(svc(db))),
      offline: () => down.add(`${name}.turso.io`),
      online: async () => {
        down.delete(`${name}.turso.io`)
        m.resume()
        for (let i = 0; i < 3; i++) await m.refresh().catch(() => false)
      }
    }
  }
  const night = () => remote.exec(`SELECT bed_time, wake_time FROM sleep_logs WHERE day = '${DAY}'`)[0]?.values ?? []
  const plan = () => JSON.parse(String(remote.exec(`SELECT items FROM day_plans WHERE day = '${DAY}'`)[0]?.values[0]?.[0] ?? '[]')) as { text: string; done: boolean }[]
  return { remote, device, night, plan }
}

for (const desktop of [false, true]) {
  const kind = desktop ? 'desktop' : 'website'
  for (const order of ['AB', 'BA'] as const) {
    describe(`${kind}, both offline, reconnect ${order}`, () => {
      const run = async (edit: (A: Dev, B: Dev) => Promise<void>) => {
        const w = world(desktop)
        const A = await w.device('a')
        const B = await w.device('b')
        A.offline()
        B.offline()
        await edit(A, B)
        const [first, second] = order === 'AB' ? [A, B] : [B, A]
        vi.setSystemTime(new Date(`${DAY}T12:00:00Z`))
        await first.online()
        await second.online()
        await first.online()
        return { w, A, B }
      }
      type Dev = Awaited<ReturnType<ReturnType<typeof world>['device']>>

      it('the same night typed on both: the later whole entry wins, one row', async () => {
        const { w, A, B } = await run(async (A, B) => {
          at('08:31')
          await A.write((s) => s.sleep.setNight(DAY, '23:00', '06:30'))
          at('08:40')
          await B.write((s) => s.sleep.setNight(DAY, '23:40', '06:55'))
        })
        expect(w.night()).toEqual([['23:40', '06:55']])
        for (const d of [A, B]) expect(await d.read((s) => s.sleep.logs().filter((l) => l.day === DAY).map((l) => [l.bedTime, l.wakeTime]))).toEqual([['23:40', '06:55']])
      })

      it('the bedtime on one device and the wake-up on the other: both are kept', async () => {
        const { w } = await run(async (A, B) => {
          at('08:31')
          await A.write((s) => s.sleep.setBed(DAY, '23:10'))
          at('08:40')
          await B.write((s) => s.sleep.setWake(DAY, '06:40'))
        })
        expect(w.night()).toEqual([['23:10', '06:40']])
      })

      it('a must-do added on each device: both are there', async () => {
        const { w, A, B } = await run(async (A, B) => {
          at('08:31')
          await A.write((s) => s.focus.setPlan(['alpha 20 pages']))
          at('08:40')
          await B.write((s) => s.focus.setPlan(['beta 30 pages']))
        })
        expect(w.plan().map((x) => x.text).sort()).toEqual(['alpha 20 pages', 'beta 30 pages'])
        for (const d of [A, B]) expect((await d.read((s) => s.focus.plan(DAY).items.map((x) => x.text))).sort()).toEqual(['alpha 20 pages', 'beta 30 pages'])
      })
    })
  }

  describe(`${kind}: a shared list, then both offline`, () => {
    const start = async () => {
      const w = world(desktop)
      const A = await w.device('a')
      const B = await w.device('b')
      at('08:00')
      await A.write((s) => s.focus.setPlan(['read 20 pages', 'math 40 min', 'run 3 km']))
      await A.online()
      await B.online()
      expect(await B.read((s) => s.focus.plan(DAY).items.length)).toBe(3)
      A.offline()
      B.offline()
      return { w, A, B }
    }
    const meet = async (first: { online: () => Promise<void> }, second: { online: () => Promise<void> }) => {
      at('12:00')
      await first.online()
      await second.online()
      await first.online()
    }

    it('a tick on one device and a new must-do on the other: both kept, whoever reconnects last', async () => {
      for (const order of ['AB', 'BA']) {
        const { w, A, B } = await start()
        at('08:31')
        await A.write((s) => s.focus.togglePlan(0, new Date(), DAY))
        at('08:40')
        await B.write((s) => s.focus.removePlan(2, new Date(), DAY))
        at('08:41')
        await B.write((s) => s.focus.setPlan(['read 20 pages', 'math 40 min', 'call Leo 10 min'], new Date(), DAY))
        await (order === 'AB' ? meet(A, B) : meet(B, A))
        expect(w.plan().map((x) => `${x.done ? 'x' : '-'} ${x.text}`).sort()).toEqual(['- call Leo 10 min', '- math 40 min', 'x read 20 pages'])
      }
    })

    it('removed on one device, ticked later on the other: the later change wins (it stays, ticked)', async () => {
      for (const order of ['AB', 'BA']) {
        const { w, A, B } = await start()
        at('08:31')
        await A.write((s) => s.focus.removePlan(1, new Date(), DAY))
        at('08:40')
        await B.write((s) => s.focus.togglePlan(1, new Date(), DAY))
        await (order === 'AB' ? meet(A, B) : meet(B, A))
        expect(w.plan().find((x) => x.text === 'math 40 min')?.done).toBe(true)
      }
    })

    it('ticked on one device, removed later on the other: it stays removed', async () => {
      for (const order of ['AB', 'BA']) {
        const { w, A, B } = await start()
        at('08:31')
        await B.write((s) => s.focus.togglePlan(1, new Date(), DAY))
        at('08:40')
        await A.write((s) => s.focus.removePlan(1, new Date(), DAY))
        await (order === 'AB' ? meet(A, B) : meet(B, A))
        expect(w.plan().map((x) => x.text)).toEqual(['read 20 pages', 'run 3 km'])
      }
    })
  })
}

describe('must-dos on one device', () => {
  const one = async () => {
    const w = world(false)
    const A = await w.device('a')
    return { w, A }
  }

  it('remove and Undo: back in its place, ticked as it was, and paid once', async () => {
    const { w, A } = await one()
    await A.write((s) => s.focus.setPlan(['read 20 pages', 'math 40 min', 'run 3 km']))
    at('08:31')
    const paid = await A.write((s) => s.focus.togglePlan(1, new Date(), DAY).coins)
    expect(paid).toBeGreaterThan(0)
    at('08:32')
    const gone = await A.write((s) => s.focus.removePlan(1, new Date(), DAY))
    expect(w.plan().map((x) => x.text)).toEqual(['read 20 pages', 'run 3 km'])
    at('08:33')
    await A.write((s) => s.focus.restorePlan(gone.removed, gone.index, new Date(), DAY))
    expect(w.plan().map((x) => `${x.done ? 'x' : '-'} ${x.text}`)).toEqual(['- read 20 pages', 'x math 40 min', '- run 3 km'])
    // Unticking and ticking again pays nothing more.
    at('08:34')
    await A.write((s) => s.focus.togglePlan(1, new Date(), DAY))
    at('08:35')
    expect(await A.write((s) => s.focus.togglePlan(1, new Date(), DAY).coins)).toBe(0)
  })

  it('the last must-do can be removed, and a new list replaces the old one', async () => {
    const { w, A } = await one()
    await A.write((s) => s.focus.setPlan(['read 20 pages']))
    at('08:31')
    await A.write((s) => s.focus.removePlan(0, new Date(), DAY))
    expect(w.plan()).toEqual([])
    at('08:32')
    await A.write((s) => s.focus.setPlan(['read 20 pages', 'math 40 min']))
    at('08:33')
    await A.write((s) => s.focus.setPlan(['run 3 km', 'math 40 min']))
    expect(w.plan().map((x) => x.text)).toEqual(['run 3 km', 'math 40 min'])
  })

  it('a list saved before must-dos had ids is taken over as it is', async () => {
    const { w, A } = await one()
    w.remote.run(`INSERT INTO day_plans (day, items, review, reasons, updated_at) VALUES ('${DAY}', '[{"text":"old one 10 min","done":true},{"text":"old two 20 min","done":false}]', 'ok day', '["Tired"]', '2026-11-13T07:00:00.000Z')`)
    w.remote.run("UPDATE settings SET value = 'seeded' WHERE key = 'data_version'")
    await A.online()
    await A.write((s) => s.focus.togglePlan(1, new Date(), DAY))
    expect(w.plan().map((x) => `${x.done ? 'x' : '-'} ${x.text}`)).toEqual(['x old one 10 min', 'x old two 20 min'])
    expect(w.remote.exec(`SELECT review, reasons FROM day_plans WHERE day = '${DAY}'`)[0].values).toEqual([['ok day', '["Tired"]']])
  })
})

describe('honest sleep points after two devices met', () => {
  it('paid for "up on time" here, corrected to late on the other device: the points go back, once', async () => {
    const w = world(false)
    const A = await w.device('a')
    const B = await w.device('b')
    A.offline()
    B.offline()
    vi.setSystemTime(new Date(`${DAY}T06:40:00Z`))
    expect((await A.write((s) => s.sleep.logWake())).awarded).toBe(true)
    at('09:00')
    expect((await B.write((s) => s.sleep.setWake(DAY, '07:50'))).awarded).toBe(false)
    at('12:00')
    await A.online()
    await B.online()
    await A.online()
    expect(w.night()).toEqual([[null, '07:50']])
    const coins = () => A.read((s) => s.wallet.entries().filter((e) => e.ruleId === 'sleep.up_on_time').reduce((t, e) => t + (e.kind === 'undo' ? -1 : 1), 0))
    expect(await coins()).toBe(1)
    expect(await A.write((s) => s.sleep.settle())).toBe(1)
    expect(await coins()).toBe(0)
    expect(await A.write((s) => s.sleep.settle())).toBe(0)
  })

  for (const desktop of [false, true]) {
    it(`both devices paid for the same on-time wake-up: one payment stays (${desktop ? 'desktop' : 'website'})`, async () => {
      const w = world(desktop)
      const A = await w.device('a')
      const B = await w.device('b')
      A.offline()
      B.offline()
      vi.setSystemTime(new Date(`${DAY}T06:40:00Z`))
      expect((await A.write((s) => s.sleep.logWake())).awarded).toBe(true)
      vi.setSystemTime(new Date(`${DAY}T06:42:00Z`))
      expect((await B.write((s) => s.sleep.logWake())).awarded).toBe(true)
      at('12:00')
      await A.online()
      await B.online()
      await A.online()
      // The desktop renumbers its payment and sends it: the second one is taken back.
      // The website's second payment has the first one's number and is refused (kept in "couldn't sync").
      expect(await A.write((s) => s.sleep.settle())).toBe(desktop ? 1 : 0)
      const live = await A.read((s) => {
        const all = s.wallet.entries()
        const gone = new Set(all.map((e) => e.undoOf))
        return all.filter((e) => e.ruleId === 'sleep.up_on_time' && e.coins > 0 && !gone.has(e.id)).length
      })
      expect(live).toBe(1)
      // One row. (The website keeps the first tap that arrives; the desktop's merge keeps the later one.)
      expect(w.night()).toEqual([[null, desktop ? '06:42' : '06:40']])
    })
  }

  it('website: a refused payment never takes the night or the must-dos with it', async () => {
    const w = world(false)
    const A = await w.device('a')
    const B = await w.device('b')
    at('08:00')
    await A.write((s) => s.focus.setPlan(['read 20 pages', 'math 40 min']))
    await A.online()
    await B.online()
    A.offline()
    B.offline()
    at('08:31')
    // Both earn points offline: the two payments get the same number.
    expect(await A.write((s) => s.focus.togglePlan(0, new Date(), DAY).coins)).toBeGreaterThan(0)
    at('08:40')
    expect(await B.write((s) => s.focus.togglePlan(1, new Date(), DAY).coins)).toBeGreaterThan(0)
    at('08:41')
    await B.write((s) => s.sleep.setNight(DAY, '23:20', '07:30'))
    at('12:00')
    await A.online()
    await B.online()
    await A.online()
    expect(w.plan().map((x) => `${x.done ? 'x' : '-'} ${x.text}`)).toEqual(['x read 20 pages', 'x math 40 min'])
    expect(w.night()).toEqual([['23:20', '07:30']])
    // The payment that could not be sent is listed, not silently gone.
    expect(B.m.failedSync.length).toBe(1)
    expect(B.m.failedSync[0].batch.some((c) => /INSERT INTO ledger/i.test(c.sql))).toBe(true)
    expect(B.m.failedSync[0].batch.some((c) => /day_plans/i.test(c.sql))).toBe(false)
  })
})

describe('a copy saved on this device by the version before (no new columns yet)', () => {
  for (const desktop of [false, true]) {
    it(`gets the new columns, and so does the server, before the first change is sent (${desktop ? 'desktop' : 'website'})`, async () => {
      const remote = new SQL.Database()
      const old = new SQL.Database()
      for (const m of MIGRATIONS.slice(0, 23)) (remote.exec(m), old.exec(m))
      for (const db of [remote, old]) db.run("INSERT INTO settings (key, value) VALUES ('data_version', 'v1')")
      const bytes = old.export()
      vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => {
        const json = handlePipeline(remote, JSON.parse(init.body))
        return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
      })
      vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 })
      vi.stubGlobal('window', { addEventListener: () => {}, dispatchEvent: () => true })
      vi.stubGlobal('navigator', { onLine: true })
      const store: MirrorStore = { load: async () => bytes, save: async () => {} }
      const m = new Mirror(SQL, new TursoHttp('https://old.turso.io', 't'), store, desktop)
      await m.ready
      await m.write((db) => {
        const wallet = new Wallet(db as any, 'UTC')
        new SleepService(db as any, wallet).setNight(DAY, '23:10', '06:40')
        new FocusService(db as any, wallet).setPlan(['read 20 pages'], new Date(), DAY)
      })
      await m.refresh()
      expect(remote.exec(`SELECT bed_time, wake_time, bed_at IS NOT NULL FROM sleep_logs WHERE day = '${DAY}'`)[0].values).toEqual([['23:10', '06:40', 1]])
      expect(String(remote.exec(`SELECT items FROM day_plans WHERE day = '${DAY}'`)[0].values[0][0])).toContain('read 20 pages')
    })
  }
})

describe('desktop: a night is found by its day, whatever number each side gave the row', () => {
  it('this PC and the server numbered the night differently: an offline edit still merges into that night', async () => {
    const w = world(true)
    // The server's next row number is ahead of a fresh copy's (a row was made and removed there).
    w.remote.run("INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, created_at) VALUES ('2026-01-01', '07:00', '06:45', 0, 'x')")
    w.remote.run("DELETE FROM sleep_logs WHERE day = '2026-01-01'")
    const A = await w.device('a')
    at('08:31')
    await A.write((s) => s.sleep.setNight(DAY, '23:10', '06:40'))
    await A.online()
    const ids = () => w.remote.exec(`SELECT id FROM sleep_logs WHERE day = '${DAY}'`)[0].values.map((r) => r[0])
    expect(ids()).toEqual([2])
    A.offline()
    at('09:00')
    await A.write((s) => s.sleep.setBed(DAY, '23:25'))
    // Meanwhile another device corrects the wake-up of the same night, and logs another day.
    w.remote.run(`UPDATE sleep_logs SET wake_time = '06:50', wake_at = '2026-11-13T09:30:00.000Z', updated_at = '2026-11-13T09:30:00.000Z' WHERE day = '${DAY}'`)
    w.remote.run("INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, created_at) VALUES ('2026-11-12', '07:10', '06:45', 0, 'x')")
    w.remote.run("UPDATE settings SET value = 'other-device' WHERE key = 'data_version'")
    at('12:00')
    await A.online()
    expect(A.m.health().error).toBeNull()
    expect(w.night()).toEqual([['23:25', '06:50']])
    expect(w.remote.exec('SELECT COUNT(*) FROM sleep_logs')[0].values[0][0]).toBe(2)
    expect(await A.read((s) => s.sleep.logs().filter((l) => l.day === DAY).map((l) => [l.bedTime, l.wakeTime]))).toEqual([['23:25', '06:50']])
  })

  it('a night made offline here while the server gave its number to another day', async () => {
    const w = world(true)
    const A = await w.device('a')
    A.offline()
    at('08:31')
    await A.write((s) => s.sleep.setNight(DAY, '23:10', '06:40'))
    w.remote.run("INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, created_at) VALUES ('2026-11-12', '07:10', '06:45', 0, 'x')")
    w.remote.run("UPDATE settings SET value = 'other-device' WHERE key = 'data_version'")
    at('12:00')
    await A.online()
    expect(A.m.health().error).toBeNull()
    expect(w.remote.exec('SELECT day, bed_time, wake_time FROM sleep_logs ORDER BY day')[0].values).toEqual([['2026-11-12', null, '07:10'], [DAY, '23:10', '06:40']])
  })
})
