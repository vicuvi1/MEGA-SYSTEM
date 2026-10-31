// Todoist's API, called by the server with your token (TODOIST_TOKEN in
// Vercel): today's tasks, complete one, quick add (Todoist understands
// "tomorrow 17:00 p1 #University"), and what you completed since a time.
// Uses Todoist's current API (v1), with the older REST v2 as a fallback.
import type { TodoCompleted, TodoTask } from '@core/todoist'

const V1 = 'https://api.todoist.com/api/v1'
const V2 = 'https://api.todoist.com/rest/v2'
const SYNC = 'https://api.todoist.com/sync/v9'

export function createTodoistApi(token: string, fetchImpl: typeof fetch = fetch) {
  const call = async (url: string, init: RequestInit = {}): Promise<any> => {
    const res = await fetchImpl(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(10_000)
    })
    if (res.status === 401 || res.status === 403) throw new Error('Todoist refused the token: check TODOIST_TOKEN in Vercel')
    if (!res.ok) {
      const err: any = new Error(`Todoist ${res.status}`)
      err.status = res.status
      throw err
    }
    if (res.status === 204) return null
    const text = await res.text()
    return text ? JSON.parse(text) : null
  }
  /** v1 first; on "not found / gone" (an account or region still on v2), the older API. */
  const either = async <T>(v1: () => Promise<T>, v2: () => Promise<T>): Promise<T> => {
    try {
      return await v1()
    } catch (e: any) {
      if (e?.status === 404 || e?.status === 410) return v2()
      throw e
    }
  }
  const all = async (url: string): Promise<any[]> => {
    const out: any[] = []
    let cursor: string | null = null
    for (let page = 0; page < 10; page++) {
      const sep = url.includes('?') ? '&' : '?'
      const r = await call(cursor ? `${url}${sep}cursor=${encodeURIComponent(cursor)}` : url)
      if (Array.isArray(r)) return r
      out.push(...(r?.results ?? r?.items ?? []))
      cursor = r?.next_cursor ?? null
      if (!cursor) break
    }
    return out
  }

  let projectNames: Map<string, string> | null = null
  const projects = async () => {
    if (projectNames) return projectNames
    const list = await either(() => all(`${V1}/projects`), () => all(`${V2}/projects`))
    projectNames = new Map(list.map((p: any) => [String(p.id), String(p.name)]))
    return projectNames
  }

  let sectionNames: Map<string, string> | null = null
  const sections = async () => {
    if (sectionNames) return sectionNames
    const list = await either(() => all(`${V1}/sections`), () => all(`${V2}/sections`)).catch(() => [])
    sectionNames = new Map(list.map((x: any) => [String(x.id), String(x.name)]))
    return sectionNames
  }

  const toTask = (t: any, names: Map<string, string>, secs: Map<string, string> = new Map()): TodoTask => {
    const due = t.due ?? null
    const dt = String(due?.datetime ?? due?.date ?? '')
    return {
      id: String(t.id),
      content: String(t.content ?? ''),
      priority: Number(t.priority) || 1,
      due: dt ? dt.slice(0, 10) : null,
      dueTime: /T\d{2}:\d{2}/.test(dt) ? dt.slice(11, 16) : null,
      project: names.get(String(t.project_id)) ?? null,
      section: t.section_id ? (secs.get(String(t.section_id)) ?? null) : null,
      recurring: !!due?.is_recurring
    }
  }

  return {
    /** Due today or overdue, not completed. */
    async today(): Promise<TodoTask[]> {
      const q = encodeURIComponent('today | overdue')
      const [list, names, secs] = await Promise.all([either(() => all(`${V1}/tasks/filter?query=${q}`), () => all(`${V2}/tasks?filter=${q}`)), projects(), sections()])
      return list.filter((t: any) => !t.checked && !t.is_completed).map((t: any) => toTask(t, names, secs))
    },
    /** Due tomorrow, not completed (the first thing for the wind-down message). */
    async tomorrow(): Promise<TodoTask[]> {
      const q = encodeURIComponent('tomorrow')
      const [list, names, secs] = await Promise.all([either(() => all(`${V1}/tasks/filter?query=${q}`), () => all(`${V2}/tasks?filter=${q}`)), projects(), sections()])
      return list.filter((t: any) => !t.checked && !t.is_completed).map((t: any) => toTask(t, names, secs))
    },
    async close(id: string): Promise<void> {
      await either(
        () => call(`${V1}/tasks/${encodeURIComponent(id)}/close`, { method: 'POST' }),
        () => call(`${V2}/tasks/${encodeURIComponent(id)}/close`, { method: 'POST' })
      )
    },
    /** Todoist reads the date, time, priority and #project from the text. */
    async quickAdd(text: string): Promise<TodoTask> {
      const t = await either(
        () => call(`${V1}/tasks/quick`, { method: 'POST', body: JSON.stringify({ text }) }),
        () => call(`${SYNC}/quick/add`, { method: 'POST', body: JSON.stringify({ text }) })
      )
      return toTask(t ?? {}, await projects())
    },
    /** Completed since `since` (ISO), newest first. */
    async completedSince(since: string): Promise<TodoCompleted[]> {
      const until = new Date().toISOString()
      const items = await either(
        () => all(`${V1}/tasks/completed/by_completion_date?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&limit=200`),
        () => all(`${SYNC}/completed/get_all?since=${encodeURIComponent(since.slice(0, 19))}&limit=200`)
      )
      return items.map((t: any) => ({
        id: String(t.task_id ?? t.id),
        content: String(t.content ?? ''),
        priority: Number(t.priority) || 1,
        completedAt: String(t.completed_at ?? '')
      }))
    }
  }
}
export type TodoistApi = ReturnType<typeof createTodoistApi>
