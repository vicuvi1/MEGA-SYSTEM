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

  it('when another device wrote meanwhile, the change is refused cleanly and the copy reloads', async () => {
    const remote = fakeTurso()
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await mirror.ready
    // The phone logs something the PC's copy doesn't know about yet.
    remote.run(`INSERT INTO ledger (ts, day, module, kind, coins, xp, rule_id, note) VALUES ('2026-10-31T07:00:00Z', '2026-10-31', 'body', 'earn', 7, 0, NULL, 'phone')`)
    await expect(mirror.write((db) => new Wallet(db as any).award('sleep.up_on_time'))).rejects.toBeInstanceOf(MirrorError)
    // Reloaded: it now sees the phone's row, and the retry works.
    const seen = await mirror.read((db) => db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE note = 'phone'").get() as { n: number })
    expect(seen.n).toBe(1)
    await mirror.write((db) => new Wallet(db as any).award('sleep.up_on_time'))
    expect(count(remote, "SELECT COUNT(*) FROM ledger WHERE rule_id = 'sleep.up_on_time'")).toBe(1)
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
