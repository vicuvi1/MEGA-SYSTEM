// The server's copy starts small (web/mirror.ts LazyLoad, telegramBot.ts
// SERVER_COPY): a cold start no longer reads the whole database, and nothing
// ever runs against a table that is only empty because it was not downloaded.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from '../renderer/src/web/fakeTurso'
import { Mirror } from '../renderer/src/web/mirror'
import { TursoHttp } from '../renderer/src/web/tursoHttp'
import { SERVER_COPY, rowsIn } from './telegramBot'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.unstubAllGlobals())

function world() {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  remote.run("INSERT INTO settings (key, value) VALUES ('data_version', 'v1'), ('coach_profile', '{}'), ('app_sync_finance', ?), ('finance_backup_json', ?), ('app_sync_waky', '{\"data\":{}}')", [
    JSON.stringify({ editedAt: 5, data: { tx: [{ id: 'a', note: 'made-up coffee' }] } }),
    'x'.repeat(5000)
  ])
  for (let i = 0; i < 300; i++) remote.run("INSERT INTO body_log (id, at, day, kind, amount) VALUES (?, '2026-11-13T08:00:00Z', '2026-11-13', 'water', 250)", [`w${i}`])
  for (let i = 0; i < 40; i++) remote.run("INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, created_at) VALUES (?, '06:40', '06:45', 1, 'x')", [`2026-10-${String((i % 28) + 1).padStart(2, '0')}-${i}`])
  let rows = 0
  const sql: string[] = []
  const fetchImpl = (async (_u: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    for (const r of body.requests ?? []) for (const st of r.stmt ? [r.stmt] : (r.batch?.steps?.map((x: any) => x.stmt) ?? [])) sql.push(String(st.sql))
    const json = handlePipeline(remote, body)
    rows += rowsIn(json)
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  }) as unknown as typeof fetch
  const open = async (lazy: typeof SERVER_COPY | null) => {
    rows = 0
    const m = new Mirror(SQL, new TursoHttp('https://lazy.turso.io', 't', undefined, fetchImpl), null, false, lazy)
    await m.ready
    return m
  }
  return { remote, open, rows: () => rows, sql }
}

describe("the server's copy starts small", () => {
  it("a cold start reads far fewer rows, and not the apps' big copies", async () => {
    const w = world()
    await w.open(null)
    const whole = w.rows()
    w.sql.length = 0
    const m = await w.open(SERVER_COPY)
    expect(w.rows()).toBeLessThan(whole - 300)
    expect(w.sql.some((q) => /FROM "body_log"|FROM "sleep_logs"/.test(q))).toBe(false)
    // Small settings are there at once.
    expect(await m.read((db) => db.prepare("SELECT value FROM settings WHERE key = 'coach_profile'").get()?.value)).toBe('{}')
  })

  it('a table is downloaded the first time it is read, even when the caller swallows errors', async () => {
    const w = world()
    const m = await w.open(SERVER_COPY)
    expect(await m.read((db) => (db.prepare('SELECT COUNT(*) AS n FROM body_log').get() as any).n)).toBe(300)
    const careless = await m.read((db) => {
      try {
        return (db.prepare('SELECT COUNT(*) AS n FROM sleep_logs').get() as any).n
      } catch {
        return 0 // what a service with a catch-all would answer
      }
    })
    expect(careless).toBe(40)
  })

  it("an app's big copy is downloaded when it is read by its key, or by any query over all settings", async () => {
    const w = world()
    const m = await w.open(SERVER_COPY)
    expect(JSON.parse(String(await m.read((db) => db.prepare('SELECT value FROM settings WHERE key = ?').get('app_sync_finance')?.value))).data.tx[0].note).toBe('made-up coffee')
    // Not the others yet.
    expect(await m.read((db) => db.raw.exec("SELECT COUNT(*) FROM settings WHERE key = 'finance_backup_json'")[0].values[0][0])).toBe(0)
    expect(await m.read((db) => db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE '%backup_json'").get()?.n)).toBe(1)
    // A key that is not on the server: asked once, then known to be absent.
    expect(await m.read((db) => db.prepare('SELECT value FROM settings WHERE key = ?').get('app_sync_man'))).toBeUndefined()
  })

  it("a change to a big copy is made on the server's real value (never on an empty one)", async () => {
    const w = world()
    const m = await w.open(SERVER_COPY)
    await m.write((db) => {
      const cur = JSON.parse(String(db.prepare('SELECT value FROM settings WHERE key = ?').get('app_sync_finance')?.value ?? '{"data":{"tx":[]}}'))
      cur.data.tx.push({ id: 'b', note: 'made-up bus' })
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('app_sync_finance', JSON.stringify(cur))
    })
    const saved = JSON.parse(String(w.remote.exec("SELECT value FROM settings WHERE key = 'app_sync_finance'")[0].values[0][0]))
    expect(saved.data.tx.map((t: any) => t.note)).toEqual(['made-up coffee', 'made-up bus'])
    // Written without reading first: the copy is downloaded before the change runs, so the server's check sees the real row.
    await m.write((db) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('app_sync_waky', '{"data":{"n":1}}'))
    expect(w.remote.exec("SELECT value FROM settings WHERE key = 'app_sync_waky'")[0].values[0][0]).toBe('{"data":{"n":1}}')
  })

  it('a change in a table goes to the real rows, and later changes by other devices arrive', async () => {
    const w = world()
    const m = await w.open(SERVER_COPY)
    await m.write((db) => db.prepare("INSERT INTO body_log (id, at, day, kind, amount) VALUES ('new', '2026-11-13T09:00:00Z', '2026-11-13', 'water', 500)").run())
    expect(w.remote.exec('SELECT COUNT(*) FROM body_log')[0].values[0][0]).toBe(301)
    expect(await m.read((db) => (db.prepare('SELECT COUNT(*) AS n FROM body_log').get() as any).n)).toBe(301)
    // Another device adds a row to a loaded table and to one not loaded yet.
    w.remote.run("INSERT INTO body_log (id, at, day, kind, amount) VALUES ('other', '2026-11-13T10:00:00Z', '2026-11-13', 'water', 250)")
    w.remote.run("INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, created_at) VALUES ('2026-11-13', '06:50', '06:45', 1, 'x')")
    w.remote.run("UPDATE settings SET value = 'v-other' WHERE key = 'data_version'")
    w.sql.length = 0
    await m.refresh()
    expect(await m.read((db) => (db.prepare('SELECT COUNT(*) AS n FROM body_log').get() as any).n)).toBe(302)
    expect(w.sql.some((q) => /FROM "sleep_logs"/.test(q))).toBe(false)
    expect(await m.read((db) => (db.prepare('SELECT COUNT(*) AS n FROM sleep_logs').get() as any).n)).toBe(41)
  })
})
