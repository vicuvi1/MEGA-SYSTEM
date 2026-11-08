// Edits to Todoist tasks made in the app (Tasks page, Today, the plan card,
// Ben, the island), sent to Todoist and kept until Todoist confirms them.
// Pure (tested in todoSync.test.ts); the browser wires it in tursoWebBridge.ts.
//
// - Only the fields you changed are sent.
// - "today" / "tomorrow" become your own calendar date (this device's time
//   zone), so Todoist's account time zone can't put the task on the wrong day.
// - Until Todoist confirms, your edit wins over any list read from Todoist
//   (a refresh that started before the write landed shows your edit, not the
//   old value). After the confirm, Todoist's answer is what you see.
// - A failed write (offline, server busy, Todoist slow) stays in the queue,
//   is kept on reload, and is retried; the row says "Couldn't save to Todoist".
//   A write Todoist refuses outright (task gone, bad value) is dropped.
import { calendarDay, addDays } from './dates'
import { isStarred, type TodoTask } from './todoist'

/** What an edit may change on a Todoist task. */
export interface TaskPatch {
  content?: string
  /** Todoist's API value: 4 is P1 (use toApiPriority). */
  priority?: number
  /** "YYYY-MM-DD", "YYYY-MM-DD HH:MM", "no date", or Todoist's own words ("friday 18:00"). */
  due?: string
  description?: string
  labels?: string[]
  /** Minutes; null clears it. */
  duration?: number | null
}

const FIELDS = ['content', 'priority', 'due', 'description', 'labels', 'duration'] as const

/**
 * "today", "tomorrow" (optionally with a time) → your calendar date, "" → "no date".
 * Other words are left for Todoist to read.
 */
export function resolveDue(due: string, now: Date = new Date(), timeZone?: string): string {
  const v = due.trim()
  if (!v || /^no date$/i.test(v)) return 'no date'
  const m = /^(today|tod|tomorrow|tom|tmr)(?:\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?)?$/i.exec(v)
  if (!m) return v
  const day = calendarDay(now, timeZone)
  const date = /^tod/i.test(m[1]) ? day : addDays(day, 1)
  if (!m[2]) return date
  const h = Number(m[2])
  const min = Number(m[3] ?? 0)
  if (h > 23 || min > 59) return v
  return `${date} ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** The date and time an edit's due means, when it can be known here (null: Todoist will read it). */
export function parseDue(due: string): { due: string | null; dueTime: string | null } | null {
  if (/^no date$/i.test(due.trim())) return { due: null, dueTime: null }
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/.exec(due.trim())
  return m ? { due: m[1], dueTime: m[2] ?? null } : null
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Only what really changes compared with the task as last seen (everything, when it's unknown). */
export function diffPatch(base: TodoTask | undefined, patch: TaskPatch): TaskPatch {
  const out: TaskPatch = {}
  for (const k of FIELDS) {
    const v = patch[k]
    if (v === undefined) continue
    if (base) {
      if (k === 'due') {
        const p = parseDue(String(v))
        if (p && p.due === (base.due ?? null) && (p.dueTime ?? null) === (base.dueTime ?? null) && !base.recurring) continue
      } else if (k === 'labels') {
        if (same([...(v as string[])].sort(), [...(base.labels ?? [])].sort())) continue
      } else if (k === 'duration') {
        if ((v || null) === (base.duration || null)) continue
      } else if (same(v, (base as any)[k])) continue
    }
    ;(out as any)[k] = v
  }
  return out
}

/** The task as it will look once Todoist has the edit. */
export function applyPatch(t: TodoTask, patch: TaskPatch): TodoTask {
  const out: TodoTask = { ...t }
  if (patch.content !== undefined) out.content = patch.content
  if (patch.priority !== undefined) out.priority = patch.priority
  if (patch.description !== undefined) out.description = patch.description
  if (patch.labels !== undefined) out.labels = [...patch.labels]
  if (patch.duration !== undefined) out.duration = patch.duration || null
  if (patch.due !== undefined) {
    const p = parseDue(patch.due)
    if (p) {
      out.due = p.due
      out.dueTime = p.dueTime
    }
  }
  return out
}

/** Todoist's answer to a write: the fields it now holds. */
export type Confirmed = Partial<Pick<TodoTask, 'content' | 'priority' | 'due' | 'dueTime' | 'description' | 'labels' | 'duration' | 'recurring'>>

const CONFIRMED_KEYS = ['content', 'priority', 'due', 'dueTime', 'description', 'labels', 'duration', 'recurring'] as const
export const confirmedOf = (t: Partial<TodoTask> | null | undefined): Confirmed | null => {
  if (!t || typeof t !== 'object') return null
  const out: Confirmed = {}
  for (const k of CONFIRMED_KEYS) if ((t as any)[k] !== undefined) (out as any)[k] = (t as any)[k]
  return Object.keys(out).length ? out : null
}

/** Worth trying again later (offline, server busy) or refused for good (task gone, bad value)? */
export function retryable(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e ?? '')
  if ((e as any)?.status && (e as any).status >= 400 && (e as any).status < 500 && (e as any).status !== 408 && (e as any).status !== 429) return false
  return !/Todoist (400|404|410|422)\b|not found|Invalid argument/i.test(msg)
}

export type EditState = 'saving' | 'failed' | 'saved'
export interface EditStatus {
  state: EditState
  error?: string
}

interface Entry {
  id: string
  patch: TaskPatch
  /** The task as last seen, so a list can show it (e.g. a task just moved to today). */
  base?: TodoTask
  state: 'saving' | 'failed'
  error?: string
  tries: number
  nextAt: number
  ver: number
}

export interface TodoQueueOpts {
  /** Sends the edit to Todoist; resolves with the task Todoist now holds (or null when it says only "ok"). */
  send: (id: string, patch: TaskPatch) => Promise<Partial<TodoTask> | null>
  /** Where waiting edits are kept across reloads (localStorage in the browser). */
  store?: { get(): string | null; set(v: string): void }
  now?: () => number
}

/** How long Todoist's confirmed value beats a list read that started before it. */
const CONFIRM_KEEP = 60_000
/** How long "✓ saved" shows on a row. */
const SAVED_SHOW = 4000

export function createTodoQueue(opts: TodoQueueOpts) {
  const now = opts.now ?? Date.now
  const entries = new Map<string, Entry>()
  const confirmed = new Map<string, { fields: Confirmed; at: number }>()
  const inflight = new Map<string, Promise<Confirmed | null>>()
  const subs = new Set<() => void>()
  let ver = 0

  try {
    const raw = JSON.parse(opts.store?.get() ?? '[]')
    if (Array.isArray(raw)) for (const e of raw) if (e && typeof e.id === 'string' && e.patch) entries.set(e.id, { id: e.id, patch: e.patch, base: e.base, state: 'failed', error: e.error || 'Waiting to be sent', tries: Number(e.tries) || 0, nextAt: 0, ver: ++ver })
  } catch {
    /* nothing kept */
  }

  const save = () => {
    try {
      opts.store?.set(JSON.stringify([...entries.values()].map(({ id, patch, base, error, tries }) => ({ id, patch, base, error, tries }))))
    } catch {
      /* storage full or blocked: the edit still goes out now */
    }
  }
  const emit = () => {
    save()
    for (const f of subs) f()
  }
  const backoff = (tries: number) => Math.min(5 * 60_000, 5000 * 2 ** Math.max(0, tries - 1))

  const run = async (id: string): Promise<Confirmed | null> => {
    const busy = inflight.get(id)
    if (busy) {
      // One write per task at a time; the newer edit goes right after.
      await busy.catch(() => null)
      return entries.has(id) ? run(id) : (confirmed.get(id)?.fields ?? null)
    }
    const e = entries.get(id)
    if (!e) return confirmed.get(id)?.fields ?? null
    const sentVer = e.ver
    e.state = 'saving'
    e.error = undefined
    emit()
    const p = (async () => {
      try {
        const answer = await opts.send(id, e.patch)
        const cur = entries.get(id)
        const fields = confirmedOf(answer) ?? (cur ? confirmedOf(applyPatch(cur.base ?? ({ id } as TodoTask), cur.patch)) : null) ?? {}
        if (cur && cur.ver === sentVer) {
          entries.delete(id)
          confirmed.set(id, { fields, at: now() })
        }
        return fields
      } catch (err) {
        const cur = entries.get(id)
        if (cur) {
          if (retryable(err)) {
            cur.state = 'failed'
            cur.error = String((err as Error)?.message || err)
            cur.tries++
            cur.nextAt = now() + backoff(cur.tries)
          } else entries.delete(id)
        }
        throw err
      } finally {
        inflight.delete(id)
        emit()
      }
    })()
    inflight.set(id, p)
    const out = await p
    // A newer edit came in while this one was on its way: send that too.
    return entries.has(id) ? run(id) : out
  }

  return {
    /** Queue an edit (merged with one still waiting for this task) and send it; resolves once Todoist confirms. */
    edit(id: string, patch: TaskPatch, base?: TodoTask): Promise<Confirmed | null> {
      const prev = entries.get(id)
      const wanted = { ...(prev?.patch ?? {}), ...patch }
      const changed = prev ? wanted : diffPatch(base, patch)
      if (!Object.keys(changed).length) return Promise.resolve(confirmedOf(base) ?? null)
      entries.set(id, { id, patch: changed, base: prev?.base ?? base, state: 'saving', tries: prev?.tries ?? 0, nextAt: 0, ver: ++ver })
      confirmed.delete(id)
      emit()
      return run(id)
    },
    /** A list read from Todoist, with waiting edits on top (and Todoist's confirmed answer over a read that started before it). */
    overlay(tasks: TodoTask[], readStartedAt: number, keep?: (t: TodoTask) => boolean): TodoTask[] {
      const t0 = now()
      for (const [id, c] of confirmed) if (t0 - c.at > CONFIRM_KEEP) confirmed.delete(id)
      const seen = new Set<string>()
      const out: TodoTask[] = []
      for (const t of tasks) {
        seen.add(t.id)
        const e = entries.get(t.id)
        const c = confirmed.get(t.id)
        const v = e ? applyPatch(t, e.patch) : c && c.at > readStartedAt ? ({ ...t, ...c.fields } as TodoTask) : t
        if (!keep || keep(v)) out.push(v)
      }
      // A task your edit brings into this list (moved to today) before Todoist has it there.
      if (keep)
        for (const e of entries.values()) {
          if (seen.has(e.id) || !e.base) continue
          const v = applyPatch(e.base, e.patch)
          if (keep(v)) out.push(v)
        }
      return out
    },
    /** Send again every waiting edit whose wait is over (all of them with force). */
    retryDue(force = false): void {
      const t = now()
      for (const e of entries.values()) if (!inflight.has(e.id) && (force || e.nextAt <= t)) void run(e.id).catch(() => null)
    },
    retry(id: string): Promise<Confirmed | null> {
      return run(id)
    },
    /** Per task: saving… / failed (with why) / saved (for a few seconds after Todoist confirmed). */
    status(): Record<string, EditStatus> {
      const out: Record<string, EditStatus> = {}
      const t = now()
      for (const [id, c] of confirmed) if (t - c.at < SAVED_SHOW) out[id] = { state: 'saved' }
      for (const e of entries.values()) out[e.id] = e.state === 'failed' ? { state: 'failed', error: e.error } : { state: 'saving' }
      return out
    },
    get pending(): number {
      return entries.size
    },
    subscribe(fn: () => void): () => void {
      subs.add(fn)
      return () => subs.delete(fn)
    }
  }
}
export type TodoQueue = ReturnType<typeof createTodoQueue>

/** Today's list: due today or late, or starred for today. */
export const onTodayList = (today: string) => (t: TodoTask) => (!!t.due && t.due <= today) || isStarred(t)
