// Long-term safety (LT1, LT7, LT8, LT9, LT22): read-only backups, server
// snapshots, pruning and roll-ups, pinned AI models, the database version.
import { createRequire } from 'node:module'
import { gunzipSync } from 'node:zlib'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module without types
import { pipelineProblem, pipelineWrites } from '../../api/_sqlguard.mjs'
// @ts-expect-error plain JS module without types
import { newestSnapshot, saveSnapshot, snapshotProblem } from '../../api/_snapshots.mjs'
// @ts-expect-error plain JS module without types
import { SCHEMA_VERSION, schemaTooOld } from '../../api/_schema.mjs'
// @ts-expect-error plain JS module without types
import { config } from '../../api/_lib.mjs'
import { MIGRATIONS } from '@core/schema'
import { COLD_READS_WARN, healthChecks } from '@core/health'
import { handlePipeline } from '../renderer/src/web/fakeTurso'
import { rowsIn, seenCutoff } from './telegramBot'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
const ex = (sql: string) => ({ requests: [{ type: 'execute', stmt: { sql, args: [] } }, { type: 'close' }] })
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('cloud backups are read-only from a page (LT1)', () => {
  it('lets the app read them, refuses every way of changing them', () => {
    expect(pipelineProblem(ex('SELECT day, exported_at, size_bytes FROM cloud_snapshots ORDER BY day DESC LIMIT 30'))).toBeNull()
    expect(pipelineProblem(ex('SELECT MAX(day) FROM cloud_snapshots'))).toBeNull()
    for (const sql of ['DELETE FROM cloud_snapshots', 'UPDATE "cloud_snapshots" SET data = 1', 'DROP TABLE cloud_snapshots', "INSERT INTO cloud_snapshots VALUES ('x')", 'WITH a AS (SELECT 1) DELETE FROM cloud_snapshots', 'ALTER TABLE cloud_snapshots RENAME TO x', 'SELECT 1; DELETE FROM cloud_snapshots', 'CREATE TRIGGER t AFTER INSERT ON tasks BEGIN DELETE FROM cloud_snapshots; END'])
      expect(pipelineProblem(ex(sql))).toMatch(/can only be read/)
  })

  it('the server adds today’s backup once, never overwrites it, and gives the newest back as gzip', async () => {
    const db = new SQL.Database()
    const fetchImpl = (async (_url: string, init: { body: string }) => ({ status: 200, text: async () => JSON.stringify(handlePipeline(db, JSON.parse(init.body))) })) as unknown as typeof fetch
    const cfg = config({ TURSO_URL: 'https://fake.turso.io', TURSO_TOKEN: 't' })
    const now = Date.parse('2026-11-05T10:00:00Z')
    expect(snapshotProblem({ day: '2026-10-01', data: '{}' }, now)).toMatch(/today/)
    expect(snapshotProblem({ day: '2026-11-05', data: 'rm -rf' }, now)).toMatch(/Not a backup/)
    const first = await saveSnapshot(cfg, { day: '2026-11-05', data: '{"tables":{"ledger":[1]}}' }, now, fetchImpl)
    expect(first.body).toEqual({ ok: true, saved: true })
    const again = await saveSnapshot(cfg, { day: '2026-11-05', data: '{"tables":{}}' }, now, fetchImpl)
    expect(again.body).toEqual({ ok: true, saved: false })
    const snap = await newestSnapshot(cfg, fetchImpl)
    expect(snap.day).toBe('2026-11-05')
    expect(JSON.parse(gunzipSync(snap.gz).toString())).toEqual({ tables: { ledger: [1] } })
  })
})

describe('database version (LT22)', () => {
  it('the server knows the number of migrations (bump api/_schema.mjs when adding one)', () => {
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length)
  })
  it('an older page may read but not write', () => {
    expect(schemaTooOld(String(SCHEMA_VERSION - 1))).toBe(true)
    expect(schemaTooOld(String(SCHEMA_VERSION))).toBe(false)
    expect(schemaTooOld(undefined)).toBe(false)
    expect(pipelineWrites(ex('SELECT * FROM tasks'))).toBe(false)
    expect(pipelineWrites({ requests: [{ type: 'batch', batch: { steps: [{ stmt: { sql: 'BEGIN' } }, { stmt: { sql: 'UPDATE tasks SET done = 1' } }, { stmt: { sql: 'COMMIT' } }] } }] })).toBe(true)
  })
})

describe('tables that only grow (LT8)', () => {
  it('AI calls older than 90 days become one row per month, with the same totals', async () => {
    // @ts-expect-error plain JS module without types
    const { rollupStatements, USAGE_CALLS_COLUMN } = await import('../../api/ai.mjs?rollup')
    const db = new SQL.Database()
    db.run('CREATE TABLE ai_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, model TEXT NOT NULL, kind TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, cost REAL)')
    db.run(USAGE_CALLS_COLUMN)
    const add = (at: string, cost: number) => db.run('INSERT INTO ai_usage (at, model, kind, prompt_tokens, completion_tokens, cost) VALUES (?, ?, ?, ?, ?, ?)', [at, 'm', 'chat', 100, 10, cost])
    add('2026-03-02T10:00:00Z', 0.5)
    add('2026-03-20T10:00:00Z', 0.25)
    add('2026-04-01T10:00:00Z', 1)
    add('2026-11-01T10:00:00Z', 2)
    const run = () => {
      for (const s of rollupStatements(new Date('2026-11-05T00:00:00Z'))) db.run(s.sql, s.args)
    }
    run()
    run() // twice: nothing changes
    const rows = db.exec('SELECT substr(at, 1, 7), calls, cost, prompt_tokens FROM ai_usage ORDER BY at')[0].values
    expect(rows).toEqual([
      ['2026-03', 2, 0.75, 200],
      ['2026-04', 1, 1, 100],
      ['2026-11', null, 2, 100]
    ])
    expect(db.exec('SELECT SUM(COALESCE(calls, 1)), SUM(cost) FROM ai_usage')[0].values[0]).toEqual([4, 3.75])
  })

  it("Telegram's handled-update marks are kept 14 days", () => {
    expect(seenCutoff(new Date('2026-11-15T12:00:00Z'))).toBe('2026-11-01')
  })
})

describe('reads at server start (LT7)', () => {
  it('counts the rows in a Turso answer', () => {
    expect(rowsIn({ results: [{ response: { result: { rows: [[1], [2]] } } }, { response: { result: { step_results: [{ rows: [[1]] }, null] } } }, { type: 'error' }] })).toBe(3)
  })
  it("System health shows the month's total, and warns near the free limit", () => {
    const now = new Date('2026-11-05T10:00:00Z')
    const base = { now, beats: { tick: { ok: now.toISOString() } }, sportySeen: null, latestSnapshot: null, today: '2026-11-05', errors: [] }
    const c = healthChecks({ ...base, notes: { 'coldreads:2026-11': { rows: 1_234_567, starts: 12 } } }).find((x) => x.id === 'coldReads')!
    expect(c).toMatchObject({ ok: true, detail: 'This month: 1.2M rows (1.2M in 12 cold starts)' })
    // CL6: reloads after the start count too.
    const r = healthChecks({ ...base, notes: { 'coldreads:2026-11': { rows: 1_000_000, starts: 2, reload: 500_000 } } }).find((x) => x.id === 'coldReads')!
    expect(r.detail).toBe('This month: 1.5M rows (1.0M in 2 cold starts, 500.0k in reloads)')
    expect(healthChecks({ ...base, notes: { 'coldreads:2026-11': { rows: COLD_READS_WARN, starts: 1 } } }).find((x) => x.id === 'coldReads')!.ok).toBe(false)
  })
  it("warns when Ben's outside timer stops, even while the app keeps him going (LT2)", () => {
    const now = new Date('2026-11-05T10:00:00Z')
    const beats = { tick: { ok: now.toISOString() }, timer: { ok: new Date(now.getTime() - 45 * 60000).toISOString() } }
    const c = healthChecks({ now, beats, sportySeen: null, latestSnapshot: null, today: '2026-11-05', errors: [] }).find((x) => x.id === 'timer')!
    expect(c.ok).toBe(false)
    expect(c.detail).toMatch(/Last ran 45 min ago/)
  })
})

describe('pinned AI models (LT9)', () => {
  const list = (ids: string[]) => (async (url: string, init?: any) => (String(url).endsWith('/models') ? json(200, { data: ids.map((id) => ({ id })) }) : json(200, { model: JSON.parse(init.body).model, choices: [{ message: { content: 'ok' } }] }))) as unknown as typeof fetch

  it('keeps the pinned model when a newer one comes out, and says so', async () => {
    // @ts-expect-error plain JS module without types
    const { openRouterModel, strongModel, newerModels, PINNED_MODELS } = await import('../../api/ai.mjs?pinned')
    const f = list([PINNED_MODELS.chat, PINNED_MODELS.deep, 'deepseek/deepseek-v9-flash', 'deepseek/deepseek-v9-pro'])
    expect(await openRouterModel({}, f)).toBe(PINNED_MODELS.chat)
    expect(await strongModel({}, f)).toBe(PINNED_MODELS.deep)
    expect(await newerModels({}, f)).toEqual({ chat: 'deepseek/deepseek-v9-flash', deep: 'deepseek/deepseek-v9-pro' })
  })

  it('a pinned model that is gone is replaced by the newest one', async () => {
    // @ts-expect-error plain JS module without types
    const { openRouterModel, newerModels } = await import('../../api/ai.mjs?gone')
    const f = list(['deepseek/deepseek-v9-flash', 'deepseek/deepseek-v3-flash'])
    expect(await openRouterModel({}, f)).toBe('deepseek/deepseek-v9-flash')
    expect((await newerModels({}, f)).chat).toBeNull()
  })
})
