// Auto-rescue (pure, tested in planRescue.test.ts). When a planned work block
// has not started 30 minutes after its start (no focus session in it, nothing
// ticked), Ben offers ONE short plan for the rest of the day:
//
//   "Rescue: start 'Lab report' now for 45 min, move 'Read' to tomorrow."
//
// It is built from the existing rules: the late block takes the free time
// from now (a draft only; an approved, pinned or calendar block stays where it
// is and is just started), the other drafts that are late or in the way move
// like the automatic re-plan moves them (core/planAuto.ts), and what no longer
// fits goes to tomorrow like "Too much today" (core/planFit.ts), all inside
// your limits. Accept applies it (drafts only), with Undo; Not now asks once
// more 15 minutes later; Skip today ends it. At most once per block and two
// rescues a day, never in a meeting, quiet hours or while a focus timer runs.
// One key per push in `ben_pushes`, like every other push. No points.
import { autoMovable, autoReplan } from './planAuto'
import { moveToTomorrow, type AuditTask } from './planAudit'
import { tooMuchToday } from './planFit'
import { endWith, isWork, withProtected, type DayLimits } from './planLimits'
import { ensureIds, minOfDay, planItems } from './planEdit'
import type { Span } from './planShift'
import { fromMin, toMin, type DayProposal, type PlanBlock } from './rhythm'
import type { CalEvent } from './dayTime'
import { areaOfTitle, channelFor, type PushLog, type PushOut } from './benPushes'

/** Minutes after a block's start before a rescue is offered. */
export const RESCUE_AFTER_MIN = 30
/** Rescues a day (a snoozed one asking again does not count twice). */
export const RESCUE_PER_DAY = 2
/** "Not now": asked once more after this long. */
export const RESCUE_SNOOZE_MIN = 15
/** A block older than this is not rescued any more (the evening check deals with it). */
const RESCUE_UNTIL_MIN = 180
/** The late block keeps at least this much, or there is no rescue. */
const MIN_LEN = 25

export const rescueKey = (blockId: string, again = false) => `rescue:${blockId}${again ? ':again' : ''}`
export const isRescueKey = (k: string) => k.startsWith('rescue:')
/** The block id inside a rescue key. */
export const rescueBlockOf = (k: string) => k.replace(/^rescue:/, '').replace(/:again$/, '')

export interface RescueCtx {
  /** Now, HH:MM. */
  now: string
  /** The calendar's fixed events today (not this plan's own blocks). */
  events: CalEvent[]
  /** Today's focus sessions (a block with one in its time was started). */
  sessions?: Span[]
  /** The plan ends by then (bedtime minus wind-down; default 22:00). */
  endBy?: string
  limits?: DayLimits | null
  /** Today's open tasks (ids for "move to tomorrow", ranks). */
  tasks?: AuditTask[]
}

export interface RescuePlan {
  /** The plan after the rescue (the late block moved when it is a draft). */
  plan: DayProposal
  block: { id: string; title: string; start: string; minutes: number; moved: boolean }
  /** Tasks that go to tomorrow (Todoist ids when known). */
  tomorrow: { title: string; id?: string }[]
  text: string
}

const q = (s: string) => `'${s.length > 40 ? `${s.slice(0, 39)}…` : s}'`
const startedIn = (b: Pick<PlanBlock, 'start' | 'minutes'>, day: string, sessions: Span[]) => {
  const from = Date.parse(`${day}T${b.start}:00`)
  return sessions.some((x) => x.s >= from - 10 * 60_000 && x.s < from + b.minutes * 60_000)
}
const ticked = (b: PlanBlock) => !!b.done?.length

/** The work block that is late now (started 30+ min ago, not started, nothing ticked): the latest one. */
export function lateBlock(plan: DayProposal, ctx: Pick<RescueCtx, 'now' | 'sessions'>): PlanBlock | null {
  const p = ensureIds(plan)
  const now = toMin(ctx.now)
  const sessions = ctx.sessions ?? []
  const late = p.blocks.filter((b) => {
    const s = toMin(b.start)
    return isWork(b) && !ticked(b) && now - s >= RESCUE_AFTER_MIN && now - s <= RESCUE_UNTIL_MIN && !startedIn(b, p.day, sessions)
  })
  return late.sort((a, b) => b.start.localeCompare(a.start))[0] ?? null
}

/** Free minutes from `at` until the next busy thing (or the end of the day); 0 when `at` is busy. */
function roomAt(plan: DayProposal, status: 'proposed' | 'approved', skipId: string, at: number, endM: number, ctx: RescueCtx): number {
  const busy: { s: number; e: number }[] = []
  for (const e of withProtected(ctx.events, ctx.limits, plan.day)) {
    if (e.allDay || e.declined) continue
    const s = minOfDay(e.start, plan.day)
    const en = minOfDay(e.end, plan.day)
    if (en > s && en - s < 12 * 60) busy.push({ s, e: en })
  }
  for (const b of planItems(plan)) {
    if (b.id === skipId) continue
    // Drafts that are late or in the way move (the re-plan below); the rest is fixed.
    if (!b.train && autoMovable(b, status) && !ticked(b) && !startedIn(b, plan.day, ctx.sessions ?? [])) continue
    busy.push({ s: toMin(b.start), e: toMin(b.start) + b.minutes })
  }
  if (busy.some((x) => x.s <= at && x.e > at)) return 0
  const next = Math.min(endM, ...busy.filter((x) => x.s > at).map((x) => x.s))
  return Math.max(0, next - at)
}

/**
 * The rescue for the late block, or null when there is nothing worth offering
 * (no late block, no room to start it now, nothing to change).
 */
export function buildRescue(raw: DayProposal, status: 'proposed' | 'approved', ctx: RescueCtx): RescuePlan | null {
  const p = ensureIds(raw)
  const late = lateBlock(p, ctx)
  if (!late?.id) return null
  const nowM = toMin(ctx.now)
  const at = Math.ceil(nowM / 5) * 5
  const endM = toMin(endWith(ctx.endBy ?? '22:00', ctx.limits))
  const movable = autoMovable(late, status)
  let plan = p
  let minutes: number
  let start = late.start
  if (movable) {
    const room = roomAt(p, status, late.id, at, endM, ctx)
    minutes = Math.floor(Math.min(late.minutes, room) / 5) * 5
    if (minutes < Math.min(MIN_LEN, late.minutes)) return null
    start = fromMin(at)
    // The late block is held at its new spot (pinned for the moment), and the other drafts move
    // around it the way the automatic re-plan moves them (late ones, ones in the way), in your limits.
    const held = { ...p, blocks: p.blocks.map((b) => (b.id === late.id ? { ...b, start, minutes, locked: true } : b)) }
    plan = autoReplan(held, status, { now: ctx.now, events: ctx.events, sessions: ctx.sessions, endBy: ctx.endBy, limits: ctx.limits, tasks: ctx.tasks }).plan
  } else {
    // Approved, pinned or in the calendar: it stays where it is; you start it now for the time it has left.
    minutes = Math.max(0, toMin(late.start) + late.minutes - nowM)
  }
  // What no longer fits today goes to tomorrow ("Too much today"; the late block stays).
  const t = tooMuchToday(plan, { now: ctx.now, events: ctx.events, endBy: endWith(ctx.endBy ?? '22:00', ctx.limits), limits: ctx.limits, tasks: ctx.tasks })
  const lateNames = late.tasks?.length ? late.tasks : [late.title]
  const tomorrow = t.items.filter((x) => !lateNames.includes(x.title))
  if (tomorrow.length) plan = moveToTomorrow(plan, tomorrow)
  if (movable) plan = { ...plan, blocks: plan.blocks.map((b) => (b.id === late.id ? { ...b, locked: late.locked } : b)) }
  if (!movable && minutes < 15 && !tomorrow.length) return null
  const names = tomorrow.slice(0, 2).map((x) => q(x.title))
  const more = tomorrow.length > 2 ? ` +${tomorrow.length - 2} more` : ''
  const text = `Rescue: start ${q(late.title)} now${minutes >= 5 ? ` for ${minutes} min` : ''}${tomorrow.length ? `, move ${names.join(' and ')}${more} to tomorrow` : ''}.`
  return { plan, block: { id: late.id, title: late.title, start, minutes, moved: movable }, tomorrow, text }
}

/** What Accept needs later: the plan as offered, and what it does in words. */
export interface RescueOffer {
  key: string
  day: string
  at: number
  /** The plan's version it was built on (a newer plan gets the same intent re-applied). */
  version: number
  plan: DayProposal
  block: RescuePlan['block']
  tomorrow: RescuePlan['tomorrow']
  text: string
}

export interface RescueInput {
  now: number
  day: string
  /** Settings → Ben → Pushes → check-ins (rescues ride on them). */
  on: boolean
  plan: DayProposal | null
  status: 'proposed' | 'approved'
  version: number
  running: boolean
  meeting: boolean
  quiet: boolean
  log: PushLog
  here: boolean
  ctx: Omit<RescueCtx, 'now'>
}

const hmOf = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

/** The rescue push now, or null. The caller claims `push.key` and keeps `offer` for Accept. */
export function decideRescue(i: RescueInput): { push: PushOut; offer: RescueOffer } | null {
  if (!i.on || !i.plan || i.running || i.meeting || i.quiet || i.plan.day !== i.day) return null
  const ctx: RescueCtx = { ...i.ctx, now: hmOf(i.now) }
  const late = lateBlock(i.plan, ctx)
  if (!late?.id) return null
  const first = rescueKey(late.id)
  const again = rescueKey(late.id, true)
  const pending = (k: string) => !!i.log.recs[k] || i.log.outbox.some((x) => x.key === k)
  const rec = i.log.recs[first]
  let key: string
  if (!rec) {
    if (pending(first)) return null
    const used = Object.keys(i.log.recs).filter((k) => isRescueKey(k) && !k.endsWith(':again')).length
    if (used >= RESCUE_PER_DAY) return null
    key = first
  } else if (rec.ans === 'later' && !pending(again) && i.now >= (rec.until ?? rec.at + RESCUE_SNOOZE_MIN * 60_000)) key = again
  else return null
  const r = buildRescue(i.plan, i.status, ctx)
  if (!r) return null
  const push: PushOut = {
    key,
    type: 'rescue',
    area: areaOfTitle(late.title),
    level: 'normal',
    title: `${late.title} hasn't started`,
    text: r.text,
    face: '🛟',
    channel: channelFor(i.here),
    buttons: [{ label: '✅ Accept', op: 'accept', primary: true }, ...(key === first ? [{ label: 'Not now', op: 'later' as const, minutes: RESCUE_SNOOZE_MIN }] : []), { label: 'Skip today', op: 'skip' }]
  }
  return { push, offer: { key, day: i.day, at: i.now, version: i.version, plan: r.plan, block: r.block, tomorrow: r.tomorrow, text: r.text } }
}

/**
 * The plan Accept saves. The plan as offered when nothing changed since; else the same intent on
 * today's plan (the late block to its new time when it is still a draft and not started, the same
 * tasks to tomorrow). Pinned, approved and calendar blocks never move.
 */
export function rescueApplied(offer: RescueOffer, cur: DayProposal, curVersion: number, status: 'proposed' | 'approved'): DayProposal {
  if (curVersion === offer.version) return offer.plan
  let plan = ensureIds(cur)
  const b = plan.blocks.find((x) => x.id === offer.block.id)
  if (offer.block.moved && b && autoMovable(b, status) && !ticked(b)) plan = { ...plan, blocks: plan.blocks.map((x) => (x.id === b.id ? { ...x, start: offer.block.start, minutes: offer.block.minutes } : x)).sort((x, y) => x.start.localeCompare(y.start)) }
  return offer.tomorrow.length ? moveToTomorrow(plan, offer.tomorrow) : plan
}

/** The line after Accept: "Started: 'Lab report' at 10:35 for 45 min; 1 to tomorrow". */
export function acceptLine(o: Pick<RescueOffer, 'block' | 'tomorrow'>): string {
  const head = o.block.moved ? `Rescue on: ${q(o.block.title)} now at ${o.block.start} for ${o.block.minutes} min` : `Rescue on: start ${q(o.block.title)} now`
  return `${head}${o.tomorrow.length ? `; ${o.tomorrow.length} moved to tomorrow` : ''}.`
}
