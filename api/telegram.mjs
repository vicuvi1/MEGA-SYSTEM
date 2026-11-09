// POST /api/telegram?bot=<id>: Telegram sends each message for a bot here
// (webhook set by /api/bot-setup), so the bots answer 24/7 with no device
// open. Handled like the app does, on the Turso data.
import { timingSafeEqual } from 'node:crypto'
import { botDefaults, config, readBody, send, serverBots, webhookSecret, countCall } from './_lib.mjs'
import { handleTelegramUpdate } from './_bot/bot.mjs'
import { deadlineIn, foodPhoto, modelUntil } from './ai.mjs'
import { googleEnv } from './google.mjs'

/** When the webhook answers Telegram at the latest (the function stops at 60 s). */
export const WEBHOOK_ANSWER_MS = 55_000

const same = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

export default async function handler(req, res) {
  await countCall(config(), 'telegram') // CL2: counted for Settings → System health
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  const id = String(new URL(req.url, 'http://x').searchParams.get('bot') || '')
  const bot = serverBots().find((b) => b.id === id)
  if (!cfg.ok || !bot) return send(res, 404, { error: 'Unknown bot' })
  if (!same(req.headers['x-telegram-bot-api-secret-token'] || '', webhookSecret(cfg, id))) return send(res, 401, { error: 'Bad secret' })
  // The coach's brain (free text, voice, photos) when Gemini is set up.
  const key = (process.env.GEMINI_API_KEY || '').trim()
  // One time limit for the whole message: every AI answer is in by 50 s.
  const model = key || (process.env.OPENROUTER_API_KEY || '').trim() ? modelUntil(deadlineIn()) : undefined
  // The function is stopped at 60 s, and a webhook that never answered is sent
  // again by Telegram: at 55 s say "got it" (each message is handled once).
  let late = null
  try {
    const update = await readBody(req)
    const work = handleTelegramUpdate(
      { tursoUrl: cfg.url, tursoToken: cfg.token, defaults: botDefaults(), timeZone: process.env.LIFE_TZ, todoistToken: process.env.TODOIST_TOKEN, model, google: googleEnv(cfg), foodPhoto: (body) => foodPhoto(body) },
      bot.token,
      update
    )
    const timeUp = new Promise((ok) => (late = setTimeout(() => ok('late'), WEBHOOK_ANSWER_MS)))
    if ((await Promise.race([work, timeUp])) === 'late') {
      console.warn('telegram webhook: still working at 55 s, answered Telegram anyway')
      work.catch((e) => console.error('telegram webhook (late):', e))
      return send(res, 200, { ok: true, late: true })
    }
    send(res, 200, { ok: true })
  } catch (e) {
    // Turso or Telegram unreachable: Telegram sends it again later (each
    // message is handled once, so a retry never logs it twice).
    console.error('telegram webhook:', e)
    send(res, 500, { error: e.message || 'failed' })
  } finally {
    clearTimeout(late)
  }
}
