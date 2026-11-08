// Today's plan changed from outside the plan card: Telegram's buttons (Too much
// today, Move <block> to tomorrow, the end-of-day check, a quick-add for
// today) and Ben's rescue push (Accept / Not now / Skip today / Undo) on the
// island, the Coach card or Telegram. Used by the server (the bot) and by the
// app (the island's push answers), on the same synced data: today's plan in
// `coach_rhythm` (each change bumps its version, so the plan card takes it on
// its next look), the end-of-day records in `plan_review`, the push log in
// `ben_pushes`. Only draft blocks are moved here; pinned, approved and
// calendar blocks stay. No points are paid here, except Done in the check,
// which closes the Todoist task through the usual Todoist pay (once per task).
import { getSetting, setSetting, readSetting, writeSetting } from '../../../main/settings'
import { addDays } from '@core/dates'
import { RHYTHM, fromMin, rhythmFor, toMin, type DayProposal, type RhythmState } from '@core/rhythm'
import { PLAN_LIMITS, cleanLimits, limitsFor, type DayLimits } from '@core/planLimits'
import { PLAN_REVIEW, cleanReview, putItem, reviewItem, reviewRows, markLabel, type Outcome, type ReviewStore, type TimerSession } from '@core/planReview'
import { rebase } from '@core/planUndo'
import { applyEdit, ensureIds, planItems } from '@core/planEdit'
import { moveToTomorrow, type AuditTask } from '@core/planAudit'
import { movedLine, placeQuick, tooMuchToday, type Placed } from '@core/planFit'
import { sameThing } from '@core/planDedupe'
import { acceptLine, decideRescue, isRescueKey, lateBlock, RESCUE_SNOOZE_MIN, rescueApplied, type RescueOffer } from '@core/planRescue'
import type { PushOut } from '@core/benPushes'
import type { Span } from '@core/planShift'
import type { CalEvent } from '@core/dayTime'
import type { QuickTask } from '@core/quickAdd'
import { answerPushIn, readPushLog } from './benPushStore'
import { sleepWindow } from './lifeFitStore'
import { payTodoist } from './todoistCoins'

type Briefing = NonNullable<RhythmState['briefing']>

/** One change on the database (the app's mirror or the server's) with its services, and Todoist. */
export interface PlanDeps {
  read: <T>(fn: (db: any, svc: any) => T) => Promise<T>
  write: <T>(fn: (db: any, svc: any) => T) => Promise<T>
  todoist: { update?: (id: string, patch: { due?: string }) => Promise<void>; close?: (id: string) => Promise<void> } | null
}

export interface PlanFacts {
  day: string
  state: RhythmState
  /** Today's focus sessions as time spans (a block with one was started). */
  sessions: Span[]
  /** The same sessions as the timer logged them (minutes, subject). */
  timer: TimerSession[]
  limits: DayLimits
  /** The plan ends by then: bedtime minus 45 min (at most 23:00), or your off time. */
  endBy: string
  review: ReviewStore
}

const json = (db: any, key: string): unknown => {
  try {
    return JSON.parse(getSetting(db, key) || 'null')
  } catch {
    return null
  }
}
const hmOf = (d: Date) => fromMin(d.getHours() * 60 + d.getMinutes())

/** What the plan needs to know about today, read in one go. */
export function planFacts(db: any, svc: any, now = new Date()): PlanFacts {
  const day: string = svc.wallet.today(now)
  const state = rhythmFor(json(db, RHYTHM), day)
  let timer: TimerSession[] = []
  try {
    timer = (svc.focus.state(now).todaySessions ?? []) as TimerSession[]
  } catch {
    timer = []
  }
  const sessions = timer.filter((x) => x.startedAt).map((x) => ({ s: Date.parse(x.startedAt!), e: x.endedAt ? Date.parse(x.endedAt) : now.getTime() }))
  let bed = '23:30'
  try {
    bed = sleepWindow(db).bed
  } catch {
    bed = '23:30'
  }
  const bedMin = toMin(bed)
  const endBy = fromMin(Math.min(bedMin < 12 * 60 ? 23 * 60 : bedMin - 45, 23 * 60))
  return { day, state, sessions, timer, limits: limitsFor(cleanLimits(json(db, PLAN_LIMITS)), day), endBy, review: cleanReview(readSetting(db, PLAN_REVIEW)) }
}

/** The calendar's fixed events: the plan's own blocks (and events the app made) left out. */
export function fixedEvents(events: CalEvent[], plan: DayProposal | null | undefined): CalEvent[] {
  const mine = new Set(plan ? [...planItems(plan).map((b) => b.sync?.eventId)].filter(Boolean) : [])
  return events.filter((e) => !e.ours && !mine.has(e.id))
}

const saveState = (db: any, s: RhythmState) => setSetting(db, RHYTHM, JSON.stringify(s))

type Change = { plan: DayProposal; label: string; tomorrow?: { title: string; id?: string }[]; state?: Partial<RhythmState> } | { none: string }

/**
 * One change to today's plan: saved with a new version and one Undo (the plan before, the Todoist
 * dates before), then the moved tasks get tomorrow's date in Todoist. Returns the line to show.
 */
export async function changePlan(d: PlanDeps, make: (f: PlanFacts, b: Briefing) => Change | null, now = new Date()): Promise<{ ok: boolean; line: string; at?: number }> {
  const r = await d.write((db, svc) => {
    const f = planFacts(db, svc, now)
    const b = f.state.briefing
    if (!b) return { ok: false as const, line: 'No plan for today yet' }
    const c = make(f, b)
    if (!c) return { ok: false as const, line: 'Nothing to change' }
    if ('none' in c) return { ok: false as const, line: c.none }
    const at = now.getTime()
    const ids = [...new Set((c.tomorrow ?? []).map((x) => x.id).filter((x): x is string => !!x))]
    saveState(db, { ...f.state, ...(c.state ?? {}), briefing: { ...b, plan: ensureIds(c.plan), version: (b.version ?? 0) + 1 }, planUndo: { at, label: c.label, before: b.plan, dates: ids.map((id) => ({ id, due: f.day })) } })
    return { ok: true as const, line: c.label, at, ids, tomorrow: addDays(f.day, 1) }
  })
  if (!r.ok || !('ids' in r)) return { ok: r.ok, line: r.line }
  let failed = 0
  if (d.todoist?.update) for (const id of r.ids) await d.todoist.update(id, { due: r.tomorrow }).catch(() => failed++)
  return { ok: true, line: failed ? `${r.line} (Todoist didn't take the new date for ${failed})` : r.line, at: r.at }
}

/** Undo the last change made here (only that one: `at` names it, or `prefix` its words). */
export async function undoPlanChange(d: PlanDeps, o: { at?: number; prefix?: string } = {}, now = new Date()): Promise<{ ok: boolean; line: string }> {
  const r = await d.write((db, svc) => {
    const f = planFacts(db, svc, now)
    const u = f.state.planUndo
    const b = f.state.briefing
    if (!u || !b || (o.at != null && u.at !== o.at) || (o.prefix && !u.label.startsWith(o.prefix))) return { ok: false, line: 'Nothing to undo', dates: [] as { id: string; due: string }[] }
    const { planUndo: _gone, ...rest } = f.state
    saveState(db, { ...rest, briefing: { ...b, plan: rebase(u.before, b.plan), version: (b.version ?? 0) + 1 } })
    return { ok: true, line: `Undone: ${u.label}`, dates: u.dates }
  })
  if (!r.ok) return r
  let failed = 0
  if (d.todoist?.update) for (const x of r.dates) await d.todoist.update(x.id, { due: x.due }).catch(() => failed++)
  return { ok: true, line: failed ? `${r.line}. Todoist still has tomorrow for ${failed} task${failed === 1 ? '' : 's'}` : r.line }
}

/** A task's Todoist id from the plan's own memory (the list, the block's synced tasks, the open tasks). */
function idOf(plan: DayProposal, title: string, tasks: AuditTask[] = []): string | undefined {
  for (const b of planItems(plan)) for (const t of b.sync?.tasks ?? []) if (sameThing(t.title, title)) return t.id
  return [...(plan.also ?? []), ...(plan.deferred ?? [])].find((a) => a.id && sameThing(a.title, title))?.id ?? tasks.find((t) => t.id && sameThing(t.content, title))?.id
}

/** Too much today (the plan card's button): the rest of the drafts beyond today's budget go to tomorrow. */
export function tooMuchOn(d: PlanDeps, events: CalEvent[], tasks?: AuditTask[], now = new Date()) {
  return changePlan(
    d,
    (f, b) => {
      const t = tooMuchToday(b.plan, { now: hmOf(now), events: fixedEvents(events, b.plan), endBy: f.endBy, limits: f.limits, tasks })
      if (t.fits) return { none: 'Today already fits: nothing to move' }
      const items = t.items.map((x) => ({ ...x, id: x.id ?? idOf(b.plan, x.title, tasks) }))
      return { plan: moveToTomorrow(b.plan, items), label: movedLine({ items, blocks: t.blocks }), tomorrow: items }
    },
    now
  )
}

/** Move one draft block to tomorrow (its tasks leave today's plan; Todoist gets tomorrow). */
export function blockTomorrowOn(d: PlanDeps, blockId: string, tasks?: AuditTask[], now = new Date()) {
  return changePlan(
    d,
    (_f, b) => {
      const x = planItems(b.plan).find((y) => y.id === blockId)
      if (!x) return { none: 'That block is gone' }
      if (x.train || x.locked || x.ok || b.status === 'approved' || x.sync?.eventId) return { none: 'Only draft blocks move: this one is pinned or approved' }
      const items = (x.tasks?.length ? x.tasks : [x.title]).map((title) => ({ title, id: idOf(b.plan, title, tasks) }))
      return { plan: moveToTomorrow(b.plan, items), label: `Moved ${x.title} to tomorrow`, tomorrow: items }
    },
    now
  )
}

// ---- Auto-rescue (core/planRescue) ----------------------------------------------------

/** A quick look before reading the calendar: is any block of today's plan late enough for a rescue? */
export function rescueMaybe(db: any, svc: any, now = new Date()): boolean {
  const f = planFacts(db, svc, now)
  const b = f.state.briefing
  return !!b && b.plan.day === f.day && !!lateBlock(b.plan, { now: hmOf(now), sessions: f.sessions })
}

/** The rescue push now (or null). The offer is kept on today's rhythm for Accept. */
export function rescueCheck(db: any, svc: any, o: { now: Date; events: CalEvent[]; on: boolean; running: boolean; meeting: boolean; quiet: boolean; here: boolean }): PushOut | null {
  const f = planFacts(db, svc, o.now)
  const b = f.state.briefing
  const r = decideRescue({
    now: o.now.getTime(),
    day: f.day,
    on: o.on,
    plan: b?.plan ?? null,
    status: b?.status ?? 'proposed',
    version: b?.version ?? 0,
    running: o.running,
    meeting: o.meeting,
    quiet: o.quiet,
    log: readPushLog(db, f.day),
    here: o.here,
    ctx: { events: fixedEvents(o.events, b?.plan), sessions: f.sessions, endBy: f.endBy, limits: f.limits }
  })
  if (!r) return null
  saveState(db, { ...f.state, rescue: r.offer })
  return r.push
}

/**
 * An answer on a rescue push, from any channel. Accept applies the offered plan (drafts only) with
 * one Undo; Not now asks once more in 15 minutes; Skip today ends it; Undo takes an accepted one back.
 */
export async function rescueAnswer(d: PlanDeps, key: string, op: 'accept' | 'later' | 'skip' | 'undo', now = new Date()): Promise<{ ok: boolean; line: string; at?: number }> {
  if (!isRescueKey(key)) return { ok: false, line: 'That is not a rescue' }
  const day = await d.read((_db, svc) => svc.wallet.today(now) as string)
  if (op === 'undo') return undoPlanChange(d, { prefix: 'Rescue on' }, now)
  if (op === 'later' || op === 'skip') {
    await d.write((db) => answerPushIn(db, day, key, op, now.getTime(), RESCUE_SNOOZE_MIN))
    return { ok: true, line: op === 'later' ? `OK, I'll ask again in ${RESCUE_SNOOZE_MIN} min.` : 'Skipped for today.' }
  }
  const answered = await d.read((db) => readPushLog(db, day).recs[key]?.ans)
  if (answered === 'accept') return { ok: false, line: 'Already done.' }
  const r = await changePlan(
    d,
    (f, b) => {
      const offer: RescueOffer | undefined = f.state.rescue
      if (!offer || offer.day !== f.day || offer.key.replace(/:again$/, '') !== key.replace(/:again$/, '')) return { none: 'That rescue is from earlier: the plan card has today as it is now.' }
      return { plan: rescueApplied(offer, b.plan, b.version ?? 0, b.status), label: acceptLine(offer), tomorrow: offer.tomorrow }
    },
    now
  )
  if (r.ok) await d.write((db) => answerPushIn(db, day, key, 'accept', now.getTime()))
  return r
}

// ---- The end-of-day check (core/planReview) ---------------------------------------------

/** Today's check as it stands: the rows (work blocks that started), the records. */
export function reviewNow(db: any, svc: any, now = new Date()) {
  const f = planFacts(db, svc, now)
  const b = f.state.briefing
  const rows = b ? reviewRows(b.plan, { now: hmOf(now), sessions: f.timer, store: f.review }) : []
  return { day: f.day, plan: b?.plan ?? null, rows, review: f.review }
}

/**
 * One block in the check, from Telegram (the plan card's check does the same): Done ticks its
 * tasks and closes them in Todoist (paid once, the usual Todoist pay); Partly and Drop are only
 * written down; Tomorrow gives its tasks tomorrow's date (the block stays as what was planned).
 * A new mark takes back the old one: a slip comes back to today; an untick is left for the plan
 * card, which reopens the task and takes back its points the usual way.
 */
export async function markReviewOn(d: PlanDeps, blockId: string, outcome: Outcome, now = new Date()): Promise<{ ok: boolean; line: string }> {
  const r = await d.write((db, svc) => {
    const f = planFacts(db, svc, now)
    const b = f.state.briefing
    if (!b) return null
    const row = reviewRows(b.plan, { now: hmOf(now), sessions: f.timer, store: f.review }).find((x) => x.id === blockId)
    if (!row) return null
    const prev = row.mark
    if (prev?.outcome === outcome) return { line: `${row.title}: ${markLabel(prev)}`, close: [], due: [] as { id: string; due: string }[], title: row.title }
    const names = row.tasks.length ? row.tasks : [row.title]
    const ids = names.map((t) => ({ title: t, id: idOf(b.plan, t) }))
    const item = reviewItem(row, outcome, { at: now.toISOString() })
    let plan = b.plan
    for (const t of names) if (prev?.outcome === 'done' || outcome === 'done') plan = applyEdit(plan, { op: 'tick', id: row.id, task: t, on: outcome === 'done' })
    const due: { id: string; due: string }[] = []
    if (prev?.outcome === 'slip') {
      plan = { ...plan, deferred: (plan.deferred ?? []).filter((x) => !ids.some((y) => (y.id && y.id === x.id) || sameThing(y.title, x.title))) }
      for (const x of ids) if (x.id) due.push({ id: x.id, due: f.day })
    }
    if (outcome === 'slip') {
      plan = moveToTomorrow(plan, ids, { keepBlocks: true })
      for (const x of ids) if (x.id) due.push({ id: x.id, due: addDays(f.day, 1) })
    }
    const close = outcome === 'done' ? ids.filter((x) => x.id && !(plan.closed ?? []).includes(x.id)) : []
    if (plan !== b.plan) saveState(db, { ...f.state, briefing: { ...b, plan, version: (b.version ?? 0) + 1 } })
    writeSetting(db, PLAN_REVIEW, putItem(f.review, f.day, item, f.day) as any)
    return { line: `${row.title}: ${markLabel(item)}`, close, due, title: row.title }
  })
  if (!r) return { ok: false, line: 'That block is not in the check any more' }
  for (const x of r.due) await d.todoist?.update?.(x.id, { due: x.due }).catch(() => null)
  const closed: { id: string; content: string }[] = []
  for (const x of r.close) if (d.todoist?.close) await d.todoist.close(x.id!).then(() => closed.push({ id: x.id!, content: x.title }), () => null)
  if (closed.length)
    await d.write((db, svc) => {
      payTodoist(svc, closed)
      const f = planFacts(db, svc, now)
      const b = f.state.briefing
      if (b) saveState(db, { ...f.state, briefing: { ...b, plan: { ...b.plan, closed: [...new Set([...(b.plan.closed ?? []), ...closed.map((x) => x.id)])] } } })
    })
  return { ok: true, line: r.line }
}

// ---- Quick-add for today (core/quickAdd + planFit) ---------------------------------------

/** Where a quick-added task of today goes in the plan (null: no room, or no plan today). */
export function quickSpot(db: any, svc: any, q: Pick<QuickTask, 'title' | 'day' | 'minutes' | 'time' | 'priority'>, events: CalEvent[], now = new Date()): Placed | null {
  const f = planFacts(db, svc, now)
  const b = f.state.briefing
  if (!b || q.day !== f.day || b.plan.day !== f.day) return null
  return placeQuick(b.plan, { title: q.title, minutes: q.minutes, time: q.time, priority: q.priority }, { events: fixedEvents(events, b.plan), endBy: f.endBy, limits: f.limits, now: hmOf(now) })
}

/** The quick-added task's draft block, saved into today's plan (a new version the card takes). */
export function addQuickBlock(db: any, svc: any, title: string, placed: Placed, now = new Date()): boolean {
  const f = planFacts(db, svc, now)
  const b = f.state.briefing
  if (!b) return false
  const plan = applyEdit(b.plan, { op: 'add', id: `q${now.getTime().toString(36)}`, start: placed.start, minutes: placed.minutes, title, tasks: [title] })
  if (plan === b.plan) return false
  saveState(db, { ...f.state, briefing: { ...b, plan, version: (b.version ?? 0) + 1 } })
  return true
}
