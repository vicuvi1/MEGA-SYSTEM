// Automation hub, the server side: secrets stay in sys_kv, every call goes
// through safeFetch, n8n's API, failures told once, Ben's tools with the same
// confirm rules. A fake Turso, a fake n8n and made-up data only.
import { createRequire } from 'node:module'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '../core/schema'
import { handlePipeline } from '../renderer/src/web/fakeTurso'
import { TursoHttp } from '../renderer/src/web/tursoHttp'
import { BrowserDb } from '../renderer/src/web/browserDb'
import { readSetting, writeSetting } from '../main/settings'
import { cleanAutomation } from '../core/automations'
import { callHook, flowFailTick, flowsOp, flowToolsFor, loadSecrets, mergeTools, resetRunRate, runRateOk } from './flows'
import type { Net } from './automation'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
beforeEach(() => resetRunRate())

const resp = (status: number, body: string, headers: Record<string, string> = { 'content-type': 'application/json' }) => new Response(body, { status, headers })
const publicDns = async () => ['93.184.216.34']

let n = 0
function turso() {
  const remote: SqlJsDatabase = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  const url = `https://flows${++n}.fake.turso.io`
  const tursoFetch = (async (_u: string, init: RequestInit = {}) => {
    const json = handlePipeline(remote, JSON.parse(String(init.body)))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) } as any
  }) as typeof fetch
  vi.stubGlobal('fetch', tursoFetch)
  return { remote, env: { tursoUrl: url, tursoToken: 'k' }, db: new TursoHttp(url, 'k', undefined, tursoFetch) }
}

/** A fake n8n: workflows, (de)activate, executions, and a webhook that answers. */
function fakeN8n() {
  const calls: { url: string; method: string; headers: Headers; body: any; redirect?: string }[] = []
  let active = false
  let errors = [{ id: '11', workflowId: '7', workflowData: { name: 'Morning report' }, stoppedAt: '2026-11-05T07:00:00Z' }]
  const f = (async (url: string, init: RequestInit = {}) => {
    const h = new Headers(init.headers)
    calls.push({ url, method: init.method ?? 'GET', headers: h, body: init.body ? JSON.parse(String(init.body)) : null, redirect: init.redirect })
    const u = new URL(url)
    if (u.pathname.startsWith('/api/v1/')) {
      if (h.get('x-n8n-api-key') !== 'n8n-test-key') return resp(401, '{}')
      if (u.pathname === '/api/v1/workflows') return resp(200, JSON.stringify({ data: [{ id: '7', name: 'Morning report', active, nodes: [{ type: 'n8n-nodes-base.webhook', parameters: { path: 'report', httpMethod: 'POST' } }] }] }))
      if (/\/activate$/.test(u.pathname)) return (active = true), resp(200, '{}')
      if (/\/deactivate$/.test(u.pathname)) return (active = false), resp(200, '{}')
      if (u.pathname === '/api/v1/executions') return resp(200, JSON.stringify({ data: errors }))
      if (u.pathname === '/api/v1/executions/55') return resp(200, JSON.stringify({ id: '55', status: 'success', finished: true }))
    }
    if (u.pathname === '/webhook/report') return resp(200, JSON.stringify({ text: `Report for ${JSON.parse(String(init.body)).values.topic}`, url: 'https://n8n.example.com/r/1', image: 'http://not-https.example/x.png', ok: true }))
    if (u.pathname === '/webhook/moved') return resp(302, '', { location: 'https://elsewhere.example' })
    return resp(404, '{"message":"not found"}')
  }) as typeof fetch
  return { f, calls, fail: (e: typeof errors) => void (errors = e) }
}

describe('saved webhooks (AH1, AH9)', () => {
  it('keeps the address and token on the server; pages see a name and the last 4', async () => {
    const t = turso()
    const v: any = await flowsOp(t.env, { action: 'hookSet', url: 'https://n8n.example.com/webhook/report', token: 'super-secret-token-9z9z', preset: 'n8n', label: 'Report' })
    expect(v.id).toMatch(/^h/)
    const all = JSON.stringify(v)
    expect(all).not.toContain('super-secret')
    expect(all).not.toContain('/webhook/report')
    expect(v.hooks[0]).toMatchObject({ label: 'Report', preset: 'n8n', hint: '…port', host: 'n8n.example.com', hasToken: true })
    // In sys_kv, which /api/db refuses.
    const raw = String(t.remote.exec("SELECT value FROM sys_kv WHERE key = 'auto:flows'")[0].values[0][0])
    expect(raw).toContain('super-secret-token-9z9z')
  })
  it('refuses local and private addresses (they belong to the desktop app)', async () => {
    const t = turso()
    for (const url of ['https://localhost:5678/webhook/x', 'http://n8n.example.com/x', 'https://192.168.1.5/x', 'https://nas.local/x'])
      await expect(flowsOp(t.env, { action: 'hookSet', url }), url).rejects.toThrow()
    await expect(flowsOp(t.env, { action: 'hookSet', url: 'http://192.168.1.5:1880/x' })).rejects.toThrow(/desktop app/)
  })
  it('warns when a Make address does not look like Make', async () => {
    const t = turso()
    const v: any = await flowsOp(t.env, { action: 'hookSet', url: 'https://hooks.example.com/x', preset: 'make' })
    expect(v.warning).toMatch(/Make/)
  })
  it('a run POSTs through safeFetch with the token and shows the answer (AH4)', async () => {
    const t = turso()
    const n8n = fakeN8n()
    const net: Net = { fetch: n8n.f, resolve: publicDns }
    const { id }: any = await flowsOp(t.env, { action: 'hookSet', url: 'https://n8n.example.com/webhook/report', token: 'tok123', preset: 'n8n' })
    const r: any = await flowsOp(t.env, { action: 'run', hook: id, auto: { id: 'a1', name: 'Report' }, scope: { values: { topic: 'Rust', 'bad key!': 1 } } }, net)
    expect(r.result).toEqual({ ok: true, text: 'Report for Rust', url: 'https://n8n.example.com/r/1' })
    const c = n8n.calls[0]
    expect(c.method).toBe('POST')
    expect(c.redirect).toBe('manual')
    expect(c.headers.get('authorization')).toBe('Bearer tok123')
    expect(c.body).toMatchObject({ automation: 'Report', values: { topic: 'Rust' }, source: 'life-system' })
    expect(c.body.values['bad key!']).toBeUndefined()
  })
  it('a name that points at a private address is never called', async () => {
    const t = turso()
    const f = vi.fn(async () => resp(200, '{}')) as unknown as typeof fetch
    const { id }: any = await flowsOp(t.env, { action: 'hookSet', url: 'https://sneaky.example.com/webhook/x' })
    const r: any = await flowsOp(t.env, { action: 'run', hook: id, scope: { values: {} } }, { fetch: f, resolve: async () => ['10.0.0.8'] })
    expect(r.result).toMatchObject({ ok: false, why: expect.stringMatching(/private/) })
    expect(f).not.toHaveBeenCalled()
  })
  it('redirects are not followed', async () => {
    const n8n = fakeN8n()
    const r = await callHook({ url: 'https://n8n.example.com/webhook/moved', token: '', header: 'Authorization', preset: 'n8n', label: '', at: 0 }, {}, { fetch: n8n.f, resolve: publicDns })
    expect(r).toMatchObject({ ok: false, why: expect.stringMatching(/redirect/) })
  })
  it('a custom header carries the token as it is', async () => {
    const t = turso()
    const n8n = fakeN8n()
    const { id }: any = await flowsOp(t.env, { action: 'hookSet', url: 'https://n8n.example.com/webhook/report', token: 'abc', header: 'X-Life-Key' })
    await flowsOp(t.env, { action: 'run', hook: id, scope: { values: { topic: 'x' } } }, { fetch: n8n.f, resolve: publicDns })
    expect(n8n.calls[0].headers.get('x-life-key')).toBe('abc')
    await expect(flowsOp(t.env, { action: 'hookSet', url: 'https://n8n.example.com/webhook/report', header: 'Host' })).rejects.toThrow(/header/)
  })
  it('limits runs per minute', () => {
    const now = Date.now()
    let ok = 0
    for (let i = 0; i < 20; i++) if (runRateOk(now + i)) ok++
    expect(ok).toBe(12)
    expect(runRateOk(now + 61_000)).toBe(true)
  })
})

describe('connect my n8n (AH6)', () => {
  it('lists workflows, activates, makes a button and follows a run', async () => {
    const t = turso()
    const n8n = fakeN8n()
    const net: Net = { fetch: n8n.f, resolve: publicDns }
    await expect(flowsOp(t.env, { action: 'n8nSet', base: 'https://n8n.example.com', key: 'wrong' }, net)).rejects.toThrow(/refused/)
    const v: any = await flowsOp(t.env, { action: 'n8nSet', base: 'https://n8n.example.com/api/v1/', key: 'n8n-test-key' }, net)
    expect(v.n8n).toEqual({ on: true, host: 'n8n.example.com', keyHint: '…-key' })
    expect(JSON.stringify(v)).not.toContain('n8n-test-key')
    expect(v.workflows).toEqual([{ id: '7', name: 'Morning report', active: false, hooks: [{ path: 'report', method: 'POST' }] }])
    const on: any = await flowsOp(t.env, { action: 'n8nActivate', id: '7', on: true }, net)
    expect(on.workflows[0].active).toBe(true)
    expect(n8n.calls.some((c) => c.url.endsWith('/api/v1/workflows/7/activate') && c.method === 'POST')).toBe(true)
    const use: any = await flowsOp(t.env, { action: 'n8nUse', path: 'report', label: 'Morning report' }, net)
    const s = await loadSecrets(t.db)
    expect(s.hooks[use.id].url).toBe('https://n8n.example.com/webhook/report')
    expect(((await flowsOp(t.env, { action: 'n8nExec', exec: '55' }, net)) as any).state).toBe('ok')
    await expect(flowsOp(t.env, { action: 'n8nExec', exec: '../x' }, net)).rejects.toThrow()
  })
  it('refuses a private n8n on the server', async () => {
    const t = turso()
    await expect(flowsOp(t.env, { action: 'n8nSet', base: 'http://localhost:5678', key: 'k' })).rejects.toThrow(/desktop app/)
  })
})

describe('failed flows tell me (AH7)', () => {
  it('the first look remembers, then each new failure is told once', async () => {
    const t = turso()
    const n8n = fakeN8n()
    const net: Net = { fetch: n8n.f, resolve: publicDns }
    await flowsOp(t.env, { action: 'n8nSet', base: 'https://n8n.example.com', key: 'n8n-test-key' }, net)
    const t0 = new Date('2026-11-05T08:00:00Z')
    expect(await flowFailTick(t.db, t0, net)).toEqual([])
    n8n.fail([{ id: '12', workflowId: '7', workflowData: { name: 'Morning report' }, stoppedAt: '2026-11-05T08:05:00Z' }, { id: '11', workflowId: '7', workflowData: { name: 'Morning report' }, stoppedAt: '2026-11-05T07:00:00Z' }])
    // Not again within 10 minutes.
    expect(await flowFailTick(t.db, new Date(t0.getTime() + 5 * 60_000), net)).toEqual([])
    const msgs = await flowFailTick(t.db, new Date(t0.getTime() + 11 * 60_000), net)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatch(/Morning report/)
    expect(await flowFailTick(t.db, new Date(t0.getTime() + 22 * 60_000), net)).toEqual([])
  })
  it('does nothing without n8n', async () => {
    const t = turso()
    expect(await flowFailTick(t.db)).toEqual([])
  })
})

describe('Ben can run your flows (AH8)', () => {
  const setup = async () => {
    const t = turso()
    const n8n = fakeN8n()
    const net: Net = { fetch: n8n.f, resolve: publicDns }
    const { id }: any = await flowsOp(t.env, { action: 'hookSet', url: 'https://n8n.example.com/webhook/report' })
    const raw = new SQL.Database()
    for (const m of MIGRATIONS) raw.exec(m)
    const db = new BrowserDb(raw) as any
    const mirror = { read: async (fn: any) => fn(db), write: async (fn: any) => fn(db) }
    const auto = (over: any) => cleanAutomation({ id: 'a', name: 'Report', steps: [{ do: 'webhook', hook: id, where: 'cloud', preset: 'n8n' }], params: [{ key: 'topic', label: 'Topic', type: 'text', required: true }], ben: true, ...over })!
    return { t, n8n, net, db, mirror, auto }
  }
  it('only ticked automations are tools; safe ones run on the server', async () => {
    const { t, n8n, net, db, mirror, auto } = await setup()
    writeSetting(db, 'automations', { paused: false, list: [auto({ risk: 'safe' }), auto({ id: 'b', name: 'Hidden', ben: false })], dismissed: [] })
    const tools = flowToolsFor(t.env, mirror, net)
    expect((await tools.list()).map((x) => x.name)).toEqual(['flow_report'])
    expect(await tools.call('flow_report', {})).toBe('Needs: topic.')
    const r = await tools.call('flow_report', { topic: 'Algebra' })
    expect(r).toMatch(/Report for Algebra/)
    expect(r).toMatch(/outside data/)
    expect(n8n.calls).toHaveLength(1)
    expect(await tools.call('flow_hidden', {})).toMatch(/Not an automation/)
  })
  it('one that should ask waits for your tap on the island', async () => {
    const { t, n8n, net, db, mirror, auto } = await setup()
    writeSetting(db, 'automations', { paused: false, list: [auto({ risk: 'ask', ranOnce: true })], dismissed: [] })
    const r = await flowToolsFor(t.env, mirror, net).call('flow_report', { topic: 'x' })
    expect(r).toMatch(/waits for his OK/)
    expect(n8n.calls).toHaveLength(0)
    const asks = (readSetting(db, 'auto_asks') as any).asks
    expect(asks).toHaveLength(1)
    expect(asks[0]).toMatchObject({ auto: 'a', status: 'waiting', values: { topic: 'x' } })
  })
  it('a desktop-only one goes to the desktop app', async () => {
    const { t, net, db, mirror, auto } = await setup()
    writeSetting(db, 'automations', { paused: false, list: [auto({ risk: 'safe', steps: [{ do: 'note', text: 'hi' }] })], dismissed: [] })
    expect(await flowToolsFor(t.env, mirror, net).call('flow_report', { topic: 'x' })).toMatch(/desktop app/)
    expect((readSetting(db, 'auto_asks') as any).asks[0].status).toBe('go')
  })
  it('paused: no tools at all', async () => {
    const { t, net, db, mirror, auto } = await setup()
    writeSetting(db, 'automations', { paused: true, list: [auto({ risk: 'safe' })], dismissed: [] })
    expect(await flowToolsFor(t.env, mirror, net).list()).toEqual([])
  })
  it('merges with the MCP tools', async () => {
    const a = { list: async () => [{ name: 'weather_now', description: 'w' }], call: async () => 'sunny' }
    const b = { list: async () => [{ name: 'flow_x', description: 'f' }], call: async () => 'ran' }
    const m = mergeTools(a, b, null)
    expect((await m.list()).map((x) => x.name)).toEqual(['weather_now', 'flow_x'])
    expect(await m.call('flow_x', {})).toBe('ran')
    expect(await m.call('nope', {})).toMatch(/Not a tool/)
  })
})
