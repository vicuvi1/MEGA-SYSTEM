// QA1: Ben checks his own plan before it is shown or saved. Pure and tested
// in planCheck.test.ts. checkPlan() lists what is wrong; fixPlan() fixes what
// it safely can (blocks in the past, overlaps, no break after 90 minutes of
// deep work, a plan that runs into the wind-down, no water goal) and leaves
// the rest as a warning chip on the card ("2 blocks overlap — fix?").
// Pinned blocks are never moved by a fix; the others make room.
import { FREE_SHARE, planStartAt } from './dayPacker'
import { ensureIds, planItems, minOfDay, TRAIN_ID, type EditItem } from './planEdit'
import { fromMin, toMin, type DayProposal } from './rhythm'
import type { CalEvent } from './dayTime'

export type IssueCode = 'overlap' | 'breaks' | 'meal' | 'water' | 'late' | 'toomuch' | 'nofree' | 'past'

export interface PlanIssue {
  code: IssueCode
  /** Short words for the chip. */
  text: string
  /** The blocks it is about. */
  ids: string[]
  /** fixPlan() can fix it. */
  fixable: boolean
}

export interface CheckCtx {
  /** Now, HH:MM (no block may start before it; null: skip the check, e.g. tomorrow's draft). */
  now: string | null
  /** Bedtime target (HH:MM; after midnight counts as late night). */
  bedtime?: string
  /** Minutes of wind-down before bed (default 45). */
  windDown?: number
  /** The calendar's fixed events today (blocks must not sit on them). */
  events?: CalEvent[]
  /** The water reminders are on (Coach rhythm prefs). */
  water?: boolean
  /** The share of the free time that should stay unplanned (My life; default 0.15). */
  freeShare?: number
  /** Blocks the user just placed: fixPlan treats them as pinned (the others make room). */
  keep?: string[]
}

export const DEEP_MAX = 90
const BREAK_MIN = 10
const MEAL = { from: toMin('11:30'), to: toMin('14:30'), need: 30 }

type Span = { s: number; e: number; id: string; locked: boolean; fixed: boolean; deep: boolean; title: string }

const deepOf = (b: EditItem) => !b.train && b.kind !== 'quick'

/** Bed minus the wind-down, in minutes of the day (bed after midnight counts as 24:00+). */
function lastEnd(ctx: CheckCtx): number {
  const bed = toMin(ctx.bedtime ?? '23:30')
  const b = bed < toMin('12:00') ? bed + 24 * 60 : bed
  return b - (ctx.windDown ?? 45)
}

function spans(plan: DayProposal, ctx: CheckCtx): Span[] {
  const keep = new Set(ctx.keep ?? [])
  const items = planItems(plan).map((b): Span => ({ s: toMin(b.start), e: toMin(b.start) + b.minutes, id: b.id, locked: !!b.locked || keep.has(b.id), fixed: false, deep: deepOf(b), title: b.title }))
  const ev = (ctx.events ?? [])
    .filter((e) => !e.allDay && !e.declined)
    .map((e): Span => ({ s: minOfDay(e.start, plan.day), e: minOfDay(e.end, plan.day), id: `ev:${e.id}`, locked: true, fixed: true, deep: false, title: e.title }))
    .filter((x) => x.e > x.s && x.e - x.s < 12 * 60)
  return [...items, ...ev].sort((a, b) => a.s - b.s || a.e - b.e)
}

/** Every problem with the plan (empty: it's fine). */
export function checkPlan(plan: DayProposal, ctx: CheckCtx): PlanIssue[] {
  const out: PlanIssue[] = []
  const all = spans(plan, ctx)
  const mine = all.filter((x) => !x.fixed)
  // Overlaps: two blocks, or a block on a fixed event.
  const clash = new Set<string>()
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length && all[j].s < all[i].e; j++) {
      if (all[i].fixed && all[j].fixed) continue
      if (all[j].s < all[i].e && all[i].s < all[j].e) {
        if (!all[i].fixed) clash.add(all[i].id)
        if (!all[j].fixed) clash.add(all[j].id)
      }
    }
  if (clash.size) out.push({ code: 'overlap', text: `${clash.size} blocks overlap`, ids: [...clash], fixable: [...clash].some((id) => !mine.find((m) => m.id === id)?.locked) })
  // Deep work: a break of 10+ minutes at least every 90 minutes.
  const tired: string[] = []
  let run = 0
  let lastE = -1
  for (const x of mine) {
    if (!x.deep) {
      run = 0
      lastE = x.e
      continue
    }
    run = x.s - lastE >= BREAK_MIN || lastE < 0 ? x.e - x.s : run + (x.e - Math.max(x.s, lastE))
    if (run > DEEP_MAX && x.e - x.s <= DEEP_MAX) tired.push(x.id)
    lastE = x.e
  }
  if (tired.length) out.push({ code: 'breaks', text: `No break after ${DEEP_MAX} min of deep work`, ids: tired, fixable: true })
  // A meal window: 30 free minutes around lunch, when the plan runs through it.
  const covers = mine.some((x) => x.s < MEAL.to && x.e > MEAL.from)
  if (covers) {
    let free = 0
    let at = MEAL.from
    for (const x of all.filter((y) => y.e > MEAL.from && y.s < MEAL.to)) {
      free = Math.max(free, Math.min(x.s, MEAL.to) - at)
      at = Math.max(at, x.e)
    }
    free = Math.max(free, MEAL.to - at)
    if (free < MEAL.need) out.push({ code: 'meal', text: 'No time for lunch', ids: mine.filter((x) => x.s < MEAL.to && x.e > MEAL.from).map((x) => x.id), fixable: false })
  }
  if (ctx.water !== false && !(plan.waterMl > 0)) out.push({ code: 'water', text: 'No water goal', ids: [], fixable: true })
  // Ends before bedtime minus the wind-down.
  const end = lastEnd(ctx)
  const late = mine.filter((x) => x.e > end)
  if (late.length) out.push({ code: 'late', text: `Runs past ${fromMin(Math.min(end, 24 * 60 - 5) % (24 * 60))} (wind-down)`, ids: late.map((x) => x.id), fixable: late.some((x) => !x.locked) })
  // In the past.
  if (ctx.now) {
    const s0 = toMin(ctx.now)
    const past = planItems(plan).filter((b) => toMin(b.start) < s0 - 10 && toMin(b.start) + b.minutes > s0 && !b.locked && !b.sync?.eventId)
    const gone = planItems(plan).filter((b) => toMin(b.start) + b.minutes <= s0 && !b.locked && !b.sync && !(b.done?.length))
    const ids = [...past, ...gone].map((b) => b.id)
    if (ids.length) out.push({ code: 'past', text: `${ids.length} block${ids.length === 1 ? ' is' : 's are'} in the past`, ids, fixable: true })
  }
  // More planned than the free time.
  const from = ctx.now ? toMin(ctx.now) : Math.min(...mine.map((x) => x.s), end)
  // Busy time from fixed events, counted once where events overlap (a call inside a work window is not extra).
  let busy = 0
  let reach = from
  for (const x of all.filter((y) => y.fixed && y.e > from && y.s < end)) {
    const s = Math.max(x.s, reach)
    const e = Math.min(x.e, end)
    if (e > s) busy += e - s
    reach = Math.max(reach, e)
  }
  const free = Math.max(0, end - from - busy)
  const planned = mine.filter((x) => x.e > from).reduce((t, x) => t + x.e - Math.max(x.s, from), 0)
  if (planned > free + 5) out.push({ code: 'toomuch', text: `${Math.round((planned - free) / 5) * 5} min more than your free time`, ids: [], fixable: false })
  // No free time: a plan should leave some of the free time unplanned (15% unless My life says otherwise).
  else if (free >= 60) {
    const share = typeof ctx.freeShare === 'number' && Number.isFinite(ctx.freeShare) ? Math.max(0, Math.min(0.5, ctx.freeShare)) : FREE_SHARE
    const left = free - planned
    if (share > 0 && left < free * share - 5) out.push({ code: 'nofree', text: left < 15 ? 'No free time left' : `Only ${Math.round(left / 5) * 5} min free`, ids: [], fixable: false })
  }
  return out
}

/** The chip's words: the first problem, and how many more. */
export function issueChip(issues: PlanIssue[]): string | null {
  if (!issues.length) return null
  const first = issues[0]
  return `${first.text}${issues.length > 1 ? ` (+${issues.length - 1})` : ''}${issues.some((i) => i.fixable) ? ' — fix?' : ''}`
}

/**
 * Fixes what can be fixed: past blocks start from now, each block that sits on
 * an earlier one (or on a fixed event) moves after it, a 10-minute break goes
 * in after 90 minutes of deep work, what runs into the wind-down is trimmed or
 * dropped (its tasks stay on today's list), no water goal gets 2.5 L.
 */
export function fixPlan(raw: DayProposal, ctx: CheckCtx): { plan: DayProposal; fixed: string[] } {
  const plan = ensureIds(raw)
  const before = checkPlan(plan, ctx)
  if (!before.some((i) => i.fixable)) return { plan: raw, fixed: [] }
  const fixed = new Set<string>()
  const items = planItems(plan)
  const fixedSpans = spans(plan, ctx).filter((x) => x.fixed || x.locked)
  const startAt = ctx.now ? toMin(planStartAt(ctx.now)) : 0
  const end = lastEnd(ctx)
  const placed: { s: number; e: number; deep: boolean }[] = fixedSpans.map((x) => ({ s: x.s, e: x.e, deep: x.deep }))
  const out = new Map<string, { start: string; minutes: number } | null>()
  // Moveable blocks in time order; each takes the first spot from where it wants to be.
  const held = new Set(ctx.keep ?? [])
  const moveable = items.filter((b) => !b.locked && !held.has(b.id)).sort((a, b) => a.start.localeCompare(b.start))
  for (const b of moveable) {
    let s = toMin(b.start)
    if (ctx.now) {
      const nowM = toMin(ctx.now)
      const ended = s + b.minutes <= nowM
      // Done, or already in the calendar and under way: it stays as it is.
      if ((ended && (b.sync || b.done?.length)) || (!ended && s < nowM - 10 && b.sync?.eventId)) {
        placed.push({ s, e: s + b.minutes, deep: deepOf(b) })
        continue
      }
      if (ended || s < nowM - 10) {
        s = startAt
        fixed.add('past')
      }
    }
    for (let guard = 0; guard < 50; guard++) {
      const e = s + b.minutes
      const hit = placed.find((x) => s < x.e && x.s < e)
      if (hit) {
        s = Math.ceil(hit.e / 5) * 5
        fixed.add('overlap')
        continue
      }
      if (deepOf(b)) {
        // The deep run that ends right before this block (no 10-minute gap between).
        let run = b.minutes
        let at = s
        for (;;) {
          const prev = placed.filter((x) => x.e <= at && at - x.e < BREAK_MIN).sort((a, c) => c.e - a.e)[0]
          if (!prev || !prev.deep) break
          run += prev.e - prev.s
          at = prev.s
        }
        if (run > DEEP_MAX && b.minutes <= DEEP_MAX) {
          const prev = placed.filter((x) => x.e <= s && s - x.e < BREAK_MIN).sort((a, c) => c.e - a.e)[0]
          if (prev) {
            s = Math.ceil((prev.e + BREAK_MIN) / 5) * 5
            fixed.add('breaks')
            continue
          }
        }
      }
      break
    }
    let minutes = b.minutes
    if (s + minutes > end) {
      const own = toMin(b.start)
      if (end - s >= 25) {
        minutes = Math.floor((end - s) / 5) * 5
        fixed.add('late')
      } else if (own >= end && !b.sync?.eventId && !b.train) {
        // Planned inside the wind-down itself: off the plan, its tasks back on today's list.
        out.set(b.id, null)
        fixed.add('late')
        continue
      } else {
        // Making room would push it past bedtime: it stays where it was (the warning stays too).
        placed.push({ s: own, e: own + b.minutes, deep: deepOf(b) })
        continue
      }
    }
    placed.push({ s, e: s + minutes, deep: deepOf(b) })
    if (fromMin(s) !== b.start || minutes !== b.minutes) out.set(b.id, { start: fromMin(s), minutes })
  }
  // Only what really changed counts as fixed.
  if (!out.size) fixed.clear()
  let p: DayProposal = { ...plan }
  if (out.size) {
    const dropped = items.filter((b) => out.get(b.id) === null && b.id !== TRAIN_ID)
    p.blocks = plan.blocks
      .filter((b) => !(b.id && out.get(b.id) === null))
      .map((b) => {
        const n = b.id ? out.get(b.id) : undefined
        return n ? { ...b, ...n } : b
      })
      .sort((a, b) => a.start.localeCompare(b.start))
    if (plan.training) {
      const n = out.get(TRAIN_ID)
      p.training = n === null ? null : n ? { ...plan.training, time: n.start, ...(n.minutes !== items.find((x) => x.id === TRAIN_ID)?.minutes ? { minutes: n.minutes } : {}) } : plan.training
    }
    // Dropped blocks: tasks back on today's list, calendar leftovers cleared.
    const lower = (s: string) => s.trim().toLowerCase()
    const also = [...(p.also ?? [])]
    for (const b of dropped) for (const t of b.tasks ?? []) if (!also.some((a) => lower(a.title) === lower(t))) also.push({ title: t, minutes: Math.round(b.minutes / Math.max(1, b.tasks!.length)), priority: 1 })
    p.also = also.length ? also : p.also
    const rm = dropped.filter((b) => b.sync?.eventId || b.sync?.tasks?.length).map((b) => ({ id: b.id, eventId: b.sync?.eventId, calendarId: b.sync?.calendarId, tasks: b.sync?.tasks?.map((t) => ({ id: t.id, title: t.title })) }))
    if (rm.length) p.removed = [...(p.removed ?? []), ...rm]
  }
  if (ctx.water !== false && !(p.waterMl > 0)) {
    p.waterMl = 2500
    fixed.add('water')
  }
  return { plan: p, fixed: [...fixed] }
}
