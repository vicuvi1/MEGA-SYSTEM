// Ben 2 on the server's tick (fake Turso, fake Telegram, made-up data): the
// morning brief goes to Telegram at the wake time only while you're away from
// the PC, once, with "Plan my day"; the evening shutdown before bed; a drift
// word the island handed over goes out once.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '../core/schema'
import { handlePipeline } from '../renderer/src/web/fakeTurso'
import { runTick } from './telegramBot'

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
function world(settings: Record<string, unknown>) {
  const remote: SqlJsDatabase = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  for (const [k, v] of Object.entries(settings)) remote.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, typeof v === 'string' ? v : JSON.stringify(v)])
  const sent: { method: string; body: any }[] = []
  vi.stubGlobal('fetch', async (url: string, init: { body?: string } = {}) => {
    const u = String(url)
    if (u.includes('api.telegram.org')) {
      sent.push({ method: u.split('/').pop() ?? '', body: init.body ? JSON.parse(init.body) : null })
      const json = { ok: true, result: { message_id: sent.length, chat: { id: Number(CHAT) } } }
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    }
    const json = handlePipeline(remote, JSON.parse(String(init.body)))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  const env = { tursoUrl: `https://pushes${++n}.fake.turso.io`, tursoToken: 'k', timeZone: 'UTC', botToken: TOKEN, chatId: CHAT, defaults: { chatId: CHAT, megaBotToken: TOKEN, botToken: TOKEN } }
  const setting = (k: string) => JSON.parse(String(remote.exec(`SELECT value FROM settings WHERE key = '${k}'`)[0]?.values[0]?.[0] ?? 'null'))
  return { env, sent, setting }
}
const msgs = (sent: { method: string; body: any }[]) => sent.filter((s) => s.method === 'sendMessage').map((s) => s.body)
const at = (iso: string) => {
  const d = new Date(iso)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(d)
  return d
}
// The rhythm off: only Ben 2's pushes speak (no morning plan, no water nudges).
const base = { coach_rhythm_prefs: { on: false }, sleep_weekday_target: '06:30', sleep_weekend_target: '06:30', sleep_bed_target: '23:30', life_fit: { push: 'firm' } }

describe('Ben 2 on the tick', () => {
  it('sends the morning brief at the wake time when the PC is away, once', async () => {
    const w = world(base)
    await runTick(w.env as any, at('2030-03-12T06:20:00'))
    expect(msgs(w.sent).filter((m) => /Water goal/.test(m.text))).toHaveLength(0)
    await runTick(w.env as any, at('2030-03-12T06:31:00'))
    const brief = msgs(w.sent).filter((m) => /Water goal/.test(m.text))
    expect(brief).toHaveLength(1)
    expect(brief[0].text).toMatch(/No must-dos yet/)
    expect(brief[0].reply_markup.inline_keyboard[0][0]).toEqual({ text: '🗓 Plan my day', callback_data: 'bp|p|brief:2030-03-12' })
    // The Coach page gets it as a card (the push rides on Ben's log entry).
    const log = w.setting('coach_log') as any[]
    expect(log.some((e) => e.push?.type === 'brief')).toBe(true)
    await runTick(w.env as any, at('2030-03-12T06:45:00'))
    expect(msgs(w.sent).filter((m) => /Water goal/.test(m.text))).toHaveLength(1)
  })

  it('stays off Telegram while you are at the PC (the island shows it)', async () => {
    const w = world({ ...base, ben_pc_seen: { at: new Date('2030-03-12T06:29:00').getTime(), active: true } })
    await runTick(w.env as any, at('2030-03-12T06:31:00'))
    expect(msgs(w.sent).filter((m) => /Water goal/.test(m.text))).toHaveLength(0)
  })

  it('skips the brief on a day off', async () => {
    const w = world({ ...base, life_fit: { push: 'firm', pushes: { offDays: [2] } } })
    await runTick(w.env as any, at('2030-03-12T06:31:00'))
    expect(msgs(w.sent).filter((m) => /Water goal/.test(m.text))).toHaveLength(0)
  })

  it('sends the evening shutdown 30 min before bed with the bedtime line', async () => {
    const w = world(base)
    await runTick(w.env as any, at('2030-03-12T23:05:00'))
    const sd = msgs(w.sent).filter((m) => /Shut down the day/.test(m.text))
    expect(sd).toHaveLength(1)
    expect(sd[0].text).toMatch(/Bed at 23:30 \(in 25 min\)/)
    expect(w.setting('ben_pushes').recs['shutdown:2030-03-12'].via).toBe('telegram')
  })

  it('auto-rescue: a plan block 30 min late goes to Telegram once (Accept / Not now / Skip today), not while you are at the PC', async () => {
    const plan = { day: '2030-03-12', headline: 'Lab first', mustdos: [], training: null, waterMl: 2500, blocks: [{ id: 'lab', title: 'Lab report', start: '10:00', minutes: 60, kind: 'focus', tasks: ['Lab report'] }] }
    const rhythm = { day: '2030-03-12', water: [], briefing: { status: 'proposed', sentAt: '2030-03-12T07:00:00Z', version: 1, planner: 2, plan } }
    const w = world({ ...base, coach_rhythm: rhythm })
    await runTick(w.env as any, at('2030-03-12T10:20:00'))
    expect(msgs(w.sent).filter((m) => /Rescue:/.test(m.text))).toHaveLength(0)
    await runTick(w.env as any, at('2030-03-12T10:31:00'))
    const r = msgs(w.sent).filter((m) => /Rescue:/.test(m.text))
    expect(r).toHaveLength(1)
    expect(r[0].text).toMatch(/Rescue: start 'Lab report' now for 60 min\./)
    expect(r[0].reply_markup.inline_keyboard[0].map((b: any) => b.callback_data)).toEqual(['bp|a|rescue:lab', 'bp|l|rescue:lab', 'bp|s|rescue:lab'])
    expect(w.setting('coach_rhythm').rescue.key).toBe('rescue:lab')
    await runTick(w.env as any, at('2030-03-12T10:40:00'))
    expect(msgs(w.sent).filter((m) => /Rescue:/.test(m.text))).toHaveLength(1)
    // At the PC: the island shows it instead.
    const pc = world({ ...base, coach_rhythm: rhythm, ben_pc_seen: { at: new Date('2030-03-12T10:30:00').getTime(), active: true } })
    await runTick(pc.env as any, at('2030-03-12T10:31:00'))
    expect(msgs(pc.sent).filter((m) => /Rescue:/.test(m.text))).toHaveLength(0)
  })

  it('sends a drift word the island handed over, once', async () => {
    const now = new Date('2030-03-12T17:00:00').getTime()
    const w = world({ ...base, ben_pushes: { day: '2030-03-12', recs: {}, outbox: [{ key: 'drift:coach:drift:1:1', text: '👀 25 min of video during English essay. Back to it?', at: now - 60_000 }] } })
    await runTick(w.env as any, at('2030-03-12T17:00:00'))
    await runTick(w.env as any, at('2030-03-12T17:02:00'))
    expect(msgs(w.sent).filter((m) => /English essay/.test(m.text))).toHaveLength(1)
  })
})
