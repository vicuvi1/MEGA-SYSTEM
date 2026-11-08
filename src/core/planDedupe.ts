// One thing = one block (pure, tested in planDupes.test.ts).
//
// The same thing reaches the planner from several places: a Todoist task, an
// app copy of it, a habit or a meeting in the calendar, a promise to Ben, a
// pinned block from the plan before. This file says when two titles are the
// same thing and cleans a plan so each thing shows once:
//
//   - by id first, then by the normalized title (case, punctuation, emoji in
//     front, a length like "(20 min)" or "1h" taken off). "Weekly review: plan
//     the week" is the same as the "Weekly review" event (the words before ":"
//     count when they are 2+ words, so a "University: read ch. 3" task is not
//     swallowed by a "University" class). Numbers that are not a length stay:
//     "chapter 3" and "chapter 4" are two things.
//   - what wins: a pinned or approved block, then a calendar event (it is
//     fixed), then the loose copy (a task's block). The loose copy leaves the
//     plan only; nothing is deleted anywhere, and the task stays on the list.
//   - a task in a block is not its own row in "Also today" (the block's
//     checkboxes hold it).
//
// Running it twice gives the same plan (idempotent).
import { localDay, type CalEvent } from './dayTime'
import { blockLook, plainTitle } from './planLook'
import type { AlsoItem, DayProposal, PlanBlock } from './rhythm'

/** A length in a title: "(20 min)", "· 45 min", "1h", "1.5 hours". */
const LENGTH = /[([]?\s*[·•-]?\s*\d+(?:[.,]\d+)?\s*(?:min|mins|minutes|m|h|hr|hrs|hours?)\b\s*[)\]]?/giu
/** Words that mark the day, not the thing ("@today"). */
const DAYWORDS = /@?\b(today|tonight)\b/giu

/** The title as a comparable key: no emoji in front, no length, no punctuation, lower case. */
export function normTitle(title: string): string {
  return plainTitle(String(title ?? ''))
    .toLowerCase()
    .replace(LENGTH, ' ')
    .replace(DAYWORDS, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** The words before ":" (or " - ", " — "), normalized; '' when there are none. */
export function headTitle(title: string): string {
  const m = /^(.+?)\s*(?::|\s[-–—]\s)\s*\S/u.exec(plainTitle(String(title ?? '')))
  return m ? normTitle(m[1]) : ''
}

const words = (s: string) => (s ? s.split(' ').length : 0)

/** Two titles name the same thing (see the rules at the top). */
export function sameThing(a: string, b: string): boolean {
  const na = normTitle(a)
  const nb = normTitle(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const ha = headTitle(a)
  const hb = headTitle(b)
  return (!!ha && words(ha) >= 2 && ha === nb) || (!!hb && words(hb) >= 2 && hb === na)
}

/**
 * The same task once: by id, then by normalized title (two ids with the same
 * words are one thing). The first one stays (pass them most important first);
 * it keeps "starred" and "asked" if a copy had them.
 */
export function dedupeTasks<T extends { id?: string; content: string; starred?: boolean; asked?: boolean }>(tasks: T[]): T[] {
  const out: T[] = []
  const ids = new Map<string, number>()
  const keys = new Map<string, number>()
  for (const t of tasks) {
    const k = normTitle(t.content)
    if (!t.content?.trim() || !k) continue
    const i = (t.id ? ids.get(t.id) : undefined) ?? keys.get(k)
    if (i != null) {
      const kept = out[i]
      if ((t.starred && !kept.starred) || (t.asked && !kept.asked)) out[i] = { ...kept, ...(t.starred ? { starred: true } : {}), ...(t.asked ? { asked: true } : {}) }
      if (t.id && !ids.has(t.id)) ids.set(t.id, i)
      continue
    }
    out.push(t)
    if (t.id) ids.set(t.id, out.length - 1)
    keys.set(k, out.length - 1)
  }
  return out
}

const pad = (n: number) => String(n).padStart(2, '0')
const hmOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const toM = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/**
 * The calendar events a task or block can be "the same thing" as: today's
 * timed events that are not over at `after`, not declined, and not the app's
 * own (its plan blocks and focus sessions are handled by their ids).
 */
export function fixedAhead(events: CalEvent[], day: string, after: string): { title: string; start: string }[] {
  const out: { title: string; start: string }[] = []
  for (const e of events) {
    if (e.allDay || e.ours || e.declined || /^\d{4}-\d{2}-\d{2}$/.test(e.start)) continue
    const s = new Date(e.start)
    const end = new Date(e.end)
    if (Number.isNaN(s.getTime()) || localDay(e.start) !== day) continue
    if (localDay(e.end) === day && toM(hmOf(end)) <= toM(after)) continue
    out.push({ title: e.title, start: hmOf(s) })
  }
  return out
}

/** The event (still ahead today) that a title is the same thing as, if any. */
export function eventFor(title: string, fixed: { title: string; start: string }[]): { title: string; start: string } | null {
  return fixed.find((e) => sameThing(title, e.title)) ?? null
}

/** A workout is already in the calendar today (still ahead): no second training slot. */
export const sportAhead = (fixed: { title: string }[]) => fixed.some((e) => blockLook(e.title).emoji === blockLook('', null, true).emoji)

/** A block that stays where it is: pinned, or approved and already in the calendar. */
const keptBlock = (b: PlanBlock) => !!b.locked || !!(b.ok && b.sync?.eventId)

/**
 * The plan with each thing once (see the top of the file). `events`: the
 * calendar's events that are NOT this plan's own blocks; `after`: where the
 * plan starts (events already over don't count).
 */
export function dedupePlan(plan: DayProposal, o: { events?: CalEvent[]; after?: string } = {}): DayProposal {
  const fixed = fixedAhead(o.events ?? [], plan.day, o.after ?? '00:00')
  // Must-dos: each once.
  const mustdos: string[] = []
  for (const m of plan.mustdos) if (m.trim() && !mustdos.some((x) => sameThing(x, m))) mustdos.push(m)

  // Blocks: kept ones claim their things first, then the rest in time order.
  const claimed: string[] = []
  const has = (t: string) => claimed.some((c) => sameThing(c, t))
  const order = [...plan.blocks].sort((a, b) => Number(keptBlock(b)) - Number(keptBlock(a)) || a.start.localeCompare(b.start))
  const keep = new Set<PlanBlock>()
  const changed = new Map<PlanBlock, PlanBlock>()
  for (const b of order) {
    const kept = keptBlock(b)
    const tasks = b.tasks ?? []
    if (tasks.length) {
      // A task already in another block, or the same thing as a calendar event, leaves this block.
      const left = kept ? tasks.filter((t, i) => tasks.findIndex((x) => sameThing(x, t)) === i) : tasks.filter((t, i) => tasks.findIndex((x) => sameThing(x, t)) === i && !has(t) && !eventFor(t, fixed))
      // Nothing left (its one task is an event, or every task is in another block): the block goes.
      if (!left.length) continue
      keep.add(b)
      if (left.length !== tasks.length) changed.set(b, { ...b, tasks: left, ...(b.done ? { done: b.done.filter((d) => left.some((t) => sameThing(t, d))) } : {}) })
      claimed.push(...left)
      if (tasks.length === 1) claimed.push(b.title)
    } else {
      if (!kept && (has(b.title) || eventFor(b.title, fixed))) continue
      keep.add(b)
      claimed.push(b.title)
    }
  }
  const blocks = plan.blocks.filter((b) => keep.has(b)).map((b) => changed.get(b) ?? b)

  // "Also today": each task once (id, then title); not a must-do; tied to its block or its event.
  const at = new Map<string, string>()
  for (const b of blocks) for (const t of b.tasks ?? []) at.set(normTitle(t), b.start)
  const blockTitles = blocks.filter((b) => !(b.tasks ?? []).length)
  let also: AlsoItem[] | undefined
  if (plan.also) {
    also = []
    for (const a of plan.also) {
      if (!a.title?.trim()) continue
      if (mustdos.some((m) => sameThing(m, a.title))) continue
      if (also.some((x) => (a.id && x.id === a.id) || sameThing(x.title, a.title))) continue
      const { at: _at, event: _ev, ...rest } = a
      const inBlock = at.get(normTitle(a.title)) ?? blocks.find((b) => (b.tasks ?? []).some((t) => sameThing(t, a.title)))?.start ?? blockTitles.find((b) => sameThing(b.title, a.title))?.start
      const ev = inBlock ? null : eventFor(a.title, fixed)
      also.push({ ...rest, ...(inBlock ? { at: inBlock } : {}), ...(ev ? { event: ev.start } : a.event && !inBlock ? { event: a.event } : {}) })
    }
  }
  // A workout already in the calendar: no second training slot (unless he pinned it).
  const training = plan.training && !plan.training.locked && sportAhead(fixed) ? null : plan.training
  return { ...plan, mustdos, blocks, ...(also ? { also } : {}), training }
}

/** "Also today" rows still without a time: not in a block (the block's checkboxes hold those). */
export const alsoOpen = (plan: Pick<DayProposal, 'also'>): AlsoItem[] => (plan.also ?? []).filter((a) => !a.at)
