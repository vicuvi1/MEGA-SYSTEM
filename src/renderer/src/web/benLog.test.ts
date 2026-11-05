import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { handlePipeline } from './fakeTurso'
import { TursoHttp } from './tursoHttp'
import { logBen, readBenLog } from './systemHealth'
import { mergeLog } from '@core/benLog'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
function turso() {
  const db = new SQL.Database()
  const fetchImpl = (async (_u: string, init: { body: string }) => {
    const out = handlePipeline(db, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => out, text: async () => JSON.stringify(out) }
  }) as unknown as typeof fetch
  return new TursoHttp('https://fake.turso.io', 'k', undefined, fetchImpl)
}

describe("Ben's log", () => {
  it('keeps what was sent, held back (once a day per reason) and failed, newest first', async () => {
    const t = turso()
    const now = new Date('2026-11-05T09:00:00Z')
    await logBen(t, [{ status: 'sent', kind: 'water', text: '<b>💧 Water</b> time' }], now)
    await logBen(t, [{ status: 'skipped', kind: 'water', reason: 'Already sent one like it today' }], now)
    await logBen(t, [{ status: 'skipped', kind: 'water', reason: 'Already sent one like it today' }], now)
    await logBen(t, [{ status: 'failed', kind: 'nudge', reason: 'Telegram: Forbidden' }], now)
    const log = await readBenLog(t)
    expect(log.map((e) => e.status)).toEqual(['failed', 'skipped', 'sent'])
    expect(log[2].text).toBe('💧 Water time')
    expect(log[0].reason).toContain('Forbidden')
  })

  it('an empty log reads as empty', async () => {
    expect(await readBenLog(turso())).toEqual([])
  })

  it('messages and AI calls share one timeline', () => {
    const rows = mergeLog([{ at: '2026-11-05T08:00:00Z', status: 'sent', kind: 'x' }], [{ at: '2026-11-05T09:00:00Z', model: 'a/b', kind: 'nudge', prompt: 100, completion: 20, cost: 0.001 }])
    expect(rows.map((r) => r.type)).toEqual(['ai', 'msg'])
  })
})
