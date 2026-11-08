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
import { afterRun, autoAllowed, autoReplan, isFlipFlop, type AutoMeta } from '@core/planAuto'
import type { Span } from '@core/planShift'
import { fromMin, type DayProposal, type RhythmState } from '@core/rhythm'
import type { CalEvent } from '@core/dayTime'
import type { TodoTask } from '@core/todoist'
import { life } from '../bridge'

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
  return e.label
}

// ---- The audit's "Move to tomorrow" and Re-plan by itself ---------------------------

const hmNow = () => {
  const d = new Date()
  return fromMin(d.getHours() * 60 + d.getMinutes())
}

/** What the plan card knows about the day (its fixed events, bedtime, water, free share). */
type Ctx = { events: CalEvent[]; bedtime: string; water: boolean; freeShare?: number; endBy: string }
let ctx: Ctx | null = null
export function setContext(c: Ctx) {
  ctx = c
}

/** "Move to tomorrow" on the audit line: off today's plan (Undo puts it back), and Todoist gets tomorrow's date. */
export function moveTomorrow(items: LeftTask[]): string | null {
  if (!cur || !items.length) return null
  const label = items.length === 1 ? `Moved ${items[0].title} to tomorrow` : `Moved ${items.length} tasks to tomorrow`
  const l = edit({ op: 'replace', plan: moveToTomorrow(cur.plan, items), label })
  if (!l) return null
  const tomorrow = addDays(cur.plan.day, 1)
  for (const x of items) if (x.id) void life.todoist?.update?.(x.id, { due: tomorrow }).catch(() => say({ text: `Todoist didn't take the new date for ${x.title}`, tone: 'bad' }))
  todayTasks = null
  return l
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

let checking = false
let checkedAt = 0
/** Looks at Google and Todoist and takes in what changed there (newest wins). */
export async function checkRemote(force = false) {
  if (!cur || checking || (!force && Date.now() - checkedAt < 20_000)) return
  if (!planItems(cur.plan).some((b) => b.sync)) return
  if (sender.pending()) return // ours first: it is newer
  checking = true
  checkedAt = Date.now()
  try {
    const [events, tasks] = await Promise.all([life.google ? todayEvents().catch(() => null) : Promise.resolve(null), freshTasks(0)])
    if (!cur || sender.pending()) return
    const r = mergeRemote(cur.plan, events, tasks)
    if (!r.notes.length) return
    await save(r.plan)
    const where = r.from.length === 2 ? 'Google and Todoist' : r.from[0] === 'todoist' ? 'Todoist' : 'Google'
    say({ text: `Updated from ${where}: ${r.notes[0]}${r.notes.length > 1 ? ` (+${r.notes.length - 1})` : ''}`, tone: 'info' })
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
/** While a plan card is on screen: a light check every 60 s (visible page only), on focus and when the app notices outside changes. */
export function startLive(): () => void {
  liveOn++
  if (liveOn === 1) {
    const tick = () => document.visibilityState === 'visible' && void look()
    timer = setInterval(tick, 60_000)
    window.addEventListener('focus', onBack)
    document.addEventListener('visibilitychange', onBack)
    window.addEventListener('life-external-changed', tick)
    window.addEventListener('keydown', onKey)
    ;(startLive as any).tick = tick
  }
  return () => {
    liveOn--
    if (liveOn === 0) {
      if (timer) clearInterval(timer)
      timer = null
      window.removeEventListener('focus', onBack)
      document.removeEventListener('visibilitychange', onBack)
      window.removeEventListener('life-external-changed', (startLive as any).tick)
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
function onBack() {
  if (document.visibilityState === 'visible') void look()
}

/** For tests: start over. */
export function _reset() {
  cur = null
  undo.clear()
  linked = false
  autoNote = null
  known = null
  prevEvents = undefined
  memMeta = null
  for (const k of Object.keys(sync)) delete sync[k]
}
