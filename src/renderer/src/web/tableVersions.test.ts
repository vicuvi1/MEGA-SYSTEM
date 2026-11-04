import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic, type Database as SqlJsDatabase } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { setSetting } from '../../../main/settings'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { catchUpPlan } from './tableVersions'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.unstubAllGlobals())

/** A fake Turso that remembers which tables each request read in full. */
function fakeTurso(): { remote: SqlJsDatabase; fullReads: string[][] } {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  remote.exec('CREATE TABLE day_notes (day TEXT PRIMARY KEY, wake_time TEXT)')
  const fullReads: string[][] = []
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    const reads = body.requests.map((r: any) => /^SELECT \* FROM "(\w+)"$/.exec(r.stmt?.sql ?? '')?.[1]).filter(Boolean)
    if (reads.length) fullReads.push(reads)
    const json = handlePipeline(remote, body)
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  return { remote, fullReads }
}

describe('download only what changed', () => {
  it('plans', () => {
    const all = new Set(['a', 'b'])
    expect(catchUpPlan('v2', { '*': 'v2', a: 'v2', b: 'v1' }, 'v2', { a: 'v2', b: 'v1' }, all)).toEqual({ kind: 'same' })
    expect(catchUpPlan('v2', { '*': 'v2', a: 'v2', b: 'v1' }, 'v1', { a: 'v1', b: 'v1' }, all)).toEqual({ kind: 'tables', tables: ['a'] })
    // An untracked change since (older app, restore): everything.
    expect(catchUpPlan('v3', { '*': 'v2', a: 'v2' }, 'v1', { a: 'v1' }, all)).toEqual({ kind: 'full' })
    expect(catchUpPlan('v2', null, 'v1', { a: 'v1' }, all)).toEqual({ kind: 'full' })
    expect(catchUpPlan('v2', { '*': 'v2', c: 'v2' }, 'v1', {}, all)).toEqual({ kind: 'full' })
  })

  it('a second device reloads only the table the first one changed; an untracked change reloads everything once', async () => {
    const { remote, fullReads } = fakeTurso()
    const turso = () => new TursoHttp('https://fake.turso.io', 't')
    const a = new Mirror(SQL, turso())
    await a.ready // the first download joins the chain of tracked changes
    const b = new Mirror(SQL, turso())
    await b.ready
    fullReads.length = 0

    await a.write((db) => db.prepare("INSERT INTO day_notes (day, wake_time) VALUES ('2026-11-04', '07:10')").run())
    expect(await b.refresh()).toBe(true)
    expect(fullReads).toEqual([['day_notes']])
    expect(await b.read((db) => db.prepare('SELECT wake_time FROM day_notes').get())).toEqual({ wake_time: '07:10' })

    // Nothing new: one tiny query, no download.
    fullReads.length = 0
    expect(await b.refresh()).toBe(false)
    expect(fullReads).toEqual([])

    // b's own change: a picks up only that table, b doesn't reload its own.
    await b.write((db) => setSetting(db as any, 'theme', 'light'))
    expect(await b.refresh()).toBe(false)
    expect(fullReads).toEqual([])
    await a.refresh()
    expect(fullReads.flat()).toEqual(['settings'])

    // Something that doesn't track (an older app version) changes a table:
    // everything once, then only changes again.
    remote.run("INSERT INTO day_notes (day, wake_time) VALUES ('2026-11-05', '06:50')")
    remote.run("UPDATE settings SET value = 'old-app-1' WHERE key = 'data_version'")
    fullReads.length = 0
    await b.refresh()
    expect(fullReads[0].length).toBeGreaterThan(5)
    expect(await b.read((db) => db.prepare('SELECT COUNT(*) AS n FROM day_notes').get())).toEqual({ n: 2 })
    await a.refresh() // the repair marked every table: a downloads everything too
    fullReads.length = 0
    await a.write((db) => db.prepare("UPDATE day_notes SET wake_time = '06:45' WHERE day = '2026-11-05'").run())
    await b.refresh()
    expect(fullReads).toEqual([['day_notes']])
    expect(await b.read((db) => db.prepare("SELECT wake_time FROM day_notes WHERE day = '2026-11-05'").get())).toEqual({ wake_time: '06:45' })
  })
})
