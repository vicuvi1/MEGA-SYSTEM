import { createRequire } from 'node:module'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic, type Database as SqlJsDatabase } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { Wallet } from '../../../main/wallet'
import { Shop } from '../../../main/shop'
import { normalize } from './browserDb'
import { handlePipeline } from './fakeTurso'
import { Mirror, MirrorError } from './mirror'
import { TursoHttp } from './tursoHttp'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})

/** A fake Turso with the desktop schema, reached through a stubbed fetch. */
function fakeTurso(schema = MIGRATIONS): SqlJsDatabase {
  const remote = new SQL.Database()
  for (const m of schema) remote.exec(m)
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    const json = handlePipeline(remote, body)
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  return remote
}

const count = (db: SqlJsDatabase, sql: string) => Number(db.exec(sql)[0]?.values[0]?.[0] ?? 0)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('normalize', () => {
  it('turns @named parameters into ? in order', () => {
    expect(normalize('INSERT INTO t (a, b) VALUES (@a, @b)', [{ b: 2, a: 1 }])).toEqual({ sql: 'INSERT INTO t (a, b) VALUES (?, ?)', args: [1, 2] })
    expect(normalize("SELECT ':nope' WHERE x = :x", [{ x: true }])).toEqual({ sql: "SELECT ':nope' WHERE x = ?", args: [1] })
    expect(normalize('SELECT ?, ?', [5, undefined])).toEqual({ sql: 'SELECT ?, ?', args: [5, null] })
  })
})

describe('Mirror', () => {
  it('loads what Turso has, and the desktop services read it', async () => {
    const remote = fakeTurso()
    remote.run(
      `INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note) VALUES ('2026-10-30T08:00:00Z', '2026-10-30', 'body', 'earn', 40, 25, 'body.workout_done', 'phone')`
    )
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await mirror.ready
    const summary = await mirror.read((db) => new Wallet(db as any).summary())
    expect(summary.balance).toBe(40)
    // Default rules were seeded on Turso too, like the desktop does.
    expect(count(remote, 'SELECT COUNT(*) FROM rules')).toBeGreaterThan(5)
  })

  it('a change lands in Turso with the same ids, so undo points at the right row', async () => {
    const remote = fakeTurso()
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await mirror.ready
    await mirror.write((db) => new Wallet(db as any).award('sleep.up_on_time'))
    const id = count(remote, 'SELECT MAX(id) FROM ledger')
    await mirror.write((db) => new Wallet(db as any).undo(id, 'oops'))
    expect(count(remote, `SELECT COUNT(*) FROM ledger WHERE kind = 'undo' AND undo_of = ${id}`)).toBe(1)
    const local = await mirror.read((db) => new Wallet(db as any).summary())
    expect(local.balance).toBe(count(remote, "SELECT COALESCE(SUM(coins), 0) FROM ledger WHERE id NOT IN (SELECT undo_of FROM ledger WHERE undo_of IS NOT NULL) AND kind != 'undo'"))
  })

  it('spending coins in the shop is saved to Turso (it was lost on reload before)', async () => {
    const remote = fakeTurso()
    remote.run(`INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note) VALUES ('2026-10-30T08:00:00Z', '2026-10-30', 'x', 'adjust', 1000, 0, NULL, 'start')`)
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await mirror.ready
    const reward = await mirror.read((db) => (db.prepare('SELECT id, price FROM rewards ORDER BY price LIMIT 1').get() as { id: number; price: number }))
    await mirror.write((db) => {
      const wallet = new Wallet(db as any)
      new Shop(db as any, wallet).redeem(reward.id)
    })
    expect(count(remote, 'SELECT COUNT(*) FROM redemptions')).toBe(1)
    expect(count(remote, 'SELECT SUM(coins) FROM ledger')).toBe(1000 - reward.price)
  })

  it('when another device wrote meanwhile (same new id), the copy reloads and the change runs again on it (Y5)', async () => {
    const remote = fakeTurso()
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await mirror.ready
    // The phone logs something the PC's copy doesn't know about yet.
    remote.run(`INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note) VALUES ('2026-10-31T07:00:00Z', '2026-10-31', 'body', 'earn', 7, 0, NULL, 'phone')`)
    await mirror.write((db) => new Wallet(db as any).award('sleep.up_on_time'))
    // Both rows are there: the phone's and ours, once.
    const seen = await mirror.read((db) => db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE note = 'phone'").get() as { n: number })
    expect(seen.n).toBe(1)
    expect(count(remote, "SELECT COUNT(*) FROM ledger WHERE rule_id = 'sleep.up_on_time'")).toBe(1)
    expect(count(remote, "SELECT COUNT(*) FROM ledger WHERE note = 'phone'")).toBe(1)
  })

  it('a write sent twice (timeout, then retry) is saved once (Y5)', async () => {
    const remote = fakeTurso()
    const http = new TursoHttp('https://fake.turso.io', 't')
    const mirror = new Mirror(SQL, http)
    await mirror.ready
    const real = http.writeAtomic.bind(http)
    let first = true
    http.writeAtomic = async (stmts) => {
      const r = await real(stmts)
      if (first) {
        first = false
        throw Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' })
      }
      return r
    }
    await mirror.write((db) => db.prepare("INSERT INTO settings (key, value) VALUES ('y5', 'once')").run())
    expect(count(remote, "SELECT COUNT(*) FROM settings WHERE key = 'y5'")).toBe(1)
  })

  it('adds tables and columns Turso is missing, without touching the rest', async () => {
    // A Turso made from the first 6 migrations only.
    const remote = fakeTurso(MIGRATIONS.slice(0, 6))
    remote.run(`INSERT INTO settings (key, value) VALUES ('keep', 'me')`)
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await mirror.ready
    expect(count(remote, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'wishlist_goals'")).toBe(1)
    expect(count(remote, "SELECT COUNT(*) FROM pragma_table_info('rewards') WHERE name = 'product_url'")).toBe(1)
    expect(remote.exec("SELECT value FROM settings WHERE key = 'keep'")[0].values[0][0]).toBe('me')
  })

  it('a failed rule (daily cap) changes nothing, here or on Turso', async () => {
    const remote = fakeTurso()
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await mirror.ready
    await mirror.write((db) => new Wallet(db as any).award('sleep.up_on_time'))
    await expect(mirror.write((db) => new Wallet(db as any).award('sleep.up_on_time'))).rejects.toThrow()
    expect(count(remote, "SELECT COUNT(*) FROM ledger WHERE rule_id = 'sleep.up_on_time'")).toBe(1)
  })

  it('a refresh with nothing new is one tiny read; a change from another device still arrives', async () => {
    const remote = fakeTurso()
    const a = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await a.ready
    const b = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await b.ready
    const calls = vi.fn()
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      calls(JSON.parse(init.body).requests.length)
      return (realFetch as any)(url, init)
    })
    await b.refresh()
    expect(calls).toHaveBeenCalledTimes(1) // just the version check
    await a.write((db) => new Wallet(db as any).award('body.workout_done'))
    calls.mockClear()
    await b.refresh()
    expect(calls.mock.calls.length).toBeGreaterThan(1) // it downloaded again
    const balance = await b.read((db) => new Wallet(db as any).summary().balance)
    expect(balance).toBe(count(remote, 'SELECT COALESCE(SUM(coins), 0) FROM ledger'))
  })
})

describe('no lost updates between copies', () => {
  it('a setting changed by another copy is not overwritten: the change is redone on fresh data', async () => {
    const remote = fakeTurso()
    const a = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    const b = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await a.ready
    await b.ready
    const add = (m: Mirror, item: string) =>
      m.write((db) => {
        const cur = JSON.parse((db.prepare("SELECT value FROM settings WHERE key = 'list'").get() as any)?.value ?? '[]')
        db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run('list', JSON.stringify([...cur, item]))
        return cur.length
      })
    await add(a, 'from A')
    await add(b, 'from B') // b's copy didn't have "from A" yet: it must not drop it
    const saved = JSON.parse(String(remote.exec("SELECT value FROM settings WHERE key = 'list'")[0].values[0][0]))
    expect(saved.sort()).toEqual(['from A', 'from B'])
    expect(count(remote, 'SELECT COUNT(*) FROM sys_cas')).toBe(0)
  })
})

describe('records edited on two devices', () => {
  it('an edit made on a stale copy is redone on fresh data instead of erasing the other edit', async () => {
    const remote = fakeTurso()
    const cat = String(remote.exec('SELECT id FROM categories LIMIT 1')[0]?.values[0]?.[0] ?? 'study')
    if (!remote.exec('SELECT id FROM categories LIMIT 1')[0]) remote.run("INSERT INTO categories (id, name) VALUES ('study', 'Study')")
    remote.run("INSERT INTO tasks (id, title, category, priority, coins, xp, repeat, created_day) VALUES (1, 'Lab', ?, 2, 5, 10, 'none', '2026-11-04')", [cat])
    const a = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    const b = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await a.ready
    await b.ready
    await a.write((db) => db.prepare('UPDATE tasks SET title = ? WHERE id = ?').run('Lab report', 1))
    let seen = ''
    await b.write((db) => {
      seen = String((db.prepare('SELECT title FROM tasks WHERE id = 1').get() as any).title)
      db.prepare('UPDATE tasks SET priority = ? WHERE id = ?').run(1, 1)
    })
    expect(seen).toBe('Lab report') // b ran again on fresh data
    expect(remote.exec('SELECT title, priority FROM tasks WHERE id = 1')[0].values[0]).toEqual(['Lab report', 1])
  })
})

describe('offline on the phone', () => {
  // Back online at once (the wait between tries is tested on its own: CL7).
  beforeEach(() => {
    Mirror.RETRY_BASE = 0
  })
  afterEach(() => {
    Mirror.RETRY_BASE = 5000
  })
  it('a change made offline stays and reaches Turso when back online', async () => {
    const remote = fakeTurso()
    const realFetch = globalThis.fetch
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) })
    vi.stubGlobal('window', { addEventListener: () => {}, dispatchEvent: () => true })
    vi.stubGlobal('navigator', { onLine: true })
    const m = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await m.ready
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await m.write((db) => db.prepare("INSERT INTO settings (key, value) VALUES ('offline_test', 'yes') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run())
    expect(m.pendingOffline).toBe(1)
    expect(await m.read((db) => (db.prepare("SELECT value FROM settings WHERE key = 'offline_test'").get() as any)?.value)).toBe('yes')
    vi.stubGlobal('fetch', realFetch)
    await m.refresh()
    expect(m.pendingOffline).toBe(0)
    expect(remote.exec("SELECT value FROM settings WHERE key = 'offline_test'")[0].values[0][0]).toBe('yes')
  })

  it('a server error (500) keeps the offline change for later instead of dropping it (Y1)', async () => {
    fakeTurso()
    const realFetch = globalThis.fetch
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) })
    vi.stubGlobal('window', { addEventListener: () => {}, dispatchEvent: () => true })
    vi.stubGlobal('navigator', { onLine: true })
    const m = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await m.ready
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await m.write((db) => db.prepare("INSERT INTO settings (key, value) VALUES ('y1', 'kept') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run())
    expect(m.pendingOffline).toBe(1)
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, statusText: 'Server error', text: async () => 'boom' }))
    await m.refresh().catch(() => null)
    expect(m.pendingOffline).toBe(1)
    expect(m.failedSync).toHaveLength(0)
    vi.stubGlobal('fetch', realFetch)
  })

  it('a server hiccup while saving keeps the change and sends it later (S3)', async () => {
    const remote = fakeTurso()
    const realFetch = globalThis.fetch
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) })
    vi.stubGlobal('window', { addEventListener: () => {}, dispatchEvent: () => true })
    vi.stubGlobal('navigator', { onLine: true })
    const m = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await m.ready
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 503, statusText: 'Unavailable', text: async () => 'busy' }))
    await m.write((db) => db.prepare("INSERT INTO settings (key, value) VALUES ('s3', 'kept') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run())
    expect(m.pendingOffline).toBe(1)
    expect(await m.read((db) => (db.prepare("SELECT value FROM settings WHERE key = 's3'").get() as any)?.value)).toBe('kept')
    vi.stubGlobal('fetch', realFetch)
    await m.refresh()
    expect(m.pendingOffline).toBe(0)
    expect(remote.exec("SELECT value FROM settings WHERE key = 's3'")[0].values[0][0]).toBe('kept')
  })

  it('BG2/BG8: a second edit of the same setting during a hiccup waits behind the first, and a refresh keeps both on screen', async () => {
    const remote = fakeTurso()
    const realFetch = globalThis.fetch
    const mem = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) })
    vi.stubGlobal('window', { addEventListener: () => {}, dispatchEvent: () => true })
    vi.stubGlobal('navigator', { onLine: true })
    const m = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await m.ready
    const set = (v: string) => m.write((db) => db.prepare("INSERT INTO settings (key, value) VALUES ('bg2', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(v))
    const get = () => m.read((db) => (db.prepare("SELECT value FROM settings WHERE key = 'bg2'").get() as any)?.value)
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 503, statusText: 'Unavailable', text: async () => 'busy' }))
    await set('first')
    // The server answers again, but only for reads: the queue can't go yet.
    let calls = 0
    vi.stubGlobal('fetch', async (u: string, init: any) => (calls++ < 1 ? { ok: false, status: 503, statusText: 'Unavailable', text: async () => 'busy' } : realFetch(u, init)))
    await set('second')
    expect(m.pendingOffline).toBe(2)
    expect(await get()).toBe('second')
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 503, statusText: 'Unavailable', text: async () => 'busy' }))
    await m.refresh().catch(() => null)
    expect(await get()).toBe('second')
    vi.stubGlobal('fetch', realFetch)
    await m.refresh()
    expect(m.pendingOffline).toBe(0)
    expect(m.failedSync).toHaveLength(0)
    expect(remote.exec("SELECT value FROM settings WHERE key = 'bg2'")[0].values[0][0]).toBe('second')
  })

  it("storage full: the change still goes out from this tab, and you're told (S3)", async () => {
    fakeTurso()
    const realFetch = globalThis.fetch
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') }, removeItem: () => {} })
    vi.stubGlobal('window', { addEventListener: () => {}, dispatchEvent: () => true })
    vi.stubGlobal('navigator', { onLine: true })
    const m = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await m.ready
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await m.write((db) => db.prepare("INSERT INTO settings (key, value) VALUES ('s3b', 'x') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run())
    expect(m.pendingOffline).toBe(1)
    expect(m.lastError).toMatch(/can't store them/)
    vi.stubGlobal('fetch', realFetch)
    await m.refresh()
    expect(m.pendingOffline).toBe(0)
  })
})

describe('a long history and a quiet device (castle)', () => {
  /** A fake Turso that refuses answers over `maxRows` rows (like Vercel's 4.5 MB), and records every SQL. */
  function limitedTurso(maxRows: number) {
    const remote = new SQL.Database()
    for (const m of MIGRATIONS) remote.exec(m)
    const sqls: string[] = []
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body)
      for (const r of body.requests) {
        if (r.stmt) sqls.push(r.stmt.sql)
        for (const st of r.batch?.steps ?? []) sqls.push(st.stmt.sql)
      }
      const json = handlePipeline(remote, body)
      const rows = (json.results as any[]).reduce((n, r) => n + (r?.response?.result?.rows?.length ?? 0), 0)
      if (rows > maxRows) return { ok: false, status: 500, statusText: 'FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE', json: async () => ({}), text: async () => 'too large' }
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    })
    return { remote, sqls }
  }
  const PAGE = Mirror.PAGE
  afterEach(() => {
    Mirror.PAGE = PAGE
  })

  it('CL1: a reload of a big table is read in pages, and the ledger only fetches its new rows', async () => {
    Mirror.PAGE = 50
    // A full table in one answer (the old reload) is far over the limit; pages of 8 tables fit.
    const { remote, sqls } = limitedTurso(450)
    for (let i = 0; i < 400; i++) remote.run(`INSERT INTO ledger (ts, day, module, kind, coins, xp, note) VALUES ('2026-10-01T08:00:00Z', '2026-10-01', 'quests', 'adjust', 1, 0, 'old ${i}')`)
    for (let i = 0; i < 300; i++) remote.run(`INSERT INTO settings (key, value) VALUES ('k${i}', 'v')`)
    const a = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await a.ready
    const b = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await b.ready
    // Another device adds points and changes a setting.
    await b.write((db) => {
      new Wallet(db as any).award('body.workout_done')
      db.prepare("INSERT INTO settings (key, value) VALUES ('k1', 'new') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run()
    })
    sqls.length = 0
    expect(await a.refresh()).toBe(true)
    // No full download: only the changed tables, the ledger from our newest id on.
    expect(sqls.some((q) => /FROM "ledger" WHERE id > \?/.test(q))).toBe(true)
    expect(sqls.some((q) => /FROM "focus_sessions"/.test(q))).toBe(false)
    expect(await a.read((db) => new Wallet(db as any).summary().balance)).toBe(count(remote, 'SELECT SUM(coins) FROM ledger'))
    expect(await a.read((db) => (db.prepare("SELECT value FROM settings WHERE key = 'k1'").get() as any).value)).toBe('new')
    expect(await a.read((db) => (db.prepare('SELECT COUNT(*) AS n FROM ledger').get() as any).n)).toBe(count(remote, 'SELECT COUNT(*) FROM ledger'))
  })

  it('CL1: an old ledger row put back on the server (a restore) makes the ledger reload in full, never a wrong copy', async () => {
    Mirror.PAGE = 50
    const { remote } = limitedTurso(450)
    for (let i = 1; i <= 200; i++) if (i !== 3) remote.run(`INSERT INTO ledger (id, ts, day, module, kind, coins, xp, note) VALUES (${i}, '2026-10-01T08:00:00Z', '2026-10-01', 'quests', 'adjust', 1, 0, 'old')`)
    const a = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await a.ready
    const b = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await b.ready
    await b.write((db) => {
      db.prepare("INSERT INTO ledger (id, ts, day, module, kind, coins, xp, note) VALUES (3, '2026-10-01T08:00:00Z', '2026-10-01', 'quests', 'adjust', 5, 0, 'restored')").run()
    })
    await a.refresh()
    expect(await a.read((db) => (db.prepare('SELECT COUNT(*) AS n FROM ledger').get() as any).n)).toBe(200)
    expect(await a.read((db) => (db.prepare('SELECT note FROM ledger WHERE id = 3').get() as any)?.note)).toBe('restored')
  })

  it('CS4: the copy is saved once, a moment after a burst of changes, and at once when the page is left', async () => {
    fakeTurso()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const saves: number[] = []
      const m = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), { load: async () => null, save: async (b) => void saves.push(b.length) })
      await m.ready
      vi.advanceTimersByTime(5000)
      saves.length = 0
      for (let i = 0; i < 5; i++) await m.write((db) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(`cs4-${i}`, 'x'))
      expect(saves).toHaveLength(0)
      vi.advanceTimersByTime(2100)
      expect(saves).toHaveLength(1)
      await m.write((db) => db.prepare("INSERT INTO settings (key, value) VALUES ('cs4-last', 'x')").run())
      m.flushPersist()
      expect(saves).toHaveLength(2)
      vi.advanceTimersByTime(5000)
      expect(saves).toHaveLength(2) // nothing left to save
    } finally {
      vi.useRealTimers()
    }
  })

  it('CL6: the id table is made once and old ids are cleared once a day, not with every change', async () => {
    const { remote, sqls } = limitedTurso(1e9)
    const m = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await m.ready
    sqls.length = 0
    for (let i = 0; i < 3; i++) await m.write((db) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(`cl6-${i}`, 'x'))
    expect(sqls.filter((q) => /CREATE TABLE IF NOT EXISTS sys_writes/.test(q))).toHaveLength(1)
    expect(sqls.filter((q) => /DELETE FROM sys_writes/.test(q))).toHaveLength(1)
    expect(count(remote, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'sys_writes_at'")).toBe(1)
    expect(count(remote, 'SELECT COUNT(*) FROM sys_writes')).toBe(3)
    // Gone (a restore into a new database): made again, the change still saved.
    remote.run('DROP TABLE sys_writes')
    await m.write((db) => db.prepare("INSERT INTO settings (key, value) VALUES ('cl6-after', 'x')").run())
    expect(count(remote, "SELECT COUNT(*) FROM settings WHERE key = 'cl6-after'")).toBe(1)
  })

  it('CL7: offline changes are retried with growing waits, a 401 waits for the PIN, nothing is dropped', async () => {
    const remote = fakeTurso()
    const realFetch = globalThis.fetch
    vi.stubGlobal('window', { addEventListener: () => {}, dispatchEvent: () => true })
    vi.stubGlobal('navigator', { onLine: true })
    const m = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't', () => {}))
    await m.ready
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls++
      return { ok: false, status: 503, statusText: 'Unavailable', text: async () => 'busy' }
    })
    await m.write((db) => db.prepare("INSERT INTO settings (key, value) VALUES ('cl7', '1')").run())
    expect(m.pendingOffline).toBe(1)
    calls = 0
    // More changes during the wait: they queue behind, none of them knocks again.
    for (let i = 0; i < 5; i++) await m.write((db) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(`cl7-${i}`, 'x'))
    expect(calls).toBe(0)
    expect(m.pendingOffline).toBe(6)
    // The session ended: kept, and said plainly.
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, statusText: 'Unauthorized', text: async () => '' }))
    m.resume()
    await new Promise((r) => setTimeout(r, 30))
    expect(m.pendingOffline).toBe(6)
    expect(m.lastError).toMatch(/enter your PIN/)
    expect(m.health().locked).toBe(true)
    // PIN again: it goes out.
    vi.stubGlobal('fetch', realFetch)
    m.resume()
    await new Promise((r) => setTimeout(r, 50))
    await m.refresh()
    expect(m.pendingOffline).toBe(0)
    expect(count(remote, "SELECT COUNT(*) FROM settings WHERE key LIKE 'cl7%'")).toBe(6)
  })
})
