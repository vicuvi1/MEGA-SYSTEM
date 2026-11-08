// The app's Todoist edits end to end: the browser client → the server op
// (as api/todoist.mjs runs it) → Todoist's API (a fake fetch, made-up tasks).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { calendarDay, addDays } from '@core/dates'
import { toApiPriority } from '@core/todoist'
import { createTodoistApi } from '../../../server/todoistApi'
import { createTodoistClient } from './todoistClient'

afterEach(() => vi.useRealTimers())

const json = (body: unknown, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) }) as unknown as Response

/** A fake Todoist v1 with a couple of made-up tasks. */
function fakeTodoistHttp() {
  const tasks: any[] = [
    { id: 'k1', content: 'Water the plants', priority: 1, project_id: 'inbox', due: null, labels: [] },
    { id: 'k2', content: 'Draft the lab report', priority: 1, project_id: 'inbox', due: { date: '2026-11-20' }, labels: [] }
  ]
  const writes: { id: string; body: any }[] = []
  let down = false
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (down) throw new TypeError('Failed to fetch')
    const path = url.replace('https://api.todoist.com/api/v1', '')
    const m = /^\/tasks\/([^/?]+)$/.exec(path)
    if (m && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      writes.push({ id: m[1], body })
      const t = tasks.find((x) => x.id === m[1])
      if (!t) return json({ error: 'Task not found' }, 404)
      if (body.priority) t.priority = body.priority
      if (body.content) t.content = body.content
      if (body.due_date) t.due = { date: body.due_date }
      if (body.due_string) t.due = body.due_string === 'no date' ? null : { date: body.due_string.slice(0, 10), datetime: body.due_string.length > 10 ? body.due_string.replace(' ', 'T') + ':00' : undefined }
      if (body.labels) t.labels = body.labels
      return json(t)
    }
    if (path.startsWith('/projects') || path.startsWith('/sections')) return json({ results: [], next_cursor: null })
    if (path === '/tasks') return json({ results: tasks, next_cursor: null })
    if (path.startsWith('/tasks/filter')) return json({ results: tasks.filter((t) => t.due && t.due.date <= calendarDay()), next_cursor: null })
    return json({})
  }) as unknown as typeof fetch
  return {
    tasks,
    writes,
    set down(v: boolean) {
      down = v
    },
    fetchImpl
  }
}

/** api/todoist.mjs's switch, for the ops the client uses. */
const serverCall = (fake: ReturnType<typeof fakeTodoistHttp>) => {
  const api = createTodoistApi('t', fake.fetchImpl)
  return async (op: string, b: Record<string, any> = {}) => {
    try {
      if (op === 'today') return { tasks: await api.today() }
      if (op === 'everything') return await api.everything()
      if (op === 'update') return { ok: true, task: await api.updateTask(String(b.id), { content: b.content, priority: b.priority, due: b.due, labels: b.labels, duration: b.duration }) }
      return {}
    } catch (e) {
      // What the page sees from a 502.
      throw new Error((e as Error).message)
    }
  }
}

describe('Tasks sync: edits made in the app reach Todoist', () => {
  it('priority P1 is written as Todoist priority 4, and only that field is sent', async () => {
    const fake = fakeTodoistHttp()
    const c = createTodoistClient(serverCall(fake))
    await c.everything()
    await c.update('k1', { priority: toApiPriority(1) })
    expect(fake.writes).toEqual([{ id: 'k1', body: { priority: 4 } }])
  })

  it('due "today" is sent as your own date and the task shows on today\'s list', async () => {
    const fake = fakeTodoistHttp()
    const c = createTodoistClient(serverCall(fake))
    await c.everything()
    await c.update('k1', { due: 'today' })
    expect(fake.writes).toEqual([{ id: 'k1', body: { due_date: calendarDay() } }])
    expect((await c.today()).map((t) => t.id)).toContain('k1')
  })

  it('due "tomorrow" and priority at once: one write', async () => {
    const fake = fakeTodoistHttp()
    const c = createTodoistClient(serverCall(fake))
    await c.everything()
    await c.update('k2', { priority: 3, due: 'tomorrow' })
    expect(fake.writes).toEqual([{ id: 'k2', body: { priority: 3, due_date: addDays(calendarDay(), 1) } }])
  })

  it('offline: the edit waits, the list keeps it, and it is sent when Todoist answers again', async () => {
    const fake = fakeTodoistHttp()
    const c = createTodoistClient(serverCall(fake))
    await c.everything()
    fake.down = true
    await expect(c.update('k1', { priority: 4 })).rejects.toThrow(/Couldn't save to Todoist/)
    expect(c.pending().k1.state).toBe('failed')
    fake.down = false
    expect((await c.everything()).tasks.find((t) => t.id === 'k1')!.priority).toBe(4)
    await c.retry('k1')
    expect(fake.writes.at(-1)).toEqual({ id: 'k1', body: { priority: 4 } })
    expect(c.pending().k1.state).toBe('saved')
  })

  it('a change made in Todoist itself shows on the next read', async () => {
    const fake = fakeTodoistHttp()
    const c = createTodoistClient(serverCall(fake))
    await c.everything()
    fake.tasks[1].priority = 4
    fake.tasks[1].content = 'Draft the lab report (v2)'
    const t = (await c.everything()).tasks.find((x) => x.id === 'k2')!
    expect(t).toMatchObject({ priority: 4, content: 'Draft the lab report (v2)' })
  })

  it('Ben and the island get the same object: it can edit, move and delete', () => {
    const c = createTodoistClient(async () => ({}))
    for (const k of ['update', 'move', 'remove', 'everything', 'today', 'close', 'quickAdd'] as const) expect(typeof c[k]).toBe('function')
  })
})
