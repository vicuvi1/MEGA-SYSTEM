// The plan audit (pure, tested in planAudit.test.ts). It runs after every plan
// is built or edited, before the card shows it:
//
//   - one thing = one block (planDedupe), and every open task of today is
//     somewhere: in a block, at a calendar event, or listed with a reason
//     ("no room today", "waiting on you", "at the 17:00 event", tomorrow).
//     A task that is nowhere is put back on today's list: never dropped.
//   - no overlaps, nothing in the past on a from-now plan, not more planned
//     than the free time, a task due at a time is planned before that time.
//     fixPlan fixes what it can; when there is more work than time, the last
//     draft blocks leave the plan and their tasks go on the list.
//   - what it can't fix becomes one plain line for the card
//     ("1 task didn't fit: Lab report. Move it to tomorrow?").
//
// Each block also gets a short "why" line from real data only (pinned, due
// 15:00, overdue, from Todoist: P1, a must-do). Nothing here pays points or
// deletes anything outside the plan.
import { estimateMinutes, planStartAt, relinkAlso, unaccounted, type PlanTask } from './dayPacker'
import { checkPlan, fixPlan, type CheckCtx, type PlanIssue } from './planCheck'
import { alsoOpen, dedupePlan, normTitle, sameThing } from './planDedupe'
import { ensureIds, planItems, planGaps, TRAIN_ID } from './planEdit'
import { toMin, type DayProposal, type PlanBlock } from './rhythm'
import { keepLimits, withProtected } from './planLimits'

/** One of today's open tasks, as Todoist (or the app) has it. */
export interface AuditTask extends PlanTask {
  dueTime?: string | null
}

export interface AuditCtx extends CheckCtx {
  /** Today's open tasks (due today or overdue). Without them only the plan's own lists are checked. */
  tasks?: AuditTask[]
  /** false: only the lists are checked (no block moves). Default true. */
  fixTimes?: boolean
  /** false: blocks in the past are left where they are (the "Shift the plan?" prompt asks). Default true. */
  fixPast?: boolean
  /** Make the plan keep your limits (draft blocks trimmed or back on the list). Default: as fixTimes. */
  keepLimits?: boolean
}

export type LeftWhy = 'room' | 'waiting' | 'event' | 'tomorrow'

/** A task of today that has no block, with its stated reason. */
export interface LeftTask {
  title: string
  id?: string
  why: LeftWhy
  /** The reason in plain words. */
  text: string
}

export interface AuditResult {
  plan: DayProposal
  /** What was fixed (issue codes, plus 'missing' and 'trim'). */
  fixed: string[]
  /** What is still wrong (the warning chip). */
  issues: PlanIssue[]
  /** Every task of today without a block, each with its reason. */
  left: LeftTask[]
  /** The one plain line for the card (null: every task has a place). */
  line: string | null
}

const lower = (s: string) => s.trim().toLowerCase()
const inList = (list: string[] | undefined, t: string) => !!list?.length && list.includes(normTitle(t))
const hmOk = (s: unknown): s is string => typeof s === 'string' && /^\d\d:\d\d$/.test(s)

/**
 * A task's own time today, when it is a real one: not a time the plan itself
 * gave the task in Todoist when its block was approved (that is not a deadline).
 */
function ownTime(t: AuditTask, plan: DayProposal): string | null {
  if (!hmOk(t.dueTime) || (t.due && t.due !== plan.day)) return null
  const ours = planItems(plan).some((b) => (b.sync?.tasks ?? []).some((x) => (t.id && x.id === t.id) || x.at === t.dueTime))
  return ours ? null : t.dueTime
}

/**
 * How much a block matters today (lower first): a must-do or what you asked
 * for, then overdue / P1–P2 / a task with its own time today, then goal time,
 * then other focus work, then small tasks. Used to keep the important work in
 * blocks when the day is too full: the least important block gives way first.
 */
export function blockRank(b: PlanBlock, plan: DayProposal, tasks: AuditTask[] = []): number {
  const names = [b.title, ...(b.tasks ?? [])]
  const also = (t: string) => (plan.also ?? []).find((a) => sameThing(a.title, t))
  const todo = (t: string) => tasks.find((x) => sameThing(x.content, t))
  if (names.some((t) => plan.mustdos.some((m) => sameThing(m, t)) || also(t)?.asked || todo(t)?.asked)) return 0
  if (names.some((t) => also(t)?.overdue || (also(t)?.priority ?? todo(t)?.priority ?? 1) >= 3 || (todo(t)?.due && todo(t)!.due! < plan.day) || (todo(t) && ownTime(todo(t)!, plan)))) return 1
  if (b.kind === 'goal') return 2
  return b.kind === 'quick' ? 4 : 3
}

/** Is this block allowed to move or leave (not pinned, not approved, not in the calendar)? */
const loose = (b: PlanBlock, keep: Set<string>) => !b.locked && !b.ok && !b.sync?.eventId && !(b.id && keep.has(b.id)) && !b.done?.length

/** Free minutes left from `from` to the end of the day (bed minus wind-down), minus fixed events. */
function overflow(plan: DayProposal, ctx: AuditCtx): number {
  const t = checkPlan(plan, ctx).find((i) => i.code === 'toomuch')
  return t ? Number(/(\d+)/.exec(t.text)?.[1] ?? 0) : 0
}

/** A task with a time today ("by 15:00") planned in a block that ends after it. */
function lateForDue(plan: DayProposal, tasks: AuditTask[]): { block: PlanBlock; task: AuditTask }[] {
  const out: { block: PlanBlock; task: AuditTask }[] = []
  for (const t of tasks) {
    const due = ownTime(t, plan)
    if (!due) continue
    const b = plan.blocks.find((x) => (x.tasks ?? []).some((y) => sameThing(y, t.content)) || (!(x.tasks ?? []).length && sameThing(x.title, t.content)))
    if (b && toMin(b.start) + b.minutes > toMin(due)) out.push({ block: b, task: { ...t, dueTime: due } })
  }
  return out
}

/**
 * Audits (and fixes) a plan. Idempotent: auditing the result again changes nothing.
 */
export function auditPlan(raw: DayProposal, ctx: AuditCtx): AuditResult {
  const fixed = new Set<string>()
  const keep = new Set(ctx.keep ?? [])
  const tasks = (ctx.tasks ?? []).filter((t) => t.content?.trim())
  const after = ctx.now ? planStartAt(ctx.now) : '00:00'
  let plan = ensureIds(dedupePlan(ensureIds(raw), { events: ctx.events, after }))

  // 1. Every open task is somewhere: a task the plan lost goes back on today's list.
  const droppedByHand = (t: AuditTask) => inList(plan.dropped, t.content)
  const closed = new Set(plan.closed ?? [])
  const missing = unaccounted(plan, tasks).filter((t) => !droppedByHand(t) && !(t.id && closed.has(t.id)))
  if (missing.length) {
    const also = [...(plan.also ?? [])]
    for (const t of missing) if (!also.some((a) => (t.id && a.id === t.id) || sameThing(a.title, t.content))) also.push({ title: t.content.trim(), minutes: estimateMinutes(t), priority: t.priority ?? 1, ...(t.id ? { id: t.id } : {}), ...(t.project ? { project: t.project } : {}), ...(t.due && t.due < plan.day ? { overdue: true } : {}) })
    plan = { ...plan, also }
    fixed.add('missing')
  }

  if (ctx.fixTimes !== false) {
    // 2. A task due at a time: its block moves into a gap that ends before it (when there is one).
    for (const { block, task } of lateForDue(plan, tasks)) {
      if (!loose(block, keep)) continue
      const from = ctx.now ? planStartAt(ctx.now) : '00:00'
      const others = { ...plan, blocks: plan.blocks.filter((b) => b.id !== block.id) }
      const gap = planGaps(others, withProtected(ctx.events ?? [], ctx.limits, plan.day), from, task.dueTime!, block.minutes).find((g) => g.minutes >= block.minutes)
      if (!gap) continue
      plan = { ...plan, blocks: plan.blocks.map((b) => (b.id === block.id ? { ...b, start: gap.start } : b)).sort((a, b) => a.start.localeCompare(b.start)) }
      fixed.add('deadline')
    }
    // 3. Overlaps, breaks, the wind-down, the past.
    const r = fixPlan(plan, ctx.fixPast === false ? { ...ctx, now: null } : ctx)
    plan = r.plan
    r.fixed.forEach((f) => fixed.add(f))
    // 4. More work than free time: only the minimum gives way. The least important loose block is
    //    shortened first (never under 25 min); only when that is not enough does it leave the plan (its
    //    tasks on the list). Must-dos and urgent work (rank 0–1) never leave, and at least one block stays.
    if (ctx.now) {
      const nowM = toMin(ctx.now)
      for (let guard = 0; guard < 20; guard++) {
        const over = overflow(plan, ctx)
        if (over <= 0) break
        const cand = plan.blocks
          .filter((b) => loose(b, keep) && toMin(b.start) + b.minutes > nowM)
          .map((b) => ({ b, r: blockRank(b, plan, tasks) }))
          .filter((x) => x.r >= 2)
          .sort((a, c) => c.r - a.r || c.b.start.localeCompare(a.b.start))[0]
        if (!cand || plan.blocks.length <= 1) break
        const cut = Math.ceil(over / 5) * 5
        if (cand.b.minutes - cut >= 25) {
          plan = { ...plan, blocks: plan.blocks.map((x) => (x === cand.b ? { ...x, minutes: x.minutes - cut } : x)) }
          fixed.add('trim')
          continue
        }
        plan = toList(plan, cand.b)
        fixed.add('trim')
      }
    }
  }
  // 5. Your limits hold (off time, work a day, a kind's cap, protected time): only loose drafts still
  //    ahead are trimmed or go back on the list, the least important first. Never broken to fit more in.
  if (ctx.limits && (ctx.keepLimits ?? ctx.fixTimes !== false)) {
    const r = keepLimits(plan, ctx.limits, { loose: (b) => loose(b, keep), rank: (b, p) => blockRank(b, p, tasks), toList, after: ctx.now ? toMin(ctx.now) : 0 })
    if (r.changed.length) {
      plan = r.plan
      r.changed.forEach((c) => fixed.add(`limit:${c}`))
    }
  }
  plan = relinkAlso(dedupePlan(plan, { events: ctx.events, after }))
  const issues = [...checkPlan(plan, ctx)]
  for (const { block, task } of lateForDue(plan, tasks)) issues.push({ code: 'late', text: `${task.content} is due ${task.dueTime}, planned ${block.start}`, ids: [block.id!], fixable: false })
  const left = leftTasks(plan, tasks)
  return { plan, fixed: [...fixed], issues, left, line: auditLine(left) }
}

/** A block leaves the plan; its tasks (or its title) go on today's list without a time. */
function toList(plan: DayProposal, b: PlanBlock): DayProposal {
  const also = [...(plan.also ?? [])]
  const must = new Set(plan.mustdos.map(lower))
  const items = b.tasks?.length ? b.tasks : [b.title]
  for (const t of items) if (!must.has(lower(t)) && !also.some((a) => sameThing(a.title, t))) also.push({ title: t, minutes: Math.round(b.minutes / items.length), priority: 1 })
  return relinkAlso({ ...plan, blocks: plan.blocks.filter((x) => x !== b), also })
}

/** Every task of today without a block, with the reason (the plan's lists, then Todoist's). */
export function leftTasks(plan: DayProposal, tasks: AuditTask[] = []): LeftTask[] {
  const out: LeftTask[] = []
  const closed = new Set(plan.closed ?? [])
  const inBlock = (t: string) => planItems(plan).some((b) => (b.tasks ?? []).some((x) => sameThing(x, t)) || sameThing(b.title, t))
  const seen = (t: string, id?: string) => out.some((x) => (id && x.id === id) || sameThing(x.title, t))
  const waiting = plan.squeeze?.keep
  const add = (title: string, id: string | undefined, why: LeftWhy, text: string) => {
    if (!title.trim() || seen(title, id) || (id && closed.has(id))) return
    out.push({ title: title.trim(), ...(id ? { id } : {}), why, text })
  }
  for (const m of plan.mustdos) {
    if (inBlock(m)) continue
    const a = (plan.also ?? []).find((x) => sameThing(x.title, m))
    const t = tasks.find((x) => sameThing(x.content, m))
    if (a?.event) add(m, a.id ?? t?.id, 'event', `at the ${a.event} event`)
    else if (waiting && sameThing(waiting, m)) add(m, a?.id ?? t?.id, 'waiting', 'waiting on you')
    else add(m, a?.id ?? t?.id, 'room', 'no room today')
  }
  for (const a of alsoOpen(plan)) {
    if (inBlock(a.title)) continue
    if (a.event) add(a.title, a.id, 'event', `at the ${a.event} event`)
    else if (waiting && sameThing(waiting, a.title)) add(a.title, a.id, 'waiting', 'waiting on you')
    else add(a.title, a.id, 'room', 'no room today')
  }
  for (const d of plan.deferred ?? []) add(d.title, d.id, 'tomorrow', d.why || 'tomorrow')
  return out
}

/** The card's one plain line about what has no room (null: everything has a place). */
export function auditLine(left: LeftTask[]): string | null {
  const room = left.filter((l) => l.why === 'room')
  if (!room.length) return null
  if (room.length === 1) return `1 task didn't fit: ${room[0].title}. Move it to tomorrow?`
  const names = room.slice(0, 2).map((r) => r.title).join(', ')
  return `${room.length} tasks didn't fit: ${names}${room.length > 2 ? ` +${room.length - 2} more` : ''}. Move them to tomorrow?`
}

/**
 * "Move to tomorrow": these tasks leave today's plan (blocks, must-dos, the
 * list) and go under "Moved to tomorrow" with the reason. Nothing is deleted.
 */
export function moveToTomorrow(plan: DayProposal, items: Pick<LeftTask, 'title' | 'id'>[]): DayProposal {
  if (!items.length) return plan
  const hit = (t: string, id?: string) => items.some((x) => (x.id && id && x.id === id) || sameThing(x.title, t))
  const blocks = plan.blocks.filter((b) => !(b.tasks?.length ? b.tasks.every((t) => hit(t)) : hit(b.title))).map((b) => (b.tasks?.some((t) => hit(t)) ? { ...b, tasks: b.tasks.filter((t) => !hit(t)) } : b))
  const deferred = [...(plan.deferred ?? [])]
  for (const x of items) if (!deferred.some((d) => (x.id && d.id === x.id) || sameThing(d.title, x.title))) deferred.push({ title: x.title, ...(x.id ? { id: x.id } : {}), why: 'You moved it to tomorrow' })
  return relinkAlso({ ...plan, blocks, mustdos: plan.mustdos.filter((m) => !hit(m)), also: (plan.also ?? []).filter((a) => !hit(a.title, a.id)), deferred })
}

// ---- Why each block is there (one short muted line) ---------------------------

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const P_NAME: Record<number, string> = { 4: 'P1', 3: 'P2', 2: 'P3' }

/**
 * Why a block is in the plan, from real data only (null: nothing worth saying).
 * At most two short reasons: "pinned · due 15:00", "overdue · from Todoist: P1".
 */
export function blockWhy(b: PlanBlock & { id?: string; train?: boolean }, plan: DayProposal, tasks: AuditTask[] = []): string | null {
  const parts: string[] = []
  const names = b.tasks?.length ? b.tasks : [b.title]
  const also = (t: string) => (plan.also ?? []).find((a) => sameThing(a.title, t))
  const todo = (t: string) => tasks.find((x) => sameThing(x.content, t))
  if (b.locked) parts.push('pinned')
  // A deadline session says which deadline and which session ("exam in 5 days, session 2 of 4").
  if (b.why?.trim()) parts.push(b.why.trim())
  if (b.train || b.id === TRAIN_ID) parts.push("today's workout")
  if (names.some((t) => also(t)?.asked || todo(t)?.asked || (plan.squeeze && sameThing(plan.squeeze.keep, t)))) parts.push('you asked for it today')
  const timed = names.map(todo).find((t) => t && ownTime(t, plan))
  if (timed) parts.push(`due ${ownTime(timed, plan)}`)
  const later = names.map(todo).find((t) => t?.due && t.due > plan.day)
  if (later?.due) {
    const d = new Date(`${later.due}T12:00:00`)
    const days = Math.round((d.getTime() - new Date(`${plan.day}T12:00:00`).getTime()) / 86400000)
    parts.push(days <= 6 ? `due ${DAYS[d.getDay()]}` : `due in ${days} days`)
  }
  if (names.some((t) => also(t)?.overdue || (todo(t)?.due && todo(t)!.due! < plan.day))) parts.push('overdue')
  if (names.some((t) => plan.mustdos.some((m) => sameThing(m, t)))) parts.push('must-do')
  const pr = Math.max(0, ...names.map((t) => also(t)?.priority ?? todo(t)?.priority ?? 0))
  if (P_NAME[pr]) parts.push(`from Todoist: ${P_NAME[pr]}`)
  if (b.kind === 'goal' && !b.why?.trim()) parts.push('goal time for today')
  if (b.kind === 'quick' && (b.tasks?.length ?? 0) > 1) parts.push(`${b.tasks!.length} small tasks together`)
  if (!parts.length) {
    const project = names.map((t) => also(t)?.project ?? todo(t)?.project).find(Boolean)
    if (project) parts.push(`from Todoist · ${project}`)
  }
  return parts.length ? parts.slice(0, 2).join(' · ') : null
}

