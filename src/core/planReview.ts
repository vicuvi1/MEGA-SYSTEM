// The end-of-day check (pure and tested, planReview.test.ts): in the evening,
// each of today's plan blocks gets one tap: Done / Partly (how many minutes) /
// Slipped -> tomorrow / Drop. What happened is kept in the synced setting
// `plan_review` (one record per block, by the block's id, so marking twice
// changes nothing). It feeds the learned task times (core/taskTimes.ts) and
// the plan score (core/planScore.ts).
//
// Honest by design: the check itself pays nothing. A Done block closes its
// Todoist task through the plan's usual tick (points come only from that
// existing path), a slipped one goes through the usual Move to tomorrow, and
// a dropped one is only written down (nothing is deleted anywhere).
//
// Real numbers win: the minutes the focus timer logged for a block come
// first, then minutes you type, else nothing is assumed (`src: 'plan'`).
// Telegram and other callers use `reviewRows` and `reviewItem` too.
import { estimateMinutes } from './dayPacker'
import { sameThing } from './planDedupe'
import { isWork } from './planLimits'
import { planItems } from './planEdit'
import { similarity } from './benNormalize'
import { addDays } from './dates'
import { toMin, type DayProposal } from './rhythm'

export const PLAN_REVIEW = 'plan_review'
/** Records older than this many days are left out when the setting is written again (it is a small rolling log). */
export const KEEP_DAYS = 90

export type Outcome = 'done' | 'part' | 'slip' | 'drop'
/** Where `actual` came from: the focus timer, minutes you typed, or nothing known. */
export type Source = 'timer' | 'said' | 'plan'

export interface ReviewItem {
  /** The plan block's id. */
  id: string
  title: string
  /** "HH:MM" the block started. */
  start: string
  /** The block's length in the plan. */
  planned: number
  /** The planner's own plain guess for this title (core/dayPacker estimateMinutes): what learning compares with. */
  guess: number
  outcome: Outcome
  /** Real minutes, when known (timer or typed). */
  actual: number | null
  src: Source
  /** The block's Todoist tasks (titles). */
  tasks?: string[]
  /** Todoist project and labels of its task, when known (for the learned task times). */
  project?: string
  labels?: string[]
  /** When it was marked (ISO). */
  at: string
}

export interface ReviewStore {
  v: 1
  days: Record<string, { items: Record<string, ReviewItem> }>
}

export const EMPTY_REVIEW: ReviewStore = { v: 1, days: {} }

const OUTCOMES: Outcome[] = ['done', 'part', 'slip', 'drop']
const SOURCES: Source[] = ['timer', 'said', 'plan']
const DAY = /^\d{4}-\d{2}-\d{2}$/
const HM = /^\d{2}:\d{2}$/
const num = (x: unknown, lo: number, hi: number): number | null => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : null)
const strs = (x: unknown): string[] | undefined => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && !!s.trim()).map((s) => s.slice(0, 120)).slice(0, 12) : undefined)

function cleanItem(x: any, id: string): ReviewItem | null {
  if (!x || typeof x !== 'object' || typeof x.title !== 'string' || !OUTCOMES.includes(x.outcome)) return null
  const planned = num(x.planned, 5, 600)
  if (planned == null) return null
  const tasks = strs(x.tasks)
  const labels = strs(x.labels)
  return {
    id,
    title: x.title.slice(0, 120),
    start: typeof x.start === 'string' && HM.test(x.start) ? x.start : '00:00',
    planned,
    guess: num(x.guess, 5, 600) ?? planned,
    outcome: x.outcome,
    actual: num(x.actual, 0, 900),
    src: SOURCES.includes(x.src) ? x.src : 'plan',
    ...(tasks?.length ? { tasks } : {}),
    ...(typeof x.project === 'string' && x.project.trim() ? { project: x.project.slice(0, 80) } : {}),
    ...(labels?.length ? { labels } : {}),
    at: typeof x.at === 'string' ? x.at : ''
  }
}

/** The setting as read (anything broken is left out). */
export function cleanReview(raw: unknown): ReviewStore {
  const days: ReviewStore['days'] = {}
  const src = (raw as any)?.days
  if (!src || typeof src !== 'object') return { v: 1, days }
  for (const [day, d] of Object.entries(src)) {
    if (!DAY.test(day) || !d || typeof (d as any).items !== 'object') continue
    const items: Record<string, ReviewItem> = {}
    for (const [id, x] of Object.entries((d as any).items ?? {})) {
      const it = cleanItem(x, id)
      if (it) items[id] = it
    }
    if (Object.keys(items).length) days[day] = { items }
  }
  return { v: 1, days }
}

const trim = (s: ReviewStore, today: string): ReviewStore => {
  const from = addDays(today, -KEEP_DAYS)
  return { v: 1, days: Object.fromEntries(Object.entries(s.days).filter(([d]) => d >= from)) }
}

/** Saves one block's record (the same record twice changes nothing). Days older than KEEP_DAYS fall off. */
export function putItem(s: ReviewStore, day: string, item: ReviewItem, today: string): ReviewStore {
  const items = { ...(s.days[day]?.items ?? {}), [item.id]: item }
  return trim({ v: 1, days: { ...s.days, [day]: { items } } }, today)
}

/** Takes a block's record back (Undo). */
export function dropItem(s: ReviewStore, day: string, id: string): ReviewStore {
  const items = { ...(s.days[day]?.items ?? {}) }
  if (!(id in items)) return s
  delete items[id]
  const days = { ...s.days }
  if (Object.keys(items).length) days[day] = { items }
  else delete days[day]
  return { v: 1, days }
}

/**
 * Two copies of the setting (this device and another one): every day and block from both,
 * the newer mark winning per block. Used when a write finds a newer copy than it read.
 */
export function mergeReview(a: ReviewStore, b: ReviewStore): ReviewStore {
  const days: ReviewStore['days'] = { ...a.days }
  for (const [day, d] of Object.entries(b.days)) {
    const items = { ...(days[day]?.items ?? {}) }
    for (const [id, it] of Object.entries(d.items)) if (!items[id] || (it.at || '') > (items[id].at || '')) items[id] = it
    days[day] = { items }
  }
  return { v: 1, days }
}

// ---- Which blocks the check lists -------------------------------------------------

/** A focus session from the timer. Times are ISO strings (local or with a zone). */
export interface TimerSession {
  subject: string
  startedAt: string | null
  endedAt: string | null
  minutes: number
}

export interface ReviewRow {
  id: string
  title: string
  start: string
  minutes: number
  tasks: string[]
  /** Minutes the focus timer logged for it today (0: none). */
  timer: number
  /** Every task of it is ticked in the plan already. */
  ticked: boolean
  /** What you marked already (null: not yet). */
  mark: ReviewItem | null
}

const minOf = (iso: string) => {
  const d = new Date(iso)
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * The focus timer's minutes per block: a session counts for the block whose name it carries
 * (the timer started from the block, or a similar subject), else for the block it mostly sat in.
 * Each session counts once.
 */
export function timerFor(blocks: { id: string; title: string; start: string; minutes: number; tasks?: string[] }[], sessions: TimerSession[]): Map<string, number> {
  const out = new Map<string, number>(blocks.map((b) => [b.id, 0]))
  const names = (b: (typeof blocks)[number]) => [b.title, ...(b.tasks ?? [])]
  for (const s of sessions) {
    const mins = Math.max(0, Math.round(s.minutes || 0))
    if (!mins) continue
    const subject = String(s.subject ?? '')
    const byName = subject.trim() ? blocks.find((b) => names(b).some((n) => sameThing(n, subject) || similarity(subject, n) >= 0.6 || similarity(n, subject) >= 0.6)) : undefined
    let hit = byName
    if (!hit && s.startedAt) {
      const a = minOf(s.startedAt)
      const e = s.endedAt ? minOf(s.endedAt) : a + mins
      const best = blocks
        .map((b) => ({ b, overlap: Math.max(0, Math.min(e, toMin(b.start) + b.minutes) - Math.max(a, toMin(b.start))) }))
        .sort((x, y) => y.overlap - x.overlap)[0]
      if (best && best.overlap * 2 >= Math.max(1, e - a)) hit = best.b
    }
    if (hit) out.set(hit.id, (out.get(hit.id) ?? 0) + mins)
  }
  return out
}

/** The work blocks of the plan that have started by `now` (training, breaks and meals are left out), earliest first. */
export function reviewRows(plan: DayProposal, i: { now: string; sessions?: TimerSession[]; store?: ReviewStore }): ReviewRow[] {
  const now = toMin(i.now)
  const blocks = planItems(plan)
    .filter((b) => !b.train && isWork(b) && toMin(b.start) < now)
    .sort((a, b) => a.start.localeCompare(b.start))
  const timer = timerFor(blocks, i.sessions ?? [])
  const marks = i.store?.days[plan.day]?.items ?? {}
  return blocks.map((b) => {
    const tasks = b.tasks ?? []
    const done = (b.done ?? []).map((t) => t.toLowerCase())
    const names = tasks.length ? tasks : [b.title]
    return { id: b.id, title: b.title, start: b.start, minutes: b.minutes, tasks, timer: timer.get(b.id) ?? 0, ticked: names.every((t) => done.includes(t.toLowerCase())), mark: marks[b.id] ?? null }
  })
}

/** The end-of-day check is offered from the end of the last block (and any time from the shutdown). */
export function reviewFrom(plan: DayProposal): string | null {
  const ends = planItems(plan)
    .filter((b) => !b.train && isWork(b))
    .map((b) => toMin(b.start) + b.minutes)
  if (!ends.length) return null
  const m = Math.max(...ends)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** True once the last work block is over (the plan card then shows "Check the day"). */
export const reviewOpen = (plan: DayProposal, now: string): boolean => {
  const at = reviewFrom(plan)
  return !!at && toMin(now) >= toMin(at)
}

/**
 * One block's record. `minutes`: what you typed (wins); else the timer's minutes; else none.
 * Partly without any number keeps `actual` empty (the score then counts half the block).
 */
export function reviewItem(row: Pick<ReviewRow, 'id' | 'title' | 'start' | 'minutes' | 'tasks' | 'timer'>, outcome: Outcome, o: { minutes?: number | null; at: string; project?: string | null; labels?: string[] | null; priority?: number }): ReviewItem {
  const typed = typeof o.minutes === 'number' && Number.isFinite(o.minutes) && o.minutes >= 0 ? Math.min(900, Math.round(o.minutes)) : null
  const counts = outcome === 'done' || outcome === 'part'
  const actual = !counts ? (row.timer > 0 ? row.timer : null) : typed ?? (row.timer > 0 ? row.timer : null)
  const src: Source = counts && typed != null ? 'said' : actual != null && row.timer > 0 ? 'timer' : 'plan'
  const one = row.tasks.length === 1 ? row.tasks[0] : row.tasks.length ? null : row.title
  return {
    id: row.id,
    title: row.title.slice(0, 120),
    start: row.start,
    planned: Math.max(5, Math.round(row.minutes)),
    guess: one ? estimateMinutes({ content: one, priority: o.priority }) : Math.max(5, Math.round(row.minutes)),
    outcome,
    actual,
    src,
    ...(row.tasks.length ? { tasks: row.tasks.slice(0, 12) } : {}),
    ...(o.project?.trim() ? { project: o.project.trim().slice(0, 80) } : {}),
    ...(o.labels?.length ? { labels: o.labels.slice(0, 12) } : {}),
    at: o.at
  }
}

/** The words for a mark ("Done", "Partly · 30 min", "Tomorrow", "Dropped"). */
export function markLabel(m: Pick<ReviewItem, 'outcome' | 'actual'>): string {
  if (m.outcome === 'done') return m.actual != null ? `Done · ${m.actual} min` : 'Done'
  if (m.outcome === 'part') return m.actual != null ? `Partly · ${m.actual} min` : 'Partly'
  return m.outcome === 'slip' ? 'Tomorrow' : 'Dropped'
}

/** One plain line for Telegram or a toast: "3 of 5 blocks checked: 2 done, 1 to tomorrow". */
export function reviewLine(rows: Pick<ReviewRow, 'mark'>[]): string {
  const marked = rows.filter((r) => r.mark)
  if (!rows.length) return 'No blocks to check today'
  const n = (o: Outcome) => marked.filter((r) => r.mark!.outcome === o).length
  const parts = [n('done') && `${n('done')} done`, n('part') && `${n('part')} partly`, n('slip') && `${n('slip')} to tomorrow`, n('drop') && `${n('drop')} dropped`].filter(Boolean)
  return `${marked.length} of ${rows.length} block${rows.length === 1 ? '' : 's'} checked${parts.length ? `: ${parts.join(', ')}` : ''}`
}
