import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { handlePipeline } from './fakeTurso'
import { TursoHttp } from './tursoHttp'
import { logErrors, readHealth } from './systemHealth'

const sent: any[][] = []
vi.mock('../bridge', () => ({ life: { system: { logError: async () => {}, logErrors: async (list: any[]) => void sent.push(list) } } }))

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})

function turso() {
  const db = new SQL.Database()
  const fetchImpl = (async (_u: string, init: { body: string }) => ({ ok: true, status: 200, json: async () => handlePipeline(db, JSON.parse(init.body)), text: async () => JSON.stringify(handlePipeline(db, JSON.parse(init.body))) })) as unknown as typeof fetch
  return { db, t: new TursoHttp('https://fake.turso.io', 'k', undefined, fetchImpl) }
}

describe('the error log', () => {
  afterEach(async () => {
    const { resetErrorReport } = await import('../errorReport')
    resetErrorReport()
    sent.length = 0
    vi.useRealTimers()
  })

  it('keeps the stack, the build and the screen, in a table devices never sync', async () => {
    const { db, t } = turso()
    await logErrors(t, [
      { source: 'web', msg: 'x is undefined', stack: 'TypeError: x is undefined\n at /assets/index.js:1:2', version: 'web 1.4.0+abc1234', place: '/#/today' },
      { source: 'web', msg: 'second' }
    ])
    const h = await readHealth(t)
    expect(h.errors.map((e) => e.msg)).toEqual(['x is undefined', 'second'])
    expect(h.errors[0]).toMatchObject({ version: 'web 1.4.0+abc1234', place: '/#/today' })
    expect(h.errors[0].stack).toContain('index.js:1:2')
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0].values.flat()
    expect(tables).toContain('sys_error_log')
    expect(tables.every((n) => !String(n).startsWith('sys_') || /^sys_(health|error_log)$/.test(String(n)))).toBe(true)
  })

  it('errors wait and go out together, once each', async () => {
    vi.useFakeTimers()
    const { reportError, pendingErrors } = await import('../errorReport')
    reportError('web', 'boom', 'Error: boom\n    at f (https://mega-system-ten.vercel.app/assets/index-abc.js:10:5)')
    reportError('web', 'boom') // same message again: skipped
    reportError('web', 'other')
    reportError('web', 'Failed to fetch') // browser noise: skipped
    expect(pendingErrors()).toBe(2)
    expect(sent).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(sent).toHaveLength(1)
    expect(sent[0].map((e: any) => e.msg)).toEqual(['boom', 'other'])
    expect(sent[0][0].stack).toContain('/assets/index-abc.js:10:5')
    expect(sent[0][0].stack).not.toContain('vercel.app')
    expect(sent[0][0].version).toBeTruthy()
  })

  it('ten waiting errors are sent at once', async () => {
    const { reportError } = await import('../errorReport')
    for (let i = 0; i < 10; i++) reportError('web', `e${i}`)
    await Promise.resolve()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toHaveLength(10)
  })
})
