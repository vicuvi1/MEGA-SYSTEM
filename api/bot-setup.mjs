// GET /api/bot-setup (also /api/bot-health, a rewrite in vercel.json): for
// each bot in the server's settings, what Telegram says about it (name,
// webhook or not, messages waiting, last error). Reads nothing from the chats
// and shows no tokens; still, only you (a session or the CRON_SECRET) may ask.
// POST /api/bot-setup (session required): points every bot in the server's
// settings at /api/telegram, so they answer 24/7. Safe to call often: a bot
// already pointed here is left as it is. Production only (a preview must not
// take the bots away from the live site).
import { bearer, config, cronSecretOk, ensureWebhook, leftBots, readBody, send, serverBots, sessionOk, requireSession, tg } from './_lib.mjs'

const BOTS = ['MEGA_BOT_TOKEN', 'TELEGRAM_BOT_TOKEN', 'SPORT_BOT_TOKEN', 'FINANCE_BOT_TOKEN', 'MAN_BOT_TOKEN', 'WAKY_BOT_TOKEN']

async function check(token) {
  try {
    const [me, hook] = await Promise.all([tg(token, 'getMe'), tg(token, 'getWebhookInfo')])
    const h = hook?.result ?? {}
    return {
      bot: me?.result?.username ? '@' + me.result.username : null,
      name: me?.result?.first_name ?? null,
      ok: !!me?.ok,
      error: me?.ok ? null : me?.description ?? 'no answer',
      webhook: h.url ? new URL(h.url).host : null,
      waiting: h.pending_update_count ?? null,
      lastError: h.last_error_message ?? null,
      lastErrorAt: h.last_error_date ? new Date(h.last_error_date * 1000).toISOString() : null
    }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

/** The bots' health (was api/bot-health.mjs). */
export async function botHealth(req, res) {
  if (!cronSecretOk(req) && !(await sessionOk(config(), bearer(req)).catch(() => false))) return send(res, 401, { error: 'Not allowed' })
  const out = {}
  const seen = new Map()
  for (const name of BOTS) {
    const token = (process.env[name] || '').trim()
    if (!token) {
      out[name] = 'not set'
      continue
    }
    const id = token.split(':')[0]
    if (seen.has(id)) {
      out[name] = `same bot as ${seen.get(id)}`
      continue
    }
    seen.set(id, name)
    out[name] = await check(token)
  }
  send(res, 200, out)
}

export default async function handler(req, res) {
  if (req.method === 'GET') return botHealth(req, res)
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!(await requireSession(res, cfg, bearer(req)))) return
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
    try {
      // The same helper the daily self-check uses to put a wrong link right (CL3).
      results.push(await ensureWebhook(cfg, b, host))
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
