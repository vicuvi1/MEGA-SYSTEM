// POST /api/ai (session required) {prompt} → {text, model}
//      {op:'status'}                     → {configured}
// Google Gemini for the website, with the key kept on the server
// (GEMINI_API_KEY in Vercel). The page builds the prompt from your data.
import { bearer, config, getSetting, readBody, send, requireSession, setSetting, turso } from './_lib.mjs'
import { BUDGET_KEY, DEFAULT_BUDGET_USD, budgetPlan, budgetTier, costOf, monthStart } from './_budget.mjs'

const MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.8-flash']
const API = 'https://generativelanguage.googleapis.com/v1beta/models/'

/**
 * Asks Gemini, trying the next model when one is gone (404).
 * opts.json: answer as JSON; opts.media: [{mime, data (base64)}] (a voice
 * note, a photo) sent with the prompt.
 */
const noThinkCfg = new Set()
export async function askGemini(key, prompt, fetchImpl = fetch, opts = {}) {
  let last = ''
  for (const model of MODELS) {
    const r = await fetchImpl(`${API}${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        ...(splitPrompt(prompt).system ? { systemInstruction: { parts: [{ text: splitPrompt(prompt).system }] } } : {}),
        contents: [{ parts: [{ text: splitPrompt(prompt).user }, ...(opts.media ?? []).map((m) => ({ inline_data: { mime_type: m.mime, data: m.data } }))] }],
        // B18: the backup model thinks only a little for chat and nudges (faster, cheaper); more for big asks.
        generationConfig: { temperature: 0.7, maxOutputTokens: opts.think ? 4096 : 2048, ...(opts.json ? { responseMimeType: 'application/json' } : {}), ...(noThinkCfg.has(model) ? {} : { thinkingConfig: { thinkingBudget: opts.think ? 2048 : 256 } }) }
      })
    })
    // A model that doesn't take a thinking budget: ask again without it (and remember).
    if (r.status === 400 && !noThinkCfg.has(model)) {
      const err = await r.clone().json().catch(() => ({}))
      if (/thinking/i.test(err?.error?.message ?? '')) {
        noThinkCfg.add(model)
        return askGemini(key, prompt, fetchImpl, opts)
      }
    }
    if (r.status === 404) {
      last = `${model} is not available`
      continue
    }
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${j?.error?.message || 'request failed'}`)
    const um = j?.usageMetadata ?? {}
    await recordUsage({ model: `google/${model}`, kind: opts.kind || (opts.media?.length ? 'media' : 'chat'), prompt: um.promptTokenCount, completion: um.candidatesTokenCount, cost: null }, process.env, fetchImpl)
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

let resolvedStrong
/**
 * The strong model for hard thinking (plans, reviews, corrections, questions):
 * OPENROUTER_STRONG_MODEL if set, else the newest DeepSeek "pro"/reasoning
 * model OpenRouter lists (not flash, lite or distilled); null if none.
 */
export async function strongModel(env = process.env, fetchImpl = fetch) {
  if ((env.OPENROUTER_STRONG_MODEL || '').trim()) return env.OPENROUTER_STRONG_MODEL.trim()
  if (resolvedStrong !== undefined) return resolvedStrong
  try {
    const r = await fetchImpl(`${OPENROUTER}/models`)
    const ids = ((await r.json())?.data ?? []).map((m) => String(m.id)).filter((id) => /^deepseek\//i.test(id) && !/:free$|flash|lite|distill|prover|ocr|coder/i.test(id))
    const pro = ids.filter((id) => /pro|reason|-r\d/i.test(id)).sort(newer)
    resolvedStrong = pro[0] ?? ids.filter((id) => /v\d/i.test(id)).sort(newer)[0] ?? null
  } catch {
    resolvedStrong = null
  }
  return resolvedStrong
}

// ---- Your choice of model (Settings → Ben → Brain), kept in the database ----
export const MODELS_KEY = 'ai_models'
let chosen = null
let chosenAt = 0
/** {chat, deep}: the models you picked (null = automatic). Cached 30 s. */
// Tests never read or write the real database (Vercel's build has its keys).
const testing = (env) => !!(env.VITEST || process.env.VITEST)

export async function chosenModels(env = process.env, fetchImpl = fetch) {
  if (chosen && Date.now() - chosenAt < 30_000) return chosen
  if (testing(env)) return { chat: null, deep: null }
  const cfg = config(env)
  let v = { chat: null, deep: null }
  if (cfg.ok) {
    try {
      const raw = JSON.parse((await getSetting(cfg, MODELS_KEY, fetchImpl)) || 'null')
      if (raw && typeof raw === 'object') v = { chat: raw.chat || null, deep: raw.deep || null }
    } catch {
      /* automatic */
    }
  }
  chosen = v
  chosenAt = Date.now()
  return v
}

// ---- Usage: every call's tokens and real cost (OpenRouter reports it) ----
const USAGE_TABLE = `CREATE TABLE IF NOT EXISTS ai_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, model TEXT NOT NULL, kind TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, cost REAL)`
const t = (v) => (v == null ? { type: 'null' } : typeof v === 'number' ? (Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v }) : { type: 'text', value: String(v) })
export async function recordUsage(u, env = process.env, fetchImpl = fetch) {
  // No reported cost (Gemini, some OpenRouter models): estimate it from the tokens (A7).
  u = { ...u, cost: costOf(u.model, u.prompt, u.completion, u.cost) }
  // The minute-long budget cache counts this call straight away.
  if (budgetCache && u.cost) {
    const spent = budgetCache.v.spent + u.cost
    budgetCache.v = { ...budgetCache.v, spent, tier: budgetTier(spent, budgetCache.v.budget) }
  }
  if (testing(env)) return
  const cfg = config(env)
  if (!cfg.ok) return
  await turso(cfg, {
    requests: [
      { type: 'execute', stmt: { sql: USAGE_TABLE } },
      { type: 'execute', stmt: { sql: 'INSERT INTO ai_usage (at, model, kind, prompt_tokens, completion_tokens, cost) VALUES (?, ?, ?, ?, ?, ?)', args: [t(new Date().toISOString()), t(u.model), t(u.kind ?? null), t(u.prompt ?? null), t(u.completion ?? null), t(u.cost ?? null)] } },
      { type: 'close' }
    ]
  }, fetchImpl).catch(() => null)
}

// ---- The monthly budget: steps down to cheaper models as it fills up ----
let budgetCache = null
/** This month's spend, the budget (USD) and the tier. Cached for a minute. */
export async function budgetState(env = process.env, fetchImpl = fetch, now = new Date()) {
  if (budgetCache && Date.now() - budgetCache.at < 60_000) return budgetCache.v
  let budget = DEFAULT_BUDGET_USD
  let spent = 0
  const cfg = config(env)
  if (!testing(env) && cfg.ok) {
    const { json } = await turso(cfg, {
      requests: [
        { type: 'execute', stmt: { sql: USAGE_TABLE } },
        { type: 'execute', stmt: { sql: 'SELECT COALESCE(SUM(cost),0) FROM ai_usage WHERE at >= ?', args: [{ type: 'text', value: monthStart(now) }] } },
        { type: 'execute', stmt: { sql: 'SELECT value FROM settings WHERE key = ?', args: [{ type: 'text', value: BUDGET_KEY }] } },
        { type: 'close' }
      ]
    }, fetchImpl).catch(() => ({ json: null }))
    const cell = (i) => json?.results?.[i]?.response?.result?.rows?.[0]?.[0]
    // A failed read is not "$0 spent" (A7): keep the last known numbers (else play
    // it safe with the cheaper tier) and try again in 10 seconds.
    if (!cell(1)) {
      const last = budgetCache?.v ?? { budget, spent: 0, tier: 'save' }
      budgetCache = { at: Date.now() - 50_000, v: last }
      return last
    }
    spent = Number(cell(1)?.value ?? 0) || 0
    try {
      const b = JSON.parse(cell(2)?.value ?? 'null')
      if (b && typeof b.usd === 'number') budget = b.usd
    } catch {
      /* default */
    }
  }
  const v = { budget, spent, tier: budgetTier(spent, budget, now) }
  budgetCache = { at: Date.now(), v }
  return v
}

/** Asks OpenRouter (text only). opts.json: answer as a JSON object; opts.strong: the strong model (flash if it fails). */
export async function askOpenRouter(key, prompt, fetchImpl = fetch, opts = {}, env = process.env) {
  // A test run (Settings → Test Ben) asks one exact model, with no fallback.
  // Even a test run respects a used-up budget (A7).
  if (opts.model) {
    if ((await budgetState(env, fetchImpl)).tier === 'minimal') throw Object.assign(new Error('AI budget used up this month: model tests are paused'), { budget: true })
    return callOpenRouter(key, opts.model, prompt, fetchImpl, { ...opts, think: !!opts.strong }, 45_000, 'low')
  }
  // The budget decides first: near the limit no strong model, past it only the cheap one.
  const plan = budgetPlan((await budgetState(env, fetchImpl)).tier, opts)
  opts = { ...opts, strong: plan.strong }
  // Your pick wins: the chat model for everything, the deep one for plans and reviews.
  const pick = opts.noPick || !plan.useChosen ? { chat: null, deep: null } : await chosenModels(env, fetchImpl)
  const mine = opts.strong ? pick.deep || pick.chat : pick.chat
  if (mine) {
    try {
      return await callOpenRouter(key, mine, prompt, fetchImpl, { ...opts, think: !!opts.strong }, opts.strong ? 60_000 : 45_000, 'medium')
    } catch (e) {
      console.warn(`chosen model ${mine} failed, using automatic:`, e.message)
    }
  }
  if (opts.strong) {
    const strong = await strongModel(env, fetchImpl)
    const flash = await openRouterModel(env, fetchImpl)
    if (strong && strong !== flash) {
      try {
        return await callOpenRouter(key, strong, prompt, fetchImpl, { ...opts, think: true }, 35_000, 'medium')
      } catch (e) {
        console.warn('strong model failed, using flash:', e.message)
        return callOpenRouter(key, flash, prompt, fetchImpl, { ...opts, think: false }, 20_000)
      }
    }
  }
  const model = await openRouterModel(env, fetchImpl)
  return callOpenRouter(key, model, prompt, fetchImpl, opts, opts.think ? 40_000 : 30_000)
}

/**
 * B1: Ben's prompt has a fixed part (his instructions, the same every time)
 * and a live part, split by <<<LIVE>>>. The fixed part goes first as the
 * system message, so the provider caches it and charges much less for it.
 */
export const PROMPT_SPLIT = '\n<<<LIVE>>>\n'
export function splitPrompt(prompt) {
  const i = String(prompt).indexOf(PROMPT_SPLIT)
  return i < 0 ? { system: null, user: String(prompt) } : { system: prompt.slice(0, i), user: prompt.slice(i + PROMPT_SPLIT.length) }
}
const messagesFor = (prompt) => {
  const { system, user } = splitPrompt(prompt)
  return system ? [{ role: 'system', content: system }, { role: 'user', content: user }] : [{ role: 'user', content: user }]
}

async function callOpenRouter(key, model, prompt, fetchImpl, opts, timeout, effort = 'low') {
  const r = await fetchImpl(`${OPENROUTER}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://mega-system-ten.vercel.app', 'X-Title': 'Life System' },
    // opts.think: big asks (plans, reviews, reshuffles) get the model's reasoning.
    body: JSON.stringify({ model, messages: messagesFor(prompt), ...(/^deepseek\//.test(model) ? { provider: { order: ['deepseek'], allow_fallbacks: true } } : {}), temperature: 0.6, max_tokens: opts.think ? 6000 : 2048, usage: { include: true }, ...(opts.json ? { response_format: { type: 'json_object' } } : {}), ...(opts.think ? { reasoning: { effort } } : {}) }),
    signal: AbortSignal.timeout(timeout)
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${j?.error?.message || 'request failed'}`)
  const text = j?.choices?.[0]?.message?.content
  const u = j?.usage ?? {}
  await recordUsage({ model: j?.model || model, kind: opts.kind || (opts.think ? 'deep' : 'chat'), prompt: u.prompt_tokens, completion: u.completion_tokens, cost: typeof u.cost === 'number' ? u.cost : null }, process.env, fetchImpl)
  if (!text) throw new Error('OpenRouter gave an empty answer')
  return { text: String(text), model: j?.model || model }
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
      if (!gKey || e.budget) throw e
    }
  }
  if (!gKey) throw new Error('Add OPENROUTER_API_KEY or GEMINI_API_KEY in Vercel to use the AI coach')
  // The Gemini path keeps to the same budget (A7): extras stop when it's used up.
  budgetPlan((await budgetState(env, fetchImpl)).tier, opts)
  return askGemini(gKey, prompt, fetchImpl, opts)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  if (!(await requireSession(res, config(), bearer(req)))) return
  const key = (process.env.GEMINI_API_KEY || '').trim()
  let body
  try {
    body = await readBody(req)
  } catch {
    return send(res, 400, { error: 'Bad request' })
  }
  const orKey = (process.env.OPENROUTER_API_KEY || '').trim()
  if (body?.op === 'status') {
    const strong = orKey ? await strongModel() : null
    const pick = await chosenModels()
    return send(res, 200, { configured: !!(key || orKey), model: orKey ? pick.chat || (await openRouterModel()) : key ? 'gemini' : null, strong: pick.deep || pick.chat || strong, chosen: pick, auto: { chat: orKey ? await openRouterModel() : null, deep: strong } })
  }
  if (body?.op === 'models') return send(res, 200, { models: await listModels() })
  if (body?.op === 'setModels') {
    const clean = (v) => (typeof v === 'string' && /^[\w.\-]+\/[\w.:\-]+$/.test(v) ? v : null)
    const v = { chat: clean(body.chat), deep: clean(body.deep) }
    await setSetting(config(), MODELS_KEY, JSON.stringify(v))
    chosen = v
    chosenAt = Date.now()
    return send(res, 200, { ok: true, chosen: v })
  }
  if (body?.op === 'usage') return send(res, 200, { ...(await usageReport(orKey)), budget: await budgetState() })
  if (body?.op === 'setBudget') {
    const usd = Number(body.usd)
    if (!Number.isFinite(usd) || usd < 0 || usd > 1000) return send(res, 400, { error: 'Budget: 0–1000 USD a month (0 = no limit)' })
    await setSetting(config(), BUDGET_KEY, JSON.stringify({ usd: Math.round(usd * 100) / 100 }))
    budgetCache = null
    return send(res, 200, { ok: true, budget: await budgetState() })
  }
  // Ben's test: 20 typical messages on throwaway data, with the model you pick.
  if (body?.op === 'eval') {
    if (!orKey) return send(res, 503, { error: 'Add OPENROUTER_API_KEY in Vercel to test models' })
    const model = typeof body.model === 'string' && /^[\w.\-]+\/[\w.:\-]+$/.test(body.model) ? body.model : (await chosenModels()).chat || (await openRouterModel())
    try {
      const [{ runBenEval }, { default: initSqlJs }, { createRequire }] = await Promise.all([import('./_bot/bot.mjs'), import('sql.js'), import('node:module')])
      const require = createRequire(import.meta.url)
      const SQL = await initSqlJs({ locateFile: (f) => require.resolve(`sql.js/dist/${f}`) })
      const since = new Date().toISOString()
      const r = await runBenEval(SQL, async (prompt, opts = {}) => (await askOpenRouter(orKey, prompt, fetch, { ...opts, media: undefined, model, kind: 'eval' })).text, 50_000)
      const u = await usageSince(since)
      return send(res, 200, { model, ...r, cost: u.cost, calls: u.calls })
    } catch (e) {
      return send(res, 500, { error: e.message || 'test failed' })
    }
  }
  if (!key && !orKey) return send(res, 503, { error: 'Add OPENROUTER_API_KEY or GEMINI_API_KEY in Vercel to use AI on the website' })
  const prompt = String(body?.prompt || '').slice(0, 60_000)
  if (!prompt.trim()) return send(res, 400, { error: 'Empty prompt' })
  try {
    send(res, 200, await askModel(prompt))
  } catch (e) {
    send(res, 502, { error: e.message || 'Gemini failed' })
  }
}

/** OpenRouter's models with prices per 1M tokens (in USD), newest/popular first. */
let modelsCache = null
async function listModels(fetchImpl = fetch) {
  if (modelsCache && Date.now() - modelsCache.at < 3600_000) return modelsCache.list
  const r = await fetchImpl(`${OPENROUTER}/models`, { signal: AbortSignal.timeout(15_000) })
  const data = (await r.json())?.data ?? []
  const per1M = (x) => (x == null || x === '' || Number(x) < 0 ? null : Math.round(Number(x) * 1e6 * 1000) / 1000)
  const list = data
    .filter((m) => (m.architecture?.output_modalities ?? ['text']).includes('text'))
    .map((m) => ({ id: m.id, name: m.name, in: per1M(m.pricing?.prompt), out: per1M(m.pricing?.completion), context: m.context_length ?? null, created: m.created ?? 0, tools: (m.supported_parameters ?? []).includes('tools'), reasoning: (m.supported_parameters ?? []).includes('reasoning') }))
    .sort((a, b) => b.created - a.created)
  modelsCache = { at: Date.now(), list }
  return list
}

/** What the coach cost: today, 7 and 30 days, by model, the last calls, and OpenRouter's balance. */
async function usageReport(orKey, fetchImpl = fetch) {
  const cfg = config()
  const out = { today: null, week: null, month: null, byModel: [], byKind: [], recent: [], credits: null }
  if (cfg.ok) {
    const day0 = new Date()
    day0.setHours(0, 0, 0, 0)
    const since = (d) => new Date(Date.now() - d * 86400_000).toISOString()
    const q = (sql, args = []) => ({ type: 'execute', stmt: { sql, args: args.map((a) => ({ type: 'text', value: a })) } })
    const sum = 'SELECT COUNT(*), COALESCE(SUM(cost),0), COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0) FROM ai_usage WHERE at >= ?'
    const { json } = await turso(cfg, {
      requests: [
        { type: 'execute', stmt: { sql: USAGE_TABLE } },
        q(sum, [day0.toISOString()]),
        q(sum, [since(7)]),
        q(sum, [since(30)]),
        q('SELECT model, COUNT(*), COALESCE(SUM(cost),0), COALESCE(SUM(prompt_tokens),0) + COALESCE(SUM(completion_tokens),0) FROM ai_usage WHERE at >= ? GROUP BY model ORDER BY 3 DESC, 2 DESC', [since(30)]),
        q('SELECT at, model, kind, prompt_tokens, completion_tokens, cost FROM ai_usage ORDER BY id DESC LIMIT 60'),
        q("SELECT COALESCE(kind, 'chat'), COUNT(*), COALESCE(SUM(cost),0) FROM ai_usage WHERE at >= ? GROUP BY 1 ORDER BY 3 DESC, 2 DESC", [since(30)]),
        { type: 'close' }
      ]
    }, fetchImpl).catch(() => ({ json: null }))
    const rows = (i) => json?.results?.[i]?.response?.result?.rows ?? []
    const v = (c) => (c == null || c.type === 'null' ? null : c.value)
    const tot = (i) => {
      const r = rows(i)[0]
      return r ? { calls: Number(v(r[0])), cost: Number(v(r[1])), tokens: Number(v(r[2])) + Number(v(r[3])) } : null
    }
    out.today = tot(1)
    out.week = tot(2)
    out.month = tot(3)
    out.byModel = rows(4).map((r) => ({ model: v(r[0]), calls: Number(v(r[1])), cost: Number(v(r[2])), tokens: Number(v(r[3])) }))
    out.byKind = rows(6).map((r) => ({ kind: v(r[0]), calls: Number(v(r[1])), cost: Number(v(r[2])) }))
    out.recent = rows(5).map((r) => ({ at: v(r[0]), model: v(r[1]), kind: v(r[2]), prompt: v(r[3]) == null ? null : Number(v(r[3])), completion: v(r[4]) == null ? null : Number(v(r[4])), cost: v(r[5]) == null ? null : Number(v(r[5])) }))
  }
  if (orKey) {
    try {
      const r = await fetchImpl(`${OPENROUTER}/credits`, { headers: { Authorization: `Bearer ${orKey}` }, signal: AbortSignal.timeout(8000) })
      const d = (await r.json())?.data
      if (d) out.credits = { total: Number(d.total_credits), used: Number(d.total_usage), left: Number(d.total_credits) - Number(d.total_usage) }
    } catch {
      /* no balance shown */
    }
  }
  return out
}

/** Cost and calls since a moment (the test run's own spend). */
async function usageSince(iso, fetchImpl = fetch) {
  const cfg = config()
  if (!cfg.ok) return { cost: null, calls: 0 }
  const { json } = await turso(cfg, { requests: [{ type: 'execute', stmt: { sql: 'SELECT COUNT(*), COALESCE(SUM(cost),0) FROM ai_usage WHERE at >= ? AND kind = ?', args: [{ type: 'text', value: iso }, { type: 'text', value: 'eval' }] } }, { type: 'close' }] }, fetchImpl).catch(() => ({ json: null }))
  const r = json?.results?.[0]?.response?.result?.rows?.[0]
  return r ? { calls: Number(r[0]?.value ?? 0), cost: Number(r[1]?.value ?? 0) } : { cost: null, calls: 0 }
}
