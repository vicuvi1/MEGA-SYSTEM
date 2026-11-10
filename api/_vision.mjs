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
// - Several photos of one meal (up to 6: a plate, a packaged snack, a drink) go in ONE
//   request, numbered "Photo 1…n", so the AI sees the whole meal and lists each food once.
// - countPhoto: 50 photos a day (the owner's day, LIFE_TZ), counted in sys_kv (server only:
//   /api/db refuses it). Every photo of a request counts (3 photos = 3 of the 50).
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
/** At most 6 photos of one meal in one request (a plate, a packaged snack, a drink…). */
export const MAX_PHOTOS = 6
/** All the photos of one request together (the page sends 6 × 350 KB at most; Telegram up to 6 × 1 MB photos, in-process). */
export const MAX_TOTAL_B64 = 8_000_000

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

/** One picture, checked: a JPEG/PNG/WebP in base64, not too big. */
function readImage(img) {
  const mime = clean(img?.mime).toLowerCase()
  const data = typeof img?.data === 'string' ? img.data.replace(/^data:[^,]*,/, '') : ''
  if (!MIMES.has(mime)) return { error: 'Send a JPEG, PNG or WebP photo.' }
  if (!data || data.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/=\s]+$/.test(data)) return { error: 'The photo is missing or too big. Try again.' }
  return { image: { mime, data: data.replace(/\s+/g, '') } }
}

/**
 * The pictures in a request: `images` (1–6 photos of one meal) or the older
 * single `image`. Each is checked, and all of them together stay under MAX_TOTAL_B64.
 */
function readImages(body) {
  const list = Array.isArray(body?.images) && body.images.length ? body.images : [body?.image]
  if (list.length > MAX_PHOTOS) return { error: `Send at most ${MAX_PHOTOS} photos of one meal.` }
  const images = []
  for (const raw of list) {
    const r = readImage(raw)
    if (r.error) return r
    images.push(r.image)
  }
  if (images.reduce((a, x) => a + x.data.length, 0) > MAX_TOTAL_B64) return { error: 'The photos are too big together. Try fewer photos.' }
  return { images }
}

/** The request from the page, checked: the photo, a short note, at most 60 saved foods, today and the goals. */
export function readPhotoRequest(body) {
  if (body?.kind === 'scale') {
    const img = readImage(body?.image)
    return img.error ? img : { kind: 'scale', image: img.image }
  }
  const img = readImages(body)
  if (img.error) return img
  const saved = (Array.isArray(body.saved) ? body.saved : [])
    .slice(0, 60)
    .map((s) => ({ id: txt(s?.id, 60), name: txt(s?.name, 60), portion: txt(s?.portion, 40), kcal: num(s?.kcal, 5000), protein: num(s?.protein, 400), carbs: num(s?.carbs, 800), fat: num(s?.fat, 400) }))
    .filter((s) => s.id && s.name)
  const today = { kcal: num(body.today?.kcal, 20000), protein: num(body.today?.protein, 1000), items: (Array.isArray(body.today?.items) ? body.today.items : []).slice(0, 20).map((x) => txt(x, 60)).filter(Boolean) }
  const targets = { kcal: num(body.targets?.kcal, 10000), protein: num(body.targets?.protein, 600) }
  // His usual portions (learned from his corrections, core/foodVision.ts portionHints): at most 8.
  const portions = (Array.isArray(body.portions) ? body.portions : [])
    .slice(0, PROMPT_PORTIONS)
    .map((p) => ({ name: txt(p?.name, 40), g: Math.round(num(p?.g, 3000)) }))
    .filter((p) => p.name && p.g >= 5)
  return { kind: 'food', image: img.images[0], images: img.images, note: txt(body.note, 300), saved, today, targets, portions }
}

/** A short prompt is a cheap one: at most this many saved foods and usual portions go in it. */
export const PROMPT_SAVED = 8
export const PROMPT_PORTIONS = 8
const noteWords = (s) => new Set(String(s ?? '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3).map((w) => w.replace(/s$/, '')))
/** The saved foods worth sending: the ones the note names first, then his own order (core/foodVision.ts pickSaved, the same rule). */
export function promptSaved(saved, note, max = PROMPT_SAVED) {
  const words = noteWords(note)
  if (!words.size) return saved.slice(0, max)
  return saved
    .map((s, i) => ({ s, i, hit: [...noteWords(s.name)].filter((w) => words.has(w)).length }))
    .sort((a, b) => b.hit - a.hit || a.i - b.i)
    .slice(0, max)
    .map((x) => x.s)
}

/** The instructions and the text that goes with the photo. Short on purpose: every word is paid for on every photo. */
export function foodPhotoPrompt(req) {
  const system = `You estimate the food in meal photos for a calorie and protein log. Be precise.
1. Identify each separate food or drink; list each once.
2. Grams eaten (cooked weight). Size it against what is in the photo: dinner plate 26 cm, side plate 20 cm, fork 19 cm, spoon 15 ml, adult palm 9 cm wide, fist about 250 ml, can 330 ml. gramsLow and gramsHigh: your honest range.
3. A readable nutrition label or package text is exact: use its numbers for the amount eaten and set fromLabel true.
4. A SAVED FOOD (match by meaning, e.g. a container of bulgur = "bulgur container"): set matchedSavedFoodId and qty in portions; its own numbers are used.
5. HIS USUAL PORTIONS: use that many grams unless the photo clearly shows a different amount.
6. Else matchedSavedFoodId is null: kcal, protein, carbs and fat for the whole amount from standard food values; check kcal ≈ 4×protein + 4×carbs + 9×fat.
The owner's note is the truth. confidence: high = sure what and how much, medium = fair guess, low = amount hard to see. message: one short friendly sentence.
Answer ONLY with JSON in the given shape.${photosRule(req)}`
  const picked = promptSaved(req.saved, req.note)
  const saved = picked.length ? picked.map((s) => `- id ${s.id}: ${s.name}, ${s.portion || '1 portion'}: ${s.kcal} kcal, ${s.protein} g protein${s.carbs ? `, ${s.carbs} g carbs` : ''}${s.fat ? `, ${s.fat} g fat` : ''}`).join('\n') : '(none)'
  const usual = (req.portions ?? []).length ? `\nHIS USUAL PORTIONS: ${req.portions.map((p) => `${p.name} ${p.g} g`).join(', ')}` : ''
  const user = `Owner's note: ${req.note || '(none)'}
SAVED FOODS:
${saved}${usual}
${(req.images?.length ?? 1) > 1 ? `What is in these ${req.images.length} photos?` : 'What is in this photo?'}`
  return { system, user }
}

/** The extra rule when several photos come together (one meal, each food listed once). */
function photosRule(req) {
  const n = req.images?.length ?? 1
  if (n < 2) return ''
  return `

There are ${n} photos (Photo 1 to Photo ${n}), all of ONE meal. They may show the same food from different angles, or different foods eaten together (a plate, a packaged snack, a drink).
- List each food ONCE. Never count the same food twice because it is in two photos.
- photo: the number of the photo where that food is clearest (1 to ${n}).
- A package label in a photo is the truth for that food's numbers.`
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
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  /** Which photo it is in (1…n), when several photos come together. */
  photo: { type: 'number' },
  /** The honest range of grams. */
  gramsLow: { type: 'number' },
  gramsHigh: { type: 'number' },
  /** The numbers come from a readable label or package. */
  fromLabel: { type: 'boolean' }
}
const ITEM_REQUIRED = ['name', 'matchedSavedFoodId', 'qty', 'unit', 'grams', 'gramsLow', 'gramsHigh', 'kcal', 'protein', 'carbs', 'fat', 'confidence']
// No totals: the code adds them up again anyway, so asking for them only costs output tokens.
const SHAPE = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', properties: ITEM_PROPS, required: ITEM_REQUIRED } },
    message: { type: 'string' }
  },
  required: ['items', 'message']
}
/** Gemini's schema: the same shape with its upper-case type names (OBJECT, STRING…). */
const upper = (o) => (Array.isArray(o) ? o.map(upper) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'type' ? String(v).toUpperCase() : k === 'required' || k === 'enum' ? v : upper(v)])) : o)
export const GEMINI_SCHEMA = upper(SHAPE)
/** Claude's tool input (JSON Schema: null is a type there, not a flag). */
export const CLAUDE_SCHEMA = { ...SHAPE, properties: { ...SHAPE.properties, items: { type: 'array', items: { type: 'object', properties: { ...ITEM_PROPS, matchedSavedFoodId: { type: ['string', 'null'] } }, required: ITEM_REQUIRED } } } }

/** The HTTP request for one try (url, headers, body). The key is only in a header. */
export function buildVisionRequest(p, model, req, think = THINK_LOW, media = true) {
  const scale = req.kind === 'scale'
  const { system, user } = scale ? scalePrompt() : foodPhotoPrompt(req)
  // Every photo of the meal in the one request (each with its number when there are several).
  const pics = !scale && Array.isArray(req.images) && req.images.length ? req.images : [req.image]
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
        messages: [{ role: 'user', content: [...pics.flatMap((x, i) => [...(pics.length > 1 ? [{ type: 'text', text: `Photo ${i + 1}:` }] : []), { type: 'image', source: { type: 'base64', media_type: x.mime, data: x.data } }]), { type: 'text', text: user }] }]
      }
    }
  }
  return {
    url: `${GEMINI_API}${model}:generateContent`,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [...pics.flatMap((x, i) => [...(pics.length > 1 ? [{ text: `Photo ${i + 1}:` }] : []), { inline_data: { mime_type: x.mime, data: x.data } }]), { text: user }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json',
        responseSchema: scale ? GEMINI_SCALE_SCHEMA : GEMINI_SCHEMA,
        // A small thinking budget for an ordinary photo; the careful second look gets more (readFoodPhoto).
        ...(think != null && think !== false ? { thinkingConfig: { thinkingBudget: think === true ? THINK_HIGH : Number(think) } } : {}),
        // A fixed, modest image size (tokens per photo) instead of the most detailed one.
        ...(media && !scale ? { mediaResolution: mediaResolution() } : {})
      }
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

/** Thinking budgets (tokens): small for an ordinary photo, more for the careful second look. VISION_THINK sets the small one. */
export const THINK_LOW = 128
export const THINK_HIGH = 1024
const thinkLow = (env = process.env) => {
  const raw = String(env.VISION_THINK ?? '').trim()
  const n = Number(raw)
  return raw !== '' && Number.isFinite(n) && n >= 0 && n <= 8192 ? Math.round(n) : THINK_LOW
}
/** The image size Gemini reads at (VISION_MEDIA = low | medium | high; medium by default: labels stay readable, tokens stay fixed). */
export function mediaResolution(env = process.env) {
  const v = String(env.VISION_MEDIA ?? '').trim().toLowerCase()
  return `MEDIA_RESOLUTION_${v === 'low' || v === 'high' ? v.toUpperCase() : 'MEDIUM'}`
}
/** A second, careful look is worth paying for: a food it could not see well, or a big meal (over 900 kcal). */
export const SECOND_LOOK_KCAL = 900
export function needsSecondLook(json) {
  const items = Array.isArray(json?.items) ? json.items : []
  if (!items.length) return false
  const kcal = items.reduce((a, x) => a + (Number(x?.kcal) || 0), 0)
  return kcal > SECOND_LOOK_KCAL || items.some((x) => x?.confidence === 'low' && !x?.matchedSavedFoodId && x?.fromLabel !== true)
}

/** The token counts of one reply: input (the image part apart when the provider says), output and thinking. */
export function usageOf(p, j) {
  if (p.name === 'claude') return { prompt: Number(j?.usage?.input_tokens) || 0, image: null, completion: Number(j?.usage?.output_tokens) || 0, thoughts: 0 }
  const u = j?.usageMetadata ?? {}
  const img = (u.promptTokensDetails ?? []).find((d) => d?.modality === 'IMAGE')
  return { prompt: Number(u.promptTokenCount) || 0, image: img ? Number(img.tokenCount) || 0 : null, completion: Number(u.candidatesTokenCount) || 0, thoughts: Number(u.thoughtsTokenCount) || 0 }
}

/** One read through the provider's models: a 404 moves to the next, one retry for a time-out, a busy provider or bad JSON. */
async function readOnce(p, req, think, { fetchImpl, record, deadline, wait, kind }) {
  let retried = false
  let media = true
  for (let i = 0; i < p.models.length; i++) {
    const model = p.models[i]
    const left = deadline - Date.now() - 3000
    if (left < 4000) throw Object.assign(new Error('Reading the photo took too long. Try again.'), { timeUp: true })
    try {
      const t0 = Date.now()
      const r = buildVisionRequest(p, model, req, think, media)
      const res = await fetchImpl(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(r.body), signal: AbortSignal.timeout(Math.min(25_000, left)) })
      if (res.status === 404 && i < p.models.length - 1) continue
      const j = await res.json().catch(() => ({}))
      const msg = String(j?.error?.message ?? '')
      // A model that takes no thinking budget, or no image size setting: ask it again without it.
      if (res.status === 400 && think != null && think !== false && /thinking/i.test(msg)) {
        think = null
        i--
        continue
      }
      if (res.status === 400 && media && /media.?resolution/i.test(msg)) {
        media = false
        i--
        continue
      }
      if (!res.ok) throw new Error(`${p.name === 'claude' ? 'Claude' : 'Gemini'} ${res.status}: ${msg || 'request failed'}`)
      const out = readVisionReply(p, j)
      const usage = { ...usageOf(p, j), ms: Date.now() - t0 }
      // Thinking is paid like output: it goes into the completion count.
      await record({ model: `${p.name === 'claude' ? 'anthropic' : 'google'}/${model}`, kind, prompt: usage.prompt, completion: usage.completion + usage.thoughts, cost: null }).catch(() => null)
      return { json: out.json, model, usage }
    } catch (e) {
      if (retried || !worthRetry(e)) throw e
      retried = true
      await wait(800)
      i--
    }
  }
  throw new Error('No AI model could read the photo')
}

/**
 * Reads the photo: first with a small thinking budget; a hard photo (a food it
 * could not see well, or over 900 kcal) gets ONE careful second look with more
 * thinking when there is time (both are counted in the AI budget). Each try gets
 * at most 25 s and never more than the time left. `record` gets the tokens.
 * Returns the raw JSON (checked again with core/foodVision.ts), the model, each
 * try's token counts and time, and whether a second look was taken.
 */
export async function readFoodPhoto(p, req, { fetchImpl = fetch, record = async () => {}, deadline = Date.now() + VISION_DEADLINE_MS, wait = (ms) => new Promise((ok) => setTimeout(ok, ms)), env = process.env } = {}) {
  const scale = req.kind === 'scale'
  const ctx = { fetchImpl, record, deadline, wait, kind: scale ? 'scaleShot' : 'foodPhoto' }
  const first = await readOnce(p, req, scale ? THINK_HIGH : thinkLow(env), ctx)
  const usage = [first.usage]
  if (scale || p.name !== 'gemini' || !needsSecondLook(first.json) || deadline - Date.now() < 20_000) return { json: first.json, model: first.model, usage, second: false }
  try {
    const again = await readOnce(p, req, THINK_HIGH, { ...ctx, kind: 'foodPhoto2' })
    usage.push(again.usage)
    return { json: Array.isArray(again.json?.items) && again.json.items.length ? again.json : first.json, model: again.model, usage, second: true }
  } catch {
    return { json: first.json, model: first.model, usage, second: false }
  }
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
 * Counts `n` photos for today (each photo of a request counts) and says how
 * many were counted. `run(sql, args)` runs the statements in order and returns
 * the last one's rows. Yesterday's counters are removed in the same go.
 */
export async function countPhoto(run, now = new Date(), tz = '', n = 1) {
  const day = photoDay(now, tz)
  const add = Math.max(1, Math.min(MAX_PHOTOS, Math.round(Number(n) || 1)))
  const rows = await run([
    { sql: 'CREATE TABLE IF NOT EXISTS sys_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)', args: [] },
    { sql: "DELETE FROM sys_kv WHERE key LIKE 'vision:%' AND key < ?", args: [`vision:${day}`] },
    { sql: 'INSERT INTO sys_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + CAST(excluded.value AS INTEGER) RETURNING value', args: [`vision:${day}`, String(add)] }
  ])
  const total = Number(rows?.[0]?.[0])
  if (!Number.isFinite(total)) throw new Error('Database not reachable')
  return total
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
