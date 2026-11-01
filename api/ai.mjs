// POST /api/ai (session required) {prompt} → {text, model}
//      {op:'status'}                     → {configured}
// Google Gemini for the website, with the key kept on the server
// (GEMINI_API_KEY in Vercel). The page builds the prompt from your data.
import { bearer, config, readBody, send, sessionOk } from './_lib.mjs'

const MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.8-flash']
const API = 'https://generativelanguage.googleapis.com/v1beta/models/'

/**
 * Asks Gemini, trying the next model when one is gone (404).
 * opts.json: answer as JSON; opts.media: [{mime, data (base64)}] (a voice
 * note, a photo) sent with the prompt.
 */
export async function askGemini(key, prompt, fetchImpl = fetch, opts = {}) {
  let last = ''
  for (const model of MODELS) {
    const r = await fetchImpl(`${API}${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, ...(opts.media ?? []).map((m) => ({ inline_data: { mime_type: m.mime, data: m.data } }))] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 4096, ...(opts.json ? { responseMimeType: 'application/json' } : {}) }
      })
    })
    if (r.status === 404) {
      last = `${model} is not available`
      continue
    }
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${j?.error?.message || 'request failed'}`)
    const parts = j?.candidates?.[0]?.content?.parts ?? []
    const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('')
    if (!text) throw new Error('Gemini gave an empty answer')
    return { text, model }
  }
  throw new Error(last || 'No Gemini model answered')
}

const OPENROUTER = 'https://openrouter.ai/api/v1'
let resolvedModel = null

/** Version numbers in a model id ("deepseek-v4.1-flash" → [4, 1]) for "newest first". */
const versionOf = (id) => (String(id).match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
const newer = (a, b) => {
  const x = versionOf(a)
  const y = versionOf(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0)
  return 0
}

/**
 * The OpenRouter model to use: OPENROUTER_MODEL if set, else the newest
 * DeepSeek "flash" model OpenRouter lists (cheap and good), else DeepSeek chat.
 */
export async function openRouterModel(env = process.env, fetchImpl = fetch) {
  if ((env.OPENROUTER_MODEL || '').trim()) return env.OPENROUTER_MODEL.trim()
  if (resolvedModel) return resolvedModel
  try {
    const r = await fetchImpl(`${OPENROUTER}/models`)
    const ids = ((await r.json())?.data ?? []).map((m) => String(m.id)).filter((id) => /^deepseek\//i.test(id) && !/:free$/.test(id))
    const flash = ids.filter((id) => /flash/i.test(id)).sort(newer)
    resolvedModel = flash[0] ?? ids.filter((id) => /chat|v\d/i.test(id)).sort(newer)[0] ?? 'deepseek/deepseek-chat'
  } catch {
    resolvedModel = 'deepseek/deepseek-chat'
  }
  return resolvedModel
}

/** Asks OpenRouter (text only). opts.json: answer as a JSON object. */
export async function askOpenRouter(key, prompt, fetchImpl = fetch, opts = {}, env = process.env) {
  const model = await openRouterModel(env, fetchImpl)
  const r = await fetchImpl(`${OPENROUTER}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://mega-system-ten.vercel.app', 'X-Title': 'Life System' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 2048, ...(opts.json ? { response_format: { type: 'json_object' } } : {}) }),
    signal: AbortSignal.timeout(45_000)
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${j?.error?.message || 'request failed'}`)
  const text = j?.choices?.[0]?.message?.content
  if (!text) throw new Error('OpenRouter gave an empty answer')
  return { text: String(text), model }
}

/**
 * The coach's model: OpenRouter (DeepSeek) first for text, Gemini for voice
 * notes and photos, and Gemini as the backup when OpenRouter fails.
 */
export async function askModel(prompt, opts = {}, env = process.env, fetchImpl = fetch) {
  const orKey = (env.OPENROUTER_API_KEY || '').trim()
  const gKey = (env.GEMINI_API_KEY || '').trim()
  if (orKey && !opts.media?.length) {
    try {
      return await askOpenRouter(orKey, prompt, fetchImpl, opts, env)
    } catch (e) {
      if (!gKey) throw e
    }
  }
  if (!gKey) throw new Error('Add OPENROUTER_API_KEY or GEMINI_API_KEY in Vercel to use the AI coach')
  return askGemini(gKey, prompt, fetchImpl, opts)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  if (!sessionOk(config(), bearer(req))) return send(res, 401, { error: 'Locked: enter your PIN again' })
  const key = (process.env.GEMINI_API_KEY || '').trim()
  let body
  try {
    body = await readBody(req)
  } catch {
    return send(res, 400, { error: 'Bad request' })
  }
  const orKey = (process.env.OPENROUTER_API_KEY || '').trim()
  if (body?.op === 'status') return send(res, 200, { configured: !!(key || orKey), model: orKey ? await openRouterModel() : key ? 'gemini' : null })
  if (!key && !orKey) return send(res, 503, { error: 'Add OPENROUTER_API_KEY or GEMINI_API_KEY in Vercel to use AI on the website' })
  const prompt = String(body?.prompt || '').slice(0, 60_000)
  if (!prompt.trim()) return send(res, 400, { error: 'Empty prompt' })
  try {
    send(res, 200, await askModel(prompt))
  } catch (e) {
    send(res, 502, { error: e.message || 'Gemini failed' })
  }
}
