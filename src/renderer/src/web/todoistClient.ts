// The browser's Todoist (through /api/todoist): reads, and edits that go
// through the waiting-edit queue (core/todoSync.ts). Every place that edits a
// task uses this one object: the Tasks page, Today, the plan card, Ben's quick
// commands and the island. Tested in todoistClient.test.ts.
import { calendarDay } from '@core/dates'
import type { Area, TodoDelta, TodoLookup, TodoTask } from '@core/todoist'
import { createTodoQueue, onTodayList, resolveDue, type TaskPatch } from '@core/todoSync'

export type TodoistCall = (op: string, extra?: Record<string, unknown>) => Promise<any>

export const PENDING_KEY = 'todoist_pending_edits'

/** localStorage, or nothing when the browser blocks it. */
export const localStore = (key = PENDING_KEY) => ({
  get: () => {
    try {
      return globalThis.localStorage?.getItem(key) ?? null
    } catch {
      return null
    }
  },
  set: (v: string) => {
    try {
      globalThis.localStorage?.setItem(key, v)
    } catch {
      /* blocked: kept for this visit only */
    }
  }
})

export function createTodoistClient(call: TodoistCall, opts: { store?: { get(): string | null; set(v: string): void }; now?: () => number; onChange?: () => void } = {}) {
  const now = opts.now ?? Date.now
  /** The task as last read, so a waiting edit can still show it in a list. */
  const known = new Map<string, TodoTask>()
  const remember = (list: TodoTask[]) => {
    for (const t of list) known.set(t.id, t)
    return list
  }
  const queue = createTodoQueue({
    send: async (id, patch) => (await call('update', { id, ...patch }))?.task ?? null,
    store: opts.store,
    now
  })
  if (opts.onChange) queue.subscribe(opts.onChange)
  const today = () => calendarDay(new Date(now()))
  /** Where tasks are now, as Todoist's change check last said (newest wins; a few hundred at most). */
  const where = new Map<string, TodoLookup & { at: number }>()
  const note = (l: TodoLookup) => {
    where.delete(l.id)
    where.set(l.id, { ...l, at: now() })
    if (where.size > 500) where.delete(where.keys().next().value as string)
  }
  /** Tasks this app wrote lately: their change coming back is not "a change from Todoist". */
  const wrote = new Map<string, number>()
  const mine = (id: string) => {
    wrote.set(String(id), now())
    if (wrote.size > 300) wrote.delete(wrote.keys().next().value as string)
  }
  const ours = (id: string) => now() - (wrote.get(id) ?? -Infinity) < 120_000
  /** The start of today on this device, for "done today" (a recurring task moves on when done). */
  const midnight = () => {
    const d = new Date(now())
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }

  return {
    queue,
    /**
     * Todoist's "anything new since token?": the changed tasks come with the
     * answer, so a task done, deleted, moved or renamed in Todoist is put right
     * here at once (a waiting edit of yours keeps only what Todoist didn't
     * change itself since; see core/todoSync.ts reconcilePatch).
     */
    async changes(token: string): Promise<{ token: string; changed: number; outside: number; items: TodoDelta[] }> {
      const j = await call('changes', { token })
      const items = (Array.isArray(j?.items) ? j.items : []) as TodoDelta[]
      let outside = Math.max(0, (Number(j?.changed) || 0) - items.length)
      for (const d of items) {
        if (!d || !d.id) continue
        if (!ours(d.id)) outside++
        const { checked, deleted, ...rest } = d
        const old = known.get(d.id)
        // The change check has no project names: keep the ones the last list read gave.
        const t: TodoTask = { ...rest, project: rest.project ?? old?.project ?? null, section: rest.section ?? old?.section ?? null }
        if (checked || deleted) {
          queue.remote(t, true)
          known.delete(d.id)
          note({ id: d.id, state: deleted ? 'gone' : 'done' })
        } else {
          queue.remote(t)
          known.set(d.id, t)
          note({ id: d.id, state: 'open', task: t })
        }
      }
      return { token: String(j?.token ?? ''), changed: Number(j?.changed) || 0, outside, items }
    },
    /**
     * Where these tasks are now (open on some day, done, or gone): from what
     * the change check already saw, else asked from Todoist. A recurring task
     * is always asked (done today, it stays open on its next date).
     */
    async lookup(ids: string[]): Promise<Map<string, TodoLookup>> {
      const out = new Map<string, TodoLookup>()
      const ask: string[] = []
      for (const id of new Set(ids)) {
        const w = where.get(id)
        if (w && !(w.state === 'open' && w.task?.recurring)) out.set(id, w)
        else ask.push(id)
      }
      if (ask.length) {
        const j = await call('lookup', { ids: ask.slice(0, 25), since: midnight() })
        for (const l of (j?.tasks ?? []) as TodoLookup[]) {
          if (!l?.id) continue
          out.set(l.id, l)
          if (l.state !== 'open') known.delete(l.id)
        }
      }
      return out
    },
    async today(): Promise<TodoTask[]> {
      const at = now()
      const list = remember(((await call('today')).tasks ?? []) as TodoTask[])
      return queue.overlay(list, at, onTodayList(today()))
    },
    async upcoming(): Promise<TodoTask[]> {
      const at = now()
      return queue.overlay(remember(((await call('upcoming')).tasks ?? []) as TodoTask[]), at)
    },
    async everything(): Promise<{ tasks: TodoTask[]; areas: Area[] }> {
      const at = now()
      const j = await call('everything')
      return { tasks: queue.overlay(remember((j.tasks ?? []) as TodoTask[]), at), areas: (j.areas ?? []) as Area[] }
    },
    /**
     * Changes a task in Todoist: only what changed is sent, "today"/"tomorrow"
     * become your own date. Resolves once Todoist confirms; on a failure the
     * edit waits in the queue (shown on the row with Retry) and this throws.
     */
    async update(id: string, patch: TaskPatch): Promise<void> {
      const clean: TaskPatch = {}
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) (clean as any)[k] = v
      if (clean.due !== undefined) clean.due = resolveDue(String(clean.due), new Date(now()))
      mine(id)
      try {
        const fields = await queue.edit(id, clean, known.get(id))
        const t = known.get(id)
        if (t && fields) known.set(id, { ...t, ...fields })
      } catch (e) {
        const why = String((e as Error)?.message || e)
        throw new Error(queue.status()[id]?.state === 'failed' ? `Couldn't save to Todoist (${why}). It will try again.` : `Couldn't save to Todoist: ${why}`)
      }
    },
    close: async (id: string) => {
      mine(id)
      await call('close', { id })
    },
    quickAdd: async (text: string, area?: string) => {
      const t = (await call('quick', { text, area })).task as TodoTask & { area?: string | null }
      if (t?.id) mine(t.id)
      return t
    },
    move: async (id: string, area: string) => {
      mine(id)
      await call('move', { id, area })
    },
    remove: async (id: string) => {
      mine(id)
      await call('remove', { id })
    },
    /** Reopens a task (an untick in the app). */
    reopen: async (id: string) => {
      mine(id)
      await call('reopen', { id })
    },
    /** Per task id: saving / failed / saved. */
    pending: () => queue.status(),
    retry: async (id: string) => {
      await queue.retry(id)
    },
    /** Waiting edits whose wait is over go out again (all of them with force: back online, Sync). */
    retryDue: (force = false) => queue.retryDue(force)
  }
}
export type TodoistClient = ReturnType<typeof createTodoistClient>
