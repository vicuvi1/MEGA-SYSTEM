// /api/mcp: Life System for AI apps (Claude, ChatGPT…), MC1–MC5.
//   POST /api/mcp  (Authorization: Bearer <personal token>)  JSON-RPC 2.0, MCP
//        "Streamable HTTP", stateless: one JSON answer per request (202 for
//        notifications). The tools are in src/server/mcp.ts (via _bot/bot.mjs).
//   GET  /api/mcp → 405 (no event stream: every answer comes with its request).
//   POST /api/mcp?op=tokens (Authorization: Bearer <app session>)
//        {action:'list'} | {action:'create', label, scope:'read'|'write'} | {action:'revoke', id}
//        Settings → Connect an AI app. A new token is shown once.
//   GET  /api/mcp?wk=resource | wk=as   OAuth metadata (vercel.json rewrites
//        /.well-known/oauth-protected-resource and …/oauth-authorization-server here).
//   POST /api/mcp?oauth=register        dynamic client registration (signed, no table)
//   GET/POST /api/mcp?oauth=authorize   the PIN page, then back to the app with a code
//   POST /api/mcp?oauth=token           code + PKCE verifier → a personal token
// Tool results are never logged.
import { bearer, botDefaults, checkPin, clientIp, config, gate, readBody, requireSession, send } from './_lib.mjs'
import { authorizePage, authorizeRequest, createToken, exchangeCode, listTokens, makeCode, rateOk, registerClient, resourceMeta, revokeToken, serverMeta, tokenAuth } from './_mcpauth.mjs'
import { mcpCall } from './_bot/bot.mjs'
import { askModel } from './ai.mjs'
import { googleEnv } from './google.mjs'

/** This site's address, for the OAuth metadata (APP_URL wins). */
export function baseUrl(req, env = process.env) {
  const fixed = String(env.APP_URL || '').trim().replace(/\/+$/, '')
  if (/^https:\/\//.test(fixed)) return fixed
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || 'localhost').split(',')[0].trim()
  const proto = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https'
  return `${proto}://${host}`
}

const cors = (res) => {
  // Bearer tokens only, no cookies: any origin may call (MCP Inspector, web clients).
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID')
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Protocol-Version')
}

const html = (res, status, body) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://claude.ai https://claude.com https://chatgpt.com https://chat.openai.com http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'")
  res.end(body)
}

/** A form or JSON body, as an object (Vercel may have parsed it already). */
async function formBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body
  let raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString() : null
  if (raw == null) {
    const chunks = []
    for await (const c of req) chunks.push(c)
    raw = Buffer.concat(chunks).toString()
  }
  if (String(req.headers?.['content-type'] || '').includes('json')) return JSON.parse(raw || '{}')
  return Object.fromEntries(new URLSearchParams(raw))
}

function unauthorized(res, req, why) {
  res.setHeader('WWW-Authenticate', `Bearer realm="life-system", resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"${why ? `, error="invalid_token", error_description="${why}"` : ''}`)
  send(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: why || 'Connect with a token from Life System (Settings → Connect an AI app)' } })
}

function botEnv(cfg) {
  const hasAi = (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || '').trim()
  const model = hasAi ? async (prompt, opts) => (await askModel(prompt, opts)).text : undefined
  return { tursoUrl: cfg.url, tursoToken: cfg.token, defaults: botDefaults(), timeZone: process.env.LIFE_TZ, todoistToken: process.env.TODOIST_TOKEN, model, google: googleEnv(cfg) }
}

async function oauth(req, res, cfg, kind) {
  const base = baseUrl(req)
  if (kind === 'register') {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
    let body
    try {
      body = await formBody(req)
    } catch {
      return send(res, 400, { error: 'invalid_client_metadata' })
    }
    const r = registerClient(cfg, body)
    return send(res, r.status, r.body)
  }
  if (kind === 'token') {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
    let body
    try {
      body = await formBody(req)
    } catch {
      return send(res, 400, { error: 'invalid_request' })
    }
    try {
      const r = await exchangeCode(cfg, body)
      return send(res, r.status, r.body)
    } catch {
      return send(res, 503, { error: 'temporarily_unavailable' })
    }
  }
  if (kind === 'authorize') {
    const url = new URL(req.url || '/', base)
    let q = Object.fromEntries(url.searchParams)
    let form = null
    if (req.method === 'POST') {
      try {
        form = await formBody(req)
      } catch {
        form = {}
      }
      q = { ...q, ...form }
    }
    const a = authorizeRequest(cfg, q)
    if (a.error) return html(res, 400, `<!doctype html><meta charset="utf-8"><title>Life System</title><p style="font:16px system-ui;padding:24px">${String(a.error).replace(/</g, '&lt;')}</p>`)
    const fields = { client_id: a.clientId, redirect_uri: a.redirect, response_type: 'code', code_challenge: a.challenge, code_challenge_method: 'S256', state: a.state, scope: a.scope }
    if (req.method !== 'POST') return html(res, 200, authorizePage({ client: a.client.name, scope: a.scope, fields }))
    const scope = form.access === 'write' ? 'write' : 'read'
    let refused
    try {
      refused = await checkPin(cfg, form.pin, Date.now(), fetch, clientIp(req))
    } catch {
      return html(res, 503, authorizePage({ client: a.client.name, scope, fields, error: 'Life System can’t reach its database right now. Try again in a minute.' }))
    }
    if (refused) return html(res, refused.status === 429 ? 429 : 401, authorizePage({ client: a.client.name, scope, fields, error: refused.body?.error || 'Wrong PIN' }))
    const code = makeCode(cfg, { clientId: a.clientId, redirect: a.redirect, challenge: a.challenge, scope, label: a.client.name })
    const back = new URL(a.redirect)
    back.searchParams.set('code', code)
    if (a.state) back.searchParams.set('state', a.state)
    back.searchParams.set('iss', base)
    res.statusCode = 302
    res.setHeader('Location', back.toString())
    res.setHeader('Cache-Control', 'no-store')
    return res.end()
  }
  return send(res, 404, { error: 'Unknown' })
}

/** Settings → Connect an AI app (your app session). */
async function tokens(req, res, cfg) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  if (!(await requireSession(res, cfg, bearer(req)))) return
  let body
  try {
    body = await readBody(req)
  } catch {
    return send(res, 400, { error: 'Bad request' })
  }
  try {
    if (body?.action === 'create') {
      const t = await createToken(cfg, { label: body.label, scope: body.scope })
      return send(res, 200, { created: t, tokens: await listTokens(cfg) })
    }
    if (body?.action === 'revoke') await revokeToken(cfg, body.id)
    return send(res, 200, { tokens: await listTokens(cfg) })
  } catch (e) {
    return send(res, e.status || 503, { error: e.status ? e.message : 'Database not reachable: try again in a moment' })
  }
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    return res.end()
  }
  const cfg = config()
  const url = new URL(req.url || '/', 'http://x')
  const wk = url.searchParams.get('wk')
  if (wk === 'resource') return send(res, 200, resourceMeta(baseUrl(req)))
  if (wk === 'as') return send(res, 200, serverMeta(baseUrl(req)))
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up: add TURSO_URL and TURSO_TOKEN in Vercel' })
  const kind = url.searchParams.get('oauth')
  if (kind) return oauth(req, res, cfg, kind)
  if (url.searchParams.get('op') === 'tokens') return tokens(req, res, cfg)

  // ---- MCP itself ----
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS')
    return send(res, 405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use POST (this server sends no event stream)' } })
  }
  let who
  try {
    who = await tokenAuth(cfg, bearer(req))
  } catch {
    return send(res, 503, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Database not reachable: try again in a moment' } })
  }
  if (!who) return unauthorized(res, req, bearer(req) ? 'The token is wrong or was removed' : '')
  if (!rateOk(who.id)) {
    res.setHeader('Retry-After', '30')
    return send(res, 429, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Too many calls: wait a minute' } })
  }
  let body
  try {
    body = await readBody(req)
  } catch {
    return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  }
  // Talking to Ben costs AI money: once every few seconds at most, across instances.
  const asksBen = (m) => m?.method === 'tools/call' && m?.params?.name === 'ask_ben'
  if ((Array.isArray(body) ? body : [body]).some(asksBen)) {
    const free = await gate(cfg, `mcp_ask:${who.id}`, 4000).catch(() => true)
    if (!free) return send(res, 429, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'One message to Ben at a time: wait a few seconds' } })
  }
  try {
    const out = await mcpCall(botEnv(cfg), body, { scope: who.scope, client: who.label })
    const version = String(req.headers?.['mcp-protocol-version'] || '')
    if (version) res.setHeader('Mcp-Protocol-Version', version)
    if (out === null) {
      res.statusCode = 202
      return res.end()
    }
    return send(res, 200, out)
  } catch (e) {
    // The failure only, never the data.
    console.error('mcp: failed', e?.message)
    return send(res, 503, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Life System could not answer: try again in a moment' } })
  }
}
