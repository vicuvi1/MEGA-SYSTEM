// /api/mcp end to end on a fake Turso (made-up data): the personal token's
// doors (missing, wrong, removed, signed out → 401), a read token can't write,
// a write token logs water through Ben's own path (points, coach log, undo),
// and the OAuth sign-in for claude.ai / ChatGPT (PKCE, allowlisted returns,
// one-time codes).
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { MIGRATIONS } from '../../../core/schema'
import { handlePipeline } from './fakeTurso'
// @ts-expect-error plain JS API modules
import mcpHandler from '../../../../api/mcp.mjs'
// @ts-expect-error plain JS API modules
import { config, login, signOutAll } from '../../../../api/_lib.mjs'
// @ts-expect-error plain JS API modules
import { pkceOk, redirectAllowed } from '../../../../api/_mcpauth.mjs'

const require = createRequire(import.meta.url)
let remote: SqlJsDatabase
const saved = { ...process.env }

beforeAll(async () => {
  const SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
  remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  Object.assign(process.env, { TURSO_URL: 'https://mcp-api.fake.turso.io', TURSO_TOKEN: 'fake-key', SESSION_SECRET: 'test-secret', LIFE_TZ: 'UTC' })
  delete process.env.OPENROUTER_API_KEY
  delete process.env.GEMINI_API_KEY
  delete process.env.TODOIST_TOKEN
  delete process.env.GOOGLE_CLIENT_ID
  delete process.env.APP_URL
  vi.stubGlobal('fetch', async (_url: string, init: { body?: string } = {}) => {
    const json = handlePipeline(remote, JSON.parse(String(init.body)))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
})
afterAll(() => {
  vi.unstubAllGlobals()
  process.env = saved
})

type Res = { status: number; headers: Record<string, string>; text: string; json: any }
function call(req: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown }): Promise<Res> {
  return new Promise((resolve) => {
    const res: any = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      setHeader(k: string, v: string) {
        this.headers[k.toLowerCase()] = v
      },
      write() {},
      end(b?: string) {
        let json: any = null
        try {
          json = b ? JSON.parse(b) : null
        } catch {
          json = null
        }
        resolve({ status: this.statusCode, headers: this.headers, text: b ?? '', json })
      }
    }
    void mcpHandler({ method: 'POST', url: '/api/mcp', on: () => {}, ...req, headers: { host: 'life.example.test', ...(req.headers ?? {}) } }, res)
  })
}
const rpc = (token: string | null, method: string, params?: unknown, id: number | null = 1) =>
  call({ headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' }, body: { jsonrpc: '2.0', ...(id == null ? {} : { id }), method, ...(params ? { params } : {}) } })

let session = ''
const tokensOp = (body: unknown, s = session) => call({ url: '/api/mcp?op=tokens', headers: { authorization: `Bearer ${s}` }, body })
const q = (sql: string) => remote.exec(sql)[0]?.values ?? []

describe('/api/mcp: personal tokens', () => {
  let readTok = ''
  let writeTok = ''
  it('Settings makes tokens with a session only, and shows each once', async () => {
    expect((await tokensOp({ action: 'list' }, 'forged.session')).status).toBe(401)
    session = (await login(config(), '2007')).body.session
    const r = await tokensOp({ action: 'create', label: 'Claude Desktop', scope: 'read' })
    expect(r.status).toBe(200)
    readTok = r.json.created.token
    expect(readTok).toMatch(/^lsm_[0-9a-f]{12}_/)
    writeTok = (await tokensOp({ action: 'create', label: 'Claude Code', scope: 'write' })).json.created.token
    const list = (await tokensOp({ action: 'list' })).json.tokens
    expect(list.map((t: any) => t.label).sort()).toEqual(['Claude Code', 'Claude Desktop'])
    expect(JSON.stringify(list)).not.toContain('lsm_')
    // Only a hash is kept.
    expect(JSON.stringify(q('SELECT * FROM sys_mcp_tokens'))).not.toContain(readTok.slice(17))
  })

  it('no token, a wrong one or a made-up one → 401 with where to sign in', async () => {
    const none = await rpc(null, 'initialize', { protocolVersion: '2025-06-18' })
    expect(none.status).toBe(401)
    expect(none.headers['www-authenticate']).toContain('resource_metadata="https://life.example.test/.well-known/oauth-protected-resource"')
    expect((await rpc('nope', 'ping')).status).toBe(401)
    expect((await rpc(readTok.slice(0, -1) + (readTok.endsWith('A') ? 'B' : 'A'), 'ping')).status).toBe(401)
  })

  it('initialize, ping and tools/list answer; notifications get 202', async () => {
    const init = await rpc(readTok, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    expect(init.status).toBe(200)
    expect(init.json.result.protocolVersion).toBe('2025-06-18')
    expect(init.json.result.serverInfo.name).toBe('life-system')
    expect(init.json.result.capabilities.tools).toBeTruthy()
    expect((await rpc(readTok, 'initialize', { protocolVersion: '1999-01-01' })).json.result.protocolVersion).toBe('2026-07-28')
    expect((await rpc(readTok, 'ping')).json.result).toEqual({})
    expect((await rpc(readTok, 'notifications/initialized', undefined, null)).status).toBe(202)
    expect((await rpc(readTok, 'no/such')).json.error.code).toBe(-32601)
  })

  it('a read token sees no write tools and cannot call one', async () => {
    const names = (await rpc(readTok, 'tools/list')).json.result.tools.map((t: any) => t.name)
    expect(names).toContain('get_today')
    expect(names).not.toContain('log_water')
    expect(names).not.toContain('ask_ben')
    const r = await rpc(readTok, 'tools/call', { name: 'log_water', arguments: { ml: 250 } })
    expect(r.json.error.code).toBe(-32003)
    const all = (await rpc(writeTok, 'tools/list')).json.result.tools
    const lw = all.find((t: any) => t.name === 'log_water')
    expect(lw.annotations.readOnlyHint).toBe(false)
    expect(all.find((t: any) => t.name === 'get_today').annotations.readOnlyHint).toBe(true)
  })

  it('a write token logs water like Ben: on the Coach page (via mcp) with Undo, and undo_last takes it back', async () => {
    const r = await rpc(writeTok, 'tools/call', { name: 'log_water', arguments: { ml: 500 } })
    expect(r.status).toBe(200)
    expect(r.json.result.isError).toBeFalsy()
    expect(r.json.result.structuredContent.done[0]).toMatch(/\+500 ml/)
    const log = JSON.parse(String(q("SELECT value FROM settings WHERE key = 'coach_log'")[0][0]))
    const entry = log.filter((e: any) => e.role === 'coach').pop()
    expect(entry.via).toBe('mcp')
    expect(entry.undo[0]).toMatchObject({ k: 'water', ml: -500 })
    const water = () => JSON.parse(String(q("SELECT value FROM settings WHERE key = 'sport_tracker_json'")[0][0])).data.water.currentMl
    expect(water()).toBe(500)
    expect((await rpc(writeTok, 'tools/call', { name: 'undo_last', arguments: {} })).json.result.structuredContent.needsConfirm).toBe(true)
    const u = await rpc(writeTok, 'tools/call', { name: 'undo_last', arguments: { confirm: true } })
    expect(u.json.result.structuredContent.ok).toBe(true)
    expect(water()).toBe(0)
  }, 30_000)

  it('bad input is an error result, not a crash', async () => {
    const r = await rpc(writeTok, 'tools/call', { name: 'log_water', arguments: { ml: 'lots' } })
    expect(r.json.result.isError).toBe(true)
    const r2 = await rpc(writeTok, 'tools/call', { name: 'get_sleep', arguments: { days: 7, sql: 'SELECT 1' } })
    expect(r2.json.result.isError).toBe(true)
  })

  it('a removed token, and every token after "sign out all devices", gets 401', async () => {
    const id = (await tokensOp({ action: 'list' })).json.tokens.find((t: any) => t.label === 'Claude Desktop').id
    await tokensOp({ action: 'revoke', id })
    expect((await rpc(readTok, 'ping')).status).toBe(401)
    expect((await rpc(writeTok, 'ping')).status).toBe(200)
    session = await signOutAll(config(), Date.now(), fetch, null)
    expect((await rpc(writeTok, 'ping')).status).toBe(401)
    expect((await tokensOp({ action: 'list' })).json.tokens).toEqual([])
  })

  it('GET is refused (no event stream), the metadata is public', async () => {
    expect((await call({ method: 'GET' })).status).toBe(405)
    const pr = await call({ method: 'GET', url: '/api/mcp?wk=resource' })
    expect(pr.json).toMatchObject({ resource: 'https://life.example.test/api/mcp', authorization_servers: ['https://life.example.test'] })
    const as = await call({ method: 'GET', url: '/api/mcp?wk=as' })
    expect(as.json.code_challenge_methods_supported).toEqual(['S256'])
    expect(as.json.token_endpoint).toBe('https://life.example.test/api/mcp?oauth=token')
  })
})

describe('/api/mcp: OAuth for claude.ai and ChatGPT (MC4)', () => {
  const verifier = 'a-made-up-verifier-that-is-long-enough-1234567890'
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const redirect = 'https://claude.ai/api/mcp/auth_callback'

  it('the PKCE check', () => {
    expect(pkceOk(verifier, challenge)).toBe(true)
    expect(pkceOk(verifier + 'x', challenge)).toBe(false)
    expect(pkceOk('short', createHash('sha256').update('short').digest('base64url'))).toBe(false)
  })

  it('only Claude, ChatGPT and localhost may be sent back to', () => {
    expect(redirectAllowed('https://claude.ai/api/mcp/auth_callback')).toBe(true)
    expect(redirectAllowed('https://chatgpt.com/connector_platform_oauth_redirect')).toBe(true)
    expect(redirectAllowed('http://localhost:6274/oauth/callback')).toBe(true)
    expect(redirectAllowed('https://claude.ai.evil.test/cb')).toBe(false)
    expect(redirectAllowed('http://claude.ai/cb')).toBe(false)
    expect(redirectAllowed('javascript:alert(1)')).toBe(false)
  })

  it('register → PIN page → code → token, once', async () => {
    const bad = await call({ url: '/api/mcp?oauth=register', headers: { 'content-type': 'application/json' }, body: { client_name: 'Evil', redirect_uris: ['https://evil.test/cb'] } })
    expect(bad.status).toBe(400)
    const reg = await call({ url: '/api/mcp?oauth=register', headers: { 'content-type': 'application/json' }, body: { client_name: 'Claude', redirect_uris: [redirect] } })
    expect(reg.status).toBe(201)
    const clientId = reg.json.client_id
    const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'st8', scope: 'read write' })
    const page = await call({ method: 'GET', url: `/api/mcp?oauth=authorize&${params}` })
    expect(page.status).toBe(200)
    expect(page.text).toContain('Allow Claude?')
    expect(page.text).not.toContain('<script')
    // Without PKCE: refused.
    const noPkce = new URLSearchParams(params)
    noPkce.delete('code_challenge')
    expect((await call({ method: 'GET', url: `/api/mcp?oauth=authorize&${noPkce}` })).status).toBe(400)
    // A return address the client didn't register: refused.
    const other = new URLSearchParams(params)
    other.set('redirect_uri', 'https://chatgpt.com/other')
    expect((await call({ method: 'GET', url: `/api/mcp?oauth=authorize&${other}` })).status).toBe(400)
    const form = Object.fromEntries(params)
    const wrong = await call({ url: '/api/mcp?oauth=authorize', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: { ...form, pin: '9999', access: 'write' } })
    expect(wrong.status).toBe(401)
    const okR = await call({ url: '/api/mcp?oauth=authorize', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: { ...form, pin: '2007', access: 'write' } })
    expect(okR.status).toBe(302)
    const back = new URL(okR.headers.location)
    expect(back.origin + back.pathname).toBe(redirect)
    expect(back.searchParams.get('state')).toBe('st8')
    const code = back.searchParams.get('code')!
    const tokenReq = (v: string) => call({ url: '/api/mcp?oauth=token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: v, redirect_uri: redirect, client_id: clientId }).toString() })
    expect((await tokenReq(verifier + 'x')).status).toBe(400)
    const t = await tokenReq(verifier)
    expect(t.status).toBe(200)
    expect(t.json).toMatchObject({ token_type: 'Bearer', scope: 'write' })
    expect((await tokenReq(verifier)).status).toBe(400) // a code works once
    const names = (await rpc(t.json.access_token, 'tools/list')).json.result.tools.map((x: any) => x.name)
    expect(names).toContain('log_water')
  }, 30_000)
})
