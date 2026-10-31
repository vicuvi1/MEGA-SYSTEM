// GET /api/cron?job=morning|midday|evening|night: the daily bot messages (Vercel runs
// them on the schedule in vercel.json and signs them with CRON_SECRET).
// Morning: your plan question and the coach if something slipped. Midday: a
// nudge when there's been no focus yet. Evening: the review, Sundays the week.
// Night: the wind-down before bedtime, only while wake-ups are slipping.
import { botDefaults, config, send, serverBots } from './_lib.mjs'
import { runDaily } from './_bot/bot.mjs'
import { askGemini } from './ai.mjs'

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET || ''
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { error: 'Not allowed' })
  const job = new URL(req.url, 'http://x').searchParams.get('job')
  if (!['morning', 'reask', 'midday', 'evening', 'night'].includes(job)) return send(res, 400, { error: 'job=morning|reask|midday|evening|night' })
  const cfg = config()
  const bot = serverBots().find((b) => b.name === 'MEGA_BOT_TOKEN') ?? serverBots()[0]
  const chatId = process.env.TELEGRAM_CHAT_ID || ''
  // Waky (the sleep coach) sends the bedtime wind-down when it runs on the server.
  const sleepBot = serverBots().find((b) => b.name === 'WAKY_BOT_TOKEN') ?? serverBots().find((b) => b.name === 'MAN_BOT_TOKEN')
  if (!cfg.ok || !bot || !chatId) return send(res, 200, { ok: false, reason: 'No bot or chat set up' })
  // The coach speaks in its own words when Gemini is set up (GEMINI_API_KEY).
  const key = (process.env.GEMINI_API_KEY || '').trim()
  const ai = key ? async (prompt) => (await askGemini(key, prompt)).text : undefined
  try {
    const sent = await runDaily(
      { tursoUrl: cfg.url, tursoToken: cfg.token, defaults: botDefaults(), timeZone: process.env.LIFE_TZ, todoistToken: process.env.TODOIST_TOKEN, botToken: bot.token, chatId, ai, sleepBotToken: sleepBot?.token, appUrl: process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') },
      job
    )
    send(res, 200, { ok: true, sent })
  } catch (e) {
    console.error('cron:', e)
    send(res, 500, { error: e.message || 'failed' })
  }
}
