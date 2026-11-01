// GET|POST /api/tick: the coach writes first. Sends due reminders and
// check-ins, says when a study block starts, follows up when you're slipping.
// Called every ~10 minutes by a GitHub Actions timer (.github/workflows/tick.yml)
// and every 2 minutes by the open app. Safe to call by anyone: it runs at most
// once a minute and only sends what is due (each thing once).
import { botDefaults, config, send, serverBots } from './_lib.mjs'
import { runTick } from './_bot/bot.mjs'
import { googleEnv } from './google.mjs'

export default async function handler(req, res) {
  const cfg = config()
  const bot = serverBots().find((b) => b.name === 'MEGA_BOT_TOKEN') ?? serverBots()[0]
  const chatId = process.env.TELEGRAM_CHAT_ID || ''
  if (!cfg.ok || !bot || !chatId) return send(res, 200, { ok: false, reason: 'No bot or chat set up' })
  try {
    const sent = await runTick({ tursoUrl: cfg.url, tursoToken: cfg.token, defaults: botDefaults(), timeZone: process.env.LIFE_TZ, todoistToken: process.env.TODOIST_TOKEN, google: googleEnv(cfg), botToken: bot.token, chatId })
    send(res, 200, { ok: true, sent: sent.length })
  } catch (e) {
    console.error('tick:', e)
    send(res, 500, { error: e.message || 'failed' })
  }
}
