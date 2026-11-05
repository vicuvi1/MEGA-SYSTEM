import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
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
