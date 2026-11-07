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

/** One row of the single "Today" list on the Day page. */
export interface TodayRow { key: string; kind: 'now' | 'must' | 'todoist'; text: string; done: boolean; i?: number; id?: string; time?: string | null }

/**
 * The one Today list: the current block first, then your must-dos, then
 * Todoist tasks due today. A title shows once (the same rules as
 * `dedupeTodos`). Done items leave the list and are only counted.
 * The week's top 3 is never a list: it is a small "n/3" chip.
 */
export function buildToday(o: { now?: { title: string } | null; mustdos: MustRow[]; top: TopRow[]; todoist: TodoRow[]; plan?: string[]; max?: number }): { open: TodayRow[]; done: number; week: { done: number; total: number } | null } {
  const rows = dedupeTodos({ mustdos: o.mustdos, top: o.top, todoist: o.todoist, plan: o.plan, max: o.max ?? 8 })
  const open: TodayRow[] = []
  const seen = new Set<string>()
  const nowTitle = o.now?.title?.trim()
  if (nowTitle) { open.push({ key: 'now', kind: 'now', text: nowTitle, done: false }); seen.add(normTitle(nowTitle)) }
  let done = 0
  for (const m of rows.mustdos) {
    if (m.done) { done++; continue }
    const n = normTitle(m.text)
    if (n && seen.has(n)) continue
    if (n) seen.add(n)
    open.push({ key: `must:${m.i}`, kind: 'must', text: m.text, done: false, i: m.i })
  }
  for (const t of rows.todoist) {
    const n = normTitle(t.content)
    if (n && seen.has(n)) continue
    if (n) seen.add(n)
    open.push({ key: `task:${t.id}`, kind: 'todoist', text: t.content, done: false, id: t.id, time: t.time })
  }
  const week = rows.top.length ? { done: rows.top.filter((r) => r.done).length, total: rows.top.length } : null
  return { open, done, week }
}

/** Ben's last message stays on the Day page for this long. */
export const BEN_CARD_MS = 2 * 3600_000

/** Show Ben's last message only while it is fresh (under ~2 h) or while Ben is writing a new one. */
export function benCardVisible(last: { at: string } | null | undefined, busy: boolean, nowMs: number): boolean {
  if (busy) return true
  if (!last) return false
  const t = Date.parse(last.at)
  if (!Number.isFinite(t)) return false
  return nowMs - t >= -60_000 && nowMs - t < BEN_CARD_MS
}
