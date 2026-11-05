// GET /api/config (Bearer session): the bot settings to start from. Tokens
// never leave the server: each one is replaced by "on-server" (the server's
// bots answer every message; the page only needs to know they exist).
// POST /api/config {pushSubscribe | pushUnsubscribe} (Bearer session): this phone's push address (N11).
// POST /api/config {pushPeek: address} (no session: the offline helper): the newest unread notifications.
import { bearer, botDefaults, config, readBody, send, requireSession } from './_lib.mjs'
import { peek, subscribe, unsubscribe, vapidPublic } from './_push.mjs'

export const SERVER_TOKEN = 'on-server'

export function publicBots(bots) {
  const out = {}
  for (const [k, v] of Object.entries(bots)) out[k] = /Token$/.test(k) ? (v ? SERVER_TOKEN : '') : v
  return out
}

export default async function handler(req, res) {
  const cfg = config()
  if (req.method === 'POST') {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      return send(res, 400, { error: 'Bad request' })
    }
    try {
      // The phone's offline helper: it proves who it is with its push address.
      if (body.pushPeek) return send(res, 200, { items: await peek(cfg, body.pushPeek) })
      if (!(await requireSession(res, cfg, bearer(req)))) return
      if (body.pushSubscribe) await subscribe(cfg, body.pushSubscribe)
      if (body.pushUnsubscribe) await unsubscribe(cfg, body.pushUnsubscribe)
      return send(res, 200, { ok: true })
    } catch (e) {
      return send(res, 400, { error: e.message || 'Push failed' })
    }
  }
  if (!(await requireSession(res, cfg, bearer(req)))) return
  // tz: the time zone your plan and Ben run on, so the calendar can warn when a device differs.
  send(res, 200, { bots: publicBots(botDefaults()), vapidPublicKey: vapidPublic() || null, tz: process.env.LIFE_TZ || 'Europe/Chisinau' })
}
