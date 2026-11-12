// The module switch on the server (core/modules.ts), end to end on a fake Turso and a fake Telegram:
// with the owner's default (Today, Money, Sleep, Sport Track, Discipline on) a command of an off module
// gets the switched-off line and changes nothing, Ben's check-ins stay quiet while your own reminder
// rings, the old daily coach messages do not run, and turning a module on brings its command back.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '../core/schema'
import { DEFAULT_MODULES, OFF_REPLY, setModule, writeModules } from '../core/modules'
import { handlePipeline } from '../renderer/src/web/fakeTurso'
import { handleTelegramUpdate, runDaily, runTick } from './telegramBot'

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

/** A fresh database with no `modules_on` (the default) and a recorder of what was sent to Telegram. */
function world() {
  const remote: SqlJsDatabase = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  remote.exec(`INSERT INTO settings (key, value) VALUES ('simple_mode', '{"budget":false}')`)
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
  const env = { tursoUrl: `https://m${++n}.fake.turso.io`, tursoToken: 'k', timeZone: 'UTC', defaults: { chatId: CHAT, megaBotToken: TOKEN, botToken: TOKEN } }
  const q = (sql: string) => remote.exec(sql)[0]?.values ?? []
  return { remote, sent, env, q }
}
const msg = (updateId: number, chat: string, text: string) => ({ update_id: updateId, message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private' }, from: { id: Number(chat) }, text } })
const texts = (sent: { method: string; body: any }[]) => sent.filter((s) => s.method === 'sendMessage').map((s) => String(s.body?.text ?? ''))

describe('the module switch on the server', () => {
  it('a command of an off module answers "switched off" and changes nothing; strangers get nothing', async () => {
    const { env, sent, q } = world()
    const before = q('SELECT COUNT(*) FROM ledger')[0][0]
    expect(await handleTelegramUpdate(env, TOKEN, msg(1, CHAT, '/quiz'))).toBe(`Career: ${OFF_REPLY}`)
    expect(await handleTelegramUpdate(env, TOKEN, msg(2, CHAT, '/todo'))).toBe(`Tasks: ${OFF_REPLY}`)
    expect(await handleTelegramUpdate(env, TOKEN, msg(3, CHAT, '/fun 30'))).toBe(`Rewards: ${OFF_REPLY}`)
    expect(texts(sent)).toEqual([`Career: ${OFF_REPLY}`, `Tasks: ${OFF_REPLY}`, `Rewards: ${OFF_REPLY}`])
    expect(q('SELECT COUNT(*) FROM ledger')[0][0]).toBe(before)
    sent.length = 0
    expect(await handleTelegramUpdate(env, TOKEN, msg(4, '999999', '/quiz'))).toBeNull()
    expect(sent).toEqual([])
    // A part that is on still answers as before.
    const water = await handleTelegramUpdate(env, TOKEN, msg(5, CHAT, '/water'))
    expect(water).not.toContain(OFF_REPLY)
  }, 30_000)

  it('turned on, the command works again with its data', async () => {
    const { env, remote } = world()
    remote.run("INSERT INTO settings (key, value) VALUES ('modules_on', ?)", [writeModules(setModule(DEFAULT_MODULES, 'tasks', true))])
    const r = await handleTelegramUpdate(env, TOKEN, msg(10, CHAT, '/tasks'))
    expect(r).not.toContain(OFF_REPLY)
  }, 30_000)

  it("the tick: Ben's check-in stays quiet (Coach off) while your own reminder rings", async () => {
    const { env, sent, q } = world()
    const now = new Date('2026-10-26T10:00:00Z')
    const due = new Date(now.getTime() - 60_000).toISOString()
    const list = [
      { id: 'c1', kind: 'checkin', text: 'Started the lab?', at: due, createdAt: due, follow: true },
      { id: 'r1', kind: 'remind', text: 'Call the dentist', at: due, createdAt: due }
    ]
    q(`INSERT INTO settings (key, value) VALUES ('coach_reminders', '${JSON.stringify(list).replace(/'/g, "''")}')`)
    await runTick({ ...env, botToken: TOKEN, chatId: CHAT }, now)
    const all = texts(sent).join('\n')
    expect(all).toContain('Call the dentist')
    expect(all).not.toContain('Started the lab?')
  }, 30_000)

  it("the old daily coach messages do not run while Coach is off", async () => {
    const { env, sent } = world()
    expect(await runDaily({ ...env, botToken: TOKEN, chatId: CHAT }, 'morning')).toEqual([])
    expect(await runDaily({ ...env, botToken: TOKEN, chatId: CHAT }, 'midday')).toEqual([])
    expect(texts(sent)).toEqual([])
  }, 30_000)
})
