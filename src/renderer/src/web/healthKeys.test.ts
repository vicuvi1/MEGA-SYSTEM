// MC14: phone keys are stored as hashes in a server-only table and checked in constant time.
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { handlePipeline } from './fakeTurso'
// @ts-expect-error plain JS module without types
import { config } from '../../../../api/_lib.mjs'
// @ts-expect-error plain JS module without types
import { dropHealthKey, healthKeyOk, listHealthKeys, newHealthKey } from '../../../../api/_health.mjs'
import { keepGooglePrefs } from '../../../server/googleCalendar'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
const cfg = config({ TURSO_URL: 'libsql://fake.turso.io', TURSO_TOKEN: 'k', SESSION_SECRET: 'test-secret' })

describe('phone health keys (MC14)', () => {
  it('makes a key, keeps only its hash, checks it and removes it', async () => {
    const db = new SQL.Database()
    const fetchImpl = (async (_u: string, init: { body: string }) => ({ ok: true, status: 200, text: async () => JSON.stringify(handlePipeline(db, JSON.parse(init.body))), json: async () => handlePipeline(db, JSON.parse(init.body)) })) as unknown as typeof fetch
    const made = await newHealthKey(cfg, 'Test phone <script>', 1000, fetchImpl)
    expect(made.key).toMatch(/^hk_[\w-]{32}$/)
    expect(made.label).toBe('Test phone script')
    // The table never holds the key itself.
    const stored = db.exec('SELECT hash FROM sys_health_keys')[0].values[0][0] as string
    expect(stored).not.toContain(made.key)
    expect(stored).toMatch(/^[0-9a-f]{64}$/)
    expect(await healthKeyOk(cfg, made.key, 2000, fetchImpl)).toBe(true)
    // A changed last character (never the same one: the key is random, and 1 in 64 ends in "x").
    expect(await healthKeyOk(cfg, `${made.key.slice(0, -1)}${made.key.endsWith('x') ? 'y' : 'x'}`, 2000, fetchImpl)).toBe(false)
    expect(await healthKeyOk(cfg, 'nope', 2000, fetchImpl)).toBe(false)
    expect(await listHealthKeys(cfg, fetchImpl)).toEqual([{ id: made.id, label: 'Test phone script', created: 1000, lastUsed: 2000 }])
    await dropHealthKey(cfg, made.id, fetchImpl)
    expect(await healthKeyOk(cfg, made.key, 3000, fetchImpl)).toBe(false)
  })
})

describe('Connect Gmail keeps the calendar choices', () => {
  it('a new sign-in keeps the calendars picked before', () => {
    const next = { enc: 'new', email: 'me@example.com', on: [], target: null, scopes: ['a', 'b'] }
    expect(keepGooglePrefs(JSON.stringify({ enc: 'old', on: ['cal1'], target: 'cal1' }), next)).toEqual({ ...next, on: ['cal1'], target: 'cal1' })
    expect(keepGooglePrefs(null, next)).toEqual(next)
    expect(keepGooglePrefs('broken', next)).toEqual(next)
  })
})
