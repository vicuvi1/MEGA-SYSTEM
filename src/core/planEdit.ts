// Editing the day plan right in its card (PE1, PE5, PE6, PE8), pure and tested
// in planEdit.test.ts. Every edit is a small operation on the plan that gives a
// new plan back: move a block (snapped to 5 minutes), stretch it, rename it,
// drop it, add one in a gap, move a task to another block, pin it, approve it
// on its own, tick a task. The training slot is edited the same way (its id is
// 'train'). Pinned (locked) blocks never move: not by a drag, a re-plan, the
// shift or Regenerate. What Google and Todoist hold (`sync`) is never touched
// here: core/planSync works out what to send.
import { freeWindows, planStartAt, relinkAlso } from './dayPacker'
import { blockStarted, type Span } from './planShift'
import { fromMin, toMin, type BlockSync, type DayProposal, type PlanBlock } from './rhythm'
import { localDay, type CalEvent } from './dayTime'

export const SNAP = 5
export const TRAIN_ID = 'train'
const DAY_END = 24 * 60

/** A block (or the training slot) as the editor sees it: always with an id. */
export interface EditItem extends PlanBlock {
  id: string
  train?: boolean
}

export type PlanEdit =
  | { op: 'move'; id: string; start: string }
  | { op: 'resize'; id: string; minutes: number }
  | { op: 'rename'; id: string; title: string }
  | { op: 'remove'; id: string }
  | { op: 'add'; start: string; minutes: number; title: string; id?: string }
  | { op: 'moveTask'; task: string; from: string; to: string }
  | { op: 'lock'; id: string; on: boolean }
  | { op: 'approve'; ids: string[]; on: boolean }
  | { op: 'tick'; id: string; task: string; on: boolean }
  /** A whole new plan (re-plan from now, the validator's fix). */
  | { op: 'replace'; plan: DayProposal; label: string }

/** Minutes rounded to the nearest 5. */
export const snap5 = (m: number) => Math.round(m / SNAP) * SNAP

/** A short stable id from text (the same block gets the same id on every device). */
function hashId(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

/** Each block gets an id (kept when it has one; two blocks never share one). */
export function ensureIds(plan: DayProposal): DayProposal {
  const seen = new Set<string>()
  let changed = false
  const blocks = plan.blocks.map((b, i) => {
    let id = b.id && !seen.has(b.id) ? b.id : `b${hashId(`${plan.day}|${b.title}|${b.start}|${i}`)}`
    while (seen.has(id)) id = `${id}x`
    seen.add(id)
    if (id === b.id) return b
    changed = true
    return { ...b, id }
  })
  return changed ? { ...plan, blocks } : plan
}

const trainMinutes = (t: NonNullable<DayProposal['training']>) => t.minutes ?? (Number(/(\d+)\s*min/.exec(t.what)?.[1]) || 45)

/** The blocks and the training slot, sorted by time, each with an id. */
export function planItems(plan: DayProposal): EditItem[] {
  const p = ensureIds(plan)
  const items: EditItem[] = p.blocks.map((b) => ({ ...b, id: b.id! }))
  if (p.training) {
    const t = p.training
    items.push({ id: TRAIN_ID, train: true, title: t.what, start: t.time, minutes: trainMinutes(t), locked: t.locked, ok: t.ok, sync: t.sync })
  }
  return items.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))
}

const endOf = (b: { start: string; minutes: number }) => toMin(b.start) + b.minutes

/** Writes one item back (a block, or the training slot). */
function putItem(plan: DayProposal, id: string, f: (b: EditItem) => EditItem | null): DayProposal {
  if (id === TRAIN_ID) {
    if (!plan.training) return plan
    const it = planItems(plan).find((x) => x.id === TRAIN_ID)!
    const next = f(it)
    if (!next) return { ...plan, training: null, removed: plan.training.sync?.eventId ? [...(plan.removed ?? []), { id: TRAIN_ID, eventId: plan.training.sync.eventId, calendarId: plan.training.sync.calendarId }] : plan.removed }
    const t = { ...plan.training, time: next.start, what: next.title, locked: next.locked, ok: next.ok, sync: next.sync }
    if (next.minutes !== trainMinutes(plan.training)) t.minutes = next.minutes
    return { ...plan, training: t }
  }
  const p = ensureIds(plan)
  const i = p.blocks.findIndex((b) => b.id === id)
  if (i < 0) return plan
  const next = f({ ...p.blocks[i], id })
  const blocks = [...p.blocks]
  if (!next) {
    const gone = blocks.splice(i, 1)[0]
    const removed = gone.sync?.eventId || gone.sync?.tasks?.length ? [...(p.removed ?? []), { id, eventId: gone.sync?.eventId, calendarId: gone.sync?.calendarId, tasks: gone.sync?.tasks?.map((t) => ({ id: t.id, title: t.title })) }] : p.removed
    return relinkAlso({ ...p, blocks, removed })
  }
  const { train: _t, ...block } = next
  blocks[i] = block
  return { ...p, blocks: blocks.sort((a, b) => a.start.localeCompare(b.start)) }
}

/** Applies one edit. A pinned block refuses to move or stretch (the same plan comes back). */
export function applyEdit(plan: DayProposal, e: PlanEdit): DayProposal {
  const p = ensureIds(plan)
  const item = 'id' in e && e.id ? planItems(p).find((x) => x.id === e.id) : undefined
  switch (e.op) {
    case 'move': {
      if (!item || item.locked) return p
      const s = Math.max(0, Math.min(DAY_END - item.minutes, snap5(toMin(e.start))))
      if (fromMin(s) === item.start) return p
      return relinkAlso(putItem(p, e.id, (b) => ({ ...b, start: fromMin(s) })))
    }
    case 'resize': {
      if (!item || item.locked) return p
      const m = Math.max(15, Math.min(DAY_END - toMin(item.start), snap5(e.minutes)))
      return m === item.minutes ? p : putItem(p, e.id, (b) => ({ ...b, minutes: m }))
    }
    case 'rename': {
      const t = e.title.replace(/\s+/g, ' ').trim().slice(0, 80)
      if (!item || !t || t === item.title) return p
      // A block that is just its one task renames the task too (Todoist gets the new name).
      const one = !item.train && item.tasks?.length === 1 && item.tasks[0].trim().toLowerCase() === item.title.trim().toLowerCase()
      const out = putItem(p, e.id, (b) => ({ ...b, title: t, ...(one ? { tasks: [t] } : {}) }))
      if (!one) return out
      const old = item.title.trim().toLowerCase()
      return relinkAlso({ ...out, mustdos: out.mustdos.map((m) => (m.trim().toLowerCase() === old ? t : m)), also: out.also?.map((a) => (a.title.trim().toLowerCase() === old ? { ...a, title: t } : a)) })
    }
    case 'remove':
      return item ? putItem(p, e.id, () => null) : p
    case 'add': {
      const t = e.title.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Focus'
      const start = fromMin(Math.max(0, Math.min(DAY_END - 15, snap5(toMin(e.start)))))
      const minutes = Math.max(15, Math.min(DAY_END - toMin(start), snap5(e.minutes)))
      const id = e.id ?? `b${hashId(`${p.day}|add|${t}|${start}|${p.blocks.length}`)}`
      if (p.blocks.some((b) => b.id === id)) return p
      return { ...p, blocks: [...p.blocks, { id, title: t, start, minutes, kind: 'focus' as const }].sort((a, b) => a.start.localeCompare(b.start)) }
    }
    case 'moveTask': {
      if (e.from === e.to) return p
      const from = p.blocks.find((b) => b.id === e.from)
      const to = p.blocks.find((b) => b.id === e.to)
      const k = e.task.trim().toLowerCase()
      if (!to || (from && !(from.tasks ?? []).some((t) => t.toLowerCase() === k))) return p
      if ((to.tasks ?? []).some((t) => t.toLowerCase() === k)) return p
      const blocks = p.blocks.map((b) => {
        if (b.id === e.from) return { ...b, tasks: (b.tasks ?? []).filter((t) => t.toLowerCase() !== k), done: b.done?.filter((t) => t.toLowerCase() !== k) }
        if (b.id === e.to) {
          // A block named after its one task gets a plain name once it holds two.
          return { ...b, tasks: [...(b.tasks ?? []), e.task.trim()], done: from?.done?.some((t) => t.toLowerCase() === k) ? [...(b.done ?? []), e.task.trim()] : b.done }
        }
        return b
      })
      return relinkAlso({ ...p, blocks })
    }
    case 'lock':
      return item && !!item.locked !== e.on ? putItem(p, e.id, (b) => ({ ...b, locked: e.on || undefined })) : p
    case 'approve': {
      let out = p
      for (const id of e.ids) out = putItem(out, id, (b) => ({ ...b, ok: e.on || undefined }))
      return out
    }
    case 'tick': {
      if (!item || item.train) return p
      const k = e.task.trim().toLowerCase()
      const has = (item.done ?? []).some((t) => t.toLowerCase() === k)
      if (has === e.on) return p
      return putItem(p, e.id, (b) => ({ ...b, done: e.on ? [...(b.done ?? []), e.task.trim()] : (b.done ?? []).filter((t) => t.toLowerCase() !== k) }))
    }
    case 'replace':
      return ensureIds(e.plan)
  }
}

/** The words for an edit (the undo toast: "Moved App dev to 10:15"). */
export function editLabel(e: PlanEdit, plan: DayProposal): string {
  const it = 'id' in e && e.id ? planItems(plan).find((x) => x.id === e.id) : undefined
  const name = it?.title ?? 'the block'
  switch (e.op) {
    case 'move':
      return `Moved ${name} to ${e.start}`
    case 'resize':
      return `${name}: ${e.minutes} min`
    case 'rename':
      return `Renamed to ${e.title.trim()}`
    case 'remove':
      return `Removed ${name}`
    case 'add':
      return `Added ${e.title.trim() || 'Focus'} at ${e.start}`
    case 'moveTask':
      return `Moved ${e.task} to ${plan.blocks.find((b) => b.id === e.to)?.title ?? 'another block'}`
    case 'lock':
      return e.on ? `Pinned ${name}` : `Unpinned ${name}`
    case 'approve':
      return e.on ? `Approved ${e.ids.length} block${e.ids.length === 1 ? '' : 's'}` : `Back to draft: ${e.ids.length} block${e.ids.length === 1 ? '' : 's'}`
    case 'tick':
      return e.on ? `Done: ${e.task}` : `Not done: ${e.task}`
    case 'replace':
      return e.label
  }
}

/** Is this block approved (the whole plan is, or this block on its own)? */
export const isApproved = (b: Pick<PlanBlock, 'ok'>, status: 'proposed' | 'approved') => status === 'approved' || !!b.ok

/** PE5 "Approve until 14:00": the ids of the blocks that start before `hm`. */
export function idsUntil(plan: DayProposal, hm: string): string[] {
  return planItems(plan)
    .filter((b) => toMin(b.start) < toMin(hm))
    .map((b) => b.id)
}

/** Free gaps (15 min+) between `from` and `to`, around the plan and the calendar's events: where a block can be added. */
export function planGaps(plan: DayProposal, events: CalEvent[], from: string, to: string, min = 15): { start: string; minutes: number }[] {
  const busy = [...planItems(plan).map((b) => ({ s: toMin(b.start), e: endOf(b) })), ...events.filter((e) => !e.allDay && !e.declined).map((e) => ({ s: minOfDay(e.start, plan.day), e: minOfDay(e.end, plan.day) }))].sort((a, b) => a.s - b.s)
  const out: { start: string; minutes: number }[] = []
  let at = snapUp(toMin(from))
  const end = toMin(to)
  for (const b of busy) {
    if (b.s - at >= min && at < end) out.push({ start: fromMin(at), minutes: Math.min(b.s, end) - at })
    at = Math.max(at, snapUp(b.e))
  }
  if (end - at >= min) out.push({ start: fromMin(at), minutes: end - at })
  return out.filter((g) => g.minutes >= min)
}

const snapUp = (m: number) => Math.ceil(m / SNAP) * SNAP

/** Minute of the plan's day for an ISO time (before the day: 0, after it: 24:00). */
export function minOfDay(iso: string, day: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso <= day ? 0 : DAY_END
  const d = new Date(iso)
  const local = localDay(iso)
  if (local < day) return 0
  if (local > day) return DAY_END
  return d.getHours() * 60 + d.getMinutes()
}

// ---- PE6: pinned blocks survive Regenerate ----------------------------------

/** Blocks a fresh plan must keep where they are: pinned ones, and approved ones already in the calendar. */
export function keptBlocks(prev: DayProposal | null | undefined): PlanBlock[] {
  return (prev?.blocks ?? []).filter((b) => b.locked || (b.ok && b.sync?.eventId))
}

/** Kept blocks as fixed calendar events (the packer plans around them). */
export function keptAsEvents(prev: DayProposal | null | undefined): CalEvent[] {
  if (!prev) return []
  return keptBlocks(prev).map((b) => {
    const s = new Date(`${prev.day}T${b.start}:00`)
    return { id: `kept-${b.id ?? b.start}`, calendarId: 'plan', title: b.title, start: s.toISOString(), end: new Date(s.getTime() + b.minutes * 60000).toISOString(), allDay: false }
  })
}

/** A fresh plan with the old plan's kept blocks put back (new blocks on top of them, and their tasks, give way). */
export function mergeKept(fresh: DayProposal, prev: DayProposal | null | undefined): DayProposal {
  const kept = keptBlocks(prev)
  if (!kept.length || !prev || prev.day !== fresh.day) return fresh
  const keptTasks = new Set(kept.flatMap((b) => b.tasks ?? []).map((t) => t.toLowerCase()))
  const clash = (b: PlanBlock) => kept.some((k) => toMin(b.start) < endOf(k) && endOf(b) > toMin(k.start))
  const blocks = fresh.blocks
    .filter((b) => !clash(b))
    // A new block whose every task sits in a kept block is not needed twice.
    .filter((b) => !b.tasks?.length || b.tasks.some((t) => !keptTasks.has(t.toLowerCase())))
    .map((b) => (b.tasks?.length ? { ...b, tasks: b.tasks.filter((t) => !keptTasks.has(t.toLowerCase())) } : b))
  // The old plan's removed-but-not-yet-cleared calendar events still need clearing.
  return relinkAlso(ensureIds({ ...fresh, blocks: [...blocks, ...kept].sort((a, b) => a.start.localeCompare(b.start)), removed: prev.removed, closed: prev.closed }))
}

// ---- PE8: re-plan from now ---------------------------------------------------

export interface ReplanResult {
  plan: DayProposal
  moved: number
  /** Blocks that no longer fit today (their tasks stay on today's list). */
  unplaced: string[]
}

/**
 * Re-packs only the time that is left: blocks already done (ended, or started
 * with a focus session) and pinned blocks stay; the rest are packed again, in
 * their order, into the free time from now (around the calendar's events).
 */
export function replanFromNow(plan: DayProposal, o: { now: string; events: CalEvent[]; sessions?: Span[]; endBy?: string }): ReplanResult {
  const p = ensureIds(plan)
  const startAt = planStartAt(o.now)
  const s0 = toMin(startAt)
  const sessions = o.sessions ?? []
  // Done: worked on (a focus session in its time) or every task ticked. Pinned: stays. Missed ones are packed again.
  const allTicked = (b: PlanBlock) => !!b.tasks?.length && b.tasks.every((t) => (b.done ?? []).some((d) => d.toLowerCase() === t.toLowerCase()))
  const stays = (b: PlanBlock) => !!b.locked || (toMin(b.start) < s0 && (blockStarted(b, p.day, sessions) || allTicked(b)))
  const keep = p.blocks.filter(stays)
  const move = p.blocks.filter((b) => !stays(b)).sort((a, b) => a.start.localeCompare(b.start))
  const asEvent = (b: PlanBlock): CalEvent => {
    const s = new Date(`${p.day}T${b.start}:00`)
    return { id: `keep-${b.id}`, calendarId: 'plan', title: b.title, start: s.toISOString(), end: new Date(s.getTime() + b.minutes * 60000).toISOString(), allDay: false }
  }
  const busy = [...o.events, ...keep.map(asEvent)]
  if (p.training && (p.training.locked || toMin(p.training.time) < s0)) busy.push(asEvent({ id: TRAIN_ID, title: p.training.what, start: p.training.time, minutes: trainMinutes(p.training) }))
  let wins = freeWindows(busy, p.day, startAt, o.endBy ?? '22:00')
  const placed: PlanBlock[] = []
  const unplaced: string[] = []
  let moved = 0
  for (const b of move) {
    const w = wins.find((x) => x.e - x.s >= b.minutes)
    if (!w) {
      unplaced.push(b.title)
      continue
    }
    const at = Math.ceil(w.s / SNAP) * SNAP
    if (fromMin(at) !== b.start) moved++
    placed.push({ ...b, start: fromMin(at) })
    const parts = [{ ...w, e: at - 10 }, { ...w, s: at + b.minutes + 10 }].filter((x) => x.e - x.s >= 15)
    wins = [...wins.slice(0, wins.indexOf(w)), ...parts, ...wins.slice(wins.indexOf(w) + 1)]
  }
  // Blocks that don't fit leave the plan: their tasks go back on today's list.
  const gone = move.filter((b) => unplaced.includes(b.title))
  const removed = [...(p.removed ?? []), ...gone.filter((b) => b.sync?.eventId || b.sync?.tasks?.length).map((b) => ({ id: b.id!, eventId: b.sync?.eventId, calendarId: b.sync?.calendarId, tasks: b.sync?.tasks?.map((t) => ({ id: t.id, title: t.title })) }))]
  const also = [...(p.also ?? [])]
  const lower = (s: string) => s.trim().toLowerCase()
  const must = new Set(p.mustdos.map(lower))
  for (const b of gone) for (const t of b.tasks?.length ? b.tasks : [b.title]) if (!must.has(lower(t)) && !also.some((a) => lower(a.title) === lower(t))) also.push({ title: t, minutes: Math.round(b.minutes / Math.max(1, b.tasks?.length ?? 1)), priority: 1 })
  const blocks = [...keep, ...placed].sort((a, b) => a.start.localeCompare(b.start))
  return { plan: relinkAlso({ ...p, blocks, also, removed }), moved, unplaced }
}

/** The sync snapshot a block would have right now (what Google and Todoist should hold). */
export function snapshotOf(b: Pick<PlanBlock, 'start' | 'minutes' | 'title'>, keep?: BlockSync): BlockSync {
  return { ...(keep ?? {}), start: b.start, minutes: b.minutes, title: b.title }
}
