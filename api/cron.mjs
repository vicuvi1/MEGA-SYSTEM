// GET /api/cron?job=morning|evening: the daily bot messages (Vercel runs
// them on the schedule in vercel.json and signs them with CRON_SECRET).
// Morning: your plan question. Evening: the review, and on Sundays the week.
import { botDefaults, config, send, serverBots } from './_lib.mjs'
import { runDaily } from './_bot/bot.mjs'

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET || ''
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { error: 'Not allowed' })
  const job = new URL(req.url, 'http://x').searchParams.get('job')
  if (job !== 'morning' && job !== 'evening') return send(res, 400, { error: 'job=morning|evening' })
  const cfg = config()
  const bot = serverBots().find((b) => b.name === 'MEGA_BOT_TOKEN') ?? serverBots()[0]
  const chatId = process.env.TELEGRAM_CHAT_ID || ''
  if (!cfg.ok || !bot || !chatId) return send(res, 200, { ok: false, reason: 'No bot or chat set up' })
  try {
    const sent = await runDaily(
      { tursoUrl: cfg.url, tursoToken: cfg.token, defaults: botDefaults(), timeZone: process.env.LIFE_TZ, todoistToken: process.env.TODOIST_TOKEN, botToken: bot.token, chatId },
      job
    )
    send(res, 200, { ok: true, sent })
  } catch (e) {
    console.error('cron:', e)
    send(res, 500, { error: e.message || 'failed' })
  }
}
