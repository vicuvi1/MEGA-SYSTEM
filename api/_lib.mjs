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

export async function getSetting(cfg, key, fetchImpl) {
  const { status, json } = await turso(cfg, { requests: [{ type: 'execute', stmt: { sql: 'SELECT value FROM settings WHERE key = ?', args: [text(key)] } }, { type: 'close' }] }, fetchImpl)
  const r = json?.results?.[0]
  if (status !== 200 || !r || r.type === 'error') throw new Error('Database not reachable')
  const row = r.response?.result?.rows?.[0]
  return row ? cell(row[0]) : null
}

export async function setSetting(cfg, key, value, fetchImpl) {
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
export const sign = (secret, data) => createHmac('sha256', secret).update(data).digest('base64url')

/**
 * A session carries the "epoch" it was made in: a short hash of the PIN hash
 * and the sign-out counter. Changing the PIN or "Sign out all devices"
 * changes the epoch, and every older session stops working.
 */
export function makeSession(cfg, now = Date.now(), ep = '') {
  const data = b64(JSON.stringify({ exp: now + SESSION_DAYS * 86400_000, ep }))
  return `${data}.${sign(cfg.secret, data)}`
}

/** Signed by us and not expired: its payload, else null (no database read). */
export function sessionSigned(cfg, token, now = Date.now()) {
  if (!cfg.secret || typeof token !== 'string') return null
  const [data, sig] = token.split('.')
  if (!data || !sig) return null
  const want = Buffer.from(sign(cfg.secret, data))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString())
    return p.exp > now ? p : null
  } catch {
    return null
  }
}

const EPOCH_KEY = 'session_epoch'
let epochCache = { at: 0, value: '' }
/** The current epoch (cached 30 s per server instance). */
export async function liveEpoch(cfg, fetchImpl = fetch, now = Date.now()) {
  if (epochCache.value && now - epochCache.at < 30_000) return epochCache.value
  const [pin, counter] = await Promise.all([getSetting(cfg, 'pin_hash', fetchImpl), getSetting(cfg, EPOCH_KEY, fetchImpl)])
  const value = createHash('sha256').update(`${pin ?? ''}|${counter ?? '0'}`).digest('base64url').slice(0, 16)
  epochCache = { at: now, value }
  return value
}
export const forgetEpoch = () => (epochCache = { at: 0, value: '' })

/** A valid session: signed, not expired, and from the current epoch. */
export async function sessionOk(cfg, token, now = Date.now(), fetchImpl = fetch) {
  const p = sessionSigned(cfg, token, now)
  if (!p) return false
  try {
    return p.ep === (await liveEpoch(cfg, fetchImpl, now))
  } catch {
    return false
  }
}

/** "Sign out all devices": a new epoch; returns a fresh session for the device that asked. */
export async function signOutAll(cfg, now = Date.now(), fetchImpl = fetch) {
  const n = Number((await getSetting(cfg, EPOCH_KEY, fetchImpl)) || 0) + 1
  await setSetting(cfg, EPOCH_KEY, String(n), fetchImpl)
  forgetEpoch()
  return makeSession(cfg, now, await liveEpoch(cfg, fetchImpl, now))
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
  forgetEpoch()
  return { status: 200, body: { session: makeSession(cfg, now, await liveEpoch(cfg, fetchImpl, now)) } }
}

/** The bot settings the app starts from (tokens live in the server's settings). */
export function botDefaults(env = process.env) {
  const chat = env.TELEGRAM_CHAT_ID || ''
  const main = env.TELEGRAM_BOT_TOKEN || ''
  return {
    // Bots run by their own program: the app never reads them.
    skipBotIds: leftBots(env).map((b) => b.id),
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

const BOT_VARS = ['MEGA_BOT_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SPORT_BOT_TOKEN', 'FINANCE_BOT_TOKEN', 'MAN_BOT_TOKEN']

/** Bots run by their own program (e.g. Sporty's Python bot): BOTS_NOT_ON_SERVER=TELEGRAM_BOT_TOKEN,… */
export function leftBots(env = process.env) {
  const names = String(env.BOTS_NOT_ON_SERVER || '').split(',').map((s) => s.trim()).filter(Boolean)
  return names.map((name) => ({ name, token: (env[name] || '').trim() })).filter((b) => b.token.includes(':')).map((b) => ({ ...b, id: b.token.split(':')[0] }))
}

/** The bots the server answers, one entry per bot (same token twice is one bot). */
export function serverBots(env = process.env) {
  const left = new Set(leftBots(env).map((b) => b.id))
  const out = []
  for (const name of BOT_VARS) {
    const token = (env[name] || '').trim()
    if (!token.includes(':')) continue
    const id = token.split(':')[0]
    if (!left.has(id) && !out.some((b) => b.id === id)) out.push({ name, id, token })
  }
  return out
}

/** The secret Telegram sends with each message to a bot, so nobody else can post as it. */
export const webhookSecret = (cfg, botId) => sign(cfg.secret, 'telegram:' + botId)
