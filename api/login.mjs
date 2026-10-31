// POST /api/login {pin} → {session}
import { config, login, readBody, send } from './_lib.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up: add TURSO_URL and TURSO_TOKEN in Vercel' })
  try {
    const { pin } = await readBody(req)
    const r = await login(cfg, pin)
    send(res, r.status, r.body)
  } catch (e) {
    send(res, 502, { error: e.message || 'Login failed' })
  }
}
