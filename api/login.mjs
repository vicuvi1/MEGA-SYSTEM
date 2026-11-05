// POST /api/login {pin} → {session}
// POST /api/login {renew: session} → {session}: a device that skips the PIN
// (Settings → General) swaps its still-valid session for a fresh 30-day one.
// POST /api/login {signOutAll: session} → {session}: every other device has
// to enter the PIN again (this one gets a fresh session).
// POST /api/login {passkey:'options'|'register'|'login', …}: fingerprint/face unlock (_passkey.mjs).
import { clientIp, config, liveEpoch, login, makeSession, readBody, send, sessionOk, signOutAll } from './_lib.mjs'
import { expectedSite, passkeyLogin, passkeyOptions, passkeyRegister } from './_passkey.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up: add TURSO_URL and TURSO_TOKEN in Vercel' })
  try {
    const body = await readBody(req)
    const { pin, renew, signOutAll: all } = body
    // Passkeys (M7): options for either step; registering needs your session (PIN first).
    if (body.passkey === 'options') return send(res, 200, await passkeyOptions(cfg, body.op))
    if (body.passkey === 'register') {
      if (!(await sessionOk(cfg, body.session))) return send(res, 401, { error: 'Unlock with your PIN first' })
      return send(res, 200, await passkeyRegister(cfg, body, expectedSite(req)))
    }
    if (body.passkey === 'login') {
      try {
        return send(res, 200, await passkeyLogin(cfg, body, expectedSite(req)))
      } catch (e) {
        return send(res, 401, { error: e.message || 'Passkey failed' })
      }
    }
    if (all) return (await sessionOk(cfg, all)) ? send(res, 200, { session: await signOutAll(cfg) }) : send(res, 401, { error: 'Session expired: enter your PIN' })
    if (renew) return (await sessionOk(cfg, renew)) ? send(res, 200, { session: makeSession(cfg, Date.now(), await liveEpoch(cfg)) }) : send(res, 401, { error: 'Session expired: enter your PIN' })
    const r = await login(cfg, pin, Date.now(), fetch, clientIp(req))
    send(res, r.status, r.body)
  } catch (e) {
    send(res, 502, { error: e.message || 'Login failed' })
  }
}
