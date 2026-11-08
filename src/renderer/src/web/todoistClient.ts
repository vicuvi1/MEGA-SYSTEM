// The browser's Todoist (through /api/todoist): reads, and edits that go
// through the waiting-edit queue (core/todoSync.ts). Every place that edits a
// task uses this one object: the Tasks page, Today, the plan card, Ben's quick
// commands and the island. Tested in todoistClient.test.ts.
import { calendarDay } from '@core/dates'
import type { Area, TodoTask } from '@core/todoist'
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

  return {
    queue,
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
      await call('close', { id })
    },
    quickAdd: async (text: string, area?: string) => (await call('quick', { text, area })).task as TodoTask & { area?: string | null },
    move: async (id: string, area: string) => {
      await call('move', { id, area })
    },
    remove: async (id: string) => {
      await call('remove', { id })
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
