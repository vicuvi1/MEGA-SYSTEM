// PE7: undo for every plan edit, pure and tested in planUndo.test.ts.
// A short stack (20 edits) of the plan before and after each one. Undoing
// puts the plan back as you had it, but keeps what Google and Todoist hold
// right now (`sync`), so the next sync round sends exactly the difference:
// a moved block moves back, a deleted one is made again, an added one goes.
import type { BlockSync, DayProposal, PlanBlock } from './rhythm'
import { ensureIds, TRAIN_ID } from './planEdit'

export const UNDO_MAX = 20

export interface UndoEntry {
  label: string
  before: DayProposal
  after: DayProposal
}

export class UndoStack {
  private list: UndoEntry[] = []
  private redoList: UndoEntry[] = []
  constructor(private max = UNDO_MAX) {}
  push(e: UndoEntry) {
    this.list.push(e)
    if (this.list.length > this.max) this.list.splice(0, this.list.length - this.max)
    this.redoList = []
  }
  /** The newest edit, taken off the stack. */
  undo(): UndoEntry | null {
    const e = this.list.pop() ?? null
    if (e) this.redoList.push(e)
    return e
  }
  redo(): UndoEntry | null {
    const e = this.redoList.pop() ?? null
    if (e) this.list.push(e)
    return e
  }
  peek(): UndoEntry | null {
    return this.list[this.list.length - 1] ?? null
  }
  get size() {
    return this.list.length
  }
  /** A new day or a fresh plan: the old edits mean nothing now. */
  clear() {
    this.list = []
    this.redoList = []
  }
}

/**
 * `target` (the plan as it was) with today's sync memory from `current`: blocks
 * that still exist keep their memory; a block that was deleted gets its memory
 * back if its event wasn't cleared yet, else it is made again; a block that
 * only exists now is deleted (its event goes on the removed list).
 */
export function rebase(target: DayProposal, current: DayProposal): DayProposal {
  const t = ensureIds(target)
  const c = ensureIds(current)
  const memory = new Map<string, BlockSync | undefined>()
  for (const b of c.blocks) memory.set(b.id!, b.sync)
  const pendingRemoved = new Map((c.removed ?? []).map((r) => [r.id, r]))
  const used = new Set<string>()
  const syncFor = (id: string): BlockSync | undefined => {
    if (memory.has(id)) return memory.get(id)
    const r = pendingRemoved.get(id)
    if (r) {
      used.add(id)
      // Its event still exists (not cleared yet): it is simply kept.
      const old = t.blocks.find((b) => b.id === id)?.sync ?? (id === TRAIN_ID ? t.training?.sync : undefined)
      return old && r.eventId ? { ...old, eventId: r.eventId, calendarId: r.calendarId } : undefined
    }
    return undefined
  }
  const blocks: PlanBlock[] = t.blocks.map((b) => {
    const s = syncFor(b.id!)
    const { sync: _old, ...rest } = b
    return s ? { ...rest, sync: s } : rest
  })
  const ids = new Set(blocks.map((b) => b.id))
  const removed = [...(c.removed ?? []).filter((r) => !used.has(r.id))]
  for (const b of c.blocks) if (!ids.has(b.id) && (b.sync?.eventId || b.sync?.tasks?.length)) removed.push({ id: b.id!, eventId: b.sync?.eventId, calendarId: b.sync?.calendarId, tasks: b.sync?.tasks?.map((x) => ({ id: x.id, title: x.title })) })
  let training = t.training
  if (training) {
    const s = c.training ? c.training.sync : syncFor(TRAIN_ID)
    const { sync: _o, ...rest } = training
    training = s ? { ...rest, sync: s } : rest
  } else if (c.training?.sync?.eventId) removed.push({ id: TRAIN_ID, eventId: c.training.sync.eventId, calendarId: c.training.sync.calendarId })
  const out: DayProposal = { ...t, blocks, training, closed: c.closed }
  if (removed.length) out.removed = removed
  else delete out.removed
  if (!c.closed) delete out.closed
  return out
}
