// What the day plan must send to Google Calendar and Todoist (PE2, PE3), and
// what changed there that the plan should take in (PE4). Pure and tested in
// planSync.test.ts; the page (renderer/src/plan/planStore.ts) runs the calls.
//
// Each block remembers what the outside apps hold for it (`sync`: the event's
// id and time, each task's id and time). The work to do is the difference
// between the block as it is now and that memory, so many quick edits become
// one call per block (the page waits ~400 ms after the last one), and an undo
// is just another difference. Only approved blocks reach the calendar and
// task times (a draft syncs once it is approved); a tick closes the task in
// Todoist from any block.
//
// Two-way: an event moved, renamed or deleted in Google (or a task moved or
// closed in Todoist) changes the plan, unless the block has an edit of yours
// that is not sent yet: then yours is newer and wins.
import { fromMin, toMin, type BlockSync, type DayProposal } from './rhythm'
import { isApproved, minOfDay, planItems, TRAIN_ID, type EditItem } from './planEdit'
import type { CalEvent } from './dayTime'
import type { TodoTask } from './todoist'
import { blockLook, lookTitle, planEventId, plainTitle, sameTitle } from './planLook'

export type GoogleOp =
  /** `id`: the block's own event id (planEventId), so a second write finds the first event instead of making another. */
  | { kind: 'create'; id: string; title: string; start: string; end: string; description: string; colorId: string }
  | { kind: 'update'; eventId: string; calendarId: string; title?: string; start?: string; end?: string; description?: string; colorId?: string }
  | { kind: 'remove'; eventId: string; calendarId: string }

export type TodoOp =
  | { kind: 'time'; taskId: string; title: string; due: string; duration: number }
  | { kind: 'clear'; taskId: string; title: string; due: string }
  | { kind: 'rename'; taskId: string; content: string }
  | { kind: 'close'; taskId: string; title: string }
  | { kind: 'reopen'; taskId: string; title: string }

/** One block's work: at most one calendar call and its task calls. `snap` is its memory once they worked (null: forget it). */
export interface BlockJob {
  id: string
  /** 'removed': a deleted block's leftovers. */
  from: 'block' | 'removed'
  google?: GoogleOp
  todo: TodoOp[]
  snap: BlockSync | null
}

export interface SyncPlan {
  jobs: BlockJob[]
  /** Ticks and unticks (any block, draft or approved). */
  ticks: TodoOp[]
  /** plan.closed once the ticks went through. */
  closed: string[]
}

export interface SyncCtx {
  status: 'proposed' | 'approved'
  /** A task's Todoist id from its title (the plan's own list, then today's tasks). */
  taskId: (title: string) => string | undefined
  /** Now (minutes): a block that already ended is not put into the calendar. */
  nowMin?: number
}

const iso = (day: string, hm: string, plus = 0) => new Date(new Date(`${day}T${hm}:00`).getTime() + plus * 60000).toISOString()
const lower = (s: string) => s.trim().toLowerCase()

/** A block's open tasks laid one after another inside it (each gets its share of the time, 5 min at least). */
export function taskTimes(b: Pick<EditItem, 'start' | 'minutes' | 'tasks' | 'done' | 'train'>, taskId: (t: string) => string | undefined): { id: string; title: string; at: string; minutes: number }[] {
  if (b.train) return []
  const done = new Set((b.done ?? []).map(lower))
  const open = (b.tasks ?? []).filter((t) => !done.has(lower(t))).map((t) => ({ title: t, id: taskId(t) })).filter((x): x is { title: string; id: string } => !!x.id)
  if (!open.length) return []
  const per = Math.max(5, Math.floor(b.minutes / open.length / 5) * 5)
  return open.map((t, i) => ({ id: t.id, title: t.title, at: fromMin(Math.min(toMin(b.start) + i * per, 23 * 60 + 55)), minutes: per }))
}

/** The event's notes: where it came from and its tasks. */
export const eventNotes = (b: Pick<EditItem, 'tasks'>) => ['Planned with your coach in Life System', ...(b.tasks?.length ? ['', ...b.tasks.map((t) => `- ${t}`)] : [])].join('\n')

const sameTasks = (a: BlockSync['tasks'], b: BlockSync['tasks']) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])

/** Everything the plan must still send. Empty when Google and Todoist already match it. */
export function planJobs(plan: DayProposal, ctx: SyncCtx): SyncPlan {
  const items = planItems(plan)
  // A task's id: what this block already sent first (a renamed one-task block keeps its task), then the lookup.
  const idOf = (b: EditItem) => (t: string) => b.sync?.tasks?.find((x) => lower(x.title) === lower(t))?.id ?? (b.sync?.tasks?.length === 1 && b.tasks?.length === 1 ? b.sync.tasks[0].id : undefined) ?? ctx.taskId(t)
  const live = items.filter((b) => isApproved(b, ctx.status))
  // Where each task should be now (approved blocks), and every task the plan still holds.
  const want = new Map<string, { at: string; minutes: number; title: string }>()
  const desired = new Map<string, BlockSync['tasks']>()
  for (const b of live) {
    const tt = taskTimes(b, idOf(b))
    desired.set(b.id, tt)
    for (const t of tt) want.set(t.id, t)
  }
  const held = new Set(live.flatMap((b) => (b.tasks ?? []).map(idOf(b)).filter(Boolean) as string[]))
  // What Todoist was last given, by task id.
  const had = new Map<string, { at: string; minutes: number; title: string }>()
  for (const b of items) for (const t of b.sync?.tasks ?? []) had.set(t.id, t)
  const jobs: BlockJob[] = []
  const todoFor = (tasks: BlockSync['tasks']) => {
    const out: TodoOp[] = []
    for (const t of tasks ?? []) {
      const h = had.get(t.id)
      if (!h || h.at !== t.at || h.minutes !== t.minutes) out.push({ kind: 'time', taskId: t.id, title: t.title, due: `${plan.day} ${t.at}`, duration: t.minutes })
      if (h && h.title !== t.title) out.push({ kind: 'rename', taskId: t.id, content: t.title })
    }
    return out
  }
  const clearGone = (old: BlockSync['tasks']) => (old ?? []).filter((t) => !want.has(t.id) && !held.has(t.id)).map((t): TodoOp => ({ kind: 'clear', taskId: t.id, title: t.title, due: plan.day }))

  for (const b of items) {
    const prev = b.sync
    if (!isApproved(b, ctx.status)) {
      // Back to draft (or never approved): its calendar event goes, its tasks lose their time.
      if (!prev) continue
      jobs.push({ id: b.id, from: 'block', google: prev.eventId && prev.calendarId ? { kind: 'remove', eventId: prev.eventId, calendarId: prev.calendarId } : undefined, todo: clearGone(prev.tasks), snap: null })
      continue
    }
    const tasks = desired.get(b.id) ?? []
    // The event's look: an emoji by kind in front of the title, and the kind's colour.
    const title = lookTitle(b.title, b.kind, b.train)
    const colorId = blockLook(b.title, b.kind, b.train).colorId
    const names = b.train ? [] : (b.tasks ?? [])
    const snap: BlockSync = { start: b.start, minutes: b.minutes, title: b.title, ...(tasks.length ? { tasks } : {}), ...(names.length ? { names } : {}) }
    let google: GoogleOp | undefined
    if (!prev?.eventId) {
      const ended = ctx.nowMin != null && toMin(b.start) + b.minutes <= ctx.nowMin
      if (!ended) google = { kind: 'create', id: planEventId(plan.day, b.id), colorId, title, start: iso(plan.day, b.start), end: iso(plan.day, b.start, b.minutes), description: b.train ? 'Planned with your coach in Life System' : eventNotes(b) }
    } else {
      snap.eventId = prev.eventId
      snap.calendarId = prev.calendarId
      const moved = prev.start !== b.start || prev.minutes !== b.minutes
      const renamed = prev.title !== b.title
      // The notes list the tasks: rewritten when the list changed (an older memory without it: left alone).
      const notes = !b.train && prev.names !== undefined && JSON.stringify(prev.names) !== JSON.stringify(names)
      if (prev.names === undefined && names.length) snap.names = names
      if (moved || renamed || notes)
        google = {
          kind: 'update',
          eventId: prev.eventId,
          calendarId: prev.calendarId ?? 'primary',
          ...(moved ? { start: iso(plan.day, b.start), end: iso(plan.day, b.start, b.minutes) } : {}),
          ...(renamed ? { title, colorId } : {}),
          ...(notes ? { description: eventNotes(b) } : {})
        }
    }
    const todo = [...todoFor(tasks), ...clearGone(prev?.tasks)]
    const same = !!prev && prev.start === snap.start && prev.minutes === snap.minutes && prev.title === snap.title && sameTasks(prev.tasks, snap.tasks) && JSON.stringify(prev.names ?? []) === JSON.stringify(snap.names ?? [])
    if (google || todo.length || !same) jobs.push({ id: b.id, from: 'block', google, todo, snap })
  }
  for (const r of plan.removed ?? []) {
    jobs.push({ id: r.id, from: 'removed', google: r.eventId && r.calendarId ? { kind: 'remove', eventId: r.eventId, calendarId: r.calendarId } : undefined, todo: (r.tasks ?? []).filter((t) => !want.has(t.id) && !held.has(t.id)).map((t) => ({ kind: 'clear', taskId: t.id, title: t.title, due: plan.day })), snap: null })
  }
  // Ticks: closed in Todoist once; an untick reopens it.
  const doneIds = new Map<string, string>()
  for (const b of items) for (const t of b.done ?? []) {
    const id = idOf(b)(t)
    if (id) doneIds.set(id, t)
  }
  const closedBefore = new Set(plan.closed ?? [])
  const ticks: TodoOp[] = []
  for (const [id, title] of doneIds) if (!closedBefore.has(id)) ticks.push({ kind: 'close', taskId: id, title })
  for (const id of closedBefore) if (!doneIds.has(id)) ticks.push({ kind: 'reopen', taskId: id, title: '' })
  return { jobs, ticks, closed: [...doneIds.keys()] }
}

export interface JobResult {
  id: string
  from: 'block' | 'removed'
  ok: boolean
  snap: BlockSync | null
  /** The new event (create). */
  event?: { id: string; calendarId: string }
}

/**
 * Writes what went through into the (possibly newer) plan: each block's memory,
 * the removed list, the closed tasks. A block edited again meanwhile keeps its
 * new times; its memory is what was sent, so the next round sends the rest.
 */
export function settle(plan: DayProposal, results: JobResult[], closed?: string[]): DayProposal {
  let blocks = plan.blocks
  let training = plan.training
  let removed = plan.removed
  for (const r of results) {
    if (!r.ok) continue
    if (r.from === 'removed') {
      removed = (removed ?? []).filter((x) => x.id !== r.id)
      continue
    }
    const snap = r.snap ? { ...r.snap, ...(r.event ? { eventId: r.event.id, calendarId: r.event.calendarId } : {}) } : undefined
    if (r.id === TRAIN_ID) {
      if (training) training = { ...training, sync: snap }
      continue
    }
    blocks = blocks.map((b) => (b.id === r.id ? { ...b, sync: snap } : b))
  }
  const out: DayProposal = { ...plan, blocks, training }
  if (removed && removed.length) out.removed = removed
  else delete out.removed
  if (closed) out.closed = closed
  return out
}

// ---- PE4: changes made in Google Calendar or Todoist --------------------------

export interface RemoteResult {
  plan: DayProposal
  /** What changed, for the "updated from Google" toast. */
  notes: string[]
  from: ('google' | 'todoist')[]
}

/** Has this block an edit of yours that Google/Todoist doesn't have yet? */
export function pending(b: Pick<EditItem, 'start' | 'minutes' | 'title' | 'sync'>): boolean {
  return !!b.sync && (b.sync.start !== b.start || b.sync.minutes !== b.minutes || b.sync.title !== b.title)
}

/**
 * Takes in what changed outside. `events`: today's calendar (null when it could not be read:
 * then nothing is taken as deleted); `tasks`: today's open Todoist tasks (null: not read).
 */
export function mergeRemote(plan: DayProposal, events: CalEvent[] | null, tasks: TodoTask[] | null): RemoteResult {
  const notes: string[] = []
  const from = new Set<'google' | 'todoist'>()
  let p = plan
  const put = (id: string, f: (b: EditItem) => EditItem | null) => {
    if (id === TRAIN_ID) {
      if (!p.training) return
      const it = planItems(p).find((x) => x.id === TRAIN_ID)!
      const n = f(it)
      p = { ...p, training: n ? { ...p.training, time: n.start, what: n.title, sync: n.sync, ...(n.minutes !== it.minutes ? { minutes: n.minutes } : {}) } : null }
      return
    }
    const blocks = p.blocks.flatMap((b) => {
      if (b.id !== id) return [b]
      const n = f({ ...b, id })
      if (!n) return []
      const { train: _t, ...rest } = n
      return [rest]
    })
    p = { ...p, blocks: blocks.sort((a, b) => a.start.localeCompare(b.start)) }
  }
  for (const b of planItems(plan)) {
    const s = b.sync
    if (!s?.eventId || !events || pending(b)) continue
    const e = events.find((x) => x.id === s.eventId)
    if (!e) {
      put(b.id, () => null)
      notes.push(`${b.title} was deleted in Google Calendar`)
      from.add('google')
      continue
    }
    if (e.allDay) continue
    const start = fromMin(minOfDay(e.start, plan.day))
    const minutes = Math.max(5, minOfDay(e.end, plan.day) - minOfDay(e.start, plan.day))
    // The emoji the app puts in front of the title is not part of the block's name.
    const title = sameTitle(e.title, s.title) ? s.title : plainTitle(e.title)
    if (start === s.start && minutes === s.minutes && title === s.title) continue
    put(b.id, (x) => ({ ...x, start, minutes, title, sync: { ...s, start, minutes, title } }))
    notes.push(start !== s.start ? `${title} moved to ${start} in Google Calendar` : title !== s.title ? `${s.title} renamed to ${title} in Google Calendar` : `${title} is now ${minutes} min in Google Calendar`)
    from.add('google')
  }
  if (tasks) {
    const open = new Map(tasks.map((t) => [t.id, t]))
    for (const b of planItems(p)) {
      const s = b.sync
      if (!s?.tasks?.length || pending(b)) continue
      for (const t of s.tasks) {
        const now = open.get(t.id)
        const k = lower(t.title)
        if ((b.done ?? []).some((d) => lower(d) === k)) continue
        if (!now) {
          // Closed (or moved off today) in Todoist: ticked here, never closed twice.
          put(b.id, (x) => ({ ...x, done: [...(x.done ?? []), t.title] }))
          p = { ...p, closed: [...new Set([...(p.closed ?? []), t.id])] }
          notes.push(`${t.title} was done in Todoist`)
          from.add('todoist')
          continue
        }
        const at = now.due === plan.day ? now.dueTime : null
        if (at === t.at) continue
        if (at && (b.tasks ?? []).length === 1) {
          // Its block follows a single task's new time (the calendar event follows next round).
          put(b.id, (x) => ({ ...x, start: at, sync: { ...s, tasks: [{ ...t, at }] } }))
          // The block now differs from its calendar memory: keep the memory's time so Google is moved too.
          notes.push(`${t.title} moved to ${at} in Todoist`)
        } else {
          // Moved off this block's time (or the time was taken off): it leaves the block.
          put(b.id, (x) => ({ ...x, tasks: (x.tasks ?? []).filter((y) => lower(y) !== k), sync: { ...s, tasks: (s.tasks ?? []).filter((y) => y.id !== t.id) } }))
          notes.push(at ? `${t.title} moved to ${at} in Todoist` : `${t.title} has no time in Todoist now`)
        }
        from.add('todoist')
      }
    }
  }
  return { plan: p, notes, from: [...from] }
}

// ---- Batching quick edits ------------------------------------------------------

export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(h: unknown): void
}

/**
 * Runs `fn` once things go quiet for `ms` (each poke restarts the wait). A poke
 * while it runs runs it once more right after, so the last edit is never lost.
 */
export function createDebounce(ms: number, fn: () => Promise<void> | void, t: Timers = { set: (f, m) => setTimeout(f, m), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }) {
  let handle: unknown = null
  let running = false
  let again = false
  const run = async () => {
    handle = null
    if (running) {
      again = true
      return
    }
    running = true
    try {
      await fn()
    } finally {
      running = false
      if (again) {
        again = false
        poke()
      }
    }
  }
  const poke = () => {
    if (handle != null) t.clear(handle)
    handle = t.set(() => void run(), ms)
  }
  return {
    poke,
    /** Runs now (Retry, leaving the page). */
    now: () => {
      if (handle != null) t.clear(handle)
      return run()
    },
    pending: () => handle != null || running
  }
}

/**
 * An approved plan from before blocks remembered their events: each block is
 * matched to its calendar event by name and start (as approval wrote it), so
 * the first edit moves that event instead of making a second one.
 */
export function linkEvents(plan: DayProposal, status: 'proposed' | 'approved', events: CalEvent[]): DayProposal {
  const items = planItems(plan)
  const taken = new Set(items.map((b) => b.sync?.eventId).filter(Boolean))
  let p = plan
  for (const b of items) {
    if (b.sync?.eventId || !isApproved(b, status)) continue
    const e = events.find((x) => !taken.has(x.id) && !x.allDay && plainTitle(x.title) === plainTitle(b.title) && fromMin(minOfDay(x.start, plan.day)) === b.start)
    if (!e) continue
    taken.add(e.id)
    const sync: BlockSync = { eventId: e.id, calendarId: e.calendarId, start: b.start, minutes: Math.max(5, minOfDay(e.end, plan.day) - minOfDay(e.start, plan.day)), title: b.title }
    if (b.id === TRAIN_ID) p = { ...p, training: p.training ? { ...p.training, sync } : null }
    else p = { ...p, blocks: p.blocks.map((x) => (x.id === b.id ? { ...x, sync } : x)) }
  }
  return p
}
