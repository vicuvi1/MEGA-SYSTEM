// The Top 3 (today's must-dos) follow Todoist. Pure (tested in
// todoistE2e.test.ts); the bridge runs it after Todoist's change check and on
// Sync, and writes the result with FocusService.followTodoist (never pays).
//
// Only must-dos linked to a Todoist task (by id) follow, and only ones not
// ticked yet:
// - renamed in Todoist → the must-do takes the new name;
// - moved to another day, its date taken off, or deleted → it leaves today's must-dos;
// - done in Todoist (a recurring one moved on to its next date counts) → ticked here.
// A task not known yet (no answer from Todoist) is left alone: never a guess.
import type { PlanItem } from './focus'
import type { TodoLookup, TodoTask } from './todoist'

export interface FollowResult {
  items: PlanItem[]
  changed: boolean
  /** Plain words for what changed ("Lab report moved to another day in Todoist"). */
  notes: string[]
}

/** Linked must-dos that today's list doesn't have: their ids, to look up. */
export function missingLinked(items: PlanItem[], today: TodoTask[]): string[] {
  const open = new Set(today.map((t) => t.id))
  return items.filter((i) => !i.done && i.todoistId && !open.has(i.todoistId)).map((i) => i.todoistId!)
}

export function followMustDos(items: PlanItem[], today: TodoTask[], where: Map<string, TodoLookup> | null, day: string): FollowResult {
  const open = new Map(today.map((t) => [t.id, t]))
  const notes: string[] = []
  const out: PlanItem[] = []
  for (const it of items) {
    if (it.done || !it.todoistId) {
      out.push(it)
      continue
    }
    const now = open.get(it.todoistId)
    if (now) {
      const name = now.content.trim()
      if (name && name !== it.text) {
        notes.push(`${it.text} renamed to ${name} in Todoist`)
        out.push({ ...it, text: name })
      } else out.push(it)
      continue
    }
    const l = where?.get(it.todoistId)
    if (!l || (l.state === 'open' && (!l.task || (l.task.due && l.task.due <= day)))) {
      out.push(it)
      continue
    }
    if (l.state === 'done') {
      notes.push(`${it.text} was done in Todoist`)
      out.push({ ...it, done: true })
      continue
    }
    notes.push(l.state === 'gone' ? `${it.text} was deleted in Todoist` : `${it.text} ${l.task?.due ? 'moved to another day' : 'has no date'} in Todoist`)
  }
  // The list can't be emptied (a must-do list needs one): then it stays as it was.
  if (!out.length) return { items, changed: false, notes: [] }
  return { items: out, changed: notes.length > 0, notes }
}
