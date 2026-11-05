// Phone health keys (MC14): each phone (an iOS Shortcut, an Android
// automation) gets its own key, made in Settings → Plugins. The server keeps
// only a SHA-256 hash of it in a server-only table (sys_ tables never reach
// the devices or /api/db); the key itself is shown once. A key is checked in
// constant time and can be removed on its own.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { run } from './_lib.mjs'

const T_KEYS = 'CREATE TABLE IF NOT EXISTS sys_health_keys (id TEXT PRIMARY KEY, label TEXT NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL, last_used INTEGER)'
const hashOf = (key) => createHash('sha256').update(`life-health:${key}`).digest()

/** A new key for a phone: returns it once ({id, label, key}). */
export async function newHealthKey(cfg, label, now = Date.now(), fetchImpl = fetch) {
  const id = randomBytes(6).toString('hex')
  const key = `hk_${randomBytes(24).toString('base64url')}`
  const name = String(label || 'My phone').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40) || 'My phone'
  await run(cfg, [[T_KEYS], ['INSERT INTO sys_health_keys (id, label, hash, created) VALUES (?, ?, ?, ?)', [id, name, hashOf(key).toString('hex'), now]]], fetchImpl)
  return { id, label: name, key }
}

/** The keys (without hashes): id, label, made, last used. */
export async function listHealthKeys(cfg, fetchImpl = fetch) {
  const [, rows] = await run(cfg, [[T_KEYS], ['SELECT id, label, created, last_used FROM sys_health_keys ORDER BY created']], fetchImpl)
  return rows.map(([id, label, created, last]) => ({ id: String(id), label: String(label), created: Number(created), lastUsed: last == null ? null : Number(last) }))
}

export async function dropHealthKey(cfg, id, fetchImpl = fetch) {
  await run(cfg, [[T_KEYS], ['DELETE FROM sys_health_keys WHERE id = ?', [String(id || '')]]], fetchImpl)
}

/** True when the key matches one of the saved hashes (every hash is compared, in constant time). */
export async function healthKeyOk(cfg, key, now = Date.now(), fetchImpl = fetch) {
  const given = String(key || '')
  if (!/^hk_[\w-]{20,64}$/.test(given)) return false
  const [, rows] = await run(cfg, [[T_KEYS], ['SELECT id, hash FROM sys_health_keys']], fetchImpl)
  const h = hashOf(given)
  let hit = null
  for (const [id, hex] of rows) {
    const saved = Buffer.from(String(hex), 'hex')
    if (saved.length === h.length && timingSafeEqual(saved, h)) hit = String(id)
  }
  if (hit) await run(cfg, [['UPDATE sys_health_keys SET last_used = ? WHERE id = ?', [now, hit]]], fetchImpl).catch(() => null)
  return !!hit
}
