// POST /api/coach (session required) {text} → a stream of lines (NDJSON):
//   {"step":"Reading your day"} … while the coach works (shown live in the app)
//   {"ok":true,"reply":"…","done":[…]} at the end.
// The app's Coach page talks to the same coach as the Telegram bots: same
// brain (OpenRouter DeepSeek, Gemini as backup), memory, goals & rules.
import { bearer, botDefaults, config, readBody, send, requireSession, countCall } from './_lib.mjs'
import { coachChat, coachRhythm, coachSettle, coachUndo, answerMeta } from './_bot/bot.mjs'
import { budgetState, deadlineIn, flushUsage, modelUntil, usageScope } from './ai.mjs'
import { googleEnv } from './google.mjs'

export default async function handler(req, res) {
  await countCall(config(), 'coach') // CL2: counted for Settings → System health
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!(await requireSession(res, cfg, bearer(req)))) return
  let body
  try {
    body = await readBody(req)
  } catch {
    return send(res, 400, { error: 'Bad request' })
  }
  const hasAi = (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || '').trim()
  const model = hasAi ? modelUntil(deadlineIn()) : undefined
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
  // {op:'undo', at, index?}: take back what the coach did in one reply.
  if (body?.op === 'undo') {
    try {
      return send(res, 200, await coachUndo(env, String(body.at || ''), Number.isInteger(body.index) ? body.index : undefined))
    } catch (e) {
      return send(res, 500, { error: e.message || 'failed' })
    }
  }
  // TL4: an attached file's text comes packed in the message (cut on the page): a bigger limit for it.
  const raw = String(body?.text || '').trim()
  const text = raw.slice(0, raw.includes('<<<FILE ') ? 12_000 : 4000)
  // A photo from the app (a receipt, a plate, a screen): JPEG/PNG, under ~3 MB.
  const media = body?.media && /^image\/(jpeg|png|webp)$/.test(body.media.mime) && typeof body.media.data === 'string' && body.media.data.length < 4_000_000 ? { kind: 'photo', mime: body.media.mime, data: body.media.data } : undefined
  if (!text && !media) return send(res, 400, { error: 'Say something' })
  // TL4: pictures need a model that can see (Gemini here). Without it, said plainly instead of failing.
  if (media && !(process.env.GEMINI_API_KEY || '').trim())
    return send(res, 200, { ok: true, reply: "I can't look at pictures with the AI set up on the server (it needs a Gemini key). Paste the text, or describe what's in it, and I'll help.", done: [], noVision: true })
  // QA4: the month's AI budget is used up: basic mode (the page does logs, done, focus and tasks
  // without AI) unless you chose to go over it for this message.
  const budget = hasAi ? await budgetState().catch(() => null) : null
  if (budget?.tier === 'minimal' && !body?.overBudget) return send(res, 200, { ok: false, basic: 'budget', reply: 'Your AI budget for this month is used up, so Ben is in basic mode.', done: [], budget })
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Accel-Buffering', 'no')
  const line = (o) => res.write(JSON.stringify(o) + '\n')
  try {
    // A step that starts with \u0001 is the reply so far (U2: real streaming).
    const rows = []
    const r = await usageScope.run(rows, () => coachChat(env, text, (step) => (String(step).startsWith('\u0001') ? line({ delta: String(step).slice(1) }) : line({ step })), media))
    // QA4: which model answered and roughly what it cost (the same rows as Settings → Ben's brain).
    line({ ...r, meta: { ...answerMeta(rows), ...(budget ? { tier: budget.tier } : {}) } })
  } catch (e) {
    console.error('coach:', e)
    line({ ok: false, error: e.message || 'The coach failed' })
  }
  // The reply is on screen already; what it left running (a plan's block names, usage rows) finishes now.
  await coachSettle().catch(() => null)
  await flushUsage().catch(() => null)
  res.end()
}
