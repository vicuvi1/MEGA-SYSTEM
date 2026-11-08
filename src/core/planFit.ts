// Plan speed (pure, tested in planFit.test.ts):
//
//   - fitVerdict: does a block fit at this time? The same rules as the plan
//     card's checks (overlaps with blocks and fixed events, your off time, your
//     work limit and caps), as one short line for the drop zone while you drag:
//     "Fits · 45 min free" or "Doesn't fit: overlaps Lecture".
//   - nearestSlot: where it would fit, nearest to where you dropped it.
//   - placeQuick: a quick-added task for today gets a draft block placed by the
//     planner (at the time said when it fits, else the nearest free gap).
//   - tooMuchToday: "Too much today" keeps the must-dos and the most important
//     tasks that fit, and says what moves to tomorrow. Only loose draft blocks
//     move: pinned, approved, ticked and calendar blocks never do.
//
// Nothing here reads the clock (the caller passes `now`) or touches Todoist.
import { fmtLen } from './quickAdd'
import { blockRank, leftTasks, type AuditTask, type LeftTask } from './planAudit'
import { minOfDay, planItems, snap5, TRAIN_ID, type EditItem } from './planEdit'
import { capKind, CAP_NAMES, fmtH, isWork, type DayLimits } from './planLimits'
import { estimateMinutes } from './dayPacker'
import { sameThing } from './planDedupe'
import { fromMin, toMin, type DayProposal, type PlanBlock } from './rhythm'
import type { CalEvent } from './dayTime'

const DAY_END = 24 * 60

export interface FitCtx {
  /** Fixed events of the day (calendar events, protected time from your limits). */
  events: CalEvent[]
  /** Nothing is planned past this (bedtime minus wind-down, or your off time). */
  endBy: string
  limits?: DayLimits | null
  /** The time now (HH:MM): with it, a start in the past does not fit. */
  now?: string
}

export interface FitInput {
  /** The block being moved or stretched (left out of the busy time); none for a new one. */
  id?: string
  start: string
  minutes: number
  title: string
  kind?: PlanBlock['kind']
  train?: boolean
}

export interface Verdict {
  fits: boolean
  code: 'ok' | 'overlap' | 'off' | 'work' | 'cap' | 'past' | 'late'
  /** The line for the drop zone. */
  text: string
  /** The free window around the start, in minutes (0 when it overlaps). */
  free: number
}

type Span = { s: number; e: number; name: string }

/** Everything that holds time: the plan's blocks (but `id`) and the day's fixed events. */
function busy(plan: DayProposal, events: CalEvent[], id?: string): Span[] {
  const blocks = planItems(plan)
    .filter((b) => b.id !== id)
    .map((b) => ({ s: toMin(b.start), e: toMin(b.start) + b.minutes, name: b.title }))
  const fixed = events.filter((e) => !e.allDay && !e.declined).map((e) => ({ s: minOfDay(e.start, plan.day), e: minOfDay(e.end, plan.day), name: e.title }))
  return [...blocks, ...fixed].filter((x) => x.e > x.s).sort((a, b) => a.s - b.s)
}

const endByMin = (ctx: FitCtx) => Math.min(DAY_END, toMin(ctx.endBy))

/** Does this block fit at this time? One plain line either way. */
export function fitVerdict(plan: DayProposal, b: FitInput, ctx: FitCtx): Verdict {
  const s = toMin(b.start)
  const e = s + b.minutes
  const spans = busy(plan, ctx.events, b.id)
  const hit = spans.find((x) => x.s < e && s < x.e)
  const end = endByMin(ctx)
  // The free window around where it sits (nearest busy time before and after, and the end of the day).
  const lo = Math.max(ctx.now ? toMin(ctx.now) : 0, ...spans.filter((x) => x.e <= s).map((x) => x.e), 0)
  const hi = Math.min(end, ...spans.filter((x) => x.s >= e).map((x) => x.s), DAY_END)
  const free = hit ? 0 : Math.max(0, hi - lo)
  const bad = (code: Verdict['code'], text: string): Verdict => ({ fits: false, code, text: `Doesn't fit: ${text}`, free })
  if (ctx.now && s < toMin(ctx.now)) return bad('past', 'that time has passed')
  if (hit) return bad('overlap', `overlaps ${hit.name}`)
  const l = ctx.limits
  if (l?.offAt && e > toMin(l.offAt)) return bad('off', `over your ${l.offAt} off time`)
  if (e > end) return bad('late', `runs past ${ctx.endBy}`)
  const asBlock = { title: b.title, kind: b.kind }
  if (l && !b.train && isWork(asBlock)) {
    const others = planItems(plan).filter((x) => x.id !== b.id && !x.train && x.id !== TRAIN_ID && isWork(x))
    const total = others.reduce((t, x) => t + x.minutes, 0) + b.minutes
    if (l.maxFocusMin != null && total > l.maxFocusMin) return bad('work', `over your ${fmtH(l.maxFocusMin)} limit`)
    const k = capKind(asBlock)
    const cap = l.caps.find((c) => c.kind === k)
    if (cap && others.filter((x) => capKind(x) === k).reduce((t, x) => t + x.minutes, 0) + b.minutes > cap.minutes) return bad('cap', `over your ${fmtH(cap.minutes)} ${CAP_NAMES[cap.kind].toLowerCase()} limit`)
  }
  return { fits: true, code: 'ok', text: `Fits · ${fmtLen(free)} free`, free }
}

/** The start (5-minute steps) nearest to where it was dropped where the block fits, or null when nothing fits today. */
export function nearestSlot(plan: DayProposal, b: FitInput, ctx: FitCtx): string | null {
  const want = toMin(b.start)
  let best: number | null = null
  for (let s = 0; s + b.minutes <= DAY_END; s += 5) {
    if (!fitVerdict(plan, { ...b, start: fromMin(s) }, ctx).fits) continue
    if (best === null || Math.abs(s - want) < Math.abs(best - want)) best = s
  }
  return best === null ? null : fromMin(best)
}

// ---- Quick-add: where today's task goes -----------------------------------------

export interface Placed {
  start: string
  minutes: number
  /** true: not at the time said (it was taken, or none was said). */
  moved: boolean
  /** Why it is not where it was asked (for the toast). */
  why?: string
}

/**
 * A draft block for a quick-added task of today: at the time said when it fits, else
 * the first gap (the nearest one to the time said). `null`: no room today (the task stays on today's list).
 */
export function placeQuick(plan: DayProposal, t: { title: string; minutes?: number | null; time?: string | null; priority?: number }, ctx: FitCtx): Placed | null {
  const minutes = Math.max(15, snap5(t.minutes ?? estimateMinutes({ content: t.title, priority: t.priority ?? 1 })))
  const input: FitInput = { start: t.time ?? ctx.now ?? '09:00', minutes, title: t.title, kind: 'focus' }
  if (t.time) {
    const v = fitVerdict(plan, input, ctx)
    if (v.fits) return { start: t.time, minutes, moved: false }
    const near = nearestSlot(plan, input, ctx)
    return near ? { start: near, minutes, moved: true, why: `${t.time} was taken (${v.text.replace(/^Doesn't fit: /, '')})` } : null
  }
  const from = ctx.now ? fromMin(Math.min(DAY_END - 5, Math.ceil((toMin(ctx.now) + 5) / 5) * 5)) : '00:00'
  const near = nearestSlot(plan, { ...input, start: from }, ctx)
  return near ? { start: near, minutes, moved: false } : null
}

// ---- Dropping a task row on the day column ----------------------------------------

/** A task taken out of its block and put in a new block of its own at `start`. */
export function dropTaskAt(plan: DayProposal, o: { task: string; from: string; start: string; minutes: number; id: string }): DayProposal {
  const k = o.task.trim().toLowerCase()
  const blocks = plan.blocks
    .map((b) => (b.id === o.from ? { ...b, tasks: (b.tasks ?? []).filter((t) => t.toLowerCase() !== k), done: b.done?.filter((t) => t.toLowerCase() !== k) } : b))
    // A block left with no task of its own and not named for another task goes.
    .filter((b) => !(b.id === o.from && !(b.tasks ?? []).length && b.title.trim().toLowerCase() === k))
  const done = plan.blocks.find((b) => b.id === o.from)?.done?.some((t) => t.toLowerCase() === k)
  blocks.push({ id: o.id, title: o.task.trim(), start: o.start, minutes: o.minutes, kind: 'focus', tasks: [o.task.trim()], ...(done ? { done: [o.task.trim()] } : {}) })
  return { ...plan, blocks: blocks.sort((a, b) => a.start.localeCompare(b.start)) }
}

// ---- Too much today -------------------------------------------------------------

export interface TooMuchCtx {
  now: string
  events: CalEvent[]
  endBy: string
  limits?: DayLimits | null
  tasks?: AuditTask[]
  /** Share of the time left that work may fill (default 0.75: room to breathe). */
  share?: number
}

export interface TooMuch {
  /** Tasks that go to tomorrow (title and Todoist id when known), in the order of the plan. */
  items: Pick<LeftTask, 'title' | 'id'>[]
  /** The blocks they come from, for the line that says exactly what moved. */
  blocks: { title: string; start: string; minutes: number }[]
  /** Work minutes planned now / kept / the budget they were measured against. */
  planned: number
  kept: number
  budget: number
  /** Nothing to move: the day already fits (or only protected blocks are left). */
  fits: boolean
}

/** Free minutes from `from` to `to` outside the fixed events. */
function freeBetween(plan: DayProposal, events: CalEvent[], from: number, to: number): number {
  const spans = events
    .filter((e) => !e.allDay && !e.declined)
    .map((e) => [Math.max(from, minOfDay(e.start, plan.day)), Math.min(to, minOfDay(e.end, plan.day))] as const)
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0])
  let free = Math.max(0, to - from)
  let at = from
  for (const [a, b] of spans) {
    const s = Math.max(a, at)
    if (b > s) free -= b - s
    at = Math.max(at, b)
  }
  return Math.max(0, free)
}

const id0 = (plan: DayProposal, tasks: AuditTask[], t: string) => (plan.also ?? []).find((a) => sameThing(a.title, t))?.id ?? tasks.find((x) => sameThing(x.content, t))?.id

/**
 * Which tasks go to tomorrow. Stays: blocks you pinned, approved, ticked or that are in the calendar,
 * blocks already past, must-dos and what you asked for today; then the most important of the rest
 * (`blockRank`, earlier first) while the day's work stays within the budget: the least of your work
 * limit and `share` (75%) of the free time left. The rest moves, whole blocks at a time. Tasks that
 * are on the list with "no room today" go too (never a must-do).
 */
export function tooMuchToday(plan: DayProposal, c: TooMuchCtx): TooMuch {
  const tasks = c.tasks ?? []
  const now = toMin(c.now)
  const end = Math.min(DAY_END, toMin(c.endBy))
  const free = freeBetween(plan, c.events, Math.min(now, end), end)
  const limit = c.limits?.maxFocusMin ?? null
  const budget = Math.max(0, Math.floor(Math.min(free * (c.share ?? 0.75), limit ?? Infinity) / 5) * 5)
  const work = (b: EditItem) => !b.train && b.id !== TRAIN_ID && isWork(b)
  const items = planItems(plan)
  const loose = (b: EditItem) => !b.train && !b.locked && !b.ok && !b.sync?.eventId && !b.done?.length && toMin(b.start) + b.minutes > now
  const planned = items.filter(work).reduce((t, b) => t + b.minutes, 0)
  // What stays whatever happens: not loose, or a must-do / asked (rank 0).
  const fixedWork = items.filter((b) => work(b) && (!loose(b) || blockRank(b, plan, tasks) === 0))
  let kept = fixedWork.reduce((t, b) => t + b.minutes, 0)
  const move = new Set<string>()
  const candidates = items.filter((b) => work(b) && loose(b) && blockRank(b, plan, tasks) > 0).sort((a, b) => blockRank(a, plan, tasks) - blockRank(b, plan, tasks) || a.start.localeCompare(b.start))
  for (const b of candidates) {
    if (kept + b.minutes <= budget) kept += b.minutes
    else move.add(b.id)
  }
  const out: TooMuch['items'] = []
  const blocks: TooMuch['blocks'] = []
  const add = (title: string, id?: string) => {
    if (title.trim() && !out.some((x) => (id && x.id === id) || sameThing(x.title, title))) out.push({ title: title.trim(), ...(id ? { id } : {}) })
  }
  for (const b of items) {
    if (!move.has(b.id)) continue
    blocks.push({ title: b.title, start: b.start, minutes: b.minutes })
    for (const t of b.tasks?.length ? b.tasks : [b.title]) add(t, id0(plan, tasks, t))
  }
  // Tasks on the list with no room: they go too (a must-do or what you asked for stays).
  for (const l of leftTasks(plan, tasks)) {
    if (l.why !== 'room') continue
    const a = (plan.also ?? []).find((x) => sameThing(x.title, l.title))
    if (plan.mustdos.some((m) => sameThing(m, l.title)) || a?.asked || tasks.find((x) => sameThing(x.content, l.title))?.asked) continue
    add(l.title, l.id)
  }
  return { items: out, blocks, planned, kept, budget, fits: out.length === 0 }
}

/** The line that says exactly what moved: "Moved 2 to tomorrow: Essay outline (45 min), Tidy notes (15 min)". */
export function movedLine(t: Pick<TooMuch, 'items' | 'blocks'>): string {
  const mins = (title: string) => t.blocks.find((b) => sameThing(b.title, title))?.minutes
  const names = t.items.slice(0, 4).map((x) => (mins(x.title) ? `${x.title} (${fmtLen(mins(x.title)!)})` : x.title))
  const more = t.items.length > 4 ? ` +${t.items.length - 4} more` : ''
  return `Moved ${t.items.length} to tomorrow: ${names.join(', ')}${more}`
}
