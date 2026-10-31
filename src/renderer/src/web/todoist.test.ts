import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { sortToday, todayText, type TodoTask } from '@core/todoist'
import { createTodoistApi } from '../../../server/todoistApi'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { createWebServices } from './webServices'
import { createWebBots } from './webBots'
import { payTodoist } from './todoistCoins'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) }) as unknown as Response

describe('Todoist API client', () => {
  it("reads today's tasks (all pages) with project and section names, completes and quick-adds", async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.todoist.com', '')}`)
      if (url.includes('/projects')) return json({ results: [{ id: 'p1', name: 'University' }], next_cursor: null })
      if (url.includes('/sections')) return json({ results: [{ id: 's1', name: 'Essays' }], next_cursor: null })
      if (url.includes('/tasks/filter') && !url.includes('cursor=')) return json({ results: [{ id: '1', content: 'Essay', priority: 4, project_id: 'p1', section_id: 's1', due: { date: '2026-10-31' } }], next_cursor: 'c2' })
      if (url.includes('/tasks/filter')) return json({ results: [{ id: '2', content: 'Gym', priority: 1, project_id: 'x', due: { date: '2026-10-30T18:00:00', is_recurring: true } }], next_cursor: null })
      if (url.endsWith('/close')) return { ok: true, status: 204, text: async () => '' } as unknown as Response
      if (url.endsWith('/tasks/quick')) return json({ id: '9', content: 'Call Leo', priority: 4, project_id: 'p1', due: { date: '2026-11-01T17:00:00' } })
      return json({}, 404)
    }) as unknown as typeof fetch
    const api = createTodoistApi('tok', fetchImpl)
    const tasks = await api.today()
    expect(tasks).toEqual([
      { id: '1', content: 'Essay', priority: 4, due: '2026-10-31', dueTime: null, project: 'University', section: 'Essays', recurring: false },
      { id: '2', content: 'Gym', priority: 1, due: '2026-10-30', dueTime: '18:00', project: null, section: null, recurring: true }
    ])
    await api.close('1')
    expect(await api.quickAdd('Call Leo tomorrow 17:00 p1 #University')).toMatchObject({ content: 'Call Leo', dueTime: '17:00', project: 'University' })
    expect(calls).toContain('POST /api/v1/tasks/1/close')
  })

  it('falls back to the older API when the new one is not there', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes('/api/v1/')) return json({}, 410)
      if (url.includes('/rest/v2/projects')) return json([{ id: 'p', name: 'Life' }])
      if (url.includes('/rest/v2/tasks')) return json([{ id: '5', content: 'Read', priority: 2, project_id: 'p', due: { date: '2026-10-31' } }])
      return json({}, 404)
    }) as unknown as typeof fetch
    expect(await createTodoistApi('tok', fetchImpl).today()).toMatchObject([{ id: '5', project: 'Life' }])
  })

  it('a refused token says what to do', async () => {
    const api = createTodoistApi('bad', (async () => json({}, 401)) as unknown as typeof fetch)
    await expect(api.today()).rejects.toThrow(/TODOIST_TOKEN/)
  })
})

describe('Todoist in Life System', () => {
  const task = (id: string, priority: number, due: string | null, dueTime: string | null = null): TodoTask => ({ id, content: `task ${id}`, priority, due, dueTime, project: null, recurring: false })

  it('late first, then the most urgent, then by time', () => {
    const order = sortToday([task('a', 1, '2026-10-31'), task('b', 4, '2026-10-31', '15:00'), task('c', 2, '2026-10-29'), task('d', 4, '2026-10-31', '09:00')], '2026-10-31')
    expect(order.map((t) => t.id)).toEqual(['c', 'd', 'b', 'a'])
    expect(todayText([], '2026-10-31')).toMatch(/Nothing left/)
  })

  function fakeTurso() {
    const remote = new SQL.Database()
    for (const m of MIGRATIONS) remote.exec(m)
    vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
      if (String(url).startsWith('https://api.telegram.org/')) return json({ ok: true, result: {} })
      const out = handlePipeline(remote, JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => out, text: async () => JSON.stringify(out) }
    })
    return remote
  }

  it('a completed task pays once, wherever it was completed', async () => {
    const remote = fakeTurso()
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
    await mirror.ready
    const web = createWebServices(mirror)
    expect(await web.write((s) => payTodoist(s, [{ id: '1', content: 'Essay' }]))).toBe(1)
    expect(await web.write((s) => payTodoist(s, [{ id: '1', content: 'Essay' }, { id: '2', content: 'Gym' }]))).toBe(1)
    expect(Number(remote.exec("SELECT COUNT(*) FROM ledger WHERE rule_id = 'tasks.todoist_done'")[0].values[0][0])).toBe(2)
    // never a tap in Quick log, never a bare award
    await expect(web.wallet.award('tasks.todoist_done')).rejects.toThrow()
  })

  it('the bot: /todo lists, /task adds, /done 1 completes the first one and pays', async () => {
    fakeTurso()
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
    await mirror.ready
    const services = createWebServices(mirror)
    const today = await services.read((s) => s.wallet.today())
    let open = [task('a', 1, today), task('b', 4, today)]
    const todoist = {
      today: async () => open,
      close: vi.fn(async (id: string) => void (open = open.filter((t) => t.id !== id))),
      quickAdd: vi.fn(async (text: string) => ({ ...task('n', 4, today, '17:00'), content: text }))
    }
    const bots = createWebBots({ mirror, services, defaults: { botToken: '1:x', chatId: '42' } as any, todoist })
    const say = (id: number, text: string) => bots.handleUpdate('1:x', { update_id: id, message: { chat: { id: 42 }, text } })
    expect(await say(1, '/todo')).toMatch(/1\. 🔴 <b>task b<\/b>[\s\S]*2\. ⚪ <b>task a/)
    expect(await say(2, '/task call Leo tomorrow 17:00 p1')).toMatch(/Added to Todoist/)
    expect(await say(3, '/done 1')).toMatch(/Done in Todoist:<\/b> task b[\s\S]*\+8 coins/)
    expect(todoist.close).toHaveBeenCalledWith('b')
    expect(await say(3, '/done 1')).toBeNull() // the same message again is not handled twice
  })
})
