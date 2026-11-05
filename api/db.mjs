// POST /api/db (Bearer session): a Turso pipeline request, sent on with the
// server's Turso key. Server-only tables and statements are refused (_sqlguard.mjs).
import { pipelineProblem } from './_sqlguard.mjs'
import { bearer, config, readBody, send, requireSession, turso } from './_lib.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up: add TURSO_URL and TURSO_TOKEN in Vercel' })
  if (!(await requireSession(res, cfg, bearer(req)))) return
  try {
    const body = await readBody(req)
    // Only the app's own data: never the server's tables or ATTACH/PRAGMA (A1).
    const problem = pipelineProblem(body)
    if (problem) return send(res, 403, { error: problem })
    const r = await turso(cfg, body)
    send(res, r.status, r.json)
  } catch (e) {
    send(res, 502, { error: e.message || 'Database request failed' })
  }
}
