// Settings → PC & automation, the server side (AU8 ntfy, AU9 n8n webhooks,
// AU10 the MCP servers Ben may use). Everything is kept in sys_kv (server
// only: /api/db refuses it, never copied to devices) under "auto:*"; pages
// get hints back, never a token, a topic or a full address after saving.
// Every outside call: https only, public addresses only (the name and every
// address it resolves to), no redirects, a short timeout, answers size-capped.
import { lookup } from 'node:dns/promises'
import { TursoHttp } from '../renderer/src/web/tursoHttp'
import { privateIp, urlProblem } from '../core/netGuard'
import {
  allowedTools,
  cleanHooks,
  cleanMcpServers,
  cleanNtfy,
  cleanTools,
  eventsFromLedger,
  HOOK_EVENTS,
  hooksFor,
  hooksView,
  mcpView,
  NTFY_DEFAULT,
  ntfyMessage,
  ntfyView,
  ntfyWants,
  rpcFromBody,
  TOPIC_RE,
  toolResultText,
  type HookEvent,
  type HookPayload,
  type HookState,
  type McpServer,
  type NtfyConf
} from '../core/automation'
import type { ExtTools } from '../renderer/src/web/webBots'

const SYS_KV = { sql: 'CREATE TABLE IF NOT EXISTS sys_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)', args: [] as any[] }
const K = { ntfy: 'auto:ntfy', hooks: 'auto:hooks', mcp: 'auto:mcp' }

export interface AutoConf { ntfy: NtfyConf | null; hooks: HookState; mcp: McpServer[] }

export async function loadAuto(db: TursoHttp): Promise<AutoConf> {
  // A read only (the tick runs this each minute); the table is made by the first save.
  const [r] = await db.readMany([{ sql: "SELECT key, value FROM sys_kv WHERE key LIKE 'auto:%'", args: [] }])
  const m = new Map<string, string>(r instanceof Error ? [] : r.rows.map((x) => [String(x[0]), String(x[1])]))
  const j = (k: string) => {
    try {
      return JSON.parse(m.get(k) ?? 'null')
    } catch {
      return null
    }
  }
  return { ntfy: cleanNtfy(j(K.ntfy)), hooks: cleanHooks(j(K.hooks)), mcp: cleanMcpServers(j(K.mcp)) }
}
const save = (db: TursoHttp, key: string, v: unknown) => db.writeAtomic([SYS_KV, v == null ? { sql: 'DELETE FROM sys_kv WHERE key = ?', args: [key] } : { sql: 'INSERT INTO sys_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: [key, JSON.stringify(v)] }])

// ---- safe outside calls ----

/** Fetch an address you gave, only if it is public https (checked again after the name is looked up). */
export async function safeFetch(url: string, init: RequestInit, timeoutMs: number, fetchImpl: typeof fetch = fetch, resolve: (h: string) => Promise<string[]> = defaultResolve): Promise<Response> {
  const bad = urlProblem(url)
  if (bad) throw new Error(bad)
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(host) && !host.includes(':')) {
    const ips = await resolve(host).catch(() => [] as string[])
    if (!ips.length) throw new Error('That address could not be found')
    if (ips.some(privateIp)) throw new Error('Not a private or local address')
  }
  return fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
}
const defaultResolve = async (h: string) => (await lookup(h, { all: true })).map((a) => a.address)

/** The answer's text, at most `max` bytes (the rest is never read). */
export async function readCapped(res: Response, max = 256 * 1024): Promise<string> {
  const reader = res.body?.getReader?.()
  if (!reader) return (await res.text()).slice(0, max)
  const chunks: Uint8Array[] = []
  let n = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done || !value) break
    chunks.push(value)
    n += value.length
    if (n >= max) {
      void reader.cancel().catch(() => {})
      break
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, max))
}

export interface Net { fetch?: typeof fetch; resolve?: (h: string) => Promise<string[]> }

// ---- AU8: ntfy ----

export async function sendNtfy(c: NtfyConf, html: string, o: { urgent?: boolean; test?: boolean } = {}, net: Net = {}): Promise<number> {
  const m = ntfyMessage(html)
  // Header values must be plain Latin-1: the title goes as RFC 2047 when it has other letters (emoji).
  const title = /^[\x20-\x7e]*$/.test(m.title) ? m.title : `=?UTF-8?B?${Buffer.from(m.title).toString('base64')}?=`
  const r = await safeFetch(`${c.server}/${c.topic}`, { method: 'POST', headers: { Title: title, Priority: o.urgent ? '4' : '3', Tags: o.test ? 'white_check_mark' : 'bell', 'Content-Type': 'text/plain; charset=utf-8' }, body: m.body }, 6000, net.fetch, net.resolve)
  return r.status
}

/** From the tick's send(): the same message to your phone too, when ntfy is set (never throws). */
export async function ntfyAlso(c: NtfyConf | null, text: string, urgent: boolean, net: Net = {}): Promise<boolean> {
  if (!ntfyWants(c, text, urgent)) return false
  const s = await sendNtfy(c!, text, { urgent }, net).catch(() => 0)
  return s >= 200 && s < 300
}

// ---- AU9: webhooks out ----

/** One POST, 5 s, tried once more if it fails (a 5xx, a timeout); a 4xx is not tried again. */
export async function postHook(url: string, p: HookPayload, net: Net = {}): Promise<number | string> {
  const go = () => safeFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'LifeSystem-Webhook/1' }, body: JSON.stringify(p) }, 5000, net.fetch, net.resolve).then((r) => r.status)
  try {
    const s = await go()
    if (s < 500) return s
  } catch (e) {
    if (/private|local|https|address/i.test((e as Error).message)) return (e as Error).message
  }
  try {
    return await go()
  } catch (e) {
    return String((e as Error).message ?? 'failed').slice(0, 60)
  }
}

type LedgerRow = { id: number; ts: string; day: string; module: string; kind: string; coins: number; rule: string | null; note: string | null; undone: boolean }
/** What the tick reads from its copy of the database for the webhooks. */
export interface HookFacts { ledger: LedgerRow[]; closedDays: string[]; today: string; hour: number; openMustdos: number }

/** The tick: new events → each webhook that wants them. Returns how many went. */
export async function hooksTick(db: TursoHttp, conf: AutoConf, facts: HookFacts, now = new Date(), net: Net = {}): Promise<number> {
  const s = conf.hooks
  if (!s.hooks.some((h) => h.on)) return 0
  const fromLedger = eventsFromLedger(facts.ledger, s.seen.ledger)
  const events: HookPayload[] = [...fromLedger.events]
  const seen = { ...s.seen, ledger: fromLedger.seen }
  for (const day of facts.closedDays) {
    if (seen.closed.includes(day)) continue
    seen.closed = [...seen.closed, day].slice(-10)
    // The first look only remembers (no old days).
    if (s.seen.ledger) events.push({ event: 'day_closed', at: now.toISOString(), day, text: `Day ${day} closed`, source: 'life-system' })
  }
  if (facts.hour >= 20 && facts.openMustdos > 0 && !seen.late.includes(facts.today)) {
    seen.late = [...seen.late, facts.today].slice(-10)
    events.push({ event: 'mustdo_late', at: now.toISOString(), day: facts.today, text: `${facts.openMustdos} must-do${facts.openMustdos === 1 ? '' : 's'} still open`, source: 'life-system' })
  }
  let sent = 0
  const hooks = s.hooks.map((h) => ({ ...h }))
  for (const ev of events.slice(0, 10)) {
    for (const h of hooksFor({ ...s, hooks }, ev.event)) {
      const status = await postHook(h.url, ev, net)
      h.last = { at: now.getTime(), status }
      if (typeof status === 'number' && status < 300) sent++
    }
  }
  if (JSON.stringify(seen) !== JSON.stringify(s.seen) || sent || events.length) await save(db, K.hooks, { hooks, seen })
  return sent
}

/** The ledger and plans the tick looks at (from its own copy of the database). */
export function hookFacts(db: any, today: string, hour: number, since: number): HookFacts {
  const q = (sql: string, args: unknown[] = []) => db.prepare(sql).all(...args) as any[]
  const top = q('SELECT MAX(id) AS id FROM ledger')[0]?.id ?? 0
  const rows = since
    ? q("SELECT l.id, l.ts, l.day, l.module, l.kind, l.coins, l.rule_id AS rule, l.note, EXISTS(SELECT 1 FROM ledger u WHERE u.undo_of = l.id) AS undone FROM ledger l WHERE l.id > ? ORDER BY l.id LIMIT 50", [since])
    : [{ id: Number(top) || 0, ts: '', day: '', module: '', kind: 'adjust', coins: 0, rule: null, note: null, undone: 0 }]
  const plans = q('SELECT day, items, review FROM day_plans WHERE day >= ? ORDER BY day', [prevDay(today)])
  const closedDays = plans.filter((p) => p.review != null && String(p.review).trim() !== '').map((p) => String(p.day))
  let openMustdos = 0
  const tp = plans.find((p) => p.day === today)
  try {
    openMustdos = (JSON.parse(tp?.items ?? '[]') as { done?: boolean }[]).filter((x) => !x.done).length
  } catch {
    openMustdos = 0
  }
  return { ledger: rows.map((r) => ({ ...r, id: Number(r.id), coins: Number(r.coins) || 0, undone: !!Number(r.undone) })), closedDays, today, hour, openMustdos }
}
const prevDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10)

// ---- AU10: Ben as an MCP client (Streamable HTTP, plain fetch) ----

let rpcId = 0
async function rpc(s: Pick<McpServer, 'url' | 'token'>, method: string, params: unknown, session: string | null, net: Net, timeoutMs = 6000): Promise<{ result: any; session: string | null }> {
  const id = ++rpcId
  const res = await safeFetch(
    s.url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18', ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}), ...(session ? { 'Mcp-Session-Id': session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
    },
    timeoutMs,
    net.fetch,
    net.resolve
  )
  if (res.status === 401 || res.status === 403) throw new Error('The server refused the token')
  if (res.status >= 300 && res.status < 400) throw new Error('The server tried to send Ben elsewhere (redirects are not followed)')
  if (!res.ok) throw new Error(`The server answered ${res.status}`)
  const body = await readCapped(res)
  const j = rpcFromBody(body, res.headers.get('content-type') ?? '', id)
  if (!j) throw new Error('No MCP answer')
  if (j.error) throw new Error(String(j.error.message ?? 'MCP error').slice(0, 120))
  return { result: j.result, session: res.headers.get('mcp-session-id') ?? session }
}

async function openSession(s: Pick<McpServer, 'url' | 'token'>, net: Net): Promise<string | null> {
  const r = await rpc(s, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'life-system-ben', version: '1.0.0' } }, null, net)
  // "initialized" is a notification (no answer to wait for).
  await safeFetch(s.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}), ...(r.session ? { 'Mcp-Session-Id': r.session } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }, 4000, net.fetch, net.resolve)
    .then((x) => x.body?.cancel?.())
    .catch(() => {})
  return r.session
}

export async function mcpListTools(s: Pick<McpServer, 'url' | 'token'>, net: Net = {}): Promise<unknown[]> {
  const session = await openSession(s, net)
  const r = await rpc(s, 'tools/list', {}, session, net)
  return Array.isArray(r.result?.tools) ? r.result.tools : []
}

export async function mcpCallTool(s: Pick<McpServer, 'url' | 'token'>, name: string, args: Record<string, unknown>, net: Net = {}): Promise<string> {
  const session = await openSession(s, net)
  const r = await rpc(s, 'tools/call', { name, arguments: args }, session, net, 8000)
  return toolResultText(r.result)
}

/** For Ben (webBots ExtTools): the tools you allowed; the config is read at most once a minute. */
export function extToolsFor(env: { tursoUrl: string; tursoToken: string }, net: Net = {}): ExtTools {
  let cache: { at: number; list: ReturnType<typeof allowedTools> } | null = null
  const load = async () => {
    if (cache && Date.now() - cache.at < 60_000) return cache.list
    const conf = await loadAuto(new TursoHttp(env.tursoUrl, env.tursoToken))
    cache = { at: Date.now(), list: allowedTools(conf.mcp) }
    return cache.list
  }
  return {
    list: async () => (await load()).map((t) => ({ name: t.name, description: t.description })),
    call: async (name, args) => {
      const t = (await load()).find((x) => x.name === name)
      if (!t) return 'Not a tool he allowed.'
      return mcpCallTool(t.server, name, JSON.stringify(args).length > 4000 ? {} : args, net)
    }
  }
}

// ---- Settings → PC & automation (your app session, through /api/mcp?op=automation) ----

const newId = () => Math.random().toString(36).slice(2, 10)

export async function automationOp(env: { tursoUrl: string; tursoToken: string }, body: any, net: Net = {}): Promise<Record<string, unknown>> {
  const db = new TursoHttp(env.tursoUrl, env.tursoToken)
  const conf = await loadAuto(db)
  const view = (c: AutoConf, extra: Record<string, unknown> = {}) => ({ ntfy: ntfyView(c.ntfy), hooks: hooksView(c.hooks), hookEvents: HOOK_EVENTS, mcp: mcpView(c.mcp), ...extra })
  const a = String(body?.action ?? 'get')
  if (a === 'get') return view(conf)
  if (a === 'ntfySet') {
    if (body.off) {
      await save(db, K.ntfy, null)
      return view({ ...conf, ntfy: null })
    }
    const topic = String(body.topic ?? '').trim() || conf.ntfy?.topic || ''
    if (!TOPIC_RE.test(topic)) throw Object.assign(new Error('The topic: 6–64 letters, digits, - or _ (pick something hard to guess)'), { status: 400 })
    const server = String(body.server ?? '').trim().replace(/\/+$/, '') || NTFY_DEFAULT
    const bad = urlProblem(server)
    if (bad) throw Object.assign(new Error(`The server: ${bad}`), { status: 400 })
    const c = cleanNtfy({ server, topic, level: body.level })!
    await save(db, K.ntfy, c)
    return view({ ...conf, ntfy: c })
  }
  if (a === 'ntfyTest') {
    if (!conf.ntfy) throw Object.assign(new Error('Save a topic first'), { status: 400 })
    const s = await sendNtfy(conf.ntfy, '✅ Life System test\nPhone push by ntfy works.', { test: true }, net).catch((e) => String((e as Error).message))
    return view(conf, { test: typeof s === 'number' && s < 300 ? 'Sent: check your phone' : `It did not go through (${s})` })
  }
  if (a === 'hookAdd') {
    const url = String(body.url ?? '').trim()
    const bad = urlProblem(url)
    if (bad) throw Object.assign(new Error(bad), { status: 400 })
    if (conf.hooks.hooks.length >= 5) throw Object.assign(new Error('Five webhooks at most'), { status: 400 })
    const events = (Array.isArray(body.events) ? body.events : HOOK_EVENTS).filter((e: string): e is HookEvent => (HOOK_EVENTS as readonly string[]).includes(e))
    const hooks = { ...conf.hooks, hooks: [...conf.hooks.hooks, { id: newId(), url, events, on: true }] }
    await save(db, K.hooks, hooks)
    return view({ ...conf, hooks })
  }
  if (a === 'hookSet' || a === 'hookRemove') {
    const list = a === 'hookRemove' ? conf.hooks.hooks.filter((h) => h.id !== body.id) : conf.hooks.hooks.map((h) => (h.id === body.id ? { ...h, ...(Array.isArray(body.events) ? { events: body.events.filter((e: string): e is HookEvent => (HOOK_EVENTS as readonly string[]).includes(e)) } : {}), ...(typeof body.on === 'boolean' ? { on: body.on } : {}) } : h))
    const hooks = { ...conf.hooks, hooks: list }
    await save(db, K.hooks, hooks)
    return view({ ...conf, hooks })
  }
  if (a === 'hookTest') {
    const h = conf.hooks.hooks.find((x) => x.id === body.id)
    if (!h) throw Object.assign(new Error('No such webhook'), { status: 404 })
    const status = await postHook(h.url, { event: 'test', at: new Date().toISOString(), day: new Date().toISOString().slice(0, 10), text: 'A test from Life System', source: 'life-system' }, net)
    const hooks = { ...conf.hooks, hooks: conf.hooks.hooks.map((x) => (x.id === h.id ? { ...x, last: { at: Date.now(), status } } : x)) }
    await save(db, K.hooks, hooks)
    return view({ ...conf, hooks }, { test: typeof status === 'number' && status < 300 ? `Sent (answer ${status})` : `It did not go through (${status})` })
  }
  if (a === 'mcpAdd') {
    const url = String(body.url ?? '').trim()
    const bad = urlProblem(url)
    if (bad) throw Object.assign(new Error(bad), { status: 400 })
    if (conf.mcp.length >= 5) throw Object.assign(new Error('Five servers at most'), { status: 400 })
    const token = String(body.token ?? '').trim().slice(0, 2000)
    let tools: unknown[] = []
    let error: string | undefined
    try {
      tools = await mcpListTools({ url, token }, net)
    } catch (e) {
      error = String((e as Error).message).slice(0, 160)
    }
    const srv: McpServer = { id: newId(), label: String(body.label ?? '').trim().slice(0, 40) || new URL(url).hostname, url, token, tools: cleanTools(tools, []), at: Date.now(), ...(error ? { error } : {}) }
    const mcp = [...conf.mcp, srv]
    await save(db, K.mcp, mcp)
    return view({ ...conf, mcp })
  }
  if (a === 'mcpRefresh') {
    const srv = conf.mcp.find((s) => s.id === body.id)
    if (!srv) throw Object.assign(new Error('No such server'), { status: 404 })
    let next: McpServer
    try {
      next = { ...srv, tools: cleanTools(await mcpListTools(srv, net), srv.tools), at: Date.now(), error: undefined }
    } catch (e) {
      next = { ...srv, at: Date.now(), error: String((e as Error).message).slice(0, 160) }
    }
    const mcp = conf.mcp.map((s) => (s.id === srv.id ? next : s))
    await save(db, K.mcp, mcp)
    return view({ ...conf, mcp })
  }
  if (a === 'mcpTools') {
    const allow = new Set((Array.isArray(body.allowed) ? body.allowed : []).map(String))
    const mcp = conf.mcp.map((s) => (s.id === body.id ? { ...s, tools: s.tools.map((t) => ({ ...t, allowed: allow.has(t.name) })) } : s))
    await save(db, K.mcp, mcp)
    return view({ ...conf, mcp })
  }
  if (a === 'mcpRemove') {
    const mcp = conf.mcp.filter((s) => s.id !== body.id)
    await save(db, K.mcp, mcp)
    return view({ ...conf, mcp })
  }
  throw Object.assign(new Error('Unknown action'), { status: 400 })
}
