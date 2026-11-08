import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { createWebServices } from './webServices'
import { createWebBots } from './webBots'

// The Coach chat reads quick-add words (core/quickAdd.ts) before it asks the model: a task goes to
// Todoist, an unclear line gets one short question, and talk is left to the model.
const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
const json = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as unknown as Response

async function setup() {
  // Pinned clock: Tuesday 12 March 2030, 08:30 (only Date, so the database timers still run).
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2030-03-12T08:30:00'))
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    if (String(url).startsWith('https://api.telegram.org/')) return json({ ok: true, result: {} })
    const out = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, text: async () => JSON.stringify(out), json: async () => out }
  })
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
  await mirror.ready
  const services = createWebServices(mirror)
  const todoist = {
    today: async () => [],
    close: vi.fn(async () => {}),
    quickAdd: vi.fn(async (text: string) => ({ id: 'n1', content: text, priority: 1, due: null, dueTime: null, project: null, recurring: false }))
  }
  const ai = vi.fn(async () => JSON.stringify({ reply: 'The model answered.', actions: [], remember: [] }))
  const bots = createWebBots({ mirror, services, defaults: { botToken: '1:x', chatId: '42' } as any, todoist, ai })
  return { bots, todoist, ai }
}

describe('Coach chat: quick-add in words', () => {
  it('"task lab report tomorrow 2h p1" sends a Todoist quick add and says what was added', async () => {
    const { bots, todoist, ai } = await setup()
    const r = await bots.think('task lab report tomorrow 2h p1', 'qa1')
    expect(todoist.quickAdd).toHaveBeenCalledWith('Lab report tomorrow p1 for 120 min')
    expect(r.reply).toBe('Added: Lab report · tomorrow · 2h · P1.')
    expect(ai).not.toHaveBeenCalled()
  })

  it('a task for today says it is on today\'s list and offers Re-plan from now', async () => {
    const { bots, todoist } = await setup()
    const r = await bots.think('+ gym 18:00 45 min', 'qa2')
    expect(todoist.quickAdd).toHaveBeenCalledWith('Gym today at 18:00 for 45 min')
    expect(r.reply).toMatch(/^Added: Gym · today 18:00 · 45 min\./)
    expect(r.reply).toMatch(/today's list/)
  })

  it('an unclear line asks one short question and saves nothing', async () => {
    const { bots, todoist, ai } = await setup()
    const r = await bots.think('task call mom at 7', 'qa3')
    expect(r.reply).toBe('Is "at 7" morning or evening? Say 7am or 7pm.')
    expect(todoist.quickAdd).not.toHaveBeenCalled()
    expect(ai).not.toHaveBeenCalled()
  })

  it('talk still goes to the model', async () => {
    const { bots, todoist, ai } = await setup()
    await bots.think('add read 10 min @today', 'qa4b')
    await bots.think('slept at 11pm and feel ok', 'qa4')
    await bots.think('what should I do tomorrow?', 'qa5')
    expect(todoist.quickAdd).not.toHaveBeenCalled()
    expect(ai).toHaveBeenCalled()
  })
})
