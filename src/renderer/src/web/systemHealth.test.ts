// Health beats count failures in a row; the first OK after them clears the streak
// (so a health card shows only after a sustained failure and clears by itself).
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { handlePipeline } from './fakeTurso'
import { TursoHttp } from './tursoHttp'
import { beat, readHealth } from './systemHealth'
import { alertDecisions, healthChecks } from '@core/health'

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

const at = (h: number, m: number) => new Date(2026, 10, 7, h, m)
const check = async (t: TursoHttp, now: Date) => {
  const h = await readHealth(t)
  return healthChecks({ now, beats: h.beats, sportySeen: null, latestSnapshot: null, today: '2026-11-07', errors: [] }).find((c) => c.id === 'ai')!
}

describe('AI health beats', () => {
  it('one timeout and then silence: OK at 11:10, no card (the Saturday bug)', async () => {
    const t = turso()
    await beat(t, 'ai-sat', true, undefined, at(10, 30))
    await beat(t, 'ai-sat', false, 'The operation was aborted due to timeout', at(10, 36))
    const h = await readHealth(t)
    expect(h.beats['ai-sat'].fails).toMatchObject({ n: 1 })
    const c = healthChecks({ now: at(11, 10), beats: { ai: h.beats['ai-sat'] }, sportySeen: null, latestSnapshot: null, today: '2026-11-07', errors: [] }).find((x) => x.id === 'ai')!
    expect(c.ok).toBe(true)
    expect(alertDecisions([c], {}, at(11, 10)).warn).toEqual([])
  })

  it('three failures in a row alert after 30 min; the next OK clears the streak and the card', async () => {
    const t = turso()
    await beat(t, 'ai', false, 'OpenRouter 502', at(12, 0))
    await beat(t, 'ai', false, 'OpenRouter 502', at(12, 10))
    await beat(t, 'ai', false, 'OpenRouter 502', at(12, 20))
    const down = await check(t, at(12, 35))
    expect(down).toMatchObject({ ok: false })
    expect(down.detail).toMatch(/3 failed in a row/)
    const a = alertDecisions([down], {}, at(12, 35))
    expect(a.warn).toHaveLength(1)
    await beat(t, 'ai', true, undefined, at(12, 40))
    expect((await readHealth(t)).beats.ai.fails).toBeUndefined()
    const up = await check(t, at(12, 41))
    expect(up.ok).toBe(true)
    // "Working again" once it has stayed OK for an hour.
    const seen = alertDecisions([up], a.next, at(12, 41))
    expect(seen.fixed).toHaveLength(0)
    expect(alertDecisions([up], seen.next, at(13, 41)).fixed).toHaveLength(1)
  })
})
