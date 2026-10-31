// POST /api/telegram?bot=<id>: Telegram sends each message for a bot here
// (webhook set by /api/bot-setup), so the bots answer 24/7 with no device
// open. Handled like the app does, on the Turso data.
import { timingSafeEqual } from 'node:crypto'
import { botDefaults, config, readBody, send, serverBots, webhookSecret } from './_lib.mjs'
import { handleTelegramUpdate } from './_bot/bot.mjs'
import { askGemini } from './ai.mjs'

const same = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  const id = String(new URL(req.url, 'http://x').searchParams.get('bot') || '')
  const bot = serverBots().find((b) => b.id === id)
  if (!cfg.ok || !bot) return send(res, 404, { error: 'Unknown bot' })
  if (!same(req.headers['x-telegram-bot-api-secret-token'] || '', webhookSecret(cfg, id))) return send(res, 401, { error: 'Bad secret' })
  // The coach's brain (free text, voice, photos) when Gemini is set up.
  const key = (process.env.GEMINI_API_KEY || '').trim()
  const model = key ? async (prompt, opts) => (await askGemini(key, prompt, fetch, opts)).text : undefined
  try {
    const update = await readBody(req)
    await handleTelegramUpdate(
      { tursoUrl: cfg.url, tursoToken: cfg.token, defaults: botDefaults(), timeZone: process.env.LIFE_TZ, todoistToken: process.env.TODOIST_TOKEN, model },
      bot.token,
      update
    )
    send(res, 200, { ok: true })
  } catch (e) {
    // Turso or Telegram unreachable: Telegram sends it again later (each
    // message is handled once, so a retry never logs it twice).
    console.error('telegram webhook:', e)
    send(res, 500, { error: e.message || 'failed' })
  }
}
