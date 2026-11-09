// Food photo logging, the server part (a helper of api/ai.mjs, not a function
// of its own: files starting with "_" don't count toward Vercel's 12).
//
// - visionProvider(env): Gemini by default (GEMINI_API_KEY, model VISION_MODEL or
//   gemini-3.5-flash), or Claude with VISION_PROVIDER=claude (ANTHROPIC_API_KEY,
//   model VISION_MODEL or claude-haiku-4-5). Keys come only from the server's env:
//   they are never sent to the page and never logged.
// - foodPhotoPrompt: the photo, the owner's note, his saved foods (so "the bulgur
//   container" is matched to his own numbers), today so far and the goals.
// - Both providers are asked for JSON only (Gemini's JSON mode with a schema,
//   Claude's forced tool call). One retry at most, inside the request's 50 s.
// - scalePrompt: kind 'scale' reads a smart-scale result screenshot (numbers only,
//   checked again by src/core/scaleRead.ts); it shares the same daily counter.
// - countPhoto: 50 photos a day (the owner's day, LIFE_TZ), counted in sys_kv (server only: /api/db refuses it).
// The photo is never stored or logged; only the foods the owner saves are kept.
// The page checks the answer again with src/core/foodVision.ts before showing it.

export const PHOTO_DAILY_LIMIT = 50
export const VISION_DEADLINE_MS = 50_000
const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/'
const CLAUDE_API = 'https://api.anthropic.com/v1/messages'
export const DEFAULT_GEMINI_VISION = 'gemini-3.5-flash'
/** Tried after the default when it is gone (404). */
const GEMINI_BACKUP = 'gemini-2.5-flash'
export const DEFAULT_CLAUDE_VISION = 'claude-haiku-4-5'
const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp'])
/** About 1.1 MB of photo; the page sends 100–250 KB. */
export const MAX_IMAGE_B64 = 1_500_000

const clean = (v) => String(v ?? '').trim()

/** Which provider and model read the photo, from the server's env. null = no key for it. */
export function visionProvider(env = process.env) {
  const want = clean(env.VISION_PROVIDER).toLowerCase()
  const model = clean(env.VISION_MODEL)
  if (want === 'claude' || want === 'anthropic') {
    const key = clean(env.ANTHROPIC_API_KEY)
    return key ? { name: 'claude', key, models: [model || DEFAULT_CLAUDE_VISION] } : null
  }
  const key = clean(env.GEMINI_API_KEY)
  if (!key) return null
  return { name: 'gemini', key, models: [...new Set([model || DEFAULT_GEMINI_VISION, GEMINI_BACKUP])] }
}

const num = (v, hi) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(hi, Math.round(n * 10) / 10)) : 0
}
const txt = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** The picture in a request, checked: a JPEG/PNG/WebP in base64, not too big. */
function readImage(body) {
  const img = body?.image
  const mime = clean(img?.mime).toLowerCase()
  const data = typeof img?.data === 'string' ? img.data.replace(/^data:[^,]*,/, '') : ''
  if (!MIMES.has(mime)) return { error: 'Send a JPEG, PNG or WebP photo.' }
  if (!data || data.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/=\s]+$/.test(data)) return { error: 'The photo is missing or too big. Try again.' }
  return { image: { mime, data: data.replace(/\s+/g, '') } }
}

/** The request from the page, checked: the photo, a short note, at most 60 saved foods, today and the goals. */
export function readPhotoRequest(body) {
  const img = readImage(body)
  if (img.error) return img
  if (body?.kind === 'scale') return { kind: 'scale', image: img.image }
  const saved = (Array.isArray(body.saved) ? body.saved : [])
    .slice(0, 60)
    .map((s) => ({ id: txt(s?.id, 60), name: txt(s?.name, 60), portion: txt(s?.portion, 40), kcal: num(s?.kcal, 5000), protein: num(s?.protein, 400), carbs: num(s?.carbs, 800), fat: num(s?.fat, 400) }))
    .filter((s) => s.id && s.name)
  const today = { kcal: num(body.today?.kcal, 20000), protein: num(body.today?.protein, 1000), items: (Array.isArray(body.today?.items) ? body.today.items : []).slice(0, 20).map((x) => txt(x, 60)).filter(Boolean) }
  const targets = { kcal: num(body.targets?.kcal, 10000), protein: num(body.targets?.protein, 600) }
  return { kind: 'food', image: img.image, note: txt(body.note, 300), saved, today, targets }
}

/** The instructions and the text that goes with the photo. */
export function foodPhotoPrompt(req) {
  const system = `You estimate the food in a meal photo for a calorie and protein log.
Rules:
- List each food separately, with how many (qty and unit, e.g. 2 eggs, 1 container, 150 g) and the grams eaten (cooked weight).
- The owner's note is the truth when it says what something is or how much.
- If a food is one of the owner's SAVED FOODS (or SAVED MEALS), set matchedSavedFoodId to its id and qty to how many portions; its numbers are used as saved. Match by meaning, not exact words: "bulgur container" in the note or a container of bulgur in the photo is the saved bulgur container.
- Otherwise matchedSavedFoodId is null and you estimate kcal, protein, carbs and fat for the whole amount.
- confidence: "high" when you are sure what it is and how much, "medium" for a fair guess, "low" when the portion is hard to see.
- message: one short friendly sentence about the meal (no numbers beyond the totals).
Answer ONLY with JSON in the given shape.`
  const saved = req.saved.length ? req.saved.map((s) => `- id ${s.id}: ${s.name}, portion ${s.portion || '1'}: ${s.kcal} kcal, ${s.protein} g protein${s.carbs ? `, ${s.carbs} g carbs` : ''}${s.fat ? `, ${s.fat} g fat` : ''}`).join('\n') : '(none)'
  const user = `Owner's note: ${req.note || '(none)'}
SAVED FOODS:
${saved}
Today so far: ${req.today.kcal} kcal, ${req.today.protein} g protein${req.today.items.length ? ` (${req.today.items.join(', ')})` : ''}.
Goals today: ${req.targets.kcal} kcal, ${req.targets.protein} g protein.
What is in this photo?`
  return { system, user }
}

/** A smart-scale result screenshot (Xiaomi Home / Mi Fitness / Zepp Life): the numbers on it, nothing guessed. */
export function scalePrompt() {
  const system = `You read the numbers on a screenshot of a smart scale's result screen (Xiaomi Home, Mi Fitness, Zepp Life or similar) for a body log.
Rules:
- Copy only numbers that are visible on the screen. Never estimate or work out a number that is not shown: use null.
- weightKg in kg (convert from jin or lb only if the unit is shown). bodyFatPct, waterPct, proteinPct in %. muscleKg and boneKg in kg (muscle mass, not a %). visceralFat is the visceral fat level (a small number like 4). bmr in kcal. heartRate in bpm. bodyScore is the body score out of 100.
- measuredAt: the date and time of the measurement if shown, as YYYY-MM-DDTHH:MM (local time), else null.
- If the picture is not a scale result, answer with weightKg null.
Answer ONLY with JSON in the given shape.`
  return { system, user: 'Read the scale numbers on this screenshot.' }
}

const N = { type: 'number', nullable: true }
const SCALE_KEYS = ['weightKg', 'bodyFatPct', 'muscleKg', 'waterPct', 'proteinPct', 'boneKg', 'visceralFat', 'bmr', 'bmi', 'heartRate', 'bodyScore']
const SCALE_SHAPE = {
  type: 'object',
  properties: { ...Object.fromEntries(SCALE_KEYS.map((k) => [k, N])), measuredAt: { type: 'string', nullable: true } },
  required: ['weightKg']
}
const nullable = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { type: [v.type, 'null'] }]))
export const GEMINI_SCALE_SCHEMA = (() => {
  const up = (o) => (Array.isArray(o) ? o.map(up) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'type' ? String(v).toUpperCase() : k === 'required' ? v : up(v)])) : o)
  return up(SCALE_SHAPE)
})()
export const CLAUDE_SCALE_SCHEMA = { type: 'object', properties: nullable(SCALE_SHAPE.properties), required: ['weightKg'] }

/** The answer's shape (Gemini's responseSchema; Claude's tool input). */
const ITEM_PROPS = {
  name: { type: 'string' },
  matchedSavedFoodId: { type: 'string', nullable: true },
  qty: { type: 'number' },
  unit: { type: 'string' },
  grams: { type: 'number' },
  kcal: { type: 'number' },
  protein: { type: 'number' },
  carbs: { type: 'number' },
  fat: { type: 'number' },
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] }
}
const ITEM_REQUIRED = ['name', 'matchedSavedFoodId', 'qty', 'unit', 'grams', 'kcal', 'protein', 'confidence']
const SHAPE = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', properties: ITEM_PROPS, required: ITEM_REQUIRED } },
    totals: { type: 'object', properties: { kcal: { type: 'number' }, protein: { type: 'number' } }, required: ['kcal', 'protein'] },
    message: { type: 'string' }
  },
  required: ['items', 'totals', 'message']
}
/** Gemini's schema: the same shape with its upper-case type names (OBJECT, STRING…). */
const upper = (o) => (Array.isArray(o) ? o.map(upper) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'type' ? String(v).toUpperCase() : k === 'required' || k === 'enum' ? v : upper(v)])) : o)
export const GEMINI_SCHEMA = upper(SHAPE)
/** Claude's tool input (JSON Schema: null is a type there, not a flag). */
export const CLAUDE_SCHEMA = { ...SHAPE, properties: { ...SHAPE.properties, items: { type: 'array', items: { type: 'object', properties: { ...ITEM_PROPS, matchedSavedFoodId: { type: ['string', 'null'] } }, required: ITEM_REQUIRED } } } }

/** The HTTP request for one try (url, headers, body). The key is only in a header. */
export function buildVisionRequest(p, model, req, think = true) {
  const scale = req.kind === 'scale'
  const { system, user } = scale ? scalePrompt() : foodPhotoPrompt(req)
  const tool = scale ? { name: 'log_scale', description: 'The numbers on the scale screenshot, for the body log.', input_schema: CLAUDE_SCALE_SCHEMA } : { name: 'log_meal', description: 'The foods in the photo, for the calorie log.', input_schema: CLAUDE_SCHEMA }
  if (p.name === 'claude') {
    return {
      url: CLAUDE_API,
      headers: { 'Content-Type': 'application/json', 'x-api-key': p.key, 'anthropic-version': '2023-06-01' },
      body: {
        model,
        max_tokens: 2048,
        temperature: 0.2,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: req.image.mime, data: req.image.data } }, { type: 'text', text: user }] }]
      }
    }
  }
  return {
    url: `${GEMINI_API}${model}:generateContent`,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ inline_data: { mime_type: req.image.mime, data: req.image.data } }, { text: user }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: 'application/json', responseSchema: scale ? GEMINI_SCALE_SCHEMA : GEMINI_SCHEMA, ...(think ? { thinkingConfig: { thinkingBudget: 1024 } } : {}) }
    }
  }
}

/** The JSON out of a provider's reply, and its token counts. Throws a plain error. */
export function readVisionReply(p, j) {
  if (p.name === 'claude') {
    const tool = (j?.content ?? []).find((c) => c?.type === 'tool_use')
    if (!tool?.input) throw new Error('The AI gave no answer for the photo')
    return { json: tool.input, prompt: j?.usage?.input_tokens, completion: j?.usage?.output_tokens }
  }
  const parts = j?.candidates?.[0]?.content?.parts ?? []
  const text = parts.filter((x) => !x.thought && typeof x.text === 'string').map((x) => x.text).join('')
  if (!text) throw new Error('The AI gave no answer for the photo')
  let json
  try {
    json = JSON.parse(text.replace(/```(?:json)?/gi, '').trim())
  } catch {
    throw Object.assign(new Error('The AI answer was not valid JSON'), { badJson: true })
  }
  return { json, prompt: j?.usageMetadata?.promptTokenCount, completion: j?.usageMetadata?.candidatesTokenCount }
}

const isTimeout = (e) => !!e && (e.name === 'TimeoutError' || e.name === 'AbortError' || /timed? ?out|aborted/i.test(String(e.message ?? '')))
const worthRetry = (e) => !!e && (e.badJson || isTimeout(e) || /\b(429|5\d\d)\b/.test(String(e.message ?? '')))

/**
 * Reads the photo: the provider's models in order (a 404 moves to the next),
 * one retry at most for a time-out, a busy provider or bad JSON. Each try gets
 * at most 25 s and never more than the time left. `record` gets the tokens.
 * Returns the raw JSON object (the page checks it with core/foodVision.ts).
 */
export async function readFoodPhoto(p, req, { fetchImpl = fetch, record = async () => {}, deadline = Date.now() + VISION_DEADLINE_MS, wait = (ms) => new Promise((ok) => setTimeout(ok, ms)) } = {}) {
  let retried = false
  let think = true
  for (let i = 0; i < p.models.length; i++) {
    const model = p.models[i]
    const left = deadline - Date.now() - 3000
    if (left < 4000) throw Object.assign(new Error('Reading the photo took too long. Try again.'), { timeUp: true })
    try {
      const r = buildVisionRequest(p, model, req, think)
      const res = await fetchImpl(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(r.body), signal: AbortSignal.timeout(Math.min(25_000, left)) })
      if (res.status === 404 && i < p.models.length - 1) continue
      const j = await res.json().catch(() => ({}))
      // A model that takes no thinking budget: ask it again without one.
      if (res.status === 400 && think && /thinking/i.test(j?.error?.message ?? '')) {
        think = false
        i--
        continue
      }
      if (!res.ok) throw new Error(`${p.name === 'claude' ? 'Claude' : 'Gemini'} ${res.status}: ${j?.error?.message || 'request failed'}`)
      const out = readVisionReply(p, j)
      await record({ model: `${p.name === 'claude' ? 'anthropic' : 'google'}/${model}`, kind: req.kind === 'scale' ? 'scaleShot' : 'foodPhoto', prompt: out.prompt, completion: out.completion, cost: null }).catch(() => null)
      return { json: out.json, model }
    } catch (e) {
      if (retried || !worthRetry(e)) throw e
      retried = true
      await wait(800)
      i--
    }
  }
  throw new Error('No AI model could read the photo')
}

// ---- 50 photos a day (sys_kv "vision:<YYYY-MM-DD>", server only) ----
/** The day in the owner's time zone (LIFE_TZ), else UTC: YYYY-MM-DD. */
export function photoDay(now = new Date(), tz = '') {
  try {
    if (tz) return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  } catch {
    /* an unknown time zone: UTC */
  }
  return now.toISOString().slice(0, 10)
}
/**
 * Counts one photo for today and says how many were counted. `run(sql, args)`
 * runs the statements in order and returns the last one's rows. Yesterday's
 * counters are removed in the same go.
 */
export async function countPhoto(run, now = new Date(), tz = '') {
  const day = photoDay(now, tz)
  const rows = await run([
    { sql: 'CREATE TABLE IF NOT EXISTS sys_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)', args: [] },
    { sql: "DELETE FROM sys_kv WHERE key LIKE 'vision:%' AND key < ?", args: [`vision:${day}`] },
    { sql: "INSERT INTO sys_kv (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1 RETURNING value", args: [`vision:${day}`] }
  ])
  const n = Number(rows?.[0]?.[0])
  if (!Number.isFinite(n)) throw new Error('Database not reachable')
  return n
}
/** Over the daily limit (the photo that makes 51 is refused). */
export const overLimit = (n, limit = PHOTO_DAILY_LIMIT) => n > limit

/** `run` for countPhoto on Turso (hrana pipeline). */
export const tursoRun = (turso, cfg, fetchImpl = fetch) => async (stmts) => {
  const arg = (v) => ({ type: 'text', value: String(v) })
  const { status, json } = await turso(cfg, { requests: [...stmts.map((s) => ({ type: 'execute', stmt: { sql: s.sql, args: s.args.map(arg) } })), { type: 'close' }] }, fetchImpl)
  const last = json?.results?.[stmts.length - 1]
  if (status !== 200 || !last || last.type === 'error') throw new Error('Database not reachable')
  return (last.response?.result?.rows ?? []).map((r) => r.map((c) => (c && typeof c === 'object' ? c.value : c)))
}

/** The page's fallback message when the photo can't be read now. */
export const FALLBACK = 'Use "Copy the prompt" instead: paste it with your photo into any AI app.'
