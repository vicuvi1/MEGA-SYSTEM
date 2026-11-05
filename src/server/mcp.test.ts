// The MCP tools (MC1, MC3) on a fake Turso with made-up data: JSON-RPC
// handling, every read tool, resource and prompt answers without touching the
// server's own tables or running SQL of its own, and the write tools go
// through Ben's executor (same points, same coach log).
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '../core/schema'
import { handlePipeline } from '../renderer/src/web/fakeTurso'
import { checkArgs, handleMcp, TOOLS } from './mcp'
import { mcpCall } from './telegramBot'
// @ts-expect-error plain JS API module
import { PROTECTED_TABLES } from '../../api/_sqlguard.mjs'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.unstubAllGlobals())

let n = 0
function world() {
  const remote: SqlJsDatabase = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  const sqls: string[] = []
  vi.stubGlobal('fetch', async (_url: string, init: { body?: string } = {}) => {
    const body = JSON.parse(String(init.body))
    for (const r of body.requests ?? []) {
      if (r.stmt?.sql) sqls.push(r.stmt.sql)
      for (const s of r.batch?.steps ?? []) sqls.push(s.stmt.sql)
    }
    const json = handlePipeline(remote, body)
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  const env = { tursoUrl: `https://mcp${++n}.fake.turso.io`, tursoToken: 'k', timeZone: 'UTC', defaults: {} }
  const q = (sql: string) => remote.exec(sql)[0]?.values ?? []
  return { remote, sqls, env, q }
}
const call = (env: any, scope: 'read' | 'write', method: string, params?: unknown) => mcpCall(env, { jsonrpc: '2.0', id: 1, method, params }, { scope, client: 'Test app' }) as Promise<any>

describe('MCP: JSON-RPC', () => {
  const life = async () => {
    throw new Error('not needed')
  }
  it('answers initialize without reading any data, and refuses junk', async () => {
    const r: any = await handleMcp(life, { jsonrpc: '2.0', id: 7, method: 'initialize', params: { protocolVersion: '2025-03-26' } }, { scope: 'read' })
    expect(r).toMatchObject({ jsonrpc: '2.0', id: 7, result: { protocolVersion: '2025-03-26' } })
    expect(((await handleMcp(life, { id: 1, method: 'ping' }, { scope: 'read' })) as any).error.code).toBe(-32600)
    expect(((await handleMcp(life, 'hello', { scope: 'read' })) as any).error.code).toBe(-32700)
    expect(((await handleMcp(life, [], { scope: 'read' })) as any).error.code).toBe(-32600)
  })
  it('a batch gets one answer per call and none for notifications', async () => {
    const r: any = await handleMcp(life, [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }], { scope: 'read' })
    expect(r.map((x: any) => x.id)).toEqual([1, 2])
    expect(await handleMcp(life, { jsonrpc: '2.0', method: 'notifications/initialized' }, { scope: 'read' })).toBeNull()
  })
  it('a tool that fails says so, without a stack', async () => {
    const r: any = await handleMcp(life, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_today', arguments: {} } }, { scope: 'read' })
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).not.toMatch(/at .*\.ts/)
  })
  it('checks arguments against the schema', () => {
    const s = TOOLS.find((t) => t.name === 'remind_me')!.inputSchema
    expect(checkArgs(s, { at: '2026-11-05 18:00', text: 'call' })).toBeNull()
    expect(checkArgs(s, { at: 'tomorrow', text: 'call' })).toMatch(/format/)
    expect(checkArgs(s, { text: 'call' })).toMatch(/at is required/)
    expect(checkArgs(s, { at: '2026-11-05 18:00', text: 'x', more: 1 })).toMatch(/unknown/)
  })
  it('every tool has a schema, a title and read-only marks that match', () => {
    for (const t of TOOLS) {
      expect(t.inputSchema.type).toBe('object')
      expect(t.title).toBeTruthy()
      if (t.name.startsWith('get_') || t.name === 'search_notes') expect(t.write).toBeFalsy()
    }
  })
})

describe('MCP: tools on made-up data', () => {
  it('no tool touches the server-only tables or runs SQL of its own', async () => {
    const src = readFileSync(join(__dirname, 'mcp.ts'), 'utf8')
    expect(src).not.toMatch(/sys_/)
    expect(src).not.toMatch(/\.(prepare|exec|run)\s*\(/)
    expect(src).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE)\s/)
  })

  it('every read tool, resource and prompt answers, and none reaches a sys_ table the app protects', async () => {
    const { env, sqls, q } = world()
    q("INSERT INTO notes (id, title, body, author, pinned, created_at, updated_at) VALUES ('n1', 'Exams', '# Exams\n- Made-up exam on Friday, chapters 3-5', 'me', 0, '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z')")
    q(`INSERT INTO settings (key, value) VALUES ('app_sync_finance', '${JSON.stringify({ data: { settings: { currency: 'MDL', categories: [{ id: 'c1', name: 'Food' }] }, tx: [{ id: 't1', type: 'expense', amount: 12000, category: 'c1', date: new Date().toISOString().slice(0, 10), note: 'made-up pizza' }] } })}')`)
    await call(env, 'read', 'ping') // the copy loads first
    const before = sqls.length
    const reads = TOOLS.filter((t) => !t.write)
    const args: Record<string, unknown> = { search_notes: { query: 'exam' }, get_money_summary: { detail: true } }
    for (const t of reads) {
      const r = await call(env, 'read', 'tools/call', { name: t.name, arguments: args[t.name] ?? {} })
      expect(r.result?.isError, `${t.name}: ${r.result?.content?.[0]?.text}`).toBeFalsy()
      expect(typeof r.result.structuredContent).toBe('object')
    }
    for (const uri of ['life://today', 'life://goals', 'life://memory', 'life://week']) {
      const r = await call(env, 'read', 'resources/read', { uri })
      expect(r.result.contents[0].uri).toBe(uri)
      expect(() => JSON.parse(r.result.contents[0].text)).not.toThrow()
    }
    for (const name of ['plan_my_day', 'evening_review', 'sunday_review', 'why_did_i_slip']) {
      const r = await call(env, 'read', 'prompts/get', { name })
      expect(r.result.messages[0].content.text).toContain('<life-data>')
    }
    const touched = sqls.slice(before).join('\n').toLowerCase()
    for (const t of PROTECTED_TABLES as string[]) expect(touched).not.toContain(t)
    // Money: totals by default, rows only on request.
    const totals = await call(env, 'read', 'tools/call', { name: 'get_money_summary', arguments: {} })
    expect(totals.result.structuredContent.spentToday).toBe(120)
    expect(totals.result.structuredContent.rows).toBeUndefined()
    const detail = await call(env, 'read', 'tools/call', { name: 'get_money_summary', arguments: { detail: true } })
    expect(detail.result.structuredContent.rows[0].note).toBe('made-up pizza')
    const found = await call(env, 'read', 'tools/call', { name: 'search_notes', arguments: { query: 'exam friday' } })
    expect(found.result.structuredContent.notes[0].title).toBe('Exams')
  }, 60_000)

  it('write tools run through Ben: a must-do, a note, a focus timer with honest points', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-05T10:00:00Z'))
    try {
      const { env, q } = world()
      const md = await call(env, 'write', 'tools/call', { name: 'add_mustdo', arguments: { text: 'Read chapter 3' } })
      expect(md.result.structuredContent.done[0]).toContain('Must-do added: Read chapter 3')
      const note = await call(env, 'write', 'tools/call', { name: 'add_note', arguments: { title: 'Ideas | evil', line: 'try the\nnew plan' } })
      expect(note.result.structuredContent.ok).toBe(true)
      expect(String(q("SELECT body FROM notes WHERE title = 'Ideas evil'")[0]?.[0])).toContain('try the new plan')
      const start = await call(env, 'write', 'tools/call', { name: 'start_focus', arguments: { minutes: 25, subject: 'Lab 3' } })
      expect(start.result.structuredContent.done[0]).toContain('Focus started: Lab 3 · 25 min')
      vi.setSystemTime(new Date('2026-11-05T10:26:00Z'))
      const stop = await call(env, 'write', 'tools/call', { name: 'stop_focus', arguments: {} })
      expect(stop.result.structuredContent.done[0]).toMatch(/Focus logged: Lab 3 · 2[56] min/)
      expect(Number(q("SELECT SUM(minutes) FROM focus_sessions WHERE subject = 'Lab 3'")[0][0])).toBeGreaterThanOrEqual(25)
      const log = JSON.parse(String(q("SELECT value FROM settings WHERE key = 'coach_log'")[0][0]))
      const mine = log.filter((e: any) => e.role === 'me' && e.via === 'mcp').map((e: any) => e.text)
      expect(mine[0]).toBe('🔌 Test app: must-do "Read chapter 3"')
      // Stopping twice logs nothing more.
      const again = await call(env, 'write', 'tools/call', { name: 'stop_focus', arguments: {} })
      expect(again.result.structuredContent.done[0]).toContain('No focus timer is running')
    } finally {
      vi.useRealTimers()
    }
  }, 60_000)

  it('ask_ben without an AI key says so; complete_task needs confirm', async () => {
    const { env } = world()
    const r = await call(env, 'write', 'tools/call', { name: 'ask_ben', arguments: { message: 'How is my day?' } })
    expect(r.result.structuredContent.reply).toMatch(/AI key/)
    const c = await call(env, 'write', 'tools/call', { name: 'complete_task', arguments: { task_id: '123' } })
    expect(c.result.structuredContent.needsConfirm).toBe(true)
  }, 30_000)
})
