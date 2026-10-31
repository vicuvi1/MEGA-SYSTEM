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
  if (body?.op === 'status') return send(res, 200, { configured: !!key })
  if (!key) return send(res, 503, { error: 'Add GEMINI_API_KEY in Vercel to use AI on the website' })
  const prompt = String(body?.prompt || '').slice(0, 60_000)
  if (!prompt.trim()) return send(res, 400, { error: 'Empty prompt' })
  try {
    send(res, 200, await askGemini(key, prompt))
  } catch (e) {
    send(res, 502, { error: e.message || 'Gemini failed' })
  }
}
