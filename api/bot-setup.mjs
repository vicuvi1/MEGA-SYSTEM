// POST /api/bot-setup (session required): points every bot in the server's
// settings at /api/telegram, so they answer 24/7. Safe to call often: a bot
// already pointed here is left as it is. Production only (a preview must not
// take the bots away from the live site).
import { bearer, config, leftBots, readBody, send, serverBots, sessionOk, webhookSecret } from './_lib.mjs'

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
  // {test: true}: a test message from the server's main bot (tokens never reach the page).
  if (req.headers['content-type']?.includes('json')) {
    let body = {}
    try {
      body = await readBody(req)
    } catch {
      body = {}
    }
    if (body?.test) {
      const bot = serverBots().find((b) => b.name === 'MEGA_BOT_TOKEN') ?? serverBots()[0]
      const chat = process.env.TELEGRAM_CHAT_ID || ''
      if (!bot || !chat) return send(res, 200, { ok: false, error: 'No bot or chat set up on the server' })
      try {
        const r = await tg(bot.token, 'sendMessage', { chat_id: chat, text: '✅ Test from Life System: the server bot works.' })
        return send(res, 200, r?.ok ? { ok: true } : { ok: false, error: r?.description || 'Telegram refused' })
      } catch (e) {
        return send(res, 200, { ok: false, error: e.message })
      }
    }
  }
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') return send(res, 200, { ok: false, reason: 'not production' })
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || req.headers['x-forwarded-host'] || req.headers.host
  const bots = serverBots()
  if (!host || !bots.length) return send(res, 200, { ok: false, reason: 'no bots' })
  const results = []
  for (const b of bots) {
    const url = `https://${host}/api/telegram?bot=${b.id}`
    try {
      const info = await tg(b.token, 'getWebhookInfo')
      const kinds = info?.result?.allowed_updates ?? []
      if (info?.result?.url === url && kinds.includes('callback_query')) {
        results.push({ bot: b.name, ok: true, already: true })
        continue
      }
      const set = await tg(b.token, 'setWebhook', { url, secret_token: webhookSecret(cfg, b.id), allowed_updates: ['message', 'callback_query'], drop_pending_updates: false })
      results.push({ bot: b.name, ok: !!set?.ok, error: set?.ok ? undefined : set?.description })
    } catch (e) {
      results.push({ bot: b.name, ok: false, error: e.message })
    }
  }
  // Bots given back to their own program: let go of them if we held them.
  for (const b of leftBots()) {
    try {
      const info = await tg(b.token, 'getWebhookInfo')
      if (String(info?.result?.url || '').includes('/api/telegram?bot=')) {
        const off = await tg(b.token, 'deleteWebhook', { drop_pending_updates: false })
        results.push({ bot: b.name, released: !!off?.ok })
      }
    } catch (e) {
      results.push({ bot: b.name, released: false, error: e.message })
    }
  }
  send(res, 200, { ok: results.filter((r) => !('released' in r)).every((r) => r.ok), bots: results })
}
