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

describe('Todoist areas and the Tasks page', () => {
  const projects = [{ id: 'inbox', name: 'Inbox', inbox_project: true }, { id: 'p2', name: 'University', color: 'blue' }]
  const sections = [{ id: 's1', name: '🎓 University', project_id: 'inbox', section_order: 1 }, { id: 's2', name: '🛡️ Cyber', project_id: 'inbox', section_order: 2 }, { id: 's3', name: '🏠 Life admin', project_id: 'inbox', section_order: 3 }]
  const fake = (calls: string[], quick: any = { id: '9', content: 'PicoCTF level 5', project_id: 'inbox', priority: 1 }) =>
    (async (url: string, init?: RequestInit) => {
      const path = url.replace('https://api.todoist.com', '')
      calls.push(`${init?.method ?? 'GET'} ${path}${init?.body ? ' ' + init.body : ''}`)
      if (path.startsWith('/api/v1/projects')) return json({ results: projects, next_cursor: null })
      if (path.startsWith('/api/v1/sections')) return json({ results: sections, next_cursor: null })
      if (path === '/api/v1/tasks') return json({ results: [{ id: '1', content: 'Lab 3', priority: 4, project_id: 'inbox', section_id: 's1' }, { id: '2', content: 'Loose', priority: 1, project_id: 'inbox' }], next_cursor: null })
      if (path === '/api/v1/tasks/quick') return json(quick)
      return json({})
    }) as unknown as typeof fetch

  it('guesses the area from the words', async () => {
    const { guessArea } = await import('@core/todoist')
    const areas: any[] = sections.map((x) => ({ key: `s:${x.id}`, name: x.name, kind: 'section', id: x.id, projectId: 'inbox' }))
    expect(guessArea('PicoCTF level 5', areas)?.name).toBe('🛡️ Cyber')
    expect(guessArea('finish etica course', areas)?.name).toBe('🎓 University')
    expect(guessArea('solve the Revolut problem', areas)?.name).toBe('🏠 Life admin')
    expect(guessArea('random thing', areas)).toBeNull()
  })

  it('lists every task with its area, and areas: sections first, projects too', async () => {
    const calls: string[] = []
    const r = await createTodoistApi('t', fake(calls)).everything()
    expect(r.areas.map((a) => a.key)).toEqual(['s:s1', 's:s2', 's:s3', 'p:inbox', 'p:p2'])
    expect(r.tasks[0]).toMatchObject({ id: '1', sectionId: 's1', projectId: 'inbox', section: '🎓 University' })
  })

  it('a new task goes to its area (words first, then the model), and moves/updates hit Todoist', async () => {
    const calls: string[] = []
    const api = createTodoistApi('t', fake(calls))
    const t = await api.quickAdd('PicoCTF level 5')
    expect(t.area).toBe('🛡️ Cyber')
    expect(calls).toContain('POST /api/v1/tasks/9/move {"section_id":"s2"}')
    const calls2: string[] = []
    const picked = createTodoistApi('t', fake(calls2, { id: '10', content: 'Call grandma', project_id: 'inbox', priority: 1 }), { pickArea: async () => 'Life admin' })
    expect((await picked.quickAdd('Call grandma')).area).toBe('🏠 Life admin')
    await api.update('1', { priority: 3, due: 'friday' })
    await api.move('1', 's:s2')
    expect(calls).toContain('POST /api/v1/tasks/1 {"priority":3,"due_string":"friday"}')
    expect(calls).toContain('POST /api/v1/tasks/1/move {"section_id":"s2"}')
    const calls3: string[] = []
    await createTodoistApi('t', fake(calls3)).quickAdd('Read #University chapter 2')
    expect(calls3.some((c) => c.includes('/move'))).toBe(false) // you named the project yourself
  })
})

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
    expect(tasks).toMatchObject([
      { id: '1', content: 'Essay', priority: 4, due: '2026-10-31', dueTime: null, project: 'University', section: 'Essays', recurring: false, deadline: null },
      { id: '2', content: 'Gym', priority: 1, due: '2026-10-30', dueTime: '18:00', project: null, section: null, recurring: true, deadline: null }
    ])
    await api.close('1')
    expect(await api.quickAdd('Call Leo tomorrow 17:00 p1 #University')).toMatchObject({ content: 'Call Leo', dueTime: '17:00', project: 'University' })
    expect(calls).toContain('POST /api/v1/tasks/1/close')
  })

  it('closing: an old numeric id is mapped to its new id; a task already gone counts as done; errors say why', async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const path = url.replace('https://api.todoist.com', '')
      calls.push(`${init?.method ?? 'GET'} ${path}`)
      if (path === '/api/v1/tasks/123456/close') return { ok: false, status: 400, text: async () => JSON.stringify({ error: 'Invalid argument value' }) } as unknown as Response
      if (path === '/api/v1/id_mappings/tasks/123456') return json([{ old_id: '123456', new_id: '6Abc' }])
      if (path === '/api/v1/tasks/6Abc/close') return { ok: true, status: 204, text: async () => '' } as unknown as Response
      if (path === '/api/v1/tasks/gone/close') return { ok: false, status: 404, text: async () => '{"error":"Task not found"}' } as unknown as Response
      if (path === '/api/v1/tasks/bad/close') return { ok: false, status: 400, text: async () => '{"error":"Invalid argument value"}' } as unknown as Response
      return json({}, 404)
    }) as unknown as typeof fetch
    const api = createTodoistApi('tok', fetchImpl)
    await api.close('123456')
    expect(calls).toContain('POST /api/v1/tasks/6Abc/close')
    await api.close('gone')
    await expect(api.close('bad')).rejects.toThrow('Todoist 400: Invalid argument value')
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
    expect(await say(3, '/done 1')).toMatch(/Done in Todoist:<\/b> task b[\s\S]*\+8 points/)
    expect(todoist.close).toHaveBeenCalledWith('b')
    expect(await say(3, '/done 1')).toBeNull() // the same message again is not handled twice
  })

  it('the coach acts on calendar events and Todoist tasks by their E/T numbers', async () => {
    fakeTurso()
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
    await mirror.ready
    const services = createWebServices(mirror)
    const today = await services.read((s) => s.wallet.today())
    const at = (h: number) => new Date(`${today}T${String(h).padStart(2, '0')}:00:00`).toISOString()
    const events = [
      { id: 'g1', calendarId: 'cal', title: 'Deep block', start: at(9), end: at(10), allDay: false },
      { id: 'g2', calendarId: 'cal', title: 'Sport', start: at(17), end: at(18), allDay: false }
    ]
    const calendar = { events: async () => events, create: vi.fn(async (e: any) => ({ ...e, id: 'n', calendarId: 'cal', allDay: false })), move: vi.fn(async () => {}), remove: vi.fn(async () => {}) }
    const open = [task('a', 1, today), task('b', 4, today)]
    const todoist = {
      today: async () => open,
      close: vi.fn(async () => {}),
      quickAdd: vi.fn(async (text: string) => ({ ...task('n', 1, today), content: text })),
      update: vi.fn(async () => {}),
      move: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      everything: async () => ({ tasks: open, areas: [{ key: 's:s2', name: '🛡️ Cyber' }] })
    }
    const ai = vi.fn(async () =>
      JSON.stringify({
        reply: 'Done. Sport later, focus now.',
        actions: ['move: E1 | ' + today + ' 11:00', 'shift: 30 | E2', 'resize: E2 | 30', 'done: T1', 'star: T2', 'edit: T2 | title=Fix report; priority=P1', 'taskmove: T1 | Cyber', 'delete: E9'],
        remember: []
      })
    )
    const bots = createWebBots({ mirror, services, defaults: { botToken: '1:x', chatId: '42' } as any, todoist, calendar, ai })
    const r = await bots.think('move my deep block to 11 and push sport 30 min', 'k1')
    expect(calendar.move).toHaveBeenCalledWith('cal', 'g1', at(11), at(12))
    expect(calendar.move).toHaveBeenCalledWith('cal', 'g2', new Date(Date.parse(at(17)) + 30 * 60000).toISOString(), new Date(Date.parse(at(18)) + 30 * 60000).toISOString())
    expect(todoist.close).toHaveBeenCalledWith(open[0].id)
    expect(todoist.update).toHaveBeenCalledWith(open[1].id, expect.objectContaining({ labels: ['today'] }))
    expect(todoist.update).toHaveBeenCalledWith(open[1].id, expect.objectContaining({ content: 'Fix report', priority: 4 }))
    expect(todoist.move).toHaveBeenCalledWith(open[0].id, 's:s2')
    expect(calendar.remove).not.toHaveBeenCalled() // E9 doesn't exist
    expect(r.done.join('\n')).toMatch(/Moved: Deep block/)
    expect(r.done.join('\n')).toMatch(/Shifted 1 block by \+30 min/)
  })

  it('a failed action goes back to the coach once; it tries another way and says so', async () => {
    fakeTurso()
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
    await mirror.ready
    const services = createWebServices(mirror)
    const today = await services.read((s) => s.wallet.today())
    let tries = 0
    const calendar = {
      events: async () => [],
      create: vi.fn(async (e: any) => {
        if (++tries === 1) throw new Error('Google: that time is busy')
        return { ...e, id: 'n', calendarId: 'cal', allDay: false }
      }),
      move: vi.fn(async () => {}),
      remove: vi.fn(async () => {})
    }
    const prompts: string[] = []
    const ai = vi.fn(async (p: string) => {
      prompts.push(p)
      return prompts.length === 1
        ? JSON.stringify({ reply: 'Booked gym at 18:00.', actions: [`event: Gym | ${today} 18:00 | 60`], remember: [] })
        : JSON.stringify({ reply: '18:00 was busy, so gym is at 19:00.', actions: [`event: Gym | ${today} 19:00 | 60`], remember: [] })
    })
    const bots = createWebBots({ mirror, services, defaults: { botToken: '1:x', chatId: '42' } as any, calendar, ai })
    const r = await bots.think('gym at 18 today', 'k-fix')
    expect(ai).toHaveBeenCalledTimes(2)
    expect(prompts[1]).toMatch(/RESULTS of your actions[\s\S]*⚠️ Google: that time is busy/)
    expect(calendar.create).toHaveBeenCalledTimes(2)
    expect(r.reply).toMatch(/19:00/)
    expect(r.done.join('\n')).toMatch(/⚠️ Google: that time is busy/)
  })
})

describe('Todoist changes (incremental sync)', () => {
  it('first call only gets a token; later calls count changed tasks', async () => {
    const calls: string[] = []
    const fake = (async (url: string, init: any) => {
      calls.push(`${url} ${init.body}`)
      const token = new URLSearchParams(init.body).get('sync_token')
      const json = token === '*' ? { sync_token: 't1', full_sync: true, items: [{ id: 1 }, { id: 2 }] } : token === 't1' ? { sync_token: 't2', full_sync: false, items: [{ id: 3 }] } : { sync_token: 't2', full_sync: false, items: [] }
      return new Response(JSON.stringify(json), { status: 200 })
    }) as typeof fetch
    const api = createTodoistApi('tok', fake)
    expect(await api.changes('*')).toMatchObject({ token: 't1', changed: 0 })
    expect(await api.changes('t1')).toMatchObject({ token: 't2', changed: 1 })
    expect(await api.changes('t2')).toMatchObject({ token: 't2', changed: 0 })
    expect(calls[0]).toContain('/api/v1/sync')
    expect(calls[0]).toContain('resource_types=%5B%22items%22%5D')
  })
})
