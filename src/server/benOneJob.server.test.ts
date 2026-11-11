// Ben's one job on Telegram (feature freeze): tomorrow's 3 must-dos must be concrete and exactly 3
// (saved to tomorrow's day_plans), one "go to sleep" a night after 23:15, only the owner's chat.
// Made-up data, a fake Turso and a fake Telegram.
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
function world() {
  const remote: SqlJsDatabase = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
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
  const env = { tursoUrl: `https://onejob${++n}.fake.turso.io`, tursoToken: 'k', timeZone: 'UTC', defaults: { chatId: CHAT, megaBotToken: TOKEN, botToken: TOKEN } }
  const q = (sql: string) => remote.exec(sql)[0]?.values ?? []
  return { sent, env, q }
}
const msg = (id: number, chat: string, text: string, replyTo?: string) => ({ update_id: id, message: { message_id: id, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private' }, from: { id: Number(chat) }, text, ...(replyTo ? { reply_to_message: { message_id: 1, text: replyTo } } : {}) } })
const said = (sent: { method: string; body: any }[]) => sent.filter((s) => s.method === 'sendMessage').map((s) => String(s.body?.text ?? ''))

describe("Ben's one job on Telegram", () => {
  it("21:15 asks for tomorrow's 3; vague items are refused; exactly 3 concrete ones go to tomorrow's plan", async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { env, sent, q } = world()
    const at = new Date('2026-11-11T21:16:00Z')
    vi.setSystemTime(at)
    await runTick({ ...env, botToken: TOKEN, chatId: CHAT }, at)
    const ask = said(sent).find((t) => /pick tomorrow's 3/.test(t))
    expect(ask).toBeTruthy()
    vi.setSystemTime(new Date('2026-11-11T21:20:00Z'))
    await handleTelegramUpdate(env, TOKEN, msg(5001, CHAT, 'sport\nDorm\nread', ask))
    expect(said(sent).at(-1)).toMatch(/Too vague/)
    expect(q("SELECT COUNT(*) FROM day_plans WHERE day = '2026-11-12'")[0][0]).toBe(0)
    await handleTelegramUpdate(env, TOKEN, msg(5002, CHAT, 'read 20 pages\ngym 40 min', ask))
    expect(said(sent).at(-1)).toMatch(/exactly 3/)
    await handleTelegramUpdate(env, TOKEN, msg(5003, CHAT, 'sport: 25 min, 30 push-ups\nread 20 pages\nclean the dorm 15 min', ask))
    expect(said(sent).at(-1)).toMatch(/Saved tomorrow's 3/)
    const items = JSON.parse(String(q("SELECT items FROM day_plans WHERE day = '2026-11-12'")[0][0])).map((x: any) => x.text)
    expect(items).toEqual(['sport: 25 min, 30 push-ups', 'read 20 pages', 'clean the dorm 15 min'])
  }, 60_000)

  it('a stranger cannot set the must-dos', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-11T21:20:00Z'))
    const { env, q } = world()
    await handleTelegramUpdate(env, TOKEN, msg(6001, '999999', "tomorrow: read 20 pages; gym 40 min; essay 30 min"))
    expect(q("SELECT COUNT(*) FROM day_plans WHERE day = '2026-11-12'")[0][0]).toBe(0)
  }, 60_000)

  it('writing after 23:15 gets ONE "go to sleep" a night', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { env, sent } = world()
    vi.setSystemTime(new Date('2026-11-11T22:30:00Z'))
    await handleTelegramUpdate(env, TOKEN, msg(7001, CHAT, '/help'))
    expect(said(sent).filter((t) => /go to sleep/i.test(t))).toHaveLength(0)
    vi.setSystemTime(new Date('2026-11-11T23:20:00Z'))
    await handleTelegramUpdate(env, TOKEN, msg(7002, CHAT, '/help'))
    vi.setSystemTime(new Date('2026-11-11T23:50:00Z'))
    await handleTelegramUpdate(env, TOKEN, msg(7003, CHAT, '/help'))
    expect(said(sent).filter((t) => /go to sleep/i.test(t))).toHaveLength(1)
  }, 60_000)
})
