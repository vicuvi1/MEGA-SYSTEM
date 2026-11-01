// POST /api/coach (session required) {text} → a stream of lines (NDJSON):
//   {"step":"Reading your day"} … while the coach works (shown live in the app)
//   {"ok":true,"reply":"…","done":[…]} at the end.
// The app's Coach page talks to the same coach as the Telegram bots: same
// brain (OpenRouter DeepSeek, Gemini as backup), memory, goals & rules.
import { bearer, botDefaults, config, readBody, send, sessionOk } from './_lib.mjs'
import { coachChat, coachRhythm } from './_bot/bot.mjs'
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
  const hasAi = (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || '').trim()
  const model = hasAi ? async (prompt, opts) => (await askModel(prompt, opts)).text : undefined
  const env = { tursoUrl: cfg.url, tursoToken: cfg.token, defaults: botDefaults(), timeZone: process.env.LIFE_TZ, todoistToken: process.env.TODOIST_TOKEN, model, google: googleEnv(cfg) }
  // {op:'rhythm', action, note}: today's plan from the coach (Today and Coach in the app).
  if (body?.op === 'rhythm') {
    try {
      return send(res, 200, await coachRhythm(env, { action: String(body.action || 'state'), note: body.note, prefs: body.prefs }))
    } catch (e) {
      console.error('rhythm:', e)
      return send(res, 500, { error: e.message || 'failed' })
    }
  }
  const text = String(body?.text || '').trim().slice(0, 4000)
  if (!text) return send(res, 400, { error: 'Say something' })
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Accel-Buffering', 'no')
  const line = (o) => res.write(JSON.stringify(o) + '\n')
  try {
    const r = await coachChat(env, text, (step) => line({ step }))
    line(r)
  } catch (e) {
    console.error('coach:', e)
    line({ ok: false, error: e.message || 'The coach failed' })
  }
  res.end()
}
