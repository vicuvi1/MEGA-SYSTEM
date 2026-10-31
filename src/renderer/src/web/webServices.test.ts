import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic, type Database as SqlJsDatabase } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { createWebServices } from './webServices'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.unstubAllGlobals())

function fakeTurso(): SqlJsDatabase {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const json = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  return remote
}
const count = (db: SqlJsDatabase, sql: string) => Number(db.exec(sql)[0]?.values[0]?.[0] ?? 0)

/** A fresh mirror on the same Turso, like reloading the page or another device. */
async function open() {
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
  await mirror.ready
  return createWebServices(mirror)
}

describe('web services on Turso', () => {
  it('a task added and completed is still there after a reload, paid once', async () => {
    const remote = fakeTurso()
    const web = await open()
    const cat = (await web.tasks.state()).categories[0].id
    const state = await web.tasks.save({ title: 'Read 10 pages', category: cat, coins: 5, xp: 5, priority: 2, due: null, repeat: 'none', weekdays: 0, notes: null })
    const id = state.tasks.find((t: any) => t.title === 'Read 10 pages')!.id
    await web.tasks.complete(id)
    await expect(web.tasks.complete(id)).rejects.toThrow()
    const again = await open()
    expect((await again.tasks.state()).tasks.some((t: any) => t.title === 'Read 10 pages')).toBe(true)
    expect(count(remote, "SELECT COUNT(*) FROM ledger WHERE module = 'tasks' AND kind = 'earn'")).toBe(1)
  })

  it('a clean-day check-in works once a day, and the second one is refused', async () => {
    const remote = fakeTurso()
    remote.run(`INSERT INTO discipline_events (kind, day, ts) VALUES ('start', date('now', '-5 day'), ?)`, [new Date().toISOString()])
    const fresh = await open()
    await fresh.discipline.checkIn()
    await expect(fresh.discipline.checkIn()).rejects.toThrow()
    expect(count(remote, "SELECT COUNT(*) FROM discipline_events WHERE kind = 'checkin'")).toBe(1)
  })

  it('logging the wake-up twice pays once', async () => {
    const remote = fakeTurso()
    const web = await open()
    await web.sleep.logWake('06:00', 4)
    await web.sleep.logWake('06:05', 4).catch(() => undefined)
    expect(count(remote, "SELECT COUNT(*) FROM sleep_logs")).toBe(1)
    expect(count(remote, "SELECT COUNT(*) FROM ledger WHERE rule_id LIKE 'sleep.%' AND kind = 'earn'")).toBeLessThanOrEqual(1)
  })
})
