// POST /api/login {pin} → {session}
// POST /api/login {renew: session} → {session}: a device that skips the PIN
// (Settings → General) swaps its still-valid session for a fresh 30-day one.
// POST /api/login {signOutAll: session} → {session}: every other device has
// to enter the PIN again (this one gets a fresh session).
import { config, liveEpoch, login, makeSession, readBody, send, sessionOk, signOutAll } from './_lib.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up: add TURSO_URL and TURSO_TOKEN in Vercel' })
  try {
    const { pin, renew, signOutAll: all } = await readBody(req)
    if (all) return (await sessionOk(cfg, all)) ? send(res, 200, { session: await signOutAll(cfg) }) : send(res, 401, { error: 'Session expired: enter your PIN' })
    if (renew) return (await sessionOk(cfg, renew)) ? send(res, 200, { session: makeSession(cfg, Date.now(), await liveEpoch(cfg)) }) : send(res, 401, { error: 'Session expired: enter your PIN' })
    const r = await login(cfg, pin)
    send(res, r.status, r.body)
  } catch (e) {
    send(res, 502, { error: e.message || 'Login failed' })
  }
}
