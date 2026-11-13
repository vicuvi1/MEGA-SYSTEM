// Phone keys (MC14, and Phone payments): each phone (an iOS Shortcut, an
// Android automation like MacroDroid) gets its own key, made in Settings. The
// server keeps only a SHA-256 hash of it in a server-only table (sys_ tables
// never reach the devices or /api/db); the key itself is shown once. A key is
// checked in constant time and can be removed on its own. Health keys and
// payment keys are separate kinds (own table, own prefix, own hash salt), so
// a health key can never post money and a payment key can never post health.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { run, sessionOk } from './_lib.mjs'

function keyKind({ table, prefix, salt, fallback }) {
  const T = `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, label TEXT NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL, last_used INTEGER)`
  const hashOf = (key) => createHash('sha256').update(`${salt}:${key}`).digest()
  const shape = new RegExp(`^${prefix}[\\w-]{20,64}$`)
  return {
    /** A new key: returned once ({id, label, key}). */
    async make(cfg, label, now = Date.now(), fetchImpl = fetch) {
      const id = randomBytes(6).toString('hex')
      const key = `${prefix}${randomBytes(24).toString('base64url')}`
      const name = String(label || fallback).replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) || fallback
      await run(cfg, [[T], [`INSERT INTO ${table} (id, label, hash, created) VALUES (?, ?, ?, ?)`, [id, name, hashOf(key).toString('hex'), now]]], fetchImpl)
      return { id, label: name, key }
    },
    /** The keys (without hashes): id, label, made, last used. */
    async list(cfg, fetchImpl = fetch) {
      const [, rows] = await run(cfg, [[T], [`SELECT id, label, created, last_used FROM ${table} ORDER BY created`]], fetchImpl)
      return rows.map(([id, label, created, last]) => ({ id: String(id), label: String(label), created: Number(created), lastUsed: last == null ? null : Number(last) }))
    },
    async drop(cfg, id, fetchImpl = fetch) {
      await run(cfg, [[T], [`DELETE FROM ${table} WHERE id = ?`, [String(id || '')]]], fetchImpl)
    },
    /** The matching key ({id, label}) or null (every hash is compared, in constant time). */
    async check(cfg, key, now = Date.now(), fetchImpl = fetch) {
      const given = String(key || '')
      if (!shape.test(given)) return null
      const [, rows] = await run(cfg, [[T], [`SELECT id, hash, label FROM ${table}`]], fetchImpl)
      const h = hashOf(given)
      let hit = null
      for (const [id, hex, label] of rows) {
        const saved = Buffer.from(String(hex), 'hex')
        if (saved.length === h.length && timingSafeEqual(saved, h)) hit = { id: String(id), label: String(label) }
      }
      if (hit) await run(cfg, [[`UPDATE ${table} SET last_used = ? WHERE id = ?`, [now, hit.id]]], fetchImpl).catch(() => null)
      return hit
    }
  }
}

const HEALTH = keyKind({ table: 'sys_health_keys', prefix: 'hk_', salt: 'life-health', fallback: 'My phone' })
const PAY = keyKind({ table: 'sys_pay_keys', prefix: 'pk_', salt: 'life-pay', fallback: 'My phone' })

/** A new key for a phone: returns it once ({id, label, key}). */
export const newHealthKey = (...a) => HEALTH.make(...a)
/** The keys (without hashes): id, label, made, last used. */
export const listHealthKeys = (...a) => HEALTH.list(...a)
export const dropHealthKey = (...a) => HEALTH.drop(...a)
/** True when the key matches one of the saved hashes (every hash is compared, in constant time). */
export const healthKeyOk = async (...a) => !!(await HEALTH.check(...a))

export const newPayKey = (...a) => PAY.make(...a)
export const listPayKeys = (...a) => PAY.list(...a)
export const dropPayKey = (...a) => PAY.drop(...a)
/** The payment key's {id, label}, or null. */
export const payKeyOk = (...a) => PAY.check(...a)

// ---- Phone payments: POST /api/cron?job=pay ---------------------------------

/** A notification is a few hundred bytes; anything over 4 KB is refused unread. */
export const PAY_MAX_BYTES = 4096
const hits = new Map()
/** At most `max` calls per `windowMs` for one name (an IP or a key), in this server copy's memory. */
export function rateOk(name, now = Date.now(), max = 20, windowMs = 60_000) {
  const list = (hits.get(name) ?? []).filter((t) => now - t < windowMs)
  const ok = list.length < max
  if (ok) list.push(now)
  hits.set(name, list)
  if (hits.size > 1000) hits.delete(hits.keys().next().value)
  return ok
}
export const forgetRates = () => hits.clear()

/**
 * The body as MacroDroid sends it. JSON first; a notification with a quote or
 * a line break inside can break MacroDroid's JSON, so then the fields are
 * picked out by name; with no fields at all the whole body is the text.
 * Never throws; null only for an empty body.
 */
export function readPayBody(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  try {
    const v = JSON.parse(s)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
  } catch {
    /* try the lenient ways */
  }
  try {
    const v = JSON.parse(s.replace(/[\u0000-\u001f]/g, (c) => JSON.stringify(c).slice(1, -1)))
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
  } catch {
    /* pick fields by name */
  }
  const out = {}
  for (const k of ['app', 'title', 'text', 'time']) {
    const m = new RegExp(`"${k}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?=,\\s*"(?:app|title|text|time)"\\s*:|\\}\\s*$)`).exec(s)
    if (m) out[k] = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
  }
  return Object.keys(out).length ? out : { text: s }
}

/** {app, title, text, time} checked: strings (or a number for time), each with a length cap. */
export function cleanPay(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Send JSON: {"app", "title", "text", "time"}' }
  const str = (v, max) => (v == null ? '' : typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v).slice(0, max) : null)
  const input = { app: str(body.app, 100), title: str(body.title, 300), text: str(body.text, 1500), time: str(body.time, 40) }
  if (Object.values(input).some((v) => v === null)) return { error: 'app, title, text and time must be text' }
  if (!input.text.trim() && !input.title.trim()) return { error: 'The notification text is empty' }
  return { input: { ...input, ...(body.test === true ? { test: true } : {}) } }
}

const WHAT = { saved: 'Saved to sort', merged: 'Joined the same payment from another app', duplicate: 'Already have it', ignored: 'Not a payment', unparsed: 'Kept, but the amount could not be read' }

/**
 * One request to job=pay. Returns [status, body]. `capture(input)` puts the
 * notification in money_tosort (the bot bundle's phonePay); it throws on a
 * database hiccup (→ 503). Never echoes the key or the text back.
 *   Bearer <payment key>, {app, title, text, time} → saved to sort
 *   Signed in (the app): {op:'list'} · {op:'new', label} → {key} once · {op:'drop', id} · {op:'test'}
 */
export async function payRequest({ cfg, method, token, ip = 'unknown', size = 0, raw, capture, now = Date.now(), fetchImpl = fetch, isSession = (t) => sessionOk(cfg, t, now, fetchImpl) }) {
  if (method !== 'POST') return [405, { error: 'POST only' }]
  if (size > PAY_MAX_BYTES) return [413, { error: 'Too big: a notification is at most 4 KB' }]
  if (!rateOk(`ip:${ip}`, now, 30)) return [429, { error: 'Too many requests: wait a minute' }]
  const body = readPayBody(raw)
  if (!body) return [400, { error: 'Empty body: send {"app", "title", "text", "time"}' }]
  try {
    if (typeof body.op === 'string') {
      if (!(await isSession(token))) return [401, { error: 'Locked: enter your PIN again' }]
      if (body.op === 'new') return [200, await newPayKey(cfg, body.label, now, fetchImpl)]
      if (body.op === 'drop') await dropPayKey(cfg, body.id, fetchImpl)
      if (body.op === 'test') {
        const r = await capture({ app: 'maib', title: 'maib', text: 'Plată: 1,00 MDL la TEST SHOP. Card *0000', time: '', test: true })
        return [200, { ok: true, status: r.status, what: WHAT[r.status], id: r.id }]
      }
      return [200, { keys: await listPayKeys(cfg, fetchImpl) }]
    }
    const key = await payKeyOk(cfg, token, now, fetchImpl)
    if (!key) return [401, { error: 'Not allowed: make a key in Settings → Phone payments' }]
    // One phone sends a handful a day; 30 in 10 minutes is a loop or a leak.
    if (!rateOk(`key:${key.id}`, now, 30, 10 * 60_000)) return [429, { error: 'Too many payments from this phone: wait 10 minutes' }]
    const c = cleanPay(body)
    if (c.error) return [400, { error: c.error }]
    const r = await capture(c.input)
    return [200, { ok: r.status !== 'ignored', status: r.status, what: WHAT[r.status], ...(r.reason ? { reason: r.reason } : {}), ...(r.amount != null ? { amount: r.amount, currency: r.currency } : {}) }]
  } catch (e) {
    console.error('pay:', e?.message || e)
    return [503, { error: 'Database not reachable: try again in a moment' }]
  }
}

/** The body as text, at most `max` bytes (null when bigger). Works with Vercel's parsed body too. */
export async function readCapped(req, max = PAY_MAX_BYTES) {
  const len = Number(req.headers?.['content-length'] || 0)
  if (len > max) return { size: len, raw: '' }
  let b
  try {
    b = req.body
  } catch {
    b = undefined // Vercel could not parse it as JSON: read the stream below
  }
  if (b != null) {
    const raw = typeof b === 'string' ? b : Buffer.isBuffer(b) ? b.toString('utf8') : JSON.stringify(b)
    return { size: Buffer.byteLength(raw), raw }
  }
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > max) return { size, raw: '' }
    chunks.push(c)
  }
  return { size, raw: Buffer.concat(chunks).toString('utf8') }
}
