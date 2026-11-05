// Running for months untouched ("a castle"): the daily self-check fixes and
// tells once (CL3), the second alarm (CL4), the server's call counter (CL2),
// and a server soak: a day of ticks (every 10 minutes) on a fake Turso and a
// fake Telegram, with the tables staying small.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '../core/schema'
import { healthChecks } from '../core/health'
import { webhookVerdict } from '../core/selfCheck'
import { handlePipeline } from '../renderer/src/web/fakeTurso'
import { readHealth } from '../renderer/src/web/systemHealth'
import { TursoHttp } from '../renderer/src/web/tursoHttp'
import { runSelfCheck } from './selfCheck'
import { healthAlarm, runTick } from './telegramBot'
// @ts-expect-error plain JS server helpers
import { checkWebhooks, countCall } from '../../api/_lib.mjs'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const TOKEN = '777:test-token'
const CHAT = '42'
let n = 0
function world() {
  const remote: SqlJsDatabase = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  const sent: { method: string; body: any }[] = []
  const hook = { url: '', allowed_updates: [] as string[], pending_update_count: 0 }
  const fake = async (url: string, init: { body?: string } = {}) => {
    const u = String(url)
    if (u.includes('api.telegram.org')) {
      const method = u.split('/').pop() ?? ''
      const body = init.body ? JSON.parse(init.body) : null
      sent.push({ method, body })
      if (method === 'setWebhook') Object.assign(hook, { url: body.url, allowed_updates: body.allowed_updates })
      const result = method === 'getWebhookInfo' ? hook : { message_id: sent.length, chat: { id: Number(CHAT) } }
      const json = { ok: true, result }
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    }
    const json = handlePipeline(remote, JSON.parse(String(init.body)))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  }
  vi.stubGlobal('fetch', fake)
  const url = `https://castle${++n}.fake.turso.io`
  const env = { tursoUrl: url, tursoToken: 'k', timeZone: 'UTC', defaults: { chatId: CHAT, megaBotToken: TOKEN, botToken: TOKEN } }
  const q = (sql: string) => remote.exec(sql)[0]?.values ?? []
  return { remote, sent, env, q, hook, fake, cfg: { url, token: 'k', ok: true, secret: 's' } }
}
const texts = (sent: { method: string; body: any }[]) => sent.filter((s) => s.method === 'sendMessage').map((s) => String(s.body?.text ?? ''))

describe('the daily self-check (CL3)', () => {
  it('puts a wrong Telegram link right, saves the answers and tells you about problems once', async () => {
    const { env, sent, hook, fake, cfg } = world()
    const now = new Date('2026-11-05T09:00:00Z')
    const bots = [{ name: 'MEGA_BOT_TOKEN', id: '777', token: TOKEN }]
    const deps = {
      tursoUrl: env.tursoUrl,
      tursoToken: env.tursoToken,
      now,
      webhooks: () => checkWebhooks(cfg, 'life.example', webhookVerdict, { bots, fetchImpl: fake, now }),
      ai: async () => ({ ok: false, error: 'timed out' }),
      budget: async () => ({ spent: 9, budget: 10 }),
      send: async (text: string) => void sent.push({ method: 'sendMessage', body: { text } })
    }
    const r = await runSelfCheck(deps)
    expect(hook.url).toBe('https://life.example/api/telegram?bot=777')
    expect(r.checks.find((c) => c.id === 'sc:bot:MEGA_BOT_TOKEN')).toMatchObject({ ok: true, detail: expect.stringMatching(/set again/) })
    expect(r.warned).toEqual(expect.arrayContaining(['sc:ai', 'sc:budget', 'sc:snapshot']))
    expect(texts(sent).filter((t) => /needs a look/.test(t))).toHaveLength(1)
    // Settings → System health shows it.
    const h = await readHealth(new TursoHttp(env.tursoUrl, env.tursoToken))
    const shown = healthChecks({ now, beats: h.beats, sportySeen: null, latestSnapshot: null, today: '2026-11-05', errors: [], notes: h.notes })
    expect(shown.find((c) => c.id === 'selfcheck')).toMatchObject({ ok: true, detail: expect.stringMatching(/need a look/) })
    expect(shown.find((c) => c.id === 'sc:ai')?.ok).toBe(false)
    // The next day, the same problems: nothing new is sent (the link stays right, no new setWebhook).
    sent.length = 0
    await runSelfCheck({ ...deps, now: new Date(now.getTime() + 86400_000) })
    expect(texts(sent)).toEqual([])
    expect(sent.filter((s) => s.method === 'setWebhook')).toHaveLength(0)
  }, 30_000)
})

describe('the second alarm (CL4)', () => {
  it("the daily crons warn when Ben's tick has gone quiet, once", async () => {
    const { env, sent, q } = world()
    const now = new Date('2026-11-05T12:00:00Z')
    q(`CREATE TABLE IF NOT EXISTS sys_health (key TEXT PRIMARY KEY, at TEXT NOT NULL, msg TEXT)`)
    q(`INSERT INTO sys_health (key, at, msg) VALUES ('tick:ok', '2026-11-05T09:00:00.000Z', NULL)`)
    const h = await healthAlarm({ ...env, botToken: TOKEN, chatId: CHAT }, now)
    expect(h?.ok).toBe(false)
    expect(h?.broken).toContain('tick')
    expect(texts(sent).filter((t) => /Ben's server/.test(t))).toHaveLength(1)
    await healthAlarm({ ...env, botToken: TOKEN, chatId: CHAT }, new Date(now.getTime() + 6 * 3600_000))
    expect(texts(sent).filter((t) => /Ben's server/.test(t))).toHaveLength(1)
  }, 30_000)
})

describe('counting server calls (CL2)', () => {
  it('adds up in memory and writes now and then, never once per call', async () => {
    const { q, fake, cfg } = world()
    let writes = 0
    const counting = (async (u: string, init: any) => {
      writes++
      return fake(u, init)
    }) as any
    const t0 = Date.parse('2026-11-05T10:00:00Z')
    for (let i = 0; i < 60; i++) await countCall(cfg, i % 3 ? 'db' : 'google', 10, counting, t0 + i * 1000)
    expect(writes).toBe(2)
    const note = JSON.parse(String(q("SELECT msg FROM sys_health WHERE key = 'note:calls:2026-11'")[0][0]))
    expect(note.total).toBe(50)
    expect(note.db + note.google).toBe(50)
    expect(note.rows).toBe(500)
    const c = healthChecks({ now: new Date(t0), beats: {}, sportySeen: null, latestSnapshot: null, today: '2026-11-05', errors: [], notes: { 'calls:2026-11': note } }).find((x) => x.id === 'apiCalls')!
    expect(c.detail).toMatch(/^This month: 50 \(about 0 an hour: db \d+, google \d+\), 500 database rows read$/)
  })
})

describe('server soak: a day of ticks', () => {
  it('144 ticks (every 10 minutes) keep the tables small and send a normal day of messages', async () => {
    const { env, q, sent } = world()
    vi.useFakeTimers({ toFake: ['Date'] })
    const start = new Date('2026-11-05T00:05:00Z').getTime()
    const counts = () => Object.fromEntries(['settings', 'sys_ben_log', 'sys_error_log', 'sys_health', 'sys_kv', 'notifications', 'cloud_snapshots'].map((t) => [t, Number(q(`SELECT COUNT(*) FROM ${t}`)[0]?.[0] ?? 0)]))
    let mid: Record<string, number> = {}
    for (let i = 0; i < 144; i++) {
      const at = new Date(start + i * 10 * 60_000)
      vi.setSystemTime(at)
      await runTick({ ...env, botToken: TOKEN, chatId: CHAT, timer: true }, at)
      if (i === 72) mid = counts()
    }
    const end = counts()
    // Grows by at most a little in the second half of the day (no table grows with every tick).
    // Messages and their log are kept to a fixed number; the rest hardly grow at all.
    const capped: Record<string, number> = { notifications: 200, sys_ben_log: 400, sys_error_log: 500 }
    for (const [t, v] of Object.entries(end)) {
      if (capped[t]) expect(v, t).toBeLessThanOrEqual(capped[t])
      else expect(v - (mid[t] ?? 0), t).toBeLessThanOrEqual(6)
    }
    expect(Number(q("SELECT COUNT(*) FROM sys_health WHERE key = 'tick:ok'")[0][0])).toBe(1)
    expect(end.cloud_snapshots).toBe(1)
    const msgs = texts(sent)
    // A normal day of messages (the plan, check-ins, a few spaced nudges, the review), not a flood.
    expect(msgs.length).toBeGreaterThan(3)
    expect(msgs.length).toBeLessThan(30)
    expect(msgs.filter((m) => /Your day/.test(m))).toHaveLength(1)
    const coachLog = JSON.parse(String(q("SELECT value FROM settings WHERE key = 'coach_log'")[0]?.[0] ?? '[]'))
    expect(coachLog.length).toBeLessThan(400)
  }, 120_000)
})
