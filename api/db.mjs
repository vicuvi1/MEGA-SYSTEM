// POST /api/db (Bearer session): a Turso pipeline request, sent on with the
// server's Turso key.
import { bearer, config, readBody, send, sessionOk, turso } from './_lib.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up: add TURSO_URL and TURSO_TOKEN in Vercel' })
  if (!(await sessionOk(cfg, bearer(req)))) return send(res, 401, { error: 'Locked: enter your PIN again' })
  try {
    const body = await readBody(req)
    if (!Array.isArray(body?.requests)) return send(res, 400, { error: 'Expected {requests: [...]}' })
    const r = await turso(cfg, body)
    send(res, r.status, r.json)
  } catch (e) {
    send(res, 502, { error: e.message || 'Database request failed' })
  }
}
