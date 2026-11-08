// "Your day" column: one thing = one entry (pure, tested in dayColumn.test.ts).
//
// The column draws Google events and Todoist tasks with a time. The same item
// can arrive from both (a block moved in the plan: the task has the new time
// while the old calendar event is still there until Google catches up), or
// twice from the calendar (an old copy next to the moved one). We keep one:
//   - a task goes when an event holds it (its id is in the event's checklist),
//     or has the same title (exact: always; the same words: when they overlap);
//   - two events with the same words that overlap in time are one: the one
//     made by Life System stays, then the first.
// Two different things never merge: the words must match, and for anything
// that is not an exact title the times must overlap.
import { sameThing } from './planDedupe'

export interface ColumnItem {
  key: string
  title: string
  /** Minutes from midnight. */
  start: number
  end: number
  kind: 'event' | 'task'
  /** Made by Life System (an event). */
  ours?: boolean
  /** Task ids this event already holds in its checklist. */
  holds?: string[]
  /** The task's id. */
  taskId?: string
}

const overlaps = (a: ColumnItem, b: ColumnItem) => a.start < b.end && b.start < a.end

/** The column's items with each thing once (events keep their order). */
export function dedupeColumn<T extends ColumnItem>(items: T[]): T[] {
  const events = items.filter((i) => i.kind === 'event')
  const keptEvents: T[] = []
  for (const e of events) {
    const i = keptEvents.findIndex((k) => sameThing(k.title, e.title) && overlaps(k, e))
    if (i < 0) keptEvents.push(e)
    else if (e.ours && !keptEvents[i].ours) keptEvents[i] = e
  }
  const keep = new Set<string>(keptEvents.map((e) => e.key))
  const held = new Set(keptEvents.flatMap((e) => e.holds ?? []))
  const out: T[] = []
  for (const it of items) {
    if (it.kind === 'event') {
      if (keep.has(it.key)) out.push(it)
      continue
    }
    if (it.taskId && held.has(it.taskId)) continue
    const dup = keptEvents.some((e) => e.title.trim().toLowerCase() === it.title.trim().toLowerCase() || (sameThing(e.title, it.title) && overlaps(e, it)))
    if (!dup) out.push(it)
  }
  return out
}
