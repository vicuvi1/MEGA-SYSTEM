// GET /api/cron?job=morning|midday|evening|night: the daily bot messages (Vercel runs
// them on the schedule in vercel.json and signs them with CRON_SECRET).
// Morning: your plan question and the coach if something slipped. Midday: a
// nudge when there's been no focus yet. Evening: the review, Sundays the week.
// Night: the wind-down before bedtime, only while wake-ups are slipping.
// LT2: the tick sends these too, by YOUR local time (src/core/dailyClock.ts);
// these UTC crons are the backup. Both claim the same `daily:<job>` slot.
// GET /api/cron?job=backup (CRON_SECRET): the newest daily backup as gzip, for
// the weekly encrypted off-site copy (.github/workflows/backup.yml, LT1).
import { bearer, bearerIs, botDefaults, config, cronSecretOk, gate, send, serverBots, sessionOk } from './_lib.mjs'
import { DAILY_GAP_MS, dailyDue, dailyGate, healthPush, localMinute, runDaily, runPlugins, runTick, sportShared } from './_bot/bot.mjs'
import { dropHealthKey, healthKeyOk, listHealthKeys, newHealthKey } from './_health.mjs'
import { readBody } from './_lib.mjs'
import { askModel, rollupUsage } from './ai.mjs'
import { googleEnv } from './google.mjs'
import { pushNew } from './_push.mjs'
import { newestSnapshot } from './_snapshots.mjs'

const appUrl = () => process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
const sleepBotOf = () => serverBots().find((b) => b.name === 'WAKY_BOT_TOKEN') ?? serverBots().find((b) => b.name === 'MAN_BOT_TOKEN')
/** What runDaily needs (the same from the Vercel cron and from the tick). */
function dailyEnv(cfg, bot, chatId) {
  // The coach speaks in its own words when an AI key is set up.
  const ai = (process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY || '').trim() ? async (prompt, opts) => (await askModel(prompt, opts)).text : undefined
  return { tursoUrl: cfg.url, tursoToken: cfg.token, defaults: botDefaults(), timeZone: process.env.LIFE_TZ, todoistToken: process.env.TODOIST_TOKEN, google: googleEnv(cfg), botToken: bot.token, chatId, ai, sleepBotToken: sleepBotOf()?.token, appUrl: appUrl() }
}

export default async function handler(req, res) {
  // job=tick: the coach writes first (reminders, check-ins, block starts,
  // follow-ups). Woken every ~10 min by a GitHub Actions timer and every 2 min
  // by the open app. No secret needed: it runs at most once a minute and only
  // sends what is due, each thing once.
  if (new URL(req.url, 'http://x').searchParams.get('job') === 'tick') return tick(req, res)
  // job=sport: Sporty (the Python bot) reads and writes water and workouts here.
  if (new URL(req.url, 'http://x').searchParams.get('job') === 'sport') return sport(req, res)
  // job=health: your phone sends weight, steps and sleep (a key made in Settings → Plugins).
  if (new URL(req.url, 'http://x').searchParams.get('job') === 'health') return health(req, res)
  // job=plugins: "Refresh now" in Settings → Plugins (signed in).
  if (new URL(req.url, 'http://x').searchParams.get('job') === 'plugins') return plugins(req, res)
  const secret = process.env.CRON_SECRET || ''
  if (!secret || !cronSecretOk(req)) return send(res, 401, { error: 'Not allowed' })
  const job = new URL(req.url, 'http://x').searchParams.get('job')
  if (job === 'backup') return backup(res)
  if (!['morning', 'reask', 'midday', 'evening', 'night'].includes(job)) return send(res, 400, { error: 'job=morning|reask|midday|evening|night' })
  const cfg = config()
  const bot = serverBots().find((b) => b.name === 'MEGA_BOT_TOKEN') ?? serverBots()[0]
  const chatId = process.env.TELEGRAM_CHAT_ID || ''
  if (!cfg.ok || !bot || !chatId) return send(res, 200, { ok: false, reason: 'No bot or chat set up' })
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
  const cfg = config()
  const bot = serverBots().find((b) => b.name === 'MEGA_BOT_TOKEN') ?? serverBots()[0]
  const chatId = process.env.TELEGRAM_CHAT_ID || ''
  if (!cfg.ok || !bot || !chatId) return send(res, 200, { ok: false, reason: 'No bot or chat set up' })
  // The app (a session) and the GitHub timer (CRON_SECRET) may wake Ben once a
  // minute; anyone else at most once every 4.5 minutes. One atomic slot in
  // Turso, so two server copies never run the tick at the same time.
  const timer = cronSecretOk(req) || /^(github|pinger)$/.test(String(req.headers?.['x-life-timer'] || ''))
  let trusted = cronSecretOk(req)
  if (!trusted) trusted = await sessionOk(cfg, bearer(req)).catch(() => false)
  try {
    if (!(await gate(cfg, 'tick', trusted ? 50_000 : 270_000))) return send(res, 200, { ok: true, skipped: true })
  } catch (e) {
    return send(res, 503, { error: e.message || 'Database not reachable' })
  }
  try {
    // The model plans the day and writes the reviews (the daily rhythm); plain text without one.
    const hasAi = (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || '').trim()
    const model = hasAi ? async (prompt, opts) => (await askModel(prompt, opts)).text : undefined
    const sent = await runTick({ tursoUrl: cfg.url, tursoToken: cfg.token, defaults: botDefaults(), timeZone: process.env.LIFE_TZ, todoistToken: process.env.TODOIST_TOKEN, google: googleEnv(cfg), botToken: bot.token, chatId, model, sleepBotToken: sleepBotOf()?.token, timer })
    // Phones with push on (N11): woken for anything new and unread.
    await pushNew(cfg).catch((e) => console.error('push:', e))
    // LT2: the daily messages whose LOCAL time has come, each once a day (same slot as the Vercel cron).
    const daily = []
    for (const job of dailyDue(localMinute(new Date(), process.env.LIFE_TZ || 'Europe/Chisinau'))) {
      if (!(await gate(cfg, dailyGate(job), DAILY_GAP_MS).catch(() => false))) continue
      daily.push(...(await runDaily(dailyEnv(cfg, bot, chatId), job).catch((e) => (console.error(`daily ${job}:`, e), []))))
    }
    // LT8: AI usage older than 90 days becomes one row per month (once a day).
    if (await gate(cfg, 'ai-usage-rollup', 24 * 3600_000).catch(() => false)) await rollupUsage().catch((e) => console.error('usage rollup:', e))
    send(res, 200, { ok: true, sent: sent.length + daily.length })
  } catch (e) {
    console.error('tick:', e)
    send(res, 500, { error: e.message || 'failed' })
  }
}

/** The newest daily backup, gzipped (the backup workflow encrypts it before storing it). */
async function backup(res) {
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up' })
  try {
    const snap = await newestSnapshot(cfg)
    if (!snap) return send(res, 404, { error: 'No backup yet' })
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/gzip')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Snapshot-Day', snap.day)
    res.end(snap.gz)
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
      if (!(await sessionOk(cfg, bearer(req)).catch(() => false))) return send(res, 401, { error: 'Sign in first' })
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

async function plugins(req, res) {
  const cfg = config()
  if (!cfg.ok) return send(res, 503, { error: 'Server not set up' })
  if (!(await sessionOk(cfg, bearer(req)).catch(() => false))) return send(res, 401, { error: 'Sign in first' })
  try {
    if (!(await gate(cfg, 'plugins-now', 20_000))) return send(res, 429, { error: 'Just refreshed: try again in a moment' })
    const hasAi = (process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || '').trim()
    const model = hasAi ? async (prompt, opts) => (await askModel(prompt, opts)).text : undefined
    const only = new URL(req.url, 'http://x').searchParams.get('only') || undefined
    send(res, 200, await runPlugins({ ...botEnv(cfg), google: googleEnv(cfg), model }, { only }))
  } catch (e) {
    console.error('plugins:', e)
    send(res, 500, { error: e.message || 'failed' })
  }
}
