// Re-plan by itself (pure, tested in planAuto.test.ts). When the day changes,
// the DRAFT part of today's plan that the change hits moves, and nothing else:
//
//   - a draft block the clock passed and that was not started (10 min grace),
//   - a draft block that now sits on a calendar event (added, moved, or one
//     that runs long) or on a block that is still being worked on past its end,
//   - a new task from Todoist with P1/P2 (or one you asked for) gets a free gap
//     when there is room; otherwise it goes on the list ("no room today").
//
// Pinned blocks, approved blocks, blocks in the calendar and calendar events
// never move. Blocks the change doesn't touch stay where they are (no churn),
// so the same inputs always give the same plan, and running it on its own
// result changes nothing (no flip-flop). What doesn't fit goes on today's list
// and shows in the audit line. Only the plan changes; drafts don't sync.
import { estimateMinutes, planStartAt, relinkAlso } from './dayPacker'
import { auditPlan, blockRank, type AuditCtx, type AuditTask } from './planAudit'
import { normTitle, sameThing } from './planDedupe'
import { ensureIds, isApproved, minOfDay, planItems } from './planEdit'
import type { Span } from './planShift'
import { fromMin, toMin, type DayProposal, type PlanBlock } from './rhythm'
import type { CalEvent } from './dayTime'
import { endWith, underLimits, withProtected } from './planLimits'

export interface AutoCtx extends Omit<AuditCtx, 'now' | 'tasks'> {
  now: string
  /** The calendar's fixed events now (not this plan's own blocks). */
  events: CalEvent[]
  /** The same events at the last look (to say "moved", "ran long" or "was added"). */
  prevEvents?: CalEvent[]
  /** Today's focus sessions (a block with one was started; a running one has e = now). */
  sessions?: Span[]
  /** Today's open tasks (Todoist and the app). */
  tasks?: AuditTask[]
  /** Task ids/titles the plan knew at the last look: anything else "came in from Todoist". */
  known?: string[]
  /** The plan ends by then (default 22:00). */
  endBy?: string
}

export interface AutoMove {
  id: string
  title: string
  from: string | null
  to: string | null
}

export interface AutoResult {
  plan: DayProposal
  moves: AutoMove[]
  /** One short note ("Moved 'Lab report' to 15:40 because the call ran long"), null: nothing changed. */
  note: string | null
}

type Busy = { s: number; e: number; why: string; id?: string }

const GRACE = 10
const GAP = 10
const q = (s: string) => `'${s.length > 40 ? `${s.slice(0, 39)}…` : s}'`

/** Can the automatic re-plan move this block? Only a draft nobody has touched in the outside apps. */
export function autoMovable(b: PlanBlock, status: 'proposed' | 'approved'): boolean {
  return !b.locked && !isApproved(b, status) && !b.sync?.eventId && !b.done?.length
}

/** Why an event is in the way, compared with the last look. */
function eventWhy(e: CalEvent, prev: CalEvent[] | undefined, day: string): string {
  const was = prev?.find((p) => p.id === e.id)
  if (!prev) return `because of ${e.title}`
  if (!was) return `because ${e.title} was added`
  if (minOfDay(was.start, day) === minOfDay(e.start, day) && minOfDay(e.end, day) > minOfDay(was.end, day)) return `because ${e.title} ran long`
  return `because ${e.title} moved`
}

/**
 * The automatic re-plan. `status`: the plan's approval. Returns the same plan
 * object (and no note) when nothing needs to change.
 */
export function autoReplan(raw: DayProposal, status: 'proposed' | 'approved', ctx: AutoCtx): AutoResult {
  const plan = ensureIds(raw)
  const day = plan.day
  const nowM = toMin(ctx.now)
  const s0 = toMin(planStartAt(ctx.now))
  // Your off time ends the day when it is earlier (planLimits): nothing is moved past it.
  const endM = toMin(endWith(ctx.endBy ?? '22:00', ctx.limits))
  const sessions = ctx.sessions ?? []
  // Started here: a focus session began in this block's time (one that runs on into the next block belongs to this one).
  const startedHere = (b: Pick<PlanBlock, 'start' | 'minutes'>) => {
    const from = Date.parse(`${day}T${b.start}:00`)
    return sessions.some((x) => x.s >= from - GRACE * 60000 && x.s < from + b.minutes * 60000)
  }
  const allTicked = (b: PlanBlock) => !!b.tasks?.length && b.tasks.every((t) => (b.done ?? []).some((d) => sameThing(d, t)))

  // What is busy: fixed events, blocks that can't move, and a started block that runs past its end.
  const busy: Busy[] = []
  // Protected time (training on its days, meals) is busy like an event.
  for (const e of withProtected(ctx.events, ctx.limits, day)) {
    if (e.allDay || e.declined) continue
    const s = minOfDay(e.start, day)
    const en = minOfDay(e.end, day)
    if (en > s && en - s < 12 * 60) busy.push({ s, e: en, why: eventWhy(e, ctx.prevEvents, day) })
  }
  const items = planItems(plan)
  for (const b of items) {
    const s = toMin(b.start)
    const e = s + b.minutes
    const started = startedHere(b)
    if (started) {
      // Still being worked on past its end: the time up to now (or the session's end) is taken.
      const from = Date.parse(`${day}T${b.start}:00`)
      const to = from + b.minutes * 60000
      const last = Math.max(0, ...sessions.filter((x) => x.s < to && x.e > from).map((x) => x.e))
      const over = last > to ? Math.min(24 * 60, e + Math.ceil((last - to) / 60000)) : e
      busy.push({ s, e: over, why: over > e ? `because ${b.title} ran long` : '' })
    } else if (b.train || !autoMovable(b, status) || allTicked(b)) busy.push({ s, e, why: '' })
  }

  // What has to move: late drafts, and drafts that sit on something busy. The rest stays put.
  const loose = plan.blocks.filter((b) => autoMovable(b, status) && !startedHere(b) && !allTicked(b))
  const hitBy = (b: PlanBlock) => busy.find((x) => x.s < toMin(b.start) + b.minutes && toMin(b.start) < x.e)
  const go = new Map<string, string>()
  for (const b of loose) {
    if (toMin(b.start) < nowM - GRACE) go.set(b.id!, `because it didn't start at ${b.start}`)
    else {
      const h = hitBy(b)
      if (h) go.set(b.id!, h.why || 'to make room')
    }
  }
  // Blocks that stay are busy too (the moved ones go around them).
  for (const b of loose) if (!go.has(b.id!)) busy.push({ s: toMin(b.start), e: toMin(b.start) + b.minutes, why: '', id: b.id })

  const lower = (s: string) => s.trim().toLowerCase()
  const must = new Set(plan.mustdos.map(lower))
  const rank = (b: PlanBlock) => blockRank(b, plan, ctx.tasks)
  const moving = loose.filter((b) => go.has(b.id!)).sort((a, b) => rank(a) - rank(b) || a.start.localeCompare(b.start) || a.id!.localeCompare(b.id!))

  // The first free spot from now for `minutes` (10 minutes from anything busy), or null.
  const spot = (minutes: number): number | null => {
    const sorted = [...busy].sort((a, b) => a.s - b.s)
    let at = Math.ceil(s0 / 5) * 5
    for (const x of sorted) {
      if (x.e + GAP <= at) continue
      if (x.s - GAP >= at + minutes) break
      at = Math.max(at, Math.ceil((x.e + GAP) / 5) * 5)
    }
    return at + minutes <= endM ? at : null
  }
  // No spot for the whole block: the biggest free window left, when it still makes a real block (25 min+).
  const biggest = (): { at: number; minutes: number } | null => {
    const sorted = [...busy].sort((a, b) => a.s - b.s)
    let at = Math.ceil(s0 / 5) * 5
    let best: { at: number; minutes: number } | null = null
    for (const x of [...sorted, { s: endM + GAP, e: endM + GAP, why: '' }]) {
      if (x.e + GAP <= at) continue
      const room = Math.floor((Math.min(x.s - GAP, endM) - at) / 5) * 5
      if (room >= 25 && (!best || room > best.minutes)) best = { at, minutes: room }
      at = Math.max(at, Math.ceil((x.e + GAP) / 5) * 5)
    }
    return best
  }

  const moves: AutoMove[] = []
  const why = new Map<string, string>()
  let blocks = [...plan.blocks]
  const also = [...(plan.also ?? [])]
  // Free minutes left today (windows of 25 min+). When what has to move is more than that, each moving
  // block is capped at an hour first, so the important ones all keep a block instead of one taking it all.
  const freeLeft = (): number => {
    const sorted = [...busy].sort((a, b) => a.s - b.s)
    let at = Math.ceil(s0 / 5) * 5
    let total = 0
    for (const x of [...sorted, { s: endM + GAP, e: endM + GAP, why: '' }]) {
      if (x.e + GAP <= at) continue
      const room = Math.floor((Math.min(x.s - GAP, endM) - at) / 5) * 5
      if (room >= 25) total += room
      at = Math.max(at, Math.ceil((x.e + GAP) / 5) * 5)
    }
    return total
  }
  const crowded = moving.reduce((t, b) => t + b.minutes, 0) > freeLeft()
  const want = (b: PlanBlock) => (crowded ? Math.min(b.minutes, 60) : b.minutes)
  const offList = (b: PlanBlock) => {
    blocks = blocks.filter((x) => x.id !== b.id)
    const names = b.tasks?.length ? b.tasks : [b.title]
    for (const t of names) if (!must.has(lower(t)) && !also.some((a) => sameThing(a.title, t))) also.push({ title: t, minutes: Math.round(b.minutes / names.length), priority: 1 })
  }
  for (const b0 of moving) {
    const b = { ...b0, minutes: want(b0) }
    let at = spot(b.minutes)
    let minutes = b.minutes
    // Shortened, when it keeps at least half of it (and 25 min).
    if (at == null) {
      const big = biggest()
      if (big && big.minutes >= Math.max(25, b.minutes / 2)) {
        at = big.at
        minutes = Math.min(b.minutes, big.minutes)
      }
    }
    // Still no room: a less important draft that stays gives way (the least important, latest first).
    if (at == null) {
      const losers = loose.filter((x) => !go.has(x.id!) && blocks.some((y) => y.id === x.id) && rank(x) > rank(b)).sort((x, y) => rank(y) - rank(x) || y.start.localeCompare(x.start))
      for (const l of losers) {
        const i = busy.findIndex((x) => x.id === l.id)
        if (i < 0) continue
        const [held] = busy.splice(i, 1)
        const fit = spot(b.minutes)
        const big = fit == null ? biggest() : null
        if (fit != null || (big && big.minutes >= Math.max(25, b.minutes / 2))) {
          at = fit ?? big!.at
          minutes = fit != null ? b.minutes : Math.min(b.minutes, big!.minutes)
          offList(l)
          moves.push({ id: l.id!, title: l.title, from: l.start, to: null })
          why.set(l.id!, `to make room for ${q(b.title)}`)
          break
        }
        busy.splice(i, 0, held)
      }
    }
    if (at == null) {
      const big = biggest()
      if (big) {
        at = big.at
        minutes = Math.min(b.minutes, big.minutes)
      }
    }
    if (at == null) {
      // No room left today: off the plan, its tasks on today's list (the audit line offers tomorrow).
      offList(b)
      moves.push({ id: b.id!, title: b.title, from: b.start, to: null })
      why.set(b.id!, go.get(b.id!)!)
      continue
    }
    busy.push({ s: at, e: at + minutes, why: '' })
    if (fromMin(at) === b.start && minutes === b0.minutes) continue
    blocks = blocks.map((x) => (x.id === b.id ? { ...x, start: fromMin(at!), minutes } : x))
    moves.push({ id: b.id!, title: b.title, from: b.start, to: fromMin(at) })
    why.set(b.id!, go.get(b.id!)!)
  }

  // New tasks from Todoist (P1/P2, or asked for): a free gap when there is one.
  const known = ctx.known ? new Set(ctx.known.map(normTitle)) : null
  const inPlan = (t: AuditTask) => [...plan.mustdos, ...plan.blocks.flatMap((b) => [b.title, ...(b.tasks ?? [])]), ...(plan.also ?? []).map((a) => a.title), ...(plan.deferred ?? []).map((d) => d.title)].some((x) => sameThing(x, t.content)) || (!!t.id && [...(plan.also ?? []), ...(plan.deferred ?? [])].some((a) => a.id === t.id))
  if (known) {
    for (const t of ctx.tasks ?? []) {
      if (!t.content?.trim() || inPlan(t) || known.has(normTitle(t.content)) || (t.id && known.has(normTitle(t.id)))) continue
      if ((plan.dropped ?? []).includes(normTitle(t.content)) || (t.id && plan.closed?.includes(t.id))) continue
      if (!((t.priority ?? 1) >= 3 || t.asked)) continue
      const minutes = Math.max(25, Math.min(90, Math.ceil(estimateMinutes(t) / 5) * 5))
      // Your work limit and caps hold: no room under them means the task stays on the list.
      if (!underLimits({ ...plan, blocks }, { title: t.content, kind: 'focus', minutes }, ctx.limits)) continue
      const at = spot(minutes)
      if (at == null) continue
      busy.push({ s: at, e: at + minutes, why: '' })
      const id = `a${normTitle(t.id ?? t.content).replace(/[^a-z0-9]/g, '').slice(0, 20)}`
      if (blocks.some((b) => b.id === id)) continue
      blocks.push({ id, title: t.content.trim(), start: fromMin(at), minutes, kind: 'focus', tasks: [t.content.trim()] })
      moves.push({ id, title: t.content.trim(), from: null, to: fromMin(at) })
      why.set(id, 'because it came in from Todoist')
    }
  }

  // New blocks keep your limits too: a cap or the off time trims the least important draft (the audit below).
  if (!moves.length) {
    // Nothing to move: the same plan (the card's audit lists a task that arrived without room).
    return { plan: raw, moves: [], note: null }
  }
  blocks.sort((a, b) => a.start.localeCompare(b.start))
  const next = relinkAlso({ ...plan, blocks, also })
  // The audit tidies up (one thing = one block, every task somewhere); moved blocks keep their new spot.
  const keep = moves.filter((m) => m.to).map((m) => m.id)
  const done = auditPlan(next, { ...ctx, tasks: ctx.tasks, keep: [...(ctx.keep ?? []), ...keep], fixTimes: false, keepLimits: true }).plan
  const ordered = [...moves.filter((m) => m.to), ...moves.filter((m) => !m.to)]
  return { plan: done, moves: ordered, note: autoNote(ordered, why) }
}

/** "Moved 'Lab report' to 15:40 because the call ran long" (+ how many more). */
export function autoNote(moves: AutoMove[], why: Map<string, string>): string | null {
  if (!moves.length) return null
  const m = moves[0]
  const reason = why.get(m.id) ?? ''
  const more = moves.length > 1 ? ` (+${moves.length - 1} more)` : ''
  if (m.to == null) return `No room left today for ${q(m.title)}, it's on the list${reason ? ` (${reason.replace(/^because /, '')})` : ''}${more}`
  const first = m.from == null ? `Added ${q(m.title)} at ${m.to}` : `Moved ${q(m.title)} to ${m.to}`
  return `${first}${reason ? ` ${reason}` : ''}${more}`.replace(/\s+/g, ' ').trim()
}

// ---- When it may run ------------------------------------------------------------

export const AUTO_GAP_MS = 2 * 60_000
export const AUTO_PER_DAY = 5

export interface AutoMeta {
  day: string
  count: number
  /** When the last automatic re-plan ran (ms). */
  at: number
  /** The plan (its block times) before and after the last run: a run that would undo it is a flip-flop. */
  before?: string
  after?: string
}

/** The block times of a plan, as a short key (what a flip-flop would bring back). */
export const timesKey = (p: DayProposal) =>
  planItems(p)
    .map((b) => `${b.id}@${b.start}+${b.minutes}`)
    .join(',')

/**
 * May the automatic re-plan run now? Off in Settings, while you drag or type
 * in a block, more than once in 2 minutes, more than 5 times a day: no.
 */
export function autoAllowed(o: { on: boolean; editing: boolean; meta: AutoMeta | null; day: string; nowMs: number }): { ok: boolean; why?: string } {
  if (!o.on) return { ok: false, why: 'off' }
  if (o.editing) return { ok: false, why: 'editing' }
  const m = o.meta && o.meta.day === o.day ? o.meta : null
  if (m && m.count >= AUTO_PER_DAY) return { ok: false, why: 'limit' }
  if (m && o.nowMs - m.at < AUTO_GAP_MS) return { ok: false, why: 'soon' }
  return { ok: true }
}

/** A result that puts back what the last run moved away (A → B → A): refused. */
export function isFlipFlop(meta: AutoMeta | null, day: string, cur: DayProposal, next: DayProposal): boolean {
  if (!meta || meta.day !== day || !meta.before || !meta.after) return false
  return timesKey(cur) === meta.after && timesKey(next) === meta.before
}

/** The meta after a run. */
export function afterRun(meta: AutoMeta | null, day: string, nowMs: number, before: DayProposal, after: DayProposal): AutoMeta {
  const count = meta && meta.day === day ? meta.count + 1 : 1
  return { day, count, at: nowMs, before: timesKey(before), after: timesKey(after) }
}
