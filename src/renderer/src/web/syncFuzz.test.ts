// Three copies (phone, desktop, Ben's server) adding to the same lists in a
// random order, each from a copy that may be out of date: nothing is lost.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { handlePipeline } from './fakeTurso'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.unstubAllGlobals())

describe('sync stress: three copies, random writes', () => {
  it('every item added on any copy ends up in Turso', async () => {
    const remote = new SQL.Database()
    for (const m of MIGRATIONS) remote.exec(m)
    vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => {
      const json = handlePipeline(remote, JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    })
    const copies = [0, 1, 2].map(() => new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't')))
    for (const c of copies) await c.ready
    let seed = 42
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const added: string[] = []
    for (let n = 0; n < 40; n++) {
      const c = copies[Math.floor(rnd() * 3)]
      const key = rnd() < 0.5 ? 'list_a' : 'list_b'
      const item = `${key}:${n}`
      added.push(item)
      await c.write((db) => {
        const cur = JSON.parse((db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any)?.value ?? '[]')
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify([...cur, item]))
      })
      if (rnd() < 0.2) await copies[Math.floor(rnd() * 3)].refresh()
    }
    const read = (k: string) => JSON.parse(String(remote.exec(`SELECT value FROM settings WHERE key = '${k}'`)[0]?.values[0]?.[0] ?? '[]')) as string[]
    expect([...read('list_a'), ...read('list_b')].sort()).toEqual([...added].sort())
  })
})
