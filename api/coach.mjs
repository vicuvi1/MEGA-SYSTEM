// POST /api/coach (session required) {text} → {ok, reply, done}
// The app's Coach page talks to the same coach as the Telegram bots: same
// brain (OpenRouter DeepSeek, Gemini as backup), memory, goals & rules.
import { bearer, botDefaults, config, readBody, send, sessionOk } from './_lib.mjs'
import { coachChat } from './_bot/bot.mjs'
import { askModel } from './ai.mjs'
import { googleEnv } from './google.mjs'

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!sessionOk(cfg, bearer(req))) return send(res, 401, { error: 'Locked: enter your PIN again' })
  let body
  try {
    body = await readBody(req)
  } catch {
    return send(res, 400, { error: 'Bad request' })
  }
  const text = String(body?.text || '').trim().slice(0, 4000)
  if (!text) return send(res, 400, { error: 'Say something' })
  const hasAi = (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || '').trim()
  const model = hasAi ? async (prompt, opts) => (await askModel(prompt, opts)).text : undefined
  try {
    send(res, 200, await coachChat({ tursoUrl: cfg.url, tursoToken: cfg.token, defaults: botDefaults(), timeZone: process.env.LIFE_TZ, todoistToken: process.env.TODOIST_TOKEN, model, google: googleEnv(cfg) }, text))
  } catch (e) {
    console.error('coach:', e)
    send(res, 500, { error: e.message || 'The coach failed' })
  }
}
