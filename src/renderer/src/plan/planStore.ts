// The day plan while you edit it (PE1–PE8): one copy for every plan card on
// screen (Coach and Today), edits applied at once and saved to your data,
// then sent to Google Calendar and Todoist ~400 ms after the last one, with a
// small status per block. Undo (one tap or Ctrl+Z) puts the plan back and the
// next round sends the difference. Changes made in Google or Todoist come in
// on a light check (about every 60 s while the page is visible, and when you
// come back to it). The pure logic is in core/planEdit, planSync, planUndo.
import { applyEdit, editLabel, ensureIds, isApproved, planItems, type PlanEdit } from '@core/planEdit'
import { createDebounce, linkEvents, mergeRemote, pending, planJobs, settle, type BlockJob, type JobResult, type TodoOp } from '@core/planSync'
import { rebase, UndoStack } from '@core/planUndo'
import { appDuplicates } from '@core/planLook'
import { addDays } from '@core/dates'
import { auditPlan, moveToTomorrow, type AuditTask, type LeftTask } from '@core/planAudit'
import { movedLine, placeQuick, tooMuchToday } from '@core/planFit'
import { todoistText, dayWords, type QuickTask } from '@core/quickAdd'
import { afterRun, autoAllowed, autoReplan, isFlipFlop, type AutoMeta } from '@core/planAuto'
import type { Span } from '@core/planShift'
import { fromMin, type DayProposal, type RhythmState } from '@core/rhythm'
import type { CalEvent } from '@core/dayTime'
import { limitsLine, type DayLimits } from '@core/planLimits'
import type { TodoLookup, TodoTask } from '@core/todoist'
import { markLabel, reviewItem, type Outcome, type ReviewItem, type ReviewRow } from '@core/planReview'
import { autoSyncGap } from '@core/syncLabel'
import { life } from '../bridge'
import { idleFor } from '../lastUse'
import { saveReview } from './planReviewStore'

export type BlockStatus = 'syncing' | 'ok' | 'err'

export interface PlanSnap {
  status: 'proposed' | 'approved'
  plan: DayProposal
  version: number
  /** Per block: syncing… / ✓ / ⚠ (only blocks that sync). */
  sync: Record<string, BlockStatus>
  /** The last sync problem, for the ⚠ chip's tooltip. */
  error: string | null
  canUndo: boolean
  /** The last automatic re-plan's note ("Moved 'Lab report' to 15:40 because …"), while it can still be undone. */
  autoNote: string | null
  /** Today's open Todoist tasks (for the audit and the blocks' "why" lines), when known. */
  tasks: AuditTask[] | null
}

type Listener = (s: PlanSnap | null) => void
type Notice = { text: string; tone: 'good' | 'bad' | 'info'; undo?: boolean }

const listeners = new Set<Listener>()
const notices = new Set<(n: Notice) => void>()
const undo = new UndoStack()
let cur: { status: 'proposed' | 'approved'; plan: DayProposal; version: number } | null = null
const sync: Record<string, BlockStatus> = {}
let lastError: string | null = null
/** Task title → Todoist id (the plan's own list, today's tasks, what was sent). */
const taskIds = new Map<string, string>()
let todayTasks: { at: number; list: TodoTask[] } | null = null
let linked = false

const asAudit = (list: TodoTask[] | undefined | null): AuditTask[] | null => (list ? list.map((t) => ({ id: t.id, content: t.content, priority: t.priority, due: t.due, dueTime: t.dueTime, project: t.project })) : null)
const snap = (): PlanSnap | null => (cur ? { ...cur, sync: { ...sync }, error: lastError, canUndo: undo.size > 0, autoNote: autoNote && undo.size > 0 ? autoNote.text : null, tasks: asAudit(todayTasks?.list) } : null)
const emit = () => {
  const s = snap()
  for (const l of listeners) l(s)
}
/** One toast per notice, however many plan cards are on screen (the newest card shows it). */
const say = (n: Notice) => {
  const last = [...notices].pop()
  last?.(n)
}

export function subscribe(l: Listener): () => void {
  listeners.add(l)
  l(snap())
  return () => listeners.delete(l)
}

export function onNotice(f: (n: Notice) => void): () => void {
  notices.add(f)
  return () => notices.delete(f)
}

const lower = (s: string) => s.trim().toLowerCase()
function learnIds(p: DayProposal) {
  for (const a of p.also ?? []) if (a.id) taskIds.set(lower(a.title), a.id)
  for (const d of p.deferred ?? []) if (d.id) taskIds.set(lower(d.title), d.id)
  for (const b of planItems(p)) for (const t of b.sync?.tasks ?? []) taskIds.set(lower(t.title), t.id)
}

/** A card got a fresh state from the rhythm: taken unless it is older than ours. */
export function attach(state: RhythmState) {
  const b = state.briefing
  if (!b) {
    if (cur) {
      cur = null
      undo.clear()
      emit()
    }
    return
  }
  const fresh = !cur || cur.plan.day !== b.plan.day
  if (fresh) undo.clear()
  if (!fresh && cur && (b.version ?? 0) < cur.version) return
  if (!fresh && cur && b.version === cur.version && b.status === cur.status) return
  const nowApproved = !fresh && cur?.status === 'proposed' && b.status === 'approved'
  cur = { status: b.status, plan: ensureIds(b.plan), version: b.version ?? 0 }
  learnIds(cur.plan)
  emit()
  // Just approved: the task times go to Todoist (the calendar events were made by the approval).
  // A plan changed somewhere else (Ben, another device) with edits Google doesn't have yet: send them.
  // While our own "Approve all" runs, its half-written state (approved, events not yet saved) is not sent:
  // approveAll pokes once it is done.
  if ((nowApproved && !approving) || cur.plan.removed?.length || planItems(cur.plan).some((x) => isApproved(x, cur!.status) && pending(x))) sender.poke()
  if (!linked && life.google) {
    linked = true
    void linkOld().then(cleanOnce)
  }
  // A plan just came in (or the day started): a late block moves now, not in a minute.
  setTimeout(() => void maybeAuto(), 300)
  // A plan that came in from elsewhere (Ben, another device, a new day) keeps your limits too.
  limitsKey = ''
  setTimeout(keepLimitsNow, 200)
}

/** An older approved plan: its blocks find their calendar events once. */
async function linkOld() {
  if (!cur || !life.google) return
  const needs = planItems(cur.plan).some((b) => isApproved(b, cur!.status) && !b.sync?.eventId)
  if (!needs) return
  const events = await todayEvents().catch(() => null)
  if (!events || !cur) return
  const next = linkEvents(cur.plan, cur.status, events)
  if (next !== cur.plan) await save(next)
}

const dayBounds = (day: string) => {
  const s = new Date(`${day}T00:00:00`)
  return [s.toISOString(), new Date(s.getTime() + 86400000).toISOString()] as const
}
async function todayEvents() {
  if (!cur || !life.google) return []
  return life.google.events(...dayBounds(cur.plan.day))
}
async function freshTasks(maxAgeMs = 30_000): Promise<TodoTask[] | null> {
  if (!life.todoist) return null
  if (todayTasks && Date.now() - todayTasks.at < maxAgeMs) return todayTasks.list
  const list = await life.todoist.today().catch(() => null)
  if (list) {
    todayTasks = { at: Date.now(), list }
    for (const t of list) taskIds.set(lower(t.content), t.id)
  }
  return list
}

/** Saves the plan to your data (instant on this device). */
async function save(plan: DayProposal) {
  if (!cur) return
  cur = { ...cur, plan }
  emit()
  const st = await life.coach?.planSave?.(plan).catch(() => null)
  if (st?.briefing && cur && st.briefing.plan.day === cur.plan.day) cur = { ...cur, version: st.briefing.version ?? cur.version }
}

/** One edit: applied now, saved, and sent shortly. Returns the words for the toast (null: nothing changed). */
export function edit(e: PlanEdit): string | null {
  if (!cur) return null
  const before = cur.plan
  let after = applyEdit(before, e)
  if (after === before || (e.op === 'replace' && JSON.stringify(after) === JSON.stringify(before))) return null
  // The audit after a block was placed by hand: that block stays where you put it, the others make room.
  const placed = e.op === 'move' || e.op === 'resize' ? e.id : e.op === 'add' ? e.id : undefined
  if (placed && ctx) after = auditPlan(after, { ...ctx, now: hmNow(), keep: [placed], fixPast: false, tasks: asAudit(todayTasks?.list) ?? undefined }).plan
  if (!(e.op === 'replace' && e.auto)) {
    manualAt = Date.now()
    autoNote = null
  }
  const label = editLabel(e, before)
  undo.push({ label, before, after })
  void save(after)
  sender.poke()
  // Every block approved on its own: the whole plan is approved (must-dos on Today too).
  if (e.op === 'approve' && e.on && cur.status !== 'approved' && planItems(after).every((b) => b.ok)) void approveAll()
  return label
}

/** Undo the last plan edit (the app, Google and Todoist together). */
export function undoLast(): string | null {
  if (!cur) return null
  const e = undo.undo()
  if (!e) return null
  void save(rebase(e.before, cur.plan))
  sender.poke()
  // An edit that also changed something outside the plan (Move to tomorrow: Todoist's date) takes that back too.
  const back = outside.get(e.after)
  if (back) {
    outside.delete(e.after)
    void back()
  }
  return e.label
}

/** Undo for what an edit changed outside the plan, by the edit's plan. */
const outside = new WeakMap<DayProposal, () => Promise<void>>()

// ---- The audit's "Move to tomorrow" and Re-plan by itself ---------------------------

const hmNow = () => {
  const d = new Date()
  return fromMin(d.getHours() * 60 + d.getMinutes())
}

/** What the plan card knows about the day (its fixed events, bedtime, water, free share). */
type Ctx = { events: CalEvent[]; bedtime: string; water: boolean; freeShare?: number; endBy: string; limits?: DayLimits | null }
let ctx: Ctx | null = null
export function setContext(c: Ctx) {
  ctx = c
  keepLimitsNow()
}

/**
 * Your limits changed (Coach → Daily rhythm, or a light day on Today → Week), or a new plan came in:
 * the draft blocks that break them are trimmed or go back on the list, with one note and Undo.
 * Pinned, approved and ticked blocks are yours and stay; nothing is sent to Google or Todoist (drafts).
 * Once per plan that comes in and per change of the limits, so Undo is not taken back.
 */
let limitsKey = ''
function keepLimitsNow() {
  if (!cur || !ctx?.limits || editingNow) return
  const key = `${cur.plan.day}|${JSON.stringify(ctx.limits)}`
  if (key === limitsKey) return
  limitsKey = key
  const r = auditPlan(cur.plan, { ...ctx, now: hmNow(), fixTimes: false, fixPast: false, keepLimits: true, tasks: asAudit(todayTasks?.list) ?? undefined })
  const codes = r.fixed.filter((f) => f.startsWith('limit:')).map((f) => f.slice(6))
  if (!codes.length) return
  const label = limitsLine(codes, ctx.limits) ?? 'Kept your limits'
  if (edit({ op: 'replace', plan: r.plan, label })) say({ text: label, tone: 'info', undo: true })
}

/** "Move to tomorrow" on the audit line: off today's plan (Undo puts it back), and Todoist gets tomorrow's date. */
export function moveTomorrow(items: Pick<LeftTask, 'title' | 'id'>[], words?: string, o: { keepBlocks?: boolean } = {}): string | null {
  if (!cur || !items.length) return null
  const label = words ?? (items.length === 1 ? `Moved ${items[0].title} to tomorrow` : `Moved ${items.length} tasks to tomorrow`)
  // Each Todoist task's date before the move, so Undo can put it back exactly.
  const was = new Map((todayTasks?.list ?? []).map((t) => [t.id, t.due] as const))
  const l = edit({ op: 'replace', plan: moveToTomorrow(cur.plan, items, o), label })
  if (!l || !cur) return null
  const day = cur.plan.day
  const tomorrow = addDays(day, 1)
  const ids = items.filter((x) => x.id)
  for (const x of ids) void life.todoist?.update?.(x.id!, { due: tomorrow }).catch(() => say({ text: `Todoist didn't take the new date for ${x.title}`, tone: 'bad' }))
  if (ids.length)
    outside.set(cur.plan, async () => {
      let failed = 0
      for (const x of ids) await life.todoist?.update?.(x.id!, { due: was.get(x.id!) || day }).catch(() => failed++)
      todayTasks = null
      say(failed ? { text: `Undone in the plan, but Todoist still has tomorrow for ${failed} task${failed === 1 ? '' : 's'}`, tone: 'bad' } : { text: 'Todoist has today again', tone: 'info' })
    })
  todayTasks = null
  return l
}

/** The Todoist id for a task title: the plan's own list, today's tasks, what was sent. */
const idFor = (title: string): string | undefined => taskIds.get(lower(title))
const toMinOf = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/**
 * "Too much today": keeps the must-dos and the most important tasks that fit, moves the rest of the
 * draft blocks to tomorrow (the same Move to tomorrow as the audit line: Todoist gets tomorrow's
 * date, Undo gives every old date back). Resolves with the words that say exactly what moved, or
 * `none` when the day already fits.
 */
export async function tooMuch(): Promise<{ line: string } | { none: string } | null> {
  if (!cur || !ctx) return null
  await freshTasks().catch(() => null)
  if (!cur || !ctx) return null
  const t = tooMuchToday(cur.plan, { now: hmNow(), events: ctx.events, endBy: ctx.endBy, limits: ctx.limits, tasks: asAudit(todayTasks?.list) ?? undefined })
  if (t.fits) return { none: 'Today already fits: nothing to move' }
  const items = t.items.map((x) => ({ ...x, id: x.id ?? idFor(x.title) }))
  const line = movedLine({ items, blocks: t.blocks })
  return moveTomorrow(items, line) ? { line } : null
}

/** "Move to tomorrow" on one draft block's menu: its tasks leave today's plan (Undo puts them back, Todoist too). */
export function moveBlockTomorrow(id: string): string | null {
  if (!cur) return null
  const b = planItems(cur.plan).find((x) => x.id === id)
  if (!b || b.train || b.locked || b.ok || b.sync?.eventId) return null
  const items = (b.tasks?.length ? b.tasks : [b.title]).map((title) => ({ title, id: idFor(title) ?? cur!.plan.also?.find((a) => lower(a.title) === lower(title))?.id }))
  return moveTomorrow(items, `Moved ${b.title} to tomorrow`)
}

// ---- The end-of-day check (core/planReview) ------------------------------------------

/** Adds a second thing to undo when an edit is undone (after what is already there). */
const alsoUndo = (plan: DayProposal, f: () => Promise<void>) => {
  const before = outside.get(plan)
  outside.set(plan, async () => {
    if (before) await before()
    await f()
  })
}

/** Today's Todoist tasks, fresh enough for the check (ids, project, labels, priority). */
export async function reviewTasks(): Promise<TodoTask[]> {
  return (await freshTasks().catch(() => null)) ?? todayTasks?.list ?? []
}

/**
 * One block in the end-of-day check. Done ticks its tasks (the plan's usual tick closes them in
 * Todoist, and points come only from that); Slipped moves them to tomorrow (the usual Move to
 * tomorrow, the block stays on today's plan); Partly and Drop are only written down. A new mark
 * takes back what the old one did (an untick, today's date again). Undo on the card takes back the
 * plan edit and the mark together. Resolves with the saved record (null: no plan).
 */
export async function reviewBlock(row: ReviewRow, outcome: Outcome, o: { minutes?: number | null } = {}): Promise<ReviewItem | null> {
  if (!cur) return null
  const list = await reviewTasks()
  if (!cur) return null
  const day = cur.plan.day
  const prev = row.mark
  const names = row.tasks.length ? row.tasks : [row.title]
  const task = (t: string) => list.find((x) => lower(x.content) === lower(t))
  const ids = names.map((t) => ({ title: t, id: idFor(t) ?? task(t)?.id ?? cur!.plan.also?.find((a) => lower(a.title) === lower(t))?.id }))
  const one = names.length === 1 ? task(names[0]) : undefined
  const item = reviewItem(row, outcome, { minutes: o.minutes, at: new Date().toISOString(), project: one ? (one.section ?? one.project ?? null) : null, labels: one?.labels ?? null, priority: one?.priority })
  // The old mark's effect goes first: a Done that is no longer done is unticked; a slip comes back to today.
  let plan = cur.plan
  const tick = (on: boolean) => {
    for (const t of names) plan = applyEdit(plan, { op: 'tick', id: row.id, task: t, on })
  }
  if (prev?.outcome === 'done' && outcome !== 'done') tick(false)
  if (outcome === 'done') tick(true)
  const back = prev?.outcome === 'slip' && outcome !== 'slip' ? ids.filter((x) => x.id) : []
  if (back.length) plan = { ...plan, deferred: (plan.deferred ?? []).filter((d) => !back.some((x) => x.id === d.id || lower(x.title) === lower(d.title))) }
  const putBack = async () => {
    await saveReview(prev ? { day, item: prev } : { day, drop: row.id }).catch(() => null)
  }
  if (plan !== cur.plan) {
    const label = outcome === 'done' ? `Done: ${row.title}` : `Marked ${row.title}: ${markLabel(item)}`
    if (edit({ op: 'replace', plan, label }) && cur) alsoUndo(cur.plan, putBack)
  }
  for (const x of back) void life.todoist?.update?.(x.id!, { due: day }).catch(() => say({ text: `Todoist didn't take today's date back for ${x.title}`, tone: 'bad' }))
  if (outcome === 'slip' && prev?.outcome !== 'slip') {
    if (moveTomorrow(ids, `Moved ${row.title} to tomorrow`, { keepBlocks: true }) && cur) alsoUndo(cur.plan, putBack)
  }
  await saveReview({ day, item })
  return item
}

export interface QuickAdded {
  /** One plain line for the toast: what was added and where it went. */
  line: string
  /** A draft block was placed in today's plan. */
  placed: boolean
  /** Takes it back: the plan edit and the Todoist task. */
  undo: () => Promise<void>
}

/**
 * Quick-add: the parsed line becomes a Todoist task (through the Todoist client's quick add, which
 * reads the day, priority and length), and a task for today also gets a draft block placed by the
 * planner within your limits (at the time said when it fits, else the nearest free gap). A time
 * said for a placed block lives on the block: approving it gives the task that time.
 */
export async function quickAddTask(q: QuickTask): Promise<QuickAdded> {
  if (!life.todoist?.quickAdd) throw new Error('Todoist is not connected')
  const plan = cur?.plan
  const forToday = !!plan && q.day === plan.day
  const placed = forToday && ctx ? placeQuick(plan!, { title: q.title, minutes: q.minutes, time: q.time, priority: q.priority }, { events: ctx.events, endBy: ctx.endBy, limits: ctx.limits, now: hmNow() }) : null
  const today = plan?.day ?? q.day
  const t = await life.todoist.quickAdd(todoistText(q, today, { noTime: !!placed }))
  if (!t?.id) throw new Error('Todoist did not take it')
  taskIds.set(lower(q.title), t.id)
  taskIds.set(lower(t.content || q.title), t.id)
  todayTasks = null
  let blockId: string | null = null
  if (placed) {
    blockId = `q${Date.now().toString(36)}`
    if (!edit({ op: 'add', id: blockId, start: placed.start, minutes: placed.minutes, title: q.title, tasks: [q.title] })) blockId = null
  }
  window.dispatchEvent(new Event('life-external-changed'))
  const at = placed ? `${placed.start}-${fromMin(Math.min(24 * 60 - 5, toMinOf(placed.start) + placed.minutes))}` : ''
  const where = blockId && placed ? `placed ${at}${placed.why ? ` (${placed.why})` : ''}` : forToday ? "no room in the plan today, so it is on today's list" : `for ${dayWords(q.day, today)}`
  const undo = async () => {
    if (blockId) undoLast()
    await life.todoist?.remove?.(t.id).catch(() => null)
    todayTasks = null
    window.dispatchEvent(new Event('life-external-changed'))
  }
  return { line: `Added ${q.title}: ${where}`, placed: !!blockId, undo }
}

let autoOn = true
let editingNow = false
let manualAt = 0
let autoNote: { text: string; at: number } | null = null
let prevEvents: CalEvent[] | undefined
let known: string[] | null = null
let autoBusy = false
const META = 'ls.planAuto'
const readMeta = (): AutoMeta | null => {
  try {
    return JSON.parse(localStorage.getItem(META) || 'null')
  } catch {
    return null
  }
}
const writeMeta = (m: AutoMeta) => {
  try {
    localStorage.setItem(META, JSON.stringify(m))
  } catch {
    /* no storage: the 2-minute gap still holds while the page is open */
  }
}
let memMeta: AutoMeta | null = null

/** Settings → Re-plan by itself (default on). */
export function setAuto(on: boolean) {
  autoOn = on
}
/** A block is being dragged or renamed: no automatic re-plan meanwhile. */
export function setEditing(on: boolean) {
  editingNow = on
}

async function sessionsToday(): Promise<Span[]> {
  try {
    const f = await life.focus?.state?.()
    return (f?.todaySessions ?? []).filter((x) => x.startedAt).map((x) => ({ s: Date.parse(x.startedAt!), e: x.endedAt ? Date.parse(x.endedAt) : Date.now() }))
  } catch {
    return []
  }
}

/**
 * Re-plan by itself: when the day changed (a block ran long, a task came in,
 * an event moved, the clock passed a block that didn't start), the draft part
 * that the change hits moves, with one short note and Undo. Approved and
 * pinned blocks and calendar events never move, so nothing is sent to Google
 * or Todoist. At most once in 2 minutes, 5 a day, never while you edit.
 */
export async function maybeAuto(): Promise<string | null> {
  if (!cur || !ctx || autoBusy || checking || sender.pending()) return null
  const meta = readMeta() ?? memMeta
  const day = cur.plan.day
  const gate = autoAllowed({ on: autoOn, editing: editingNow || Date.now() - manualAt < 120_000, meta, day, nowMs: Date.now() })
  if (!gate.ok) return null
  autoBusy = true
  try {
    const [events, tasks, sessions] = await Promise.all([life.google ? todayEvents().catch(() => null) : Promise.resolve([] as CalEvent[]), freshTasks(), sessionsToday()])
    if (!cur || cur.plan.day !== day || editingNow) return null
    const mine = new Set(planItems(cur.plan).map((b) => b.sync?.eventId).filter(Boolean) as string[])
    const removed = new Set((cur.plan.removed ?? []).map((r) => r.eventId).filter(Boolean) as string[])
    const fixed = events ? events.filter((e) => !e.allDay && !e.declined && !mine.has(e.id) && !removed.has(e.id)) : ctx.events
    const list = asAudit(tasks) ?? undefined
    const r = autoReplan(cur.plan, cur.status, { ...ctx, now: hmNow(), events: fixed, prevEvents, sessions, tasks: list, known: known ?? undefined })
    prevEvents = fixed
    if (list) known = list.flatMap((t) => [t.content, ...(t.id ? [t.id] : [])])
    if (!r.note || r.plan === cur.plan) return null
    if (isFlipFlop(meta, day, cur.plan, r.plan)) return null
    const before = cur.plan
    const label = edit({ op: 'replace', plan: r.plan, label: r.note, auto: true })
    if (!label) return null
    memMeta = afterRun(meta, day, Date.now(), before, cur.plan)
    writeMeta(memMeta)
    autoNote = { text: r.note, at: Date.now() }
    emit()
    say({ text: r.note, tone: 'info', undo: true })
    return r.note
  } finally {
    autoBusy = false
  }
}

let approving = false
/** "✓ Approve all": the server's approve (must-dos, the calendar), then the task times. */
export async function approveAll() {
  if (approving) return null // a second tap while the first is still writing
  approving = true
  try {
    const r = await life.coach?.rhythm?.('approve').catch((err) => {
      say({ text: (err as Error).message || 'Could not approve', tone: 'bad' })
      return null
    })
    if (r?.state) attach(r.state)
    return r
  } finally {
    approving = false
    sender.poke()
  }
}

/**
 * Once a day on this device, quietly: copies of plan blocks the app itself put
 * in today's calendar twice (same title, start and end, marked as made by Life
 * System) are removed. The block's own event stays; events you made are never touched.
 */
async function cleanOnce() {
  if (!cur || !life.google) return
  const k = 'ls.planDupesCleaned'
  try {
    if (localStorage.getItem(k) === cur.plan.day) return
  } catch {
    /* no storage: run, it is harmless */
  }
  const events = await todayEvents().catch(() => null)
  if (!events || !cur) return
  const keep = new Set(planItems(cur.plan).map((b) => b.sync?.eventId).filter((x): x is string => !!x))
  const extra = appDuplicates(events, keep)
  let removed = 0
  for (const e of extra) if (await life.google.remove(e.calendarId, e.id).then(() => true, () => false)) removed++
  try {
    localStorage.setItem(k, cur.plan.day)
  } catch {
    /* fine */
  }
  if (removed) window.dispatchEvent(new CustomEvent('life-external-changed'))
}

/** Retry now (the ⚠ chip). */
export function retry() {
  lastError = null
  void sender.now()
}

// ---- Sending ---------------------------------------------------------------------

async function runGoogle(j: BlockJob): Promise<{ id: string; calendarId: string } | undefined> {
  const g = j.google
  if (!g || !life.google) return undefined
  if (g.kind === 'create') {
    // The block's own event id: if the approval (or another device) already made it, Google updates that one.
    const e = await life.google.create({ id: g.id, title: g.title, start: g.start, end: g.end, description: g.description, colorId: g.colorId })
    return { id: e.id, calendarId: e.calendarId || 'primary' }
  }
  if (g.kind === 'remove') {
    await life.google.remove(g.calendarId, g.eventId).catch((err) => {
      // Already gone in Google: that's what we wanted.
      if (!/not found|404|410|deleted/i.test(String((err as Error).message))) throw err
    })
    return undefined
  }
  const patch = { ...(g.title ? { title: g.title } : {}), ...(g.colorId ? { colorId: g.colorId } : {}), ...(g.start ? { start: g.start, end: g.end } : {}), ...(g.description ? { description: g.description } : {}) }
  if (life.google.update) await life.google.update(g.calendarId, g.eventId, patch)
  else if (g.start && g.end) await life.google.move(g.calendarId, g.eventId, g.start, g.end)
  return undefined
}

async function runTodo(op: TodoOp): Promise<void> {
  const t = life.todoist
  if (!t) return
  if (op.kind === 'time') return t.update?.(op.taskId, { due: op.due, duration: op.duration })
  if (op.kind === 'clear') return t.update?.(op.taskId, { due: op.due, duration: null })
  if (op.kind === 'rename') return t.update?.(op.taskId, { content: op.content })
  if (op.kind === 'close') {
    // Closed already (done on the phone) counts as done: the server treats it as success.
    await t.complete({ id: op.taskId, content: op.title, priority: 1, due: null, dueTime: null, project: null, recurring: false })
    return
  }
  return t.reopen?.(op.taskId)
}

async function flush() {
  if (!cur) return
  // Ids first (saved once), so what comes back finds its block.
  const withIds = ensureIds(cur.plan)
  if (withIds !== cur.plan) await save(withIds)
  if (planItems(cur.plan).some((b) => (b.tasks?.length ?? 0) > 0)) await freshTasks()
  const now = new Date()
  const plan = cur.plan
  const work = planJobs(plan, { status: cur.status, taskId: (t) => taskIds.get(lower(t)), nowMin: now.getHours() * 60 + now.getMinutes() })
  if (!work.jobs.length && !work.ticks.length) return
  for (const j of work.jobs) if (j.from === 'block' && (j.google || j.todo.length)) sync[j.id] = 'syncing'
  emit()
  const results: JobResult[] = []
  let problem: string | null = null
  for (const j of work.jobs) {
    try {
      const event = await runGoogle(j)
      for (const op of j.todo) await runTodo(op)
      results.push({ id: j.id, from: j.from, ok: true, snap: j.snap, event })
      if (j.from === 'block') sync[j.id] = 'ok'
    } catch (e) {
      problem = (e as Error).message || 'Not sent'
      results.push({ id: j.id, from: j.from, ok: false, snap: j.snap })
      if (j.from === 'block') sync[j.id] = 'err'
    }
  }
  // Ticks: what went through counts; the rest is tried again next round.
  const closed = new Set(plan.closed ?? [])
  for (const op of work.ticks) {
    try {
      await runTodo(op)
      if (op.kind === 'close') closed.add(op.taskId)
      else closed.delete(op.taskId)
    } catch (e) {
      problem = (e as Error).message || 'Todoist did not answer'
    }
  }
  if (work.ticks.length) todayTasks = null
  lastError = problem
  if (!cur) return
  // Into the newest plan (you may have edited meanwhile).
  await save(settle(cur.plan, results, work.ticks.length ? [...closed] : undefined))
  if (problem) say({ text: `Not synced: ${problem}`, tone: 'bad' })
  // The calendar changed: pages that draw it read it again.
  if (work.jobs.some((j) => j.google)) {
    checkedAt = Date.now() // what we just sent is what Google has: no need to look again now
    window.dispatchEvent(new CustomEvent('life-plan-synced'))
    window.dispatchEvent(new CustomEvent('life-external-changed'))
  }
}

const sender = createDebounce(400, flush)

// ---- PE4: changes made in Google Calendar or Todoist ------------------------------

/** Where the plan's tasks missing from today's list are now (the change check's answer, else a lookup). Empty when unknown. */
async function whereNow(plan: DayProposal, tasks: TodoTask[], idOf: (title: string) => string | undefined): Promise<Map<string, TodoLookup> | null> {
  const open = new Set(tasks.map((t) => t.id))
  const ids = new Set<string>()
  for (const b of planItems(plan)) {
    if (b.train) continue
    const done = new Set((b.done ?? []).map(lower))
    for (const t of b.sync?.tasks ?? []) if (!done.has(lower(t.title))) ids.add(t.id)
    for (const t of b.tasks ?? []) {
      const id = done.has(lower(t)) ? undefined : idOf(t)
      if (id) ids.add(id)
    }
  }
  for (const m of plan.mustdos) {
    const id = idOf(m)
    if (id) ids.add(id)
  }
  for (const a of plan.also ?? []) if (a.id) ids.add(a.id)
  const missing = [...ids].filter((id) => !open.has(id))
  if (!life.todoist?.lookup) return null // an older bridge: the old rule (missing = done)
  if (!missing.length) return new Map()
  return life.todoist.lookup(missing).catch(() => new Map<string, TodoLookup>())
}

let checking = false
let checkedAt = 0
/** Looks at Google and Todoist and takes in what changed there (newest wins). */
export async function checkRemote(force = false) {
  if (!cur || checking || (!force && Date.now() - checkedAt < 20_000)) return
  // Ours first (it is newer): a Sync press waits a moment for edits on their way, a background look skips.
  if (force) for (let i = 0; i < 30 && sender.pending(); i++) await new Promise((ok) => setTimeout(ok, 100))
  if (!cur || checking || sender.pending()) return
  checking = true
  checkedAt = Date.now()
  try {
    const [events, tasks] = await Promise.all([life.google && planItems(cur.plan).some((b) => b.sync?.eventId) ? todayEvents().catch(() => null) : Promise.resolve(null), freshTasks(0)])
    if (!cur || sender.pending()) return
    // Tasks the plan holds that today's list no longer has: moved to another day, done or deleted?
    const idOf = (title: string) => taskIds.get(lower(title))
    const where = tasks ? await whereNow(cur.plan, tasks, idOf) : null
    if (!cur || sender.pending()) return
    const r = mergeRemote(cur.plan, events, tasks, { where, idOf })
    if (r.plan === cur.plan) return
    await save(r.plan)
    if (!r.notes.length) return
    const whom = r.from.length === 2 ? 'Google and Todoist' : r.from[0] === 'todoist' ? 'Todoist' : 'Google'
    say({ text: `Updated from ${whom}: ${r.notes[0]}${r.notes.length > 1 ? ` (+${r.notes.length - 1})` : ''}`, tone: 'info' })
    // A task moved in Todoist moves its calendar event too.
    sender.poke()
  } finally {
    checking = false
  }
}

/** The live loop's look: Google and Todoist first (they win), then the automatic re-plan. */
async function look() {
  await checkRemote()
  await maybeAuto()
}

let liveOn = 0
let timer: ReturnType<typeof setInterval> | null = null
let lookedAt = 0
/**
 * While a plan card is on screen: a light check every 60 s while you use the page (visible page only), slower while
 * it sits untouched (autoSyncGap: every minute all night was most of a tab's calls), on focus and when the app
 * notices outside changes.
 */
export function startLive(): () => void {
  liveOn++
  if (liveOn === 1) {
    const tick = () => document.visibilityState === 'visible' && ((lookedAt = Date.now()), void look())
    const every = () => Date.now() - lookedAt >= autoSyncGap(idleFor()) && tick()
    timer = setInterval(every, 60_000)
    window.addEventListener('focus', onBack)
    document.addEventListener('visibilitychange', onBack)
    window.addEventListener('life-external-changed', tick)
    // Todoist's change check saw something: the plan takes it in now (not after the 20-second pause).
    window.addEventListener('life-todoist-changed', onTodoist)
    window.addEventListener('keydown', onKey)
    ;(startLive as any).tick = tick
    // A card just opened: what changed in Todoist while it was closed (a task moved to tomorrow) comes in now.
    setTimeout(() => void checkRemote().catch(() => null), 800)
  }
  return () => {
    liveOn--
    if (liveOn === 0) {
      if (timer) clearInterval(timer)
      timer = null
      window.removeEventListener('focus', onBack)
      document.removeEventListener('visibilitychange', onBack)
      window.removeEventListener('life-external-changed', (startLive as any).tick)
      window.removeEventListener('life-todoist-changed', onTodoist)
      window.removeEventListener('keydown', onKey)
    }
  }
}
/** Ctrl+Z / Cmd+Z anywhere (not while typing): undo the last plan edit. */
function onKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey || e.altKey) return
  const el = document.activeElement as HTMLElement | null
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
  if (!undo.size) return
  e.preventDefault()
  const l = undoLast()
  if (l) say({ text: `Undone: ${l}`, tone: 'info' })
}
function onTodoist() {
  if (document.visibilityState === 'visible') void checkRemote(true).then(() => maybeAuto()).catch(() => null)
}
function onBack() {
  if (document.visibilityState === 'visible') void look()
}

/** For tests: start over. */
export function _reset() {
  cur = null
  lookedAt = 0
  undo.clear()
  linked = false
  autoNote = null
  known = null
  prevEvents = undefined
  memMeta = null
  for (const k of Object.keys(sync)) delete sync[k]
}
