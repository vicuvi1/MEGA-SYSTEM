// GET /api/cron?job=morning|midday|evening|night: the daily bot messages (Vercel runs
// them on the schedule in vercel.json and signs them with CRON_SECRET).
// Morning: your plan question and the coach if something slipped. Midday: a
// nudge when there's been no focus yet. Evening: the review, Sundays the week.
// Night: the wind-down before bedtime, only while wake-ups are slipping.
// LT2: the tick sends these too, by YOUR local time (src/core/dailyClock.ts);
// these UTC crons are the backup. Both claim the same `daily:<job>` slot.
// GET /api/cron?job=backup (CRON_SECRET): the newest daily backup for the weekly
// encrypted off-site copy (.github/workflows/backup.yml, LT1): `&list=1` its day
// and parts, `&day=D&part=N` one part's gzip bytes (joined, the parts are one
// gzip file), no extra: the whole gzip when it fits one answer.
// POST /api/cron?job=offsite (CRON_SECRET): the workflow says the copy is kept
// (Settings → Data safety shows when).
import { bearer, bearerIs, botDefaults, checkWebhooks, clientIp, config, countCall, cronSecretOk, gate, requireSession, run, send, serverBots } from './_lib.mjs'
import { DAILY_GAP_MS, dailyDue, dailyGate, healthAlarm, healthPush, localMinute, phonePay, runDaily, runPlugins, runTick, selfCheck, sportShared, tickHealth, webhookVerdict } from './_bot/bot.mjs'
import { dropHealthKey, healthKeyOk, listHealthKeys, newHealthKey, payRequest, readCapped } from './_health.mjs'
import { readBody } from './_lib.mjs'
import { deadlineIn, modelUntil, pingModel, rollupUsage } from './ai.mjs'
import { googleEnv } from './google.mjs'
import { pushNew } from './_push.mjs'
import { newestSnapshot, newestSnapshotInfo, snapshotPart } from './_snapshots.mjs'

const appUrl = () => process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
const sleepBotOf = () => serverBots().find((b) => b.name === 'WAKY_BOT_TOKEN') ?? serverBots().find((b) => b.name === 'MAN_BOT_TOKEN')
/** What runDaily needs (the same from the Vercel cron and from the tick). */
function dailyEnv(cfg, bot, chatId, deadline = deadlineIn()) {
  // The coach speaks in its own words when an AI key is set up.
  const ai = (process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY || '').trim() ? modelUntil(deadline) : undefined
  return { tursoUrl: cfg.url, tursoToken: cfg.token, defaults: botDefaults(), timeZone: process.env.LIFE_TZ, todoistToken: process.env.TODOIST_TOKEN, google: googleEnv(cfg), botToken: bot.token, chatId, ai, sleepBotToken: sleepBotOf()?.token, appUrl: appUrl() }
}

/**
 * CL3: the daily self-check, once a day (the "selfcheck" slot), from Ben's tick
 * or, if the tick has stopped, from a daily Vercel cron. Never throws.
 */
async function dailySelfCheck(req, cfg, bot, chatId) {
  try {
    if (!(await gate(cfg, 'selfcheck', 23 * 3600_000))) return null
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || req.headers?.['x-forwarded-host'] || req.headers?.host
    const live = !process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'production'
    let ping = null
    const aiPing = async () => (ping ??= await pingModel()).ai
    const r = await selfCheck(dailyEnv(cfg, bot, chatId), {
      webhooks: host ? () => checkWebhooks(cfg, host, webhookVerdict, { fix: live }) : undefined,
      ai: aiPing,
      budget: async () => (ping ??= await pingModel()).budget
    })
    return r
  } catch (e) {
    console.error('self-check:', e)
    return null
  }
}

export default async function handler(req, res) {
  // CL2: every call is counted (Settings → System health shows the month's total).
  await countCall(config(), `cron${new URL(req.url, 'http://x').searchParams.get('job') || ''}`)
  // job=tick: the coach writes first (reminders, check-ins, block starts,
  // follow-ups). Woken every ~10 min by a GitHub Actions timer or a pinger
  // (CRON_SECRET) and every 2 min by the open app (its session). Nobody else.
  if (new URL(req.url, 'http://x').searchParams.get('job') === 'tick') return tick(req, res)
  // job=sport: Sporty (the Python bot) reads and writes water and workouts here.
  if (new URL(req.url, 'http://x').searchParams.get('job') === 'sport') return sport(req, res)
  // job=health: your phone sends weight, steps and sleep (a key made in Settings → Plugins).
  if (new URL(req.url, 'http://x').searchParams.get('job') === 'health') return health(req, res)
  // job=pay: your phone sends each payment notification (MacroDroid, a key made in Settings → Phone payments).
  if (new URL(req.url, 'http://x').searchParams.get('job') === 'pay') return pay(req, res)
  // job=plugins: "Refresh now" in Settings → Plugins (signed in).
  if (new URL(req.url, 'http://x').searchParams.get('job') === 'plugins') return plugins(req, res)
  const secret = process.env.CRON_SECRET || ''
  if (!secret || !cronSecretOk(req)) return send(res, 401, { error: 'Not allowed' })
  const job = new URL(req.url, 'http://x').searchParams.get('job')
  if (job === 'backup') return backup(req, res)
  if (job === 'offsite') return offsite(req, res)
  if (!['morning', 'reask', 'midday', 'evening', 'night'].includes(job)) return send(res, 400, { error: 'job=morning|reask|midday|evening|night' })
  const cfg = config()
  const bot = serverBots().find((b) => b.name === 'MEGA_BOT_TOKEN') ?? serverBots()[0]
  const chatId = process.env.TELEGRAM_CHAT_ID || ''
  if (!cfg.ok || !bot || !chatId) return send(res, 200, { ok: false, reason: 'No bot or chat set up' })
  // CL4: the second alarm: if Ben's tick has gone quiet, these daily crons still warn you,
  // and run the self-check if the tick couldn't (CL3).
  await healthAlarm(dailyEnv(cfg, bot, chatId)).catch((e) => console.error('health alarm:', e))
  await dailySelfCheck(req, cfg, bot, chatId)
  // BG16: each daily job runs once a day, even if Vercel calls it twice (or the tick sent it already).
  try {
    if (!(await gate(cfg, dailyGate(job), DAILY_GAP_MS))) return send(res, 200, { ok: true, skipped: true })
  } catch (e) {
    return send(res, 503, { error: e.message || 'Database not reachable' })
  }
  try {
    const sent = await runDaily(dailyEnv(cfg, bot, chatId), job)
    send(res, 200, { ok: true, sent })
  } catch (e) {
    console.error('cron:', e)
    send(res, 500, { error: e.message || 'failed' })
  }
}

async function tick(req, res) {
  // One time limit for every AI answer in this run (the function stops at 60 s).
  const deadline = deadlineIn()
  const cfg = config()
  const bot = serverBots().find((b) => b.name === 'MEGA_BOT_TOKEN') ?? serverBots()[0]
  const chatId = process.env.TELEGRAM_CHAT_ID || ''
  if (!cfg.ok || !bot || !chatId) return send(res, 200, { ok: false, reason: 'No bot or chat set up' })
  // Only the app (a session) and the timers (CRON_SECRET) may wake Ben, once a
  // minute. A database hiccup while checking the session is a 503 (never a
  // sign-out). The X-Life-Timer header alone proves nothing. One atomic slot
  // in Turso, so two server copies never run the tick at the same time.
  const timer = cronSecretOk(req)
  if (!timer && !(await requireSession(res, cfg, bearer(req)))) return
  try {
    if (!(await gate(cfg, 'tick', 50_000))) return send(res, 200, { ok: true, skipped: true })
  } catch (e) {
    return send(res, 503, { error: e.message || 'Database not reachable' })
  }
  try {
    // The model plans the day and writes the reviews (the daily rhythm); plain text without one.
    const hasAi = (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || '').trim()
    const model = hasAi ? modelUntil(deadline) : undefined
    const sent = await runTick({ tursoUrl: cfg.url, tursoToken: cfg.token, defaults: botDefaults(), timeZone: process.env.LIFE_TZ, todoistToken: process.env.TODOIST_TOKEN, google: googleEnv(cfg), botToken: bot.token, chatId, model, sleepBotToken: sleepBotOf()?.token, timer })
    // Phones with push on (N11): woken for anything new and unread.
    await pushNew(cfg).catch((e) => console.error('push:', e))
    // LT2: the daily messages whose LOCAL time has come, each once a day (same slot as the Vercel cron).
    const daily = []
    for (const job of dailyDue(localMinute(new Date(), process.env.LIFE_TZ || 'Europe/Chisinau'))) {
      if (!(await gate(cfg, dailyGate(job), DAILY_GAP_MS).catch(() => false))) continue
      daily.push(...(await runDaily(dailyEnv(cfg, bot, chatId, deadline), job).catch((e) => (console.error(`daily ${job}:`, e), []))))
    }
    // LT8: AI usage older than 90 days becomes one row per month (once a day).
    if (await gate(cfg, 'ai-usage-rollup', 24 * 3600_000).catch(() => false)) await rollupUsage().catch((e) => console.error('usage rollup:', e))
    // CL3: once a day, check every part and fix what can be fixed.
    await dailySelfCheck(req, cfg, bot, chatId)
    // CL4: health:false (something broken 30+ minutes) makes the GitHub timer's run fail, so GitHub emails you.
    const h = tickHealth()
    send(res, 200, { ok: true, sent: sent.length + daily.length, ...(h ? { health: h.ok, broken: h.broken } : {}) })
  } catch (e) {
    console.error('tick:', e)
    send(res, 500, { error: e.message || 'failed' })
  }
}

/** One answer may carry at most 4.5 MB: a bigger backup is fetched part by part. */
const ONE_ANSWER = 4_300_000

/**
 * The newest daily backup (the backup workflow encrypts it before storing it):
 * `list=1` its day, size and parts with their SHA-256; `day&part` one part's
 * gzip bytes; nothing: the whole gzip when it fits one answer.
 */
async function backup(req, res) {
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up' })
  const q = new URL(req.url, 'http://x').searchParams
  try {
    if (q.get('list')) {
      const info = await newestSnapshotInfo(cfg)
      return info ? send(res, 200, info) : send(res, 404, { error: 'No backup yet' })
    }
    const gzip = (day, bytes) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/gzip')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Snapshot-Day', day)
      res.end(bytes)
    }
    if (q.get('part') != null) {
      const day = String(q.get('day') || '')
      const part = Number(q.get('part'))
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(part)) return send(res, 400, { error: 'day=YYYY-MM-DD&part=N' })
      const bytes = await snapshotPart(cfg, day, part)
      return bytes ? gzip(day, bytes) : send(res, 404, { error: 'No such part' })
    }
    const info = await newestSnapshotInfo(cfg)
    if (!info) return send(res, 404, { error: 'No backup yet' })
    if (info.bytes > ONE_ANSWER) return send(res, 413, { error: 'The backup is bigger than one answer: fetch it with list=1, then each part', parts: info.parts })
    const snap = await newestSnapshot(cfg)
    if (!snap) return send(res, 404, { error: 'No backup yet' })
    gzip(snap.day, snap.gz)
  } catch (e) {
    send(res, 503, { error: e.message || 'Database not reachable' })
  }
}

/** The off-site workflow kept an encrypted copy (POST {day, bytes}) or failed ({error}): Settings → Data safety shows it. */
async function offsite(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up' })
  try {
    const body = (await readBody(req)) || {}
    const now = new Date().toISOString()
    const ok = !body.error && /^\d{4}-\d{2}-\d{2}$/.test(String(body.day || ''))
    const msg = ok ? JSON.stringify({ day: String(body.day), bytes: Number(body.bytes) || 0 }) : String(body.error || 'The off-site copy failed').slice(0, 300)
    await run(cfg, [
      ['CREATE TABLE IF NOT EXISTS sys_health (key TEXT PRIMARY KEY, at TEXT NOT NULL, msg TEXT)'],
      ['INSERT INTO sys_health (key, at, msg) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, msg = excluded.msg', [ok ? 'offsite:ok' : 'offsite:err', now, msg]],
      ...(ok ? [['INSERT INTO sys_health (key, at, msg) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, msg = excluded.msg', ['note:offsite', now, msg]]] : [])
    ])
    send(res, 200, { ok: true })
  } catch (e) {
    send(res, 503, { error: e.message || 'Database not reachable' })
  }
}

async function sport(req, res) {

  if (!bearerIs(req, process.env.SPORT_SYNC_KEY)) return send(res, 401, { error: 'Not allowed' })
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up' })
  let body = {}
  try {
    body = req.method === 'POST' ? await readBody(req) : { op: 'state' }
  } catch {
    return send(res, 400, { error: 'Bad request' })
  }
  try {
    const r = await sportShared({ tursoUrl: cfg.url, tursoToken: cfg.token, defaults: botDefaults(), timeZone: process.env.LIFE_TZ }, body)
    send(res, r.ok ? 200 : 400, r)
  } catch (e) {
    console.error('sport:', e)
    send(res, 500, { error: e.message || 'failed' })
  }
}

const botEnv = (cfg) => ({ tursoUrl: cfg.url, tursoToken: cfg.token, defaults: botDefaults(), timeZone: process.env.LIFE_TZ })

// POST /api/cron?job=health
//   Authorization: Bearer <phone key>, {weight?, steps?, sleepHours?, day?} → saved
//   Signed in (the app): {op:'list'} · {op:'new', label} → {key} once · {op:'drop', id}
async function health(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up' })
  let body = {}
  try {
    body = (await readBody(req)) || {}
  } catch {
    return send(res, 400, { error: 'Bad JSON' })
  }
  try {
    if (body.op) {
      if (!(await requireSession(res, cfg, bearer(req)))) return
      if (body.op === 'new') return send(res, 200, await newHealthKey(cfg, body.label))
      if (body.op === 'drop') await dropHealthKey(cfg, body.id)
      return send(res, 200, { keys: await listHealthKeys(cfg) })
    }
    if (!(await healthKeyOk(cfg, bearer(req)))) return send(res, 401, { error: 'Not allowed: make a key in Settings → Plugins → Phone health numbers' })
    const r = await healthPush(botEnv(cfg), body)
    send(res, r.ok ? 200 : 400, r)
  } catch (e) {
    console.error('health:', e)
    send(res, 503, { error: e.message || 'Database not reachable' })
  }
}

// POST /api/cron?job=pay (Phone payments, docs/phone-payments.md)
//   Authorization: Bearer <payment key>, {app, title, text, time} → kept in money_tosort to sort
//   Signed in (the app): {op:'list'} · {op:'new', label} → {key} once · {op:'drop', id} · {op:'test'}
// Size- and rate-limited; 401 without a valid key; 503 on a database hiccup; never echoes the key or the text.
async function pay(req, res) {
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up' })
  let body = { size: 0, raw: '' }
  try {
    body = await readCapped(req)
  } catch {
    return send(res, 400, { error: 'Could not read the request' })
  }
  const [status, out] = await payRequest({ cfg, method: req.method, token: bearer(req), ip: clientIp(req), size: body.size, raw: body.raw, capture: (input) => phonePay(botEnv(cfg), input) })
  send(res, status, out)
}

async function plugins(req, res) {
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up' })
  if (!(await requireSession(res, cfg, bearer(req)))) return
  try {
    if (!(await gate(cfg, 'plugins-now', 20_000))) return send(res, 429, { error: 'Just refreshed: try again in a moment' })
    const hasAi = (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || '').trim()
    const model = hasAi ? modelUntil(deadlineIn()) : undefined
    const only = new URL(req.url, 'http://x').searchParams.get('only') || undefined
    send(res, 200, await runPlugins({ ...botEnv(cfg), google: googleEnv(cfg), model }, { only }))
  } catch (e) {
    console.error('plugins:', e)
    send(res, 500, { error: e.message || 'failed' })
  }
}
