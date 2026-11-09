// Todoist's API, called by the server with your token (TODOIST_TOKEN in
// Vercel): today's tasks, complete one, quick add (Todoist understands
// "tomorrow 17:00 p1 #University"), and what you completed since a time.
// Uses Todoist's current API (v1), with the older REST v2 as a fallback.
import { TODAY_LABEL, guessArea, plainName, type Area, type TodoCompleted, type TodoDelta, type TodoLookup, type TodoTask } from '@core/todoist'

const V1 = 'https://api.todoist.com/api/v1'
const V2 = 'https://api.todoist.com/rest/v2'
const SYNC = 'https://api.todoist.com/sync/v9'

type TaskPatch = { content?: string; priority?: number; due?: string; description?: string; labels?: string[]; duration?: number | null }

/** Optional: a model that picks an area when the words don't (the server passes Gemini). */
export type AreaPicker = (text: string, areaNames: string[]) => Promise<string | null>

/**
 * Todoist's due → the task's own calendar date and time. A time with a fixed
 * time zone comes as UTC ("2026-11-10T22:30:00Z"): it is turned back into the
 * task's zone, so 00:30 in Bucharest is never read as the day before at
 * 22:30. A floating time ("2026-11-10T15:00:00") is used as it is.
 */
export function dueParts(d: any): { due: string | null; dueTime: string | null } {
  if (!d) return { due: null, dueTime: null }
  const raw = String(d.datetime ?? d.date ?? '')
  if (!raw) return { due: null, dueTime: null }
  if (/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const at = new Date(raw)
    const zone = typeof d.timezone === 'string' && d.timezone ? d.timezone : undefined
    if (!isNaN(at.getTime()))
      try {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
        const g = (k: string) => parts.find((x) => x.type === k)?.value ?? ''
        return { due: `${g('year')}-${g('month')}-${g('day')}`, dueTime: `${g('hour')}:${g('minute')}` }
      } catch {
        /* an unknown zone: the plain reading below */
      }
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(d.date ?? '')) ? String(d.date) : raw.slice(0, 10)
  return { due: date, dueTime: /T\d{2}:\d{2}/.test(raw) ? raw.slice(11, 16) : null }
}

export function createTodoistApi(token: string, fetchImpl: typeof fetch = fetch, opts: { pickArea?: AreaPicker } = {}) {
  const call = async (url: string, init: RequestInit = {}): Promise<any> => {
    const res = await fetchImpl(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(10_000)
    })
    if (res.status === 401 || res.status === 403) throw new Error('Todoist refused the token: check TODOIST_TOKEN in Vercel')
    if (!res.ok) {
      // Todoist's own words ("Invalid argument value", "Task not found"), not just a number.
      const body = await res.text().catch(() => '')
      let why = ''
      try {
        const j = JSON.parse(body)
        why = String(j.error ?? j.error_tag ?? j.message ?? '')
      } catch {
        why = body.replace(/\s+/g, ' ').trim()
      }
      const err: any = new Error(`Todoist ${res.status}${why ? `: ${why.slice(0, 120)}` : ''}`)
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
    const parts = dueParts(due)
    return {
      id: String(t.id),
      content: String(t.content ?? ''),
      priority: Number(t.priority) || 1,
      due: parts.due,
      dueTime: parts.dueTime,
      project: names.get(String(t.project_id)) ?? null,
      section: t.section_id ? (secs.get(String(t.section_id)) ?? null) : null,
      deadline: t.deadline?.date ? String(t.deadline.date).slice(0, 10) : null,
      recurring: !!due?.is_recurring,
      projectId: t.project_id != null ? String(t.project_id) : null,
      sectionId: t.section_id ? String(t.section_id) : null,
      description: t.description ? String(t.description) : null,
      labels: Array.isArray(t.labels) ? t.labels.map(String) : [],
      duration: t.duration?.amount ? Number(t.duration.amount) * (t.duration.unit === 'day' ? 1440 : 1) : null
    }
  }

  /** Your areas: every section (Inbox first), and every project without sections. */
  const areaList = async (): Promise<{ areas: Area[]; inboxId: string | null; raw: { projects: any[]; sections: any[] } }> => {
    const [projects, sections] = await Promise.all([either(() => all(`${V1}/projects`), () => all(`${V2}/projects`)), either(() => all(`${V1}/sections`), () => all(`${V2}/sections`)).catch(() => [])])
    const live = projects.filter((p: any) => !p.is_archived && !p.is_deleted)
    const inbox = live.find((p: any) => p.inbox_project || p.is_inbox_project)
    const ordered = [...(inbox ? [inbox] : []), ...live.filter((p: any) => p !== inbox)]
    const areas: Area[] = []
    for (const p of ordered) {
      const secs = sections.filter((x: any) => String(x.project_id) === String(p.id) && !x.is_deleted && !x.is_archived).sort((a: any, b: any) => (a.section_order ?? a.order ?? 0) - (b.section_order ?? b.order ?? 0))
      for (const x of secs) areas.push({ key: `s:${x.id}`, name: String(x.name), kind: 'section', id: String(x.id), projectId: String(p.id), todoistColor: p.color ?? null })
      // The project itself: its tasks outside any section (the Inbox's are "Inbox").
      areas.push({ key: `p:${p.id}`, name: String(p.name), kind: 'project', id: String(p.id), projectId: String(p.id), todoistColor: p.color ?? null })
    }
    return { areas, inboxId: inbox ? String(inbox.id) : null, raw: { projects: live, sections } }
  }

  /** Moves a task to a section or a project (v1 move; the sync API on older accounts). */
  const moveTo = async (id: string, area: Pick<Area, 'kind' | 'id'>) => {
    const body = area.kind === 'section' ? { section_id: area.id } : { project_id: area.id }
    await either(
      () => call(`${V1}/tasks/${encodeURIComponent(id)}/move`, { method: 'POST', body: JSON.stringify(body) }),
      () => call(`${SYNC}/sync`, { method: 'POST', body: JSON.stringify({ commands: [{ type: 'item_move', uuid: `${id}-${Date.now()}`, args: { id, ...body } }] }) })
    )
  }

  /** The area for a new task: its words first, then the model (if any). */
  const chooseArea = async (text: string, areas: Area[]): Promise<Area | null> => {
    const byWords = guessArea(text, areas)
    if (byWords || !opts.pickArea) return byWords
    const choices = areas.filter((a) => a.kind === 'section' || a.name !== 'Inbox')
    const name = await opts.pickArea(text, choices.map((a) => plainName(a.name))).catch(() => null)
    return name ? (choices.find((a) => plainName(a.name).toLowerCase() === name.trim().toLowerCase()) ?? null) : null
  }

  /**
   * Changes the text, priority (4 = P1), date ("friday 18:00", "no date") or
   * note. Resolves with the task as Todoist now holds it (null when Todoist
   * only says "ok"), so the app shows the confirmed value.
   */
const updateTask = async (id: string, patch: TaskPatch): Promise<TodoTask | null> => {
    const body: any = {}
    if (patch.content != null) body.content = patch.content
    if (patch.priority != null) body.priority = Math.min(4, Math.max(1, Math.round(patch.priority)))
    if (patch.due != null) {
      const due = patch.due.trim()
      // A plain date is sent as a date (the app already turned "today" into your own date).
      if (/^\d{4}-\d{2}-\d{2}$/.test(due)) body.due_date = due
      else body.due_string = due || 'no date'
    }
    if (patch.description != null) body.description = patch.description
    if (Array.isArray(patch.labels)) body.labels = patch.labels.map(String).slice(0, 20)
    // How long it takes (minutes); 0 clears it.
    if (patch.duration !== undefined) {
      if (patch.duration && patch.duration > 0) {
        body.duration = Math.min(1440, Math.round(patch.duration))
        body.duration_unit = 'minute'
      } else body.duration = null
    }
    const t = await either(
      () => call(`${V1}/tasks/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(body) }),
      () => call(`${V2}/tasks/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(body) })
    )
    return t && typeof t === 'object' && t.id != null ? toTask(t, new Map()) : null
  }

  /** Completed since `since` (ISO), newest first. */
  const completedSince = async (since: string): Promise<TodoCompleted[]> => {
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

  return {
    /** Every open task and your areas (the Tasks page). */
    async everything(): Promise<{ tasks: TodoTask[]; areas: Area[] }> {
      const [list, { areas, raw }] = await Promise.all([either(() => all(`${V1}/tasks`), () => all(`${V2}/tasks`)), areaList()])
      const names = new Map(raw.projects.map((p: any) => [String(p.id), String(p.name)]))
      const secs = new Map(raw.sections.map((x: any) => [String(x.id), String(x.name)]))
      return { tasks: list.filter((t: any) => !t.checked && !t.is_completed).map((t: any) => toTask(t, names, secs)), areas }
    },
    areas: async () => (await areaList()).areas,
    /**
     * Anything changed since `token`? Todoist's incremental sync answers with
     * only the tasks that changed (usually none), so checking every few
     * seconds is cheap. The first call ('*') just returns a token.
     */
    async changes(token: string): Promise<{ token: string; changed: number; items: TodoDelta[] }> {
      const j = await call(`${V1}/sync`, {
        method: 'POST',
        body: new URLSearchParams({ sync_token: token || '*', resource_types: '["items"]' }).toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })
      const raw: any[] = !j?.full_sync && Array.isArray(j?.items) ? j.items : []
      // What changed, task by task (moved day, renamed, done, deleted), so the app can put it right
      // everywhere at once. Names of projects and sections are left out (the next list read has them).
      const items: TodoDelta[] = raw.slice(0, 200).map((t: any) => ({ ...toTask(t, projectNames ?? new Map(), sectionNames ?? new Map()), checked: !!(t.checked ?? t.is_completed), deleted: !!t.is_deleted }))
      return { token: String(j?.sync_token ?? ''), changed: raw.length, items }
    },
    /**
     * Where these tasks are now: open (with their day), done, or gone. A
     * recurring task done today moves on to its next date and stays open, so
     * it counts as done when it is in what you completed since `since`.
     */
    async lookup(ids: string[], since?: string): Promise<TodoLookup[]> {
      const want = [...new Set(ids.map(String).filter(Boolean))].slice(0, 25)
      const [names, secs] = await Promise.all([projects().catch(() => new Map<string, string>()), sections().catch(() => new Map<string, string>())])
      let doneToday: Set<string> | null = null
      const completed = async () => {
        if (doneToday) return doneToday
        const items = since ? await completedSince(since).catch(() => [] as TodoCompleted[]) : []
        doneToday = new Set(items.map((x) => x.id))
        return doneToday
      }
      const out: TodoLookup[] = []
      for (const id of want) {
        let t: any
        try {
          t = await either(
            () => call(`${V1}/tasks/${encodeURIComponent(id)}`),
            () => call(`${V2}/tasks/${encodeURIComponent(id)}`)
          )
        } catch (e: any) {
          if (e?.status === 404 || e?.status === 410) {
            // Todoist answers "not found" for a deleted task, and the older API also for a done one.
            out.push({ id, state: (await completed()).has(id) ? 'done' : 'gone' })
            continue
          }
          throw e
        }
        if (!t || t.is_deleted) out.push({ id, state: 'gone' })
        else if (t.checked || t.is_completed) out.push({ id, state: 'done', task: toTask(t, names, secs) })
        else {
          const task = toTask(t, names, secs)
          out.push({ id, state: task.recurring && (await completed()).has(id) ? 'done' : 'open', task })
        }
      }
      return out
    },
    updateTask,
    /** The same as updateTask, for callers that only need it done (the bots). */
    async update(id: string, patch: TaskPatch): Promise<void> {
      await updateTask(id, patch)
    },
    async move(id: string, areaKey: string): Promise<void> {
      const a = (await areaList()).areas.find((x) => x.key === areaKey)
      if (!a) throw new Error('That area no longer exists in Todoist')
      await moveTo(id, a)
    },
    async reopen(id: string): Promise<void> {
      await either(
        () => call(`${V1}/tasks/${encodeURIComponent(id)}/reopen`, { method: 'POST' }),
        () => call(`${V2}/tasks/${encodeURIComponent(id)}/reopen`, { method: 'POST' })
      )
    },
    async remove(id: string): Promise<void> {
      await either(
        () => call(`${V1}/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
        () => call(`${V2}/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
      )
    },
    /** A new area: a section in the Inbox (or the given project). */
    async addArea(name: string, projectId?: string): Promise<Area> {
      const { inboxId } = await areaList()
      const pid = projectId || inboxId
      const x = await either(
        () => call(`${V1}/sections`, { method: 'POST', body: JSON.stringify({ name, project_id: pid }) }),
        () => call(`${V2}/sections`, { method: 'POST', body: JSON.stringify({ name, project_id: pid }) })
      )
      return { key: `s:${x.id}`, name: String(x.name), kind: 'section', id: String(x.id), projectId: String(pid) }
    },
    async renameArea(areaKey: string, name: string): Promise<void> {
      const [kind, id] = [areaKey.slice(0, 1), areaKey.slice(2)]
      const path = kind === 's' ? 'sections' : 'projects'
      await either(
        () => call(`${V1}/${path}/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ name }) }),
        () => call(`${V2}/${path}/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ name }) })
      )
    },
    /** Due today or overdue, or starred for today (label @today), not completed. */
    async today(): Promise<TodoTask[]> {
      const q = encodeURIComponent(`today | overdue | @${TODAY_LABEL}`)
      const [list, names, secs] = await Promise.all([either(() => all(`${V1}/tasks/filter?query=${q}`), () => all(`${V2}/tasks?filter=${q}`)), projects(), sections()])
      return list.filter((t: any) => !t.checked && !t.is_completed).map((t: any) => toTask(t, names, secs))
    },
    /** Due in the next `days` days or with a deadline then (for the deadline radar). */
    async upcoming(days = 7): Promise<TodoTask[]> {
      const q = encodeURIComponent(`next ${days} days | deadline before: +${days + 1} days`)
      const plain = encodeURIComponent(`next ${days} days`)
      const get = (query: string) => either(() => all(`${V1}/tasks/filter?query=${query}`), () => all(`${V2}/tasks?filter=${query}`))
      // Older accounts don't know the deadline filter: then due dates only.
      const [list, names, secs] = await Promise.all([get(q).catch(() => get(plain)), projects(), sections()])
      return list.filter((t: any) => !t.checked && !t.is_completed).map((t: any) => toTask(t, names, secs))
    },
    /** Due tomorrow, not completed (the first thing for the wind-down message). */
    async tomorrow(): Promise<TodoTask[]> {
      const q = encodeURIComponent('tomorrow')
      const [list, names, secs] = await Promise.all([either(() => all(`${V1}/tasks/filter?query=${q}`), () => all(`${V2}/tasks?filter=${q}`)), projects(), sections()])
      return list.filter((t: any) => !t.checked && !t.is_completed).map((t: any) => toTask(t, names, secs))
    },
    /**
     * Ticks a task off. Todoist's v1 API refuses old numeric (v2) ids with 400,
     * so such an id is first turned into its v1 id. A task that is already
     * gone (done or deleted elsewhere) counts as done: that's what you wanted.
     */
    async close(id: string): Promise<void> {
      const closeV1 = (x: string) => call(`${V1}/tasks/${encodeURIComponent(x)}/close`, { method: 'POST' })
      try {
        await closeV1(id)
        return
      } catch (e: any) {
        if (e?.status !== 400 && e?.status !== 404) throw e
        if (/^\d+$/.test(id)) {
          const map = await call(`${V1}/id_mappings/tasks/${encodeURIComponent(id)}`).catch(() => null)
          const v1 = Array.isArray(map) ? map.find((m: any) => String(m.old_id) === id)?.new_id : null
          if (v1) {
            try {
              await closeV1(String(v1))
              return
            } catch (e2: any) {
              if (e2?.status !== 404) throw e2
              return // already gone
            }
          }
          // Not mapped: the older API, if this account still has it.
          try {
            await call(`${V2}/tasks/${encodeURIComponent(id)}/close`, { method: 'POST' })
            return
          } catch (e3: any) {
            if (e3?.status === 404) return
            throw e3
          }
        }
        if (e?.status === 404) return // already done or deleted elsewhere
        throw e
      }
    },
    /**
     * Todoist reads the date, time, priority and #project from the text. A
     * task that lands in the plain Inbox is then put in its area (by its
     * words, else the model); `areaKey` picks the area yourself.
     */
    async quickAdd(text: string, areaKey?: string): Promise<TodoTask & { area?: string | null }> {
      const t = await either(
        () => call(`${V1}/tasks/quick`, { method: 'POST', body: JSON.stringify({ text }) }),
        () => call(`${SYNC}/quick/add`, { method: 'POST', body: JSON.stringify({ text }) })
      )
      const task: TodoTask & { area?: string | null } = toTask(t ?? {}, await projects())
      try {
        const { areas, inboxId } = await areaList()
        const inPlainInbox = !task.sectionId && (!task.projectId || task.projectId === inboxId)
        const target = areaKey ? areas.find((a) => a.key === areaKey) ?? null : inPlainInbox && !/#\S/.test(text) ? await chooseArea(text, areas) : null
        if (target && task.id && target.key !== `p:${task.projectId}`) {
          await moveTo(task.id, target)
          task.section = target.kind === 'section' ? target.name : null
          task.sectionId = target.kind === 'section' ? target.id : null
          task.projectId = target.projectId
          task.area = target.name
        }
      } catch {
        /* the task is saved; it just stays where Todoist put it */
      }
      return task
    },
    /** Completed since `since` (ISO), newest first. */
    completedSince
  }
}
export type TodoistApi = ReturnType<typeof createTodoistApi>

/**
 * The /api/todoist ops that only talk to Todoist (api/todoist.mjs runs them;
 * `cleanup` stays there because it asks the AI). Shared with the end-to-end
 * test (web/todoistE2e.test.ts), so the test drives the same code as the site.
 * Returns null for an op it doesn't know.
 */
export async function todoistOp(api: TodoistApi, body: any): Promise<{ status: number; json: unknown } | null> {
  const ok = (json: unknown) => ({ status: 200, json })
  switch (body?.op) {
    case 'today':
      return ok({ connected: true, tasks: await api.today() })
    case 'changes':
      return ok(await api.changes(String(body.token || '*')))
    case 'lookup':
      // Tasks the app still shows but today's list no longer has: moved to another day, done, or deleted.
      return ok({ tasks: await api.lookup(Array.isArray(body.ids) ? body.ids.map(String).slice(0, 25) : [], body.since ? String(body.since).slice(0, 40) : undefined) })
    case 'upcoming':
      return ok({ tasks: await api.upcoming(7) })
    case 'close':
      await api.close(String(body.id))
      return ok({ ok: true })
    case 'quick':
      return ok({ task: await api.quickAdd(String(body.text || '').slice(0, 500), body.area ? String(body.area) : undefined) })
    case 'everything':
      return ok(await api.everything())
    case 'update': {
      // Answers with the task as Todoist now holds it, so the app shows the confirmed value.
      const task = await api.updateTask(String(body.id), { content: body.content, priority: body.priority, due: body.due, description: body.description, labels: Array.isArray(body.labels) ? body.labels : undefined, duration: body.duration === undefined ? undefined : body.duration === null ? null : Number(body.duration) })
      return ok({ ok: true, task })
    }
    case 'move':
      await api.move(String(body.id), String(body.area))
      return ok({ ok: true })
    case 'reopen':
      await api.reopen(String(body.id))
      return ok({ ok: true })
    case 'remove':
      await api.remove(String(body.id))
      return ok({ ok: true })
    case 'addArea':
      return ok({ area: await api.addArea(String(body.name || '').trim().slice(0, 60) || 'New area') })
    case 'renameArea':
      await api.renameArea(String(body.area), String(body.name || '').trim().slice(0, 60))
      return ok({ ok: true })
    case 'completed':
      return ok({ items: await api.completedSince(String(body.since || new Date(Date.now() - 86400_000).toISOString())) })
    default:
      return null
  }
}
