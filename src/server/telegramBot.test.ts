// The server's entry points (S5): the Telegram webhook and the tick, end to
// end on a fake Turso and a fake Telegram. A webhook delivered twice is
// handled once; a stranger changes nothing; two ticks in the same minute
// run once; the tick's clock never lands in the synced settings.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '../core/schema'
import { handlePipeline } from '../renderer/src/web/fakeTurso'
import { handleTelegramUpdate, runTick } from './telegramBot'

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

/** A fresh database and a recorder of what was sent to Telegram. */
function world() {
  const remote: SqlJsDatabase = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  const sent: { method: string; body: any }[] = []
  vi.stubGlobal('fetch', async (url: string, init: { body?: string } = {}) => {
    const u = String(url)
    if (u.includes('api.telegram.org')) {
      const method = u.split('/').pop() ?? ''
      sent.push({ method, body: init.body ? JSON.parse(init.body) : null })
      const json = { ok: true, result: { message_id: sent.length, chat: { id: Number(CHAT) } } }
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    }
    const json = handlePipeline(remote, JSON.parse(String(init.body)))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  // A new URL per test: the server keeps one warm copy per database.
  const env = { tursoUrl: `https://t${++n}.fake.turso.io`, tursoToken: 'k', timeZone: 'UTC', defaults: { chatId: CHAT, megaBotToken: TOKEN, botToken: TOKEN } }
  const q = (sql: string) => remote.exec(sql)[0]?.values ?? []
  return { remote, sent, env, q }
}
const msg = (updateId: number, chat: string, text: string) => ({ update_id: updateId, message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private' }, from: { id: Number(chat) }, text } })

describe('server: Telegram webhook and tick (S5)', () => {
  it('the same update delivered twice is handled once (no double points)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-26T20:30:00Z')) // the clean-day check-in opens at 19:00
    const { env, q } = world()
    q("INSERT INTO discipline_events (kind, day, ts) VALUES ('start', '2026-10-20', '2026-10-20T08:00:00Z')")
    await handleTelegramUpdate(env, TOKEN, msg(1001, CHAT, '/checkin'))
    await handleTelegramUpdate(env, TOKEN, msg(1001, CHAT, '/checkin'))
    expect(q("SELECT COUNT(*) FROM discipline_events WHERE kind = 'checkin'")[0][0]).toBe(1)
    expect(q("SELECT COUNT(*) FROM ledger WHERE rule_id = 'discipline.clean_day'")[0][0]).toBe(1)
  }, 30_000)

  it("a stranger writing to the bot changes nothing (A5)", async () => {
    const { env, q } = world()
    const reminders = JSON.stringify([{ id: 'r1', kind: 'checkin', text: 'Started the lab?', at: new Date(Date.now() - 60_000).toISOString(), sentAt: new Date(Date.now() - 30_000).toISOString(), createdAt: new Date().toISOString(), follow: true }])
    q(`INSERT INTO settings (key, value) VALUES ('coach_reminders', '${reminders.replace(/'/g, "''")}')`)
    q("INSERT INTO discipline_events (kind, day, ts) VALUES ('start', '2026-10-20', '2026-10-20T08:00:00Z')")
    const before = q('SELECT COUNT(*) FROM ledger')[0][0]
    await handleTelegramUpdate(env, TOKEN, msg(2001, '999999', 'done, I did it'))
    await handleTelegramUpdate(env, TOKEN, msg(2002, '999999', '/oath'))
    expect(q("SELECT value FROM settings WHERE key = 'coach_reminders'")[0][0]).toBe(reminders)
    expect(q('SELECT COUNT(*) FROM ledger')[0][0]).toBe(before)
  }, 30_000)

  it('two ticks in the same minute run once, and the clock stays out of the synced settings (S1)', async () => {
    const { env, q } = world()
    const at = new Date('2026-10-26T10:00:00Z')
    await runTick({ ...env, botToken: TOKEN, chatId: CHAT }, at)
    const again = await runTick({ ...env, botToken: TOKEN, chatId: CHAT }, new Date(at.getTime() + 10_000))
    expect(again).toEqual([])
    expect(q("SELECT COUNT(*) FROM settings WHERE key = 'coach_tick_at'")[0][0]).toBe(0)
    expect(Number(q("SELECT value FROM sys_kv WHERE key = 'coach_tick_at'")[0][0])).toBe(at.getTime())
  }, 30_000)
})
