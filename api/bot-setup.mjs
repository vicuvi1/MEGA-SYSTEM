// POST /api/bot-setup (session required): points every bot in the server's
// settings at /api/telegram, so they answer 24/7. Safe to call often: a bot
// already pointed here is left as it is. Production only (a preview must not
// take the bots away from the live site).
import { bearer, config, send, serverBots, sessionOk, webhookSecret } from './_lib.mjs'

async function tg(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000)
  })
  return res.json()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!sessionOk(cfg, bearer(req))) return send(res, 401, { error: 'Locked: enter your PIN again' })
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') return send(res, 200, { ok: false, reason: 'not production' })
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || req.headers['x-forwarded-host'] || req.headers.host
  const bots = serverBots()
  if (!host || !bots.length) return send(res, 200, { ok: false, reason: 'no bots' })
  const results = []
  for (const b of bots) {
    const url = `https://${host}/api/telegram?bot=${b.id}`
    try {
      const info = await tg(b.token, 'getWebhookInfo')
      if (info?.result?.url === url) {
        results.push({ bot: b.name, ok: true, already: true })
        continue
      }
      const set = await tg(b.token, 'setWebhook', { url, secret_token: webhookSecret(cfg, b.id), allowed_updates: ['message'], drop_pending_updates: false })
      results.push({ bot: b.name, ok: !!set?.ok, error: set?.ok ? undefined : set?.description })
    } catch (e) {
      results.push({ bot: b.name, ok: false, error: e.message })
    }
  }
  send(res, 200, { ok: results.every((r) => r.ok), bots: results })
}
