import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
// @ts-expect-error plain JS module without types
import { config, cronSecretOk, gate } from '../../../../api/_lib.mjs'
import { handlePipeline } from './fakeTurso'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
const cfg = config({ TURSO_URL: 'libsql://fake.turso.io', TURSO_TOKEN: 'k' })

describe('open doors closed', () => {
  it('the tick runs at most once per gap, across instances', async () => {
    const db = new SQL.Database()
    const fetchImpl = (async (_u: string, init: { body: string }) => ({ status: 200, text: async () => JSON.stringify(handlePipeline(db, JSON.parse(init.body))) })) as unknown as typeof fetch
    const t = 1_900_000_000_000
    expect(await gate(cfg, 'tick', 50_000, t, fetchImpl)).toBe(true)
    expect(await gate(cfg, 'tick', 50_000, t + 10_000, fetchImpl)).toBe(false)
    expect(await gate(cfg, 'tick', 50_000, t + 51_000, fetchImpl)).toBe(true)
  })
  it('the cron secret is checked exactly', () => {
    expect(cronSecretOk({ headers: { authorization: 'Bearer s3cret' } }, { CRON_SECRET: 's3cret' })).toBe(true)
    expect(cronSecretOk({ headers: { authorization: 'Bearer nope' } }, { CRON_SECRET: 's3cret' })).toBe(false)
    expect(cronSecretOk({ headers: {} }, { CRON_SECRET: '' })).toBe(false)
  })
})
