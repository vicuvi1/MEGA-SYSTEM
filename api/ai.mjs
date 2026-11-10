// POST /api/ai (session required) {prompt} → {text, model}
//      {op:'status'}                     → {configured}
//      {op:'foodPhoto', images (1–6) | image, note, saved, today, targets} → {ok, result} | {ok:false, error}
//        (food photo logging: provider code in _vision.mjs, 50 photos a day; kind:'scale'
//        reads a smart-scale screenshot instead, same counter and budget)
// Google Gemini for the website, with the key kept on the server
// (GEMINI_API_KEY in Vercel). The page builds the prompt from your data.
import { bearer, config, getSetting, readBody, send, requireSession, setSetting, turso, countCall } from './_lib.mjs'
import { BUDGET_KEY, DEFAULT_BUDGET_USD, budgetPlan, budgetTier, costOf, monthStart } from './_budget.mjs'
import { AsyncLocalStorage } from 'node:async_hooks'
import { FALLBACK, countPhoto, overLimit, readFoodPhoto, readPhotoRequest, tursoRun, visionProvider } from './_vision.mjs'

/** QA4: the usage rows of one request (Ben's answer shows its model and cost). Run a request inside usageScope.run([], …). */
export const usageScope = new AsyncLocalStorage()

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
      ...(opts.deadline ? { signal: AbortSignal.timeout(slot(40_000, opts.deadline)) } : {}),
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

/**
 * One time limit per request: a server function is stopped at 60 s, so every
 * answer (with all its fallbacks) must be in by 50 s. Each try gets its own
 * limit or the time that is left (less 3 s to send the answer), whichever is
 * shorter; when too little is left, the remaining fallbacks are skipped.
 */
export const AI_DEADLINE_MS = 50_000
export const deadlineIn = (ms = AI_DEADLINE_MS) => Date.now() + ms
export class TimeUpError extends Error {
  /** skipped: no call was made at all (earlier steps used the request's time), so the AI did nothing wrong. */
  constructor(skipped = false) {
    super('Ben took too long to answer. Try again in a moment.')
    this.timeUp = true
    if (skipped) this.skipped = true
  }
}
/** The time this try may take: min(its own limit, time left − 3 s). Throws when time is up. */
export function slot(limit, deadline) {
  if (!deadline) return limit
  const left = deadline - Date.now() - 3000
  if (left < 1500) throw new TimeUpError(true)
  return Math.min(limit, left)
}

/** A call that ran out of its own time limit (fetch's AbortSignal.timeout, or ours). */
export const isTimeout = (e) => !!e && (e.timeout === true || e.name === 'TimeoutError' || e.name === 'AbortError' || /aborted due to timeout|timed? ?out/i.test(String(e.message ?? '')))
/** Worth one more try: a time-out, too many requests, or a server error at the provider. */
export const retryable = (e) => !!e && !e.timeUp && !e.budget && (isTimeout(e) || /\b(429|5\d\d)\b/.test(String(e.message ?? '')))
/** The wait before the one retry. */
export const RETRY_BACKOFF_MS = 1000
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms))
/**
 * The thinking model's own cap in background work (the tick's plans and reviews): the
 * request has 50 s in all, and the quick model must still get a fair try if the thinking
 * one runs long. Before, it got 35 s, the quick model the last ~12 s, and both timed out.
 */
export const BACKGROUND_THINK_MS = 28_000
/**
 * The time a slow "thinking" model may take while still leaving room for the
 * quick model if it fails or runs long (15 s kept back). 0 = not enough time
 * to think: go straight to the quick model.
 */
export const QUICK_RESERVE_MS = 15_000
export function thinkSlot(limit, deadline) {
  if (!deadline) return limit
  const left = deadline - Date.now() - 3000 - QUICK_RESERVE_MS
  return left < 8000 ? 0 : Math.min(limit, left)
}
/** The model for one request (a webhook, a tick): every call shares its deadline. */
export const modelUntil = (deadline, env = process.env, fetchImpl = fetch) => async (prompt, opts = {}) => (await askModel(prompt, { ...opts, deadline: Math.min(opts.deadline ?? deadline, deadline) }, env, fetchImpl)).text

/**
 * LT9: the models Ben uses unless you pick others (Settings → Ben → Brain) or
 * set OPENROUTER_MODEL / OPENROUTER_STRONG_MODEL. Pinned, so a new model never
 * changes how he talks overnight: Settings → Ben says when a newer one is out.
 * A pinned model OpenRouter no longer lists is replaced by the newest one.
 */
export const PINNED_MODELS = { chat: 'deepseek/deepseek-v4.1-flash', deep: 'deepseek/deepseek-v4.1-pro' }

/** Version numbers in a model id ("deepseek-v4.1-flash" → [4, 1]) for "newest first". */
const versionOf = (id) => (String(id).match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
const newer = (a, b) => {
  const x = versionOf(a)
  const y = versionOf(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0)
  return 0
}

/** The newest DeepSeek "flash" model in a list of ids (cheap and good), else DeepSeek chat. */
export function newestFlash(all) {
  const ids = all.filter((id) => /^deepseek\//i.test(id) && !/:free$/.test(id))
  return ids.filter((id) => /flash/i.test(id)).sort(newer)[0] ?? ids.filter((id) => /chat|v\d/i.test(id)).sort(newer)[0] ?? 'deepseek/deepseek-chat'
}
/** The newest DeepSeek "pro"/reasoning model in a list (not flash, lite or distilled), or null. */
export function newestStrong(all) {
  const ids = all.filter((id) => /^deepseek\//i.test(id) && !/:free$|flash|lite|distill|prover|ocr|coder/i.test(id))
  return ids.filter((id) => /pro|reason|-r\d/i.test(id)).sort(newer)[0] ?? ids.filter((id) => /v\d/i.test(id)).sort(newer)[0] ?? null
}

let idsCache = null
/** OpenRouter's model ids (cached an hour; a failed read is tried again after 5 minutes), or null. */
async function modelIds(fetchImpl = fetch) {
  if (idsCache && Date.now() < idsCache.until) return idsCache.ids
  try {
    // A hung model list must not hold up every answer (it had no time limit).
    const r = await fetchImpl(`${OPENROUTER}/models`, { signal: AbortSignal.timeout(5_000) })
    const ids = ((await r.json())?.data ?? []).map((m) => String(m.id))
    idsCache = { ids, until: Date.now() + 3600_000 }
  } catch {
    idsCache = { ids: null, until: Date.now() + 5 * 60_000 }
  }
  return idsCache.ids
}

/**
 * The OpenRouter model to use: OPENROUTER_MODEL if set, else the pinned one
 * (PINNED_MODELS.chat), else (when OpenRouter no longer lists it) the newest
 * DeepSeek flash model.
 */
export async function openRouterModel(env = process.env, fetchImpl = fetch) {
  if ((env.OPENROUTER_MODEL || '').trim()) return env.OPENROUTER_MODEL.trim()
  const ids = await modelIds(fetchImpl)
  if (!ids || ids.includes(PINNED_MODELS.chat)) return PINNED_MODELS.chat
  return newestFlash(ids)
}

/**
 * The strong model for hard thinking (plans, reviews, corrections, questions):
 * OPENROUTER_STRONG_MODEL if set, else the pinned one, else the newest DeepSeek
 * pro/reasoning model OpenRouter lists; null if none.
 */
export async function strongModel(env = process.env, fetchImpl = fetch) {
  if ((env.OPENROUTER_STRONG_MODEL || '').trim()) return env.OPENROUTER_STRONG_MODEL.trim()
  const ids = await modelIds(fetchImpl)
  if (!ids || ids.includes(PINNED_MODELS.deep)) return PINNED_MODELS.deep
  return newestStrong(ids)
}

/** Newer DeepSeek models than the ones in use, for "a newer model is available" (null = none). */
export async function newerModels(env = process.env, fetchImpl = fetch) {
  const ids = await modelIds(fetchImpl)
  if (!ids) return { chat: null, deep: null }
  const [chat, deep] = [await openRouterModel(env, fetchImpl), await strongModel(env, fetchImpl)]
  const flash = newestFlash(ids)
  const strong = newestStrong(ids)
  return { chat: flash !== chat && newer(flash, chat) < 0 ? flash : null, deep: strong && strong !== deep && (!deep || newer(strong, deep) < 0) ? strong : null }
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
  usageScope.getStore()?.push(u)
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

/**
 * LT8: calls older than 90 days become one row per month, model and kind
 * (`calls` holds how many). All in one transaction. Statements only, so a test
 * can run them on sql.js.
 */
export function rollupStatements(now = new Date(), keepDays = 90) {
  const cut = new Date(now.getTime() - keepDays * 86400_000).toISOString()
  return [
    {
      sql: "INSERT INTO ai_usage (at, model, kind, prompt_tokens, completion_tokens, cost, calls) SELECT substr(at, 1, 7) || '-01T00:00:00.000Z', model, kind, SUM(prompt_tokens), SUM(completion_tokens), SUM(cost), COUNT(*) FROM ai_usage WHERE at < ? AND calls IS NULL GROUP BY substr(at, 1, 7), model, kind",
      args: [cut]
    },
    { sql: 'DELETE FROM ai_usage WHERE at < ? AND calls IS NULL', args: [cut] }
  ]
}
/** The `calls` column (older tables don't have it); an error means it is there already. */
export const USAGE_CALLS_COLUMN = 'ALTER TABLE ai_usage ADD COLUMN calls INTEGER'

export async function rollupUsage(env = process.env, fetchImpl = fetch, now = new Date()) {
  const cfg = config(env)
  if (!cfg.ok || testing(env)) return
  await turso(cfg, { requests: [{ type: 'execute', stmt: { sql: USAGE_TABLE } }, { type: 'execute', stmt: { sql: USAGE_CALLS_COLUMN } }, { type: 'close' }] }, fetchImpl)
  const st = rollupStatements(now)
  const steps = [{ stmt: { sql: 'BEGIN' } }, ...st.map((s, i) => ({ condition: { type: 'ok', step: i }, stmt: { sql: s.sql, args: s.args.map(t) } }))]
  steps.push({ condition: { type: 'ok', step: st.length }, stmt: { sql: 'COMMIT' } })
  steps.push({ condition: { type: 'not', cond: { type: 'ok', step: st.length + 1 } }, stmt: { sql: 'ROLLBACK' } })
  await turso(cfg, { requests: [{ type: 'batch', batch: { steps } }, { type: 'close' }] }, fetchImpl)
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

/**
 * CL3: the daily self-check's ping: a few tokens from the quick (flash) model with
 * its thinking switched off, through the fastest provider (8 s, then once more 12 s
 * after a short wait), and how much of the month's budget is used. Never the thinking
 * model, so a slow thinker can't mark Ben's AI as broken.
 */
export const PING_TIMEOUTS_MS = [8_000, 12_000]
export async function pingModel(env = process.env, fetchImpl = fetch) {
  const key = (env.OPENROUTER_API_KEY || '').trim()
  const b = await budgetState(env, fetchImpl).catch(() => null)
  const budget = b ? { spent: b.spent, budget: b.budget } : null
  if (!key) return { ai: (env.GEMINI_API_KEY || '').trim() ? null : { ok: false, error: 'No AI key on the server' }, budget }
  const model = await openRouterModel(env, fetchImpl)
  // One slow answer is not an outage: a timeout or a 5xx is asked once more (15 s) before it counts.
  let last = null
  for (const [i, ms] of PING_TIMEOUTS_MS.entries()) {
    if (i) await wait(RETRY_BACKOFF_MS)
    const t0 = Date.now()
    try {
      const r = await fetchImpl(`${OPENROUTER}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Life System' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Say OK.' }], max_tokens: 5, temperature: 0, reasoning: { enabled: false }, provider: { sort: 'latency' } }),
        signal: AbortSignal.timeout(ms)
      })
      if (r.ok) return { ai: { ok: true, model, ms: Date.now() - t0 }, budget }
      last = { ok: false, model, error: `OpenRouter ${r.status}: ${(await r.text().catch(() => '')).slice(0, 120)}` }
      if (r.status < 500 && r.status !== 429) break
    } catch (e) {
      last = { ok: false, model, error: isTimeout(e) ? `no answer in ${ms / 1000} s` : e.message }
    }
  }
  return { ai: last, budget }
}

/** Asks OpenRouter (text only). opts.json: answer as a JSON object; opts.strong: the strong model (flash if it fails). */
export async function askOpenRouter(key, prompt, fetchImpl = fetch, opts = {}, env = process.env) {
  // The caller's thinking cap (thinkMs) runs from now: the budget and model lookups below
  // take time too. Before, the cap started after them, so the chat's own timer gave up first,
  // moved on to the quick model, and this call timed out later as a stray "AI failing" error.
  const askedAt = Date.now()
  // A test run (Settings → Test Ben) asks one exact model, with no fallback.
  // Even a test run respects a used-up budget (A7).
  if (opts.model) {
    if ((await budgetState(env, fetchImpl)).tier === 'minimal') throw Object.assign(new Error('AI budget used up this month: model tests are paused'), { budget: true })
    return callOpenRouter(key, opts.model, prompt, fetchImpl, { ...opts, think: !!opts.strong }, slot(45_000, opts.deadline), 'low')
  }
  // The budget decides first: near the limit no strong model, past it only the cheap one.
  const plan = budgetPlan((await budgetState(env, fetchImpl)).tier, opts)
  opts = { ...opts, strong: plan.strong }
  // Your pick wins: the chat model for everything, the deep one for plans and reviews.
  const pick = opts.noPick || !plan.useChosen ? { chat: null, deep: null } : await chosenModels(env, fetchImpl)
  const mine = opts.strong ? pick.deep || pick.chat : pick.chat
  if (opts.strong) {
    // A thinking model can run long (reviews, plans): it gets the time left minus
    // 15 s, so the quick model can still answer when it fails or runs out of time.
    const flash = pick.chat || (await openRouterModel(env, fetchImpl))
    const deep = mine || (await strongModel(env, fetchImpl))
    // opts.thinkMs: the caller's cap on thinking (Ben's chat keeps time for its own quick retry).
    const capLeft = opts.thinkMs ? opts.thinkMs - (Date.now() - askedAt) : Infinity
    const t = capLeft < 1500 ? 0 : thinkSlot(Math.min(mine ? 60_000 : opts.thinkMs ? 35_000 : BACKGROUND_THINK_MS, capLeft), opts.deadline)
    if (deep && t) {
      try {
        // A chat answer thinks a little (fast); plans and reviews from the rhythm think more.
        return await callOpenRouter(key, deep, prompt, fetchImpl, { ...opts, think: deep !== flash || !!mine }, t, /^chat|^lookup|^retry/.test(opts.kind || '') ? 'low' : 'medium')
      } catch (e) {
        if (e.timeUp || opts.noFallback) throw e
        console.warn(`thinking model ${deep} failed, using ${flash}:`, e.message)
      }
    }
    if (deep !== flash || !t) {
      try {
        return await quickCall(key, flash, prompt, fetchImpl, { ...opts, think: false }, 25_000, { fellBack: !!(deep && t) })
      } catch (e) {
        if (e.timeUp || !pick.chat) throw e
        console.warn(`chosen model ${flash} failed, using automatic:`, e.message)
      }
    }
  } else if (mine) {
    try {
      return await callOpenRouter(key, mine, prompt, fetchImpl, opts, slot(45_000, opts.deadline), 'medium')
    } catch (e) {
      if (e.timeUp) throw e
      console.warn(`chosen model ${mine} failed, using automatic:`, e.message)
    }
  }
  if (opts.strong) opts = { ...opts, think: false }
  const model = await openRouterModel(env, fetchImpl)
  try {
    return await quickCall(key, model, prompt, fetchImpl, opts, opts.think ? 40_000 : 30_000, { fellBack: !!opts.strong })
  } catch (e) {
    if (e.timeUp) throw e
    // The pinned model was refused as unknown: the newest one keeps Ben talking (LT9).
    const ids = /\b(400|404)\b|not a valid model|no endpoints|not found/i.test(String(e?.message)) ? await modelIds(fetchImpl) : null
    const backup = ids ? newestFlash(ids) : null
    if (!backup || backup === model) throw e
    console.warn(`model ${model} failed, using ${backup}:`, e.message)
    return callOpenRouter(key, backup, prompt, fetchImpl, opts, slot(opts.think ? 40_000 : 30_000, opts.deadline))
  }
}

/**
 * The quick model, with at most ONE retry: after a time-out, a 429 or a 5xx it waits a
 * second and asks again through the fastest provider (not only DeepSeek's own, which is
 * what queues at busy hours), if enough of the request's time is left (8 s+). The answer
 * says `fallback: 'quick'` when it stands in for the thinking model.
 */
async function quickCall(key, model, prompt, fetchImpl, opts, limit, how = {}) {
  const mark = (r) => (how.fellBack ? { ...r, fallback: 'quick' } : r)
  try {
    return mark(await callOpenRouter(key, model, prompt, fetchImpl, opts, slot(limit, opts.deadline)))
  } catch (e) {
    // Ben's chat retries its quick try itself (webBots ask()): no second retry on top of it.
    if (!retryable(e) || /^(chat|retry|lookup)/.test(opts.kind || '')) throw e
    const backoff = opts.backoffMs ?? RETRY_BACKOFF_MS
    if (opts.deadline && opts.deadline - Date.now() - 3000 - backoff < 8000) throw e
    console.warn(`model ${model} failed (${e.message}), one retry through the fastest provider`)
    await wait(backoff)
    return mark(await callOpenRouter(key, model, prompt, fetchImpl, { ...opts, fastRoute: true }, slot(limit, opts.deadline)))
  }
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

/**
 * U2: the reply as it is being written. Ben answers in JSON, so this pulls the
 * "reply" string out of the partial JSON and un-escapes it (null until it starts).
 */
export function partialReply(raw) {
  const m = /"reply"\s*:\s*"/.exec(raw)
  if (!m) return null
  let out = ''
  for (let i = m.index + m[0].length; i < raw.length; i++) {
    const c = raw[i]
    if (c === '\\') {
      const n = raw[i + 1]
      if (n === undefined) break
      if (n === 'u') {
        const hex = raw.slice(i + 2, i + 6)
        if (hex.length < 4) break
        out += String.fromCharCode(parseInt(hex, 16))
        i += 5
        continue
      }
      out += n === 'n' ? '\n' : n === 't' ? '\t' : n
      i++
      continue
    }
    if (c === '"') break
    out += c
  }
  return out
}

async function streamOpenRouter(r, onDelta) {
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let text = ''
  let reasoning = ''
  let usage = {}
  let model = null
  let sent = ''
  let at = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buf += dec.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const j = JSON.parse(data)
        model = j.model || model
        if (j.usage) usage = j.usage
        const d = j.choices?.[0]?.delta?.content
        if (d) text += d
        // A thinking model's reasoning (shown folded under the answer in the app).
        const th = j.choices?.[0]?.delta?.reasoning
        if (typeof th === 'string') reasoning += th
      } catch {
        /* a keep-alive or a broken line */
      }
    }
    // About 12 updates a second at most.
    const part = partialReply(text)
    if (part != null && part !== sent && Date.now() - at > 80) {
      sent = part
      at = Date.now()
      try {
        onDelta(part)
      } catch {
        /* the listener's problem */
      }
    }
    if (done) break
  }
  return { text, usage, model, reasoning }
}

/** Hands a thinking model's reasoning to the caller (Ben's chat shows a short summary of it). */
function giveReasoning(opts, reasoning) {
  if (typeof opts.onReasoning !== 'function' || typeof reasoning !== 'string' || !reasoning.trim()) return
  try {
    opts.onReasoning(reasoning.slice(0, 8000))
  } catch {
    /* the listener's problem */
  }
}

/** Usage rows still being written (the streamed chat): a function awaits flushUsage() before it ends. */
const usageWrites = new Set()
function laterUsage(p) {
  const q = Promise.resolve(p)
    .catch(() => null)
    .finally(() => usageWrites.delete(q))
  usageWrites.add(q)
}
export async function flushUsage() {
  while (usageWrites.size) await Promise.all([...usageWrites])
}

/** Our own time limit ran out: a plain, short error (not the browser's "The operation was aborted due to timeout"). */
function timedOut(e, model, timeout, opts) {
  // Past the request's deadline, no fallback is worth trying.
  if (opts.deadline && Date.now() >= opts.deadline - 3500) return new TimeUpError()
  if (!isTimeout(e)) return e
  return Object.assign(new Error(`${String(model).split('/').pop()} timed out after ${Math.round(timeout / 1000)} s`), { timeout: true })
}

async function callOpenRouter(key, model, prompt, fetchImpl, opts, timeout, effort = 'low') {
  const streaming = typeof opts.onDelta === 'function'
  // fastRoute (the one retry): any provider, the fastest first.
  const provider = opts.fastRoute ? { provider: { sort: 'latency' } } : /^deepseek\//.test(model) ? { provider: { order: ['deepseek'], allow_fallbacks: true } } : {}
  const r = await fetchImpl(`${OPENROUTER}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://mega-system-ten.vercel.app', 'X-Title': 'Life System' },
    // opts.think: big asks (plans, reviews, reshuffles) get the model's reasoning.
    body: JSON.stringify({ model, messages: messagesFor(prompt), ...provider, temperature: 0.6, max_tokens: opts.think ? 6000 : 2048, usage: { include: true }, ...(streaming ? { stream: true } : {}), ...(opts.json ? { response_format: { type: 'json_object' } } : {}), ...(opts.think ? { reasoning: { effort } } : {}) }),
    signal: AbortSignal.timeout(timeout)
  }).catch((e) => {
    throw timedOut(e, model, timeout, opts)
  })
  if (streaming && r.ok && r.body) {
    // The same time limit stops a stream that hangs half way: the same plain error.
    const s = await streamOpenRouter(r, opts.onDelta).catch((e) => {
      throw timedOut(e, model, timeout, opts)
    })
    const u = s.usage ?? {}
    // Speed: the app's chat doesn't wait for the usage row; /api/coach writes it before it ends (flushUsage).
    laterUsage(recordUsage({ model: s.model || model, kind: opts.kind || (opts.think ? 'deep' : 'chat'), prompt: u.prompt_tokens, completion: u.completion_tokens, cost: typeof u.cost === 'number' ? u.cost : null }, process.env, fetchImpl))
    if (!s.text) throw new Error('OpenRouter gave an empty answer')
    giveReasoning(opts, s.reasoning)
    return { text: s.text, model: s.model || model }
  }
  const j = await r.json().catch((e) => {
    if (isTimeout(e)) throw timedOut(e, model, timeout, opts)
    return {}
  })
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${j?.error?.message || 'request failed'}`)
  const text = j?.choices?.[0]?.message?.content
  const u = j?.usage ?? {}
  await recordUsage({ model: j?.model || model, kind: opts.kind || (opts.think ? 'deep' : 'chat'), prompt: u.prompt_tokens, completion: u.completion_tokens, cost: typeof u.cost === 'number' ? u.cost : null }, process.env, fetchImpl)
  if (!text) throw new Error('OpenRouter gave an empty answer')
  giveReasoning(opts, j?.choices?.[0]?.message?.reasoning)
  return { text: String(text), model: j?.model || model }
}

/**
 * The coach's model: OpenRouter (DeepSeek) first for text, Gemini for voice
 * notes and photos, and Gemini as the backup when OpenRouter fails.
 */
export async function askModel(prompt, opts = {}, env = process.env, fetchImpl = fetch) {
  opts = { ...opts, deadline: opts.deadline ?? deadlineIn() }
  const orKey = (env.OPENROUTER_API_KEY || '').trim()
  const gKey = (env.GEMINI_API_KEY || '').trim()
  if (orKey && !opts.media?.length) {
    try {
      return await askOpenRouter(orKey, prompt, fetchImpl, opts, env)
    } catch (e) {
      // noFallback: the caller (Ben's chat) retries with the quick model itself, faster than Gemini.
      if (!gKey || e.budget || e.timeUp || opts.noFallback) throw e
    }
  }
  if (!gKey) throw new Error('Add OPENROUTER_API_KEY or GEMINI_API_KEY in Vercel to use the AI coach')
  // The Gemini path keeps to the same budget (A7): extras stop when it's used up.
  budgetPlan((await budgetState(env, fetchImpl)).tier, opts)
  return askGemini(gKey, prompt, fetchImpl, opts)
}

export default async function handler(req, res) {
  await countCall(config(), 'ai') // CL2: counted for Settings → System health
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
    const newerOut = orKey ? await newerModels().catch(() => ({ chat: null, deep: null })) : { chat: null, deep: null }
    return send(res, 200, { configured: !!(key || orKey), model: orKey ? pick.chat || (await openRouterModel()) : key ? 'gemini' : null, strong: pick.deep || pick.chat || strong, chosen: pick, auto: { chat: orKey ? await openRouterModel() : null, deep: strong }, pinned: PINNED_MODELS, newer: newerOut })
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
  // QA4: just this month's spend and budget (the chat's budget chip; cheap: one cached read).
  if (body?.op === 'budget') return send(res, 200, { budget: await budgetState() })
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
  if (body?.op === 'foodPhoto') return send(res, 200, await foodPhoto(body))
  if (!key && !orKey) return send(res, 503, { error: 'Add OPENROUTER_API_KEY or GEMINI_API_KEY in Vercel to use AI on the website' })
  const prompt = String(body?.prompt || '').slice(0, 60_000)
  if (!prompt.trim()) return send(res, 400, { error: 'Empty prompt' })
  try {
    send(res, 200, await askModel(prompt))
  } catch (e) {
    send(res, 502, { error: e.message || 'Gemini failed' })
  }
}

/**
 * Food photo logging: the checked request, the monthly budget, 50 photos a day,
 * then the provider. Always 200 with {ok:false, error, fallback} when it can't
 * be done, so the page shows the message and the copy-prompt way. The photo is
 * not stored or logged.
 */
export async function foodPhoto(body, env = process.env, fetchImpl = fetch, now = new Date(), opts = {}) {
  const p = visionProvider(env)
  if (!p) return { ok: false, error: `Photo reading is not set up on the server (${trimmed(env.VISION_PROVIDER).toLowerCase() === 'claude' ? 'ANTHROPIC_API_KEY' : 'GEMINI_API_KEY'} is missing).`, fallback: FALLBACK }
  const req = readPhotoRequest(body)
  if (req.error) return { ok: false, error: req.error }
  if ((await budgetState(env, fetchImpl).catch(() => null))?.tier === 'minimal') return { ok: false, error: "This month's AI budget is used up, so photos can't be read now.", fallback: FALLBACK, limit: 'budget' }
  if (!testing(env)) {
    const cfg = config(env)
    let n
    try {
      // Each photo counts. `opts.counted` is only set in-process by the Telegram bot: photos of
      // this meal it already had read once ("Add another photo" reads them all again).
      const fresh = (req.images?.length ?? 1) - Math.max(0, Math.floor(Number(opts?.counted) || 0))
      n = await countPhoto(tursoRun(turso, cfg, fetchImpl), now, trimmed(env.LIFE_TZ), Math.max(1, fresh))
    } catch {
      return { ok: false, error: 'Database not reachable: try again in a moment.', fallback: FALLBACK }
    }
    if (overLimit(n)) return { ok: false, error: (req.images?.length ?? 1) > 1 ? "These photos would go over today's limit of 50 photos. It starts again tomorrow." : "You've read 50 photos today, the daily limit. It starts again tomorrow.", fallback: FALLBACK, limit: 'day' }
  }
  try {
    const out = await readFoodPhoto(p, req, { fetchImpl, env, record: (u) => recordUsage(u, env, fetchImpl) })
    // usage: each try's token counts and time (no photo, no key), for the cost meter and the second look.
    return { ok: true, result: out.json, model: out.model, usage: out.usage, second: out.second }
  } catch (e) {
    // Only the plain message: never the request (it holds the photo) or a key.
    return { ok: false, error: e?.timeUp ? e.message : "The photo couldn't be read right now. Try again in a moment.", fallback: FALLBACK }
  }
}
const trimmed = (v) => String(v ?? '').trim()

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
  const out = { today: null, week: null, month: null, byModel: [], byModelToday: [], byModelWeek: [], byKind: [], recent: [], credits: null }
  if (cfg.ok) {
    const day0 = new Date()
    day0.setHours(0, 0, 0, 0)
    const since = (d) => new Date(Date.now() - d * 86400_000).toISOString()
    const q = (sql, args = []) => ({ type: 'execute', stmt: { sql, args: args.map((a) => ({ type: 'text', value: a })) } })
    // A monthly roll-up row (LT8) stands for `calls` calls.
    const sum = 'SELECT COALESCE(SUM(COALESCE(calls, 1)),0), COALESCE(SUM(cost),0), COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0) FROM ai_usage WHERE at >= ?'
    const byModel = 'SELECT model, COALESCE(SUM(COALESCE(calls, 1)),0), COALESCE(SUM(cost),0), COALESCE(SUM(prompt_tokens),0) + COALESCE(SUM(completion_tokens),0) FROM ai_usage WHERE at >= ? GROUP BY model ORDER BY 3 DESC, 2 DESC LIMIT 8'
    const { json } = await turso(cfg, {
      requests: [
        { type: 'execute', stmt: { sql: USAGE_TABLE } },
        { type: 'execute', stmt: { sql: USAGE_CALLS_COLUMN } },
        q(sum, [day0.toISOString()]),
        q(sum, [since(7)]),
        q(sum, [since(30)]),
        q('SELECT model, COUNT(*), COALESCE(SUM(cost),0), COALESCE(SUM(prompt_tokens),0) + COALESCE(SUM(completion_tokens),0) FROM ai_usage WHERE at >= ? GROUP BY model ORDER BY 3 DESC, 2 DESC', [since(30)]),
        q('SELECT at, model, kind, prompt_tokens, completion_tokens, cost FROM ai_usage WHERE calls IS NULL ORDER BY id DESC LIMIT 60'),
        q("SELECT COALESCE(kind, 'chat'), COUNT(*), COALESCE(SUM(cost),0) FROM ai_usage WHERE at >= ? GROUP BY 1 ORDER BY 3 DESC, 2 DESC", [since(30)]),
        // The island's AI usage page: by model for today and for 7 days.
        q(byModel, [day0.toISOString()]),
        q(byModel, [since(7)]),
        { type: 'close' }
      ]
    }, fetchImpl).catch(() => ({ json: null }))
    // Shifted by one: the ALTER TABLE above is request 1.
    const rows = (i) => json?.results?.[i > 0 ? i + 1 : i]?.response?.result?.rows ?? []

    const v = (c) => (c == null || c.type === 'null' ? null : c.value)
    const tot = (i) => {
      const r = rows(i)[0]
      return r ? { calls: Number(v(r[0])), cost: Number(v(r[1])), tokens: Number(v(r[2])) + Number(v(r[3])) } : null
    }
    out.today = tot(1)
    out.week = tot(2)
    out.month = tot(3)
    out.byModel = rows(4).map((r) => ({ model: v(r[0]), calls: Number(v(r[1])), cost: Number(v(r[2])), tokens: Number(v(r[3])) }))
    const models = (i) => rows(i).map((r) => ({ model: v(r[0]), calls: Number(v(r[1])), cost: Number(v(r[2])), tokens: Number(v(r[3])) }))
    out.byModelToday = models(7)
    out.byModelWeek = models(8)
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
