// The web app's small server (Vercel functions). It keeps the Turso and
// Telegram keys out of the page: the app logs in with its PIN, gets a
// session, and sends its database requests here. Files starting with "_"
// are not functions on Vercel.
import { createHash, createHmac, scrypt, timingSafeEqual } from 'node:crypto'

const DEFAULT_PIN = '2007' // only while no PIN was ever set, like the app
const SESSION_DAYS = 30
const GUARD_KEY = 'web_login_guard'

export function config(env = process.env) {
  const url = (env.TURSO_URL || env.TURSO_DATABASE_URL || '').trim().replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '')
  const token = (env.TURSO_TOKEN || env.TURSO_AUTH_TOKEN || '').trim()
  const secret = env.SESSION_SECRET || (token ? createHash('sha256').update('life-session:' + token).digest('hex') : '')
  return { url, token, secret, ok: Boolean(url && token) }
}

/** Sends a hrana pipeline body to Turso; returns { status, json }. */
export async function turso(cfg, body, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.url}/v2/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { error: text.slice(0, 300) }
  }
  return { status: res.status, json }
}

const text = (v) => ({ type: 'text', value: String(v) })
const cell = (v) => (!v || v.type === 'null' ? null : v.value ?? null)

async function getSetting(cfg, key, fetchImpl) {
  const { status, json } = await turso(cfg, { requests: [{ type: 'execute', stmt: { sql: 'SELECT value FROM settings WHERE key = ?', args: [text(key)] } }, { type: 'close' }] }, fetchImpl)
  const r = json?.results?.[0]
  if (status !== 200 || !r || r.type === 'error') throw new Error('Database not reachable')
  const row = r.response?.result?.rows?.[0]
  return row ? cell(row[0]) : null
}

async function setSetting(cfg, key, value, fetchImpl) {
  await turso(cfg, {
    requests: [
      { type: 'execute', stmt: { sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: [text(key), text(value)] } },
      { type: 'close' }
    ]
  }, fetchImpl)
}

const scryptAsync = (pin, salt) =>
  new Promise((resolve, reject) => scrypt(pin, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? reject(e) : resolve(k))))

/** The same check as the app and the desktop: "saltHex:scryptHex", or an old plain PIN. */
export async function pinMatches(stored, pin) {
  pin = String(pin ?? '')
  if (!stored) return pin === DEFAULT_PIN
  const [saltHex, hashHex] = String(stored).split(':')
  if (saltHex && hashHex) {
    const key = await scryptAsync(pin, Buffer.from(saltHex, 'hex'))
    const want = Buffer.from(hashHex, 'hex')
    return key.length === want.length && timingSafeEqual(key, want)
  }
  return /^\d{4,12}$/.test(stored) && stored === pin
}

const b64 = (s) => Buffer.from(s).toString('base64url')
const sign = (secret, data) => createHmac('sha256', secret).update(data).digest('base64url')

export function makeSession(cfg, now = Date.now()) {
  const data = b64(JSON.stringify({ exp: now + SESSION_DAYS * 86400_000 }))
  return `${data}.${sign(cfg.secret, data)}`
}

export function sessionOk(cfg, token, now = Date.now()) {
  if (!cfg.secret || typeof token !== 'string') return false
  const [data, sig] = token.split('.')
  if (!data || !sig) return false
  const want = Buffer.from(sign(cfg.secret, data))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString()).exp > now
  } catch {
    return false
  }
}

/**
 * Checks the PIN against the one in Turso. Wrong PINs are counted in Turso
 * (so it holds across devices and server restarts): after 5, a wait that
 * doubles each time, from 1 minute up to a day.
 */
export async function login(cfg, pin, now = Date.now(), fetchImpl = fetch) {
  let guard = { fails: 0, until: 0 }
  try {
    guard = { ...guard, ...JSON.parse((await getSetting(cfg, GUARD_KEY, fetchImpl)) || '{}') }
  } catch (e) {
    if (e.message === 'Database not reachable') throw e
  }
  if (now < guard.until) return { status: 429, body: { error: `Too many tries. Wait ${Math.ceil((guard.until - now) / 1000)} s` } }
  const stored = await getSetting(cfg, 'pin_hash', fetchImpl)
  if (!(await pinMatches(stored, pin))) {
    const fails = guard.fails + 1
    const until = fails >= 5 ? now + Math.min(60_000 * 2 ** (fails - 5), 86400_000) : 0
    await setSetting(cfg, GUARD_KEY, JSON.stringify({ fails, until }), fetchImpl)
    return { status: 401, body: { error: until ? `Too many tries. Wait ${Math.ceil((until - now) / 1000)} s` : 'Wrong PIN' } }
  }
  if (guard.fails) await setSetting(cfg, GUARD_KEY, JSON.stringify({ fails: 0, until: 0 }), fetchImpl)
  return { status: 200, body: { session: makeSession(cfg, now) } }
}

/** The bot settings the app starts from (tokens live in the server's settings). */
export function botDefaults(env = process.env) {
  const chat = env.TELEGRAM_CHAT_ID || ''
  const main = env.TELEGRAM_BOT_TOKEN || ''
  return {
    megaBotToken: env.MEGA_BOT_TOKEN || '',
    botToken: main,
    chatId: chat,
    sportBotToken: env.SPORT_BOT_TOKEN || main,
    sportBotChatId: chat,
    financeBotToken: env.FINANCE_BOT_TOKEN || '',
    financeBotChatId: chat,
    manBotToken: env.MAN_BOT_TOKEN || '',
    manBotChatId: chat
  }
}

export const bearer = (req) => String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '')

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}')
  const chunks = []
  for await (const c of req) chunks.push(c)
  return JSON.parse(Buffer.concat(chunks).toString() || '{}')
}

export function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}
