// The island's to-do rows, without doubles (pure, tested in islandTodos.test.ts).
// Today's list comes from four places that can name the same thing: your
// must-dos, this week's top 3, Todoist and tasks from the plan. One thing
// shows once: first by Todoist id, then by its title (case, spaces, emoji and
// end punctuation ignored). The first place in that order keeps it:
// must-dos, then top 3, then Todoist.

/** A title compared loosely: lower case, no emoji or punctuation, one space between words. */
export function normTitle(t: string): string {
  return String(t ?? '')
    .normalize('NFKD')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export interface TodoRow { id: string; content: string; time: string | null }
export interface MustRow { i: number; text: string; done: boolean }
export interface TopRow { i: number; text: string; done: boolean }

/** Todoist rows: the same id twice, or the same title twice, shows once. */
export function dedupeTodoist<T extends { id: string; content: string }>(list: T[]): T[] {
  const ids = new Set<string>()
  const titles = new Set<string>()
  const out: T[] = []
  for (const t of list) {
    const n = normTitle(t.content)
    if (ids.has(t.id) || (n && titles.has(n))) continue
    ids.add(t.id)
    if (n) titles.add(n)
    out.push(t)
  }
  return out
}

/**
 * Must-dos, top 3 and Todoist as the island shows them. `plan` is the titles
 * of tasks the plan already shows (they hide a Todoist row with the same
 * title, never a must-do). Row indexes (`i`) stay as they were: a tap still
 * finds its must-do or top-3 item.
 */
export function dedupeTodos(o: { mustdos: MustRow[]; top: TopRow[]; todoist: TodoRow[]; plan?: string[]; max?: number }): { mustdos: MustRow[]; top: TopRow[]; todoist: TodoRow[] } {
  const seen = new Set<string>()
  const take = <T,>(rows: T[], text: (r: T) => string): T[] =>
    rows.filter((r) => {
      const n = normTitle(text(r))
      if (!n) return true
      if (seen.has(n)) return false
      seen.add(n)
      return true
    })
  const mustdos = take(o.mustdos, (r) => r.text)
  const top = take(o.top, (r) => r.text)
  for (const p of o.plan ?? []) {
    const n = normTitle(p)
    if (n) seen.add(n)
  }
  const todoist = take(dedupeTodoist(o.todoist), (r) => r.content).slice(0, o.max ?? 3)
  return { mustdos, top, todoist }
}
