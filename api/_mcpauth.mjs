// Personal tokens for AI apps (MC1) and the small OAuth 2.1 flow that makes
// them from claude.ai and ChatGPT (MC4). Not a function on Vercel ("_").
//
// A token is shown once. The server keeps only its SHA-256 hash, in a
// server-only table /api/db refuses (sys_mcp_tokens, see _sqlguard.mjs), with
// the session "epoch" it was made in: "Sign out all devices" or a new PIN
// change the epoch, and every older token stops working, like a session.
// Removing one token on Settings → Connect an AI app ends just that one.
//
// OAuth needs no table of its own: a client id and a sign-in code are short
// signed notes (HMAC with the session secret), and a code works once (sys_gate).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { gate, liveEpoch, run, sign } from './_lib.mjs'

const T_TOKENS = 'CREATE TABLE IF NOT EXISTS sys_mcp_tokens (id TEXT PRIMARY KEY, label TEXT NOT NULL, scope TEXT NOT NULL, hash TEXT NOT NULL, ep TEXT NOT NULL, created INTEGER NOT NULL, last_used INTEGER)'
export const MAX_TOKENS = 20
const TOKEN_RE = /^lsm_([0-9a-f]{12})_([A-Za-z0-9_-]{32})$/

const sha = (s) => createHash('sha256').update(String(s)).digest()
const cleanLabel = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'AI app'
export const cleanScope = (s) => (s === 'write' ? 'write' : 'read')

/** A new token: { token (shown once), id, label, scope, created }. */
export async function createToken(cfg, { label, scope }, now = Date.now(), fetchImpl = fetch) {
  const ep = await liveEpoch(cfg, fetchImpl, now)
  const [, count] = await run(cfg, [[T_TOKENS], ['SELECT COUNT(*) FROM sys_mcp_tokens']], fetchImpl)
  if (Number(count[0]?.[0]) >= MAX_TOKENS) throw Object.assign(new Error(`At most ${MAX_TOKENS} connections: remove one first`), { status: 400 })
  const id = randomBytes(6).toString('hex')
  const token = `lsm_${id}_${randomBytes(24).toString('base64url')}`
  const row = { id, label: cleanLabel(label), scope: cleanScope(scope), created: now }
  await run(cfg, [['INSERT INTO sys_mcp_tokens (id, label, scope, hash, ep, created, last_used) VALUES (?, ?, ?, ?, ?, ?, NULL)', [id, row.label, row.scope, sha(token).toString('hex'), ep, now]]], fetchImpl)
  return { token, ...row }
}

/** Your connections (no hashes); ones from before a sign-out-all are cleared away. */
export async function listTokens(cfg, now = Date.now(), fetchImpl = fetch) {
  const ep = await liveEpoch(cfg, fetchImpl, now)
  const [, , rows] = await run(cfg, [[T_TOKENS], ['DELETE FROM sys_mcp_tokens WHERE ep <> ?', [ep]], ['SELECT id, label, scope, created, last_used FROM sys_mcp_tokens ORDER BY created DESC']], fetchImpl)
  return rows.map((r) => ({ id: String(r[0]), label: String(r[1]), scope: cleanScope(r[2]), created: Number(r[3]), lastUsed: r[4] == null ? null : Number(r[4]) }))
}

export async function revokeToken(cfg, id, fetchImpl = fetch) {
  await run(cfg, [[T_TOKENS], ['DELETE FROM sys_mcp_tokens WHERE id = ?', [String(id ?? '').slice(0, 20)]]], fetchImpl)
}

/**
 * The connection behind a bearer token: { id, label, scope }, or null (no
 * such token, wrong, removed, or from before a sign-out). Compared in
 * constant time. Throws when the database can't be reached (a 503, never a
 * "signed out").
 */
export async function tokenAuth(cfg, token, now = Date.now(), fetchImpl = fetch) {
  const m = TOKEN_RE.exec(String(token ?? ''))
  if (!m) return null
  const [, rows] = await run(cfg, [[T_TOKENS], ['SELECT hash, ep, scope, label, last_used FROM sys_mcp_tokens WHERE id = ?', [m[1]]]], fetchImpl)
  const row = rows[0]
  const want = row ? Buffer.from(String(row[0]), 'hex') : sha('no such token')
  const got = sha(token)
  const same = want.length === got.length && timingSafeEqual(want, got)
  if (!row || !same) return null
  if (String(row[1]) !== (await liveEpoch(cfg, fetchImpl, now))) return null
  // "Last used", at most once a minute.
  if (row[4] == null || now - Number(row[4]) > 60_000) await run(cfg, [['UPDATE sys_mcp_tokens SET last_used = ? WHERE id = ?', [now, m[1]]]], fetchImpl).catch(() => {})
  return { id: m[1], label: String(row[3]), scope: cleanScope(row[2]) }
}

// ---- a simple per-connection rate limit (per server instance) ---------------

const hits = new Map()
/** True when this connection may make another call (60 a minute). */
export function rateOk(id, now = Date.now(), perMin = 60) {
  const list = (hits.get(id) ?? []).filter((t) => now - t < 60_000)
  if (list.length >= perMin) {
    hits.set(id, list)
    return false
  }
  list.push(now)
  hits.set(id, list)
  if (hits.size > 500) hits.delete(hits.keys().next().value)
  return true
}

// ---- OAuth 2.1 (authorization code + PKCE) for remote AI apps ---------------

/** Where a sign-in may send you back: Claude, ChatGPT, and this computer. */
const ALLOWED_HOSTS = new Set(['claude.ai', 'claude.com', 'chatgpt.com', 'chat.openai.com'])
export function redirectAllowed(uri) {
  let u
  try {
    u = new URL(String(uri))
  } catch {
    return false
  }
  if (u.username || u.password || u.hash) return false
  if (u.protocol === 'https:') return ALLOWED_HOSTS.has(u.hostname)
  if (u.protocol === 'http:') return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'
  return false
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const unb64 = (s) => {
  try {
    return JSON.parse(Buffer.from(String(s), 'base64url').toString())
  } catch {
    return null
  }
}
const sealed = (cfg, kind, o) => {
  const data = b64(o)
  return `${data}.${sign(cfg.secret, `mcp-${kind}:${data}`)}`
}
const opened = (cfg, kind, s) => {
  const [data, sig] = String(s ?? '').split('.')
  if (!cfg.secret || !data || !sig) return null
  const want = Buffer.from(sign(cfg.secret, `mcp-${kind}:${data}`))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  return unb64(data)
}

/** Dynamic client registration: the client id is a signed note of its name and redirect URIs. */
export function registerClient(cfg, body) {
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : []
  if (!uris.length || uris.length > 5) return { status: 400, body: { error: 'invalid_redirect_uri', error_description: 'Give 1 to 5 redirect_uris' } }
  const bad = uris.find((u) => !redirectAllowed(u))
  if (bad) return { status: 400, body: { error: 'invalid_redirect_uri', error_description: 'Only Claude, ChatGPT and localhost may connect' } }
  const name = cleanLabel(body?.client_name || 'AI app')
  const client_id = sealed(cfg, 'client', { n: name, r: uris })
  return {
    status: 201,
    body: { client_id, client_name: name, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'], client_id_issued_at: Math.floor(Date.now() / 1000) }
  }
}

export function readClient(cfg, clientId) {
  const c = opened(cfg, 'client', clientId)
  return c && typeof c.n === 'string' && Array.isArray(c.r) ? { name: c.n, redirects: c.r.map(String) } : null
}

/**
 * The checks an authorize request must pass before the PIN page is shown:
 * the client, its redirect URI, PKCE S256. Returns { client, … } or { error }.
 */
export function authorizeRequest(cfg, q) {
  const client = readClient(cfg, q.client_id)
  if (!client) return { error: 'This app is not registered with Life System. Try connecting again.' }
  const redirect = String(q.redirect_uri || (client.redirects.length === 1 ? client.redirects[0] : ''))
  if (!client.redirects.includes(redirect) || !redirectAllowed(redirect)) return { error: 'That return address is not allowed.' }
  if (q.response_type !== 'code') return { error: 'Only response_type=code is supported.', redirect }
  if (q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(String(q.code_challenge || ''))) return { error: 'PKCE (S256) is required.', redirect }
  const wants = String(q.scope || '').split(/\s+/)
  return { client, redirect, challenge: String(q.code_challenge), scope: wants.includes('write') ? 'write' : 'read', state: q.state == null ? '' : String(q.state).slice(0, 500), clientId: String(q.client_id) }
}

/** A one-time sign-in code (2 minutes). */
export function makeCode(cfg, { clientId, redirect, challenge, scope, label }, now = Date.now()) {
  return sealed(cfg, 'code', { c: sha(clientId).toString('base64url'), r: redirect, x: challenge, s: cleanScope(scope), l: cleanLabel(label), e: now + 120_000, n: randomBytes(9).toString('base64url') })
}

/** PKCE S256: base64url(sha256(verifier)) is the challenge. */
export function pkceOk(verifier, challenge) {
  const v = String(verifier ?? '')
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(v)) return false
  const a = Buffer.from(createHash('sha256').update(v).digest('base64url'))
  const b = Buffer.from(String(challenge ?? ''))
  return a.length === b.length && timingSafeEqual(a, b)
}

/** POST token {grant_type, code, code_verifier, redirect_uri, client_id} → a personal token. */
export async function exchangeCode(cfg, body, now = Date.now(), fetchImpl = fetch) {
  const bad = (d) => ({ status: 400, body: { error: 'invalid_grant', error_description: d } })
  if (body?.grant_type !== 'authorization_code') return { status: 400, body: { error: 'unsupported_grant_type' } }
  const c = opened(cfg, 'code', body.code)
  if (!c || !(c.e > now)) return bad('The code is wrong or expired')
  if (c.c !== sha(String(body.client_id ?? '')).toString('base64url')) return bad('The code is for another app')
  if (body.redirect_uri != null && String(body.redirect_uri) !== c.r) return bad('The return address does not match')
  if (!pkceOk(body.code_verifier, c.x)) return bad('PKCE check failed')
  // Each code works once, across every server instance.
  if (!(await gate(cfg, `mcpcode:${c.n}`, 3600_000, now, fetchImpl))) return bad('The code was already used')
  const t = await createToken(cfg, { label: c.l, scope: c.s }, now, fetchImpl)
  return { status: 200, body: { access_token: t.token, token_type: 'Bearer', scope: t.scope } }
}

// ---- metadata and the PIN page ------------------------------------------------

export const resourceMeta = (base) => ({ resource: `${base}/api/mcp`, authorization_servers: [base], scopes_supported: ['read', 'write'], bearer_methods_supported: ['header'], resource_name: 'Life System' })
export const serverMeta = (base) => ({
  issuer: base,
  authorization_endpoint: `${base}/api/mcp?oauth=authorize`,
  token_endpoint: `${base}/api/mcp?oauth=token`,
  registration_endpoint: `${base}/api/mcp?oauth=register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: ['read', 'write']
})

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** The page that asks for your PIN and what the app may do. Plain HTML, no scripts. */
export function authorizePage({ client, scope, fields, error }) {
  const hidden = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect ${esc(client)} · Life System</title>
<style>:root{--bg:#0f1115;--surface:#171a21;--text:#eef0f4;--muted:#9aa3b2;--border:#2a2f3a;--accent:#7c8cff;--danger:#ff6b6b}
@media (prefers-color-scheme: light){:root{--bg:#f5f6f8;--surface:#fff;--text:#14161b;--muted:#5d6574;--border:#dfe3ea;--accent:#4b5cff}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px}
main{width:100%;max-width:380px;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:22px}
h1{font-size:19px;margin:0 0 6px}p{color:var(--muted);margin:0 0 14px}label{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border);border-radius:10px;margin:0 0 8px;cursor:pointer}
label small{display:block;color:var(--muted)}input[type=password]{width:100%;padding:11px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:18px;letter-spacing:4px;margin:6px 0 14px}
button{width:100%;padding:12px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-size:15px;font-weight:600;cursor:pointer}.err{color:var(--danger)}</style></head>
<body><main><h1>Allow ${esc(client)}?</h1><p>${esc(client)} wants to use your Life System. You can remove it any time in Settings → Connect an AI app.</p>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/api/mcp?oauth=authorize">${hidden}
<label><input type="radio" name="access" value="read"${scope === 'write' ? '' : ' checked'}><span><b>Read only</b><small>Your day, tasks, calendar, habits, sleep, money totals, notes.</small></span></label>
<label><input type="radio" name="access" value="write"${scope === 'write' ? ' checked' : ''}><span><b>Read and write</b><small>Also log water and workouts, add must-dos, tasks, expenses, notes, reminders, start focus, talk to Ben.</small></span></label>
<div><b>Your PIN</b><input type="password" name="pin" inputmode="numeric" autocomplete="current-password" required minlength="4" maxlength="12" pattern="[0-9]*" autofocus></div>
<button type="submit">Allow</button></form></main></body></html>`
}
