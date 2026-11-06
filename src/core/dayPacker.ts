// The day plan that looks at ALL of today's work (DP1). Pure and tested.
//
// In: every Todoist task due today or overdue, last night's top 3, goals that
// need time today, the calendar's fixed events (classes, commutes, meetings)
// and last night's sleep. Out: the 3 must-dos (the honest daily points stay
// at 3), focus blocks packed into the free time between events, small tasks
// batched into one "Quick tasks" block, an "Also today" list with every other
// task (sorted by priority, with a time estimate) and, only when the day is
// really full, tasks moved to tomorrow with the reason. Nothing is dropped
// silently: every task is a must-do, in "Also today", or deferred.
import { freeGaps, type CalEvent } from './dayTime'
import { fromMin, toMin, quarter, type AlsoItem, type DayProposal, type DeferredItem, type PlanBlock } from './rhythm'

export interface PlanTask {
  id?: string
  content: string
  /** Todoist: 4 = P1 (most urgent) … 1 = P4. */
  priority?: number
  due?: string | null
  dueTime?: string | null
  project?: string | null
  starred?: boolean
  /** Todoist's duration, when set. */
  duration?: number | null
}

export interface PackInputs {
  today: string
  now: string
  events: CalEvent[]
  tasks: PlanTask[]
  top3: string[]
  /** Goals that need time today (behind pace, deadline plans), placed first. */
  goals?: { title: string; minutes: number }[]
  waterTarget: number
  workoutDone: boolean
  /** Last night's sleep in minutes, when known (under 6 h = a lighter day). */
  sleptMin?: number | null
  /** His best focus hours (0–23), hard blocks go there first. */
  best?: number[]
  /** The plan ends by then (default 22:00, 21:30 after a short night). */
  endBy?: string
}

const QUICK = /\b(check|email|e-mail|mail|reply|answer|call|text|message|pay|buy|order|send|book|sign|print|upload|submit|confirm|cancel|renew|schedule|remind|ask|tidy|water)\b/i
const LONG = /\b(study|learn|revise|exam|homework|project|write|essay|report|thesis|lab|code|build|refactor|implement|course|lecture|practice|ctf|research|prepare|read)\b/i
const MEDIUM = /\b(watch|video|youtube|review|fix|clean|plan|problem|cv|resume|apply)\b/i

/** How long a task takes: its Todoist duration, else a guess from its words and priority. */
export function estimateMinutes(t: Pick<PlanTask, 'content' | 'duration' | 'priority'>): number {
  if (t.duration && t.duration > 0) return Math.min(240, Math.round(t.duration))
  const x = t.content
  const said = /(\d{1,3})\s*(?:min|mins|minutes|m)\b/i.exec(x)
  if (said && Number(said[1]) >= 5) return Math.min(240, Number(said[1]))
  const hours = /(\d(?:[.,]5)?)\s*h(?:ours?)?\b/i.exec(x)
  if (hours) return Math.min(240, Math.round(Number(hours[1].replace(',', '.')) * 60))
  if (LONG.test(x)) return (t.priority ?? 1) >= 3 ? 60 : 45
  if (QUICK.test(x) && x.split(/\s+/).length <= 6) return 15
  if (MEDIUM.test(x)) return 30
  return (t.priority ?? 1) >= 3 ? 45 : 25
}

export const isQuick = (minutes: number) => minutes <= 15

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Most important first: starred, priority, overdue, then due time. */
export function rankTasks<T extends PlanTask>(tasks: T[], today: string): T[] {
  return [...tasks].sort(
    (a, b) =>
      Number(!!b.starred) - Number(!!a.starred) ||
      (b.priority ?? 1) - (a.priority ?? 1) ||
      Number(!!(b.due && b.due < today)) - Number(!!(a.due && a.due < today)) ||
      String(a.due ?? '9').localeCompare(String(b.due ?? '9')) ||
      String(a.dueTime ?? '99').localeCompare(String(b.dueTime ?? '99'))
  )
}

interface Win {
  s: number
  e: number
}

/** Free windows between events, with 10 minutes to get to and from each event. */
export function freeWindows(events: CalEvent[], today: string, after: string, endBy: string): Win[] {
  const gaps = freeGaps(events, today, { after, to: endBy, minMinutes: 20 })
  const a = toMin(after)
  const end = toMin(endBy)
  return gaps
    .map((g) => {
      const s = toMin(g.start)
      const e = toMin(g.end)
      return { s: s > a && s > toMin('07:00') ? s + 10 : s, e: e < end ? e - 10 : e }
    })
    .filter((w) => w.e - w.s >= 20)
}

interface Chunk {
  title: string
  minutes: number
  kind: 'goal' | 'focus' | 'quick'
  tasks: { title: string; id?: string; minutes: number }[]
  hard: boolean
}

/** Puts one chunk in a window (best hours first for hard work, the afternoon for quick tasks). Mutates `wins`. */
function place(wins: Win[], c: Chunk, best: number[], minMin: number): { start: number; minutes: number } | null {
  const fits = (w: Win, need: number) => w.e - w.s >= need
  const take = (w: Win, start: number, minutes: number) => {
    const i = wins.indexOf(w)
    const parts: Win[] = []
    if (start - 10 - w.s >= 20) parts.push({ s: w.s, e: start - 10 })
    if (w.e - (start + minutes + 10) >= 20) parts.push({ s: start + minutes + 10, e: w.e })
    wins.splice(i, 1, ...parts)
    return { start, minutes }
  }
  if (c.kind === 'quick') {
    const pm = wins.find((w) => w.e - Math.max(w.s, toMin('13:00')) >= c.minutes)
    if (pm) return take(pm, Math.max(pm.s, toMin('13:00')), c.minutes)
  }
  if (c.hard && best.length) {
    for (const h of best) {
      const w = wins.find((x) => x.s <= h * 60 + 30 && x.e >= Math.max(x.s, h * 60) + c.minutes)
      if (w) return take(w, Math.max(w.s, h * 60), c.minutes)
    }
  }
  const w = wins.find((x) => fits(x, c.minutes))
  if (w) return take(w, w.s, c.minutes)
  // Shrink to the biggest window left when it still makes a real block.
  const big = [...wins].sort((a, b) => b.e - b.s - (a.e - a.s))[0]
  if (big && big.e - big.s >= minMin) return take(big, big.s, Math.floor((big.e - big.s) / 5) * 5)
  return null
}

const hm = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
export const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`)

/** The whole day packed without the model (also the fallback when the model returns too little). */
export function packDay(p: PackInputs): DayProposal {
  const short = p.sleptMin != null && p.sleptMin < 360
  const cap = short ? 60 : 90
  const maxBlocks = short ? 4 : 5
  const endBy = p.endBy ?? (short ? '21:30' : '22:00')
  const after = quarter(p.now)

  // Every task once (Todoist can repeat a task in "today" and "@today").
  const seen = new Set<string>()
  const tasks = rankTasks(p.tasks, p.today).filter((t) => {
    const k = t.id ? `#${t.id}` : key(t.content)
    if (!t.content.trim() || seen.has(k)) return false
    seen.add(k)
    return true
  })
  const est = new Map(tasks.map((t) => [t, estimateMinutes(t)]))

  // The 3 must-dos: last night's top 3 first, then the most important tasks.
  const mustdos: string[] = []
  const mustTasks = new Set<PlanTask>()
  const addMust = (title: string) => {
    if (mustdos.length >= 3 || !title.trim() || mustdos.some((m) => key(m) === key(title))) return
    mustdos.push(title.trim())
    const t = tasks.find((x) => key(x.content) === key(title))
    if (t) mustTasks.add(t)
  }
  p.top3.forEach(addMust)
  tasks.forEach((t) => addMust(t.content))

  // Chunks of work: goals, each must-do on its own, the rest grouped by project, quick ones batched.
  const chunks: Chunk[] = (p.goals ?? []).map((g) => ({ title: g.title, minutes: Math.min(cap, Math.max(25, g.minutes)), kind: 'goal' as const, tasks: [], hard: true }))
  const quick: PlanTask[] = []
  const others: PlanTask[] = []
  for (const m of mustdos) {
    const t = tasks.find((x) => key(x.content) === key(m))
    const minutes = t ? est.get(t)! : 50
    if (t && isQuick(minutes)) quick.push(t)
    else chunks.push({ title: m, minutes: Math.min(cap, Math.max(25, minutes)), kind: 'focus', tasks: [{ title: m, id: t?.id, minutes }], hard: true })
  }
  for (const t of tasks) {
    if (mustTasks.has(t)) continue
    if (isQuick(est.get(t)!)) quick.push(t)
    else others.push(t)
  }
  // Other tasks: by project, highest priority first, a block holds up to `cap` minutes.
  const groups = new Map<string, PlanTask[]>()
  for (const t of others) {
    const g = t.project?.trim() || 'Tasks'
    groups.set(g, [...(groups.get(g) ?? []), t])
  }
  const groupChunks: Chunk[] = []
  for (const [project, list] of groups) {
    let cur: Chunk | null = null
    for (const t of list) {
      const m = Math.min(cap, est.get(t)!)
      if (!cur || cur.minutes + m > cap) {
        cur = { title: project, minutes: 0, kind: 'focus', tasks: [], hard: (t.priority ?? 1) >= 3 }
        groupChunks.push(cur)
      }
      cur.minutes += m
      cur.tasks.push({ title: t.content, id: t.id, minutes: est.get(t)! })
    }
  }
  for (const c of groupChunks) c.title = c.tasks.length === 1 ? c.tasks[0].title : `${c.title}: ${c.tasks.map((x) => x.title).join(', ')}`
  groupChunks.sort((a, b) => Number(b.hard) - Number(a.hard) || b.minutes - a.minutes)
  chunks.push(...groupChunks)
  if (quick.length) {
    const list = quick.slice(0, 8)
    const minutes = Math.min(60, Math.max(20, list.reduce((s, t) => s + est.get(t)!, 0)))
    chunks.push({ title: `Quick tasks (${list.length})`, minutes: Math.round(minutes / 5) * 5, kind: 'quick', tasks: list.map((t) => ({ title: t.content, id: t.id, minutes: est.get(t)! })), hard: false })
  }

  // Place them: goals and must-dos first, then the rest while there's room.
  const wins = freeWindows(p.events, p.today, after, endBy)
  const freeMin = wins.reduce((s, w) => s + w.e - w.s, 0)
  const order = [...chunks.filter((c) => c.kind !== 'quick').slice(0, maxBlocks - (quick.length ? 1 : 0)), ...chunks.filter((c) => c.kind === 'quick')]
  // A short night: shorter blocks (75%, at least 25 min).
  if (short) for (const c of order) if (c.kind !== 'quick') c.minutes = Math.max(25, Math.round((c.minutes * 0.75) / 5) * 5)
  const placed: (PlanBlock & { chunk: Chunk })[] = []
  for (const c of order) {
    if (placed.length >= maxBlocks) break
    const at = place(wins, c, p.best ?? [], 25)
    if (!at) continue
    placed.push({ title: c.title.slice(0, 80), start: fromMin(at.start), minutes: at.minutes, kind: c.kind, tasks: c.tasks.map((t) => t.title), chunk: c })
  }
  placed.sort((a, b) => a.start.localeCompare(b.start))
  const blocks: PlanBlock[] = placed.map(({ chunk: _c, ...b }) => b)
  const inBlock = new Map<string, string>()
  for (const b of placed) for (const t of b.chunk.tasks) inBlock.set(key(t.title), b.start)

  // Training in the evening when there's room (not over a block).
  let training: DayProposal['training'] = null
  if (!p.workoutDone) {
    const evening = wins.filter((w) => w.e > toMin('17:00'))
    for (const w of evening) {
      const s = Math.max(w.s, toMin('17:00'))
      if (s + 45 <= w.e) {
        training = { time: fromMin(Math.ceil(s / 15) * 15), what: short ? 'easy: Workout · 30 min' : 'Workout · 45 min' }
        break
      }
    }
  }

  // Every other task: in "Also today" (with the block it sits in), or moved to tomorrow when the day is full.
  const leftFree = wins.reduce((s, w) => s + w.e - w.s, 0) - (training ? 45 : 0)
  let budget = Math.max(0, leftFree)
  const also: AlsoItem[] = []
  const deferred: DeferredItem[] = []
  for (const t of tasks) {
    if (mustTasks.has(t)) continue
    const minutes = est.get(t)!
    const at = inBlock.get(key(t.content))
    const item: AlsoItem = { title: t.content, minutes, priority: t.priority ?? 1, ...(t.id ? { id: t.id } : {}), ...(t.project ? { project: t.project } : {}), ...(at ? { at } : {}), ...(t.due && t.due < p.today ? { overdue: true } : {}) }
    if (at || (t.priority ?? 1) >= 3 || (t.due && t.due < p.today) || minutes <= budget) {
      if (!at) budget = Math.max(0, budget - minutes)
      also.push(item)
    } else deferred.push({ title: t.content, ...(t.id ? { id: t.id } : {}), why: 'No free time left today; tomorrow' })
  }
  also.sort((a, b) => b.priority - a.priority || Number(!!b.overdue) - Number(!!a.overdue))

  const focus = blocks.reduce((s, b) => s + b.minutes, 0)
  const total = tasks.length
  const classes = p.events.filter((e) => !e.allDay).length
  const why = !blocks.length
    ? freeMin < 25
      ? 'No free time between your events today, so the must-dos fit where they can.'
      : 'Nothing to plan today: pick one thing that matters.'
    : `${total} task${total === 1 ? '' : 's'}${classes ? ` and ${classes} event${classes === 1 ? '' : 's'}` : ''}, ${hm(freeMin)} free: ${blocks.length} block${blocks.length === 1 ? '' : 's'} (${fmtMin(focus)})${quick.length ? ', small tasks batched' : ''}${short ? `. Short night (${hm(p.sleptMin!)}), so shorter blocks and an earlier end` : ''}.`
  const headline = mustdos.length
    ? `${mustdos.length} must-do${mustdos.length === 1 ? '' : 's'} · ${blocks.length} block${blocks.length === 1 ? '' : 's'} · ${fmtMin(focus)} focus${also.length ? ` · ${also.length} more on the list` : ''}`
    : 'A light day: pick one thing that matters'
  return {
    day: p.today,
    headline: short ? `Short night (${hm(p.sleptMin!)}): a lighter day. ${headline}`.slice(0, 160) : headline,
    mustdos,
    blocks,
    training,
    waterMl: p.waterTarget,
    also,
    deferred,
    why,
    light: short || undefined,
    free: wins.length || blocks.length ? freeWindows(p.events, p.today, after, endBy).map((w) => ({ start: fromMin(w.s), end: fromMin(w.e) })) : []
  }
}

/** Every task of the day, found in the plan: a must-do, in a block, in "Also today", or deferred. */
export function unaccounted(plan: Pick<DayProposal, 'mustdos' | 'blocks' | 'also' | 'deferred'>, tasks: PlanTask[]): PlanTask[] {
  const known = new Set<string>([...plan.mustdos.map(key), ...(plan.also ?? []).map((a) => key(a.title)), ...(plan.deferred ?? []).map((d) => key(d.title)), ...plan.blocks.flatMap((b) => (b.tasks ?? []).map(key))])
  const ids = new Set<string>([...(plan.also ?? []).map((a) => a.id), ...(plan.deferred ?? []).map((d) => d.id)].filter((x): x is string => !!x))
  return tasks.filter((t) => !(t.id && ids.has(t.id)) && !known.has(key(t.content)))
}

/**
 * The model's plan, checked against the packer's: every task accounted for
 * (missing ones go into "Also today"), "Also today" filled from the tasks
 * (estimates, priority, ids), and the packer's plan when the model gave too
 * little (far fewer blocks or far less focus than the day has room for).
 */
export function checkModelPlan(model: DayProposal, packed: DayProposal, tasks: PlanTask[]): DayProposal {
  const enough = packed.blocks.length < 3 || (model.blocks.length >= Math.ceil(packed.blocks.length / 2) + 1 && model.blocks.reduce((s, b) => s + b.minutes, 0) >= packed.blocks.reduce((s, b) => s + b.minutes, 0) * 0.5)
  if (!enough) return { ...packed, headline: packed.headline }
  const byKey = new Map(tasks.map((t) => [key(t.content), t]))
  const byId = new Map(tasks.filter((t) => t.id).map((t) => [t.id!, t]))
  const inBlock = new Map<string, string>()
  for (const b of model.blocks) for (const t of b.tasks ?? []) inBlock.set(key(t), b.start)
  const must = new Set(model.mustdos.map(key))
  const deferred = (model.deferred ?? []).filter((d) => d.why?.trim() && (byKey.has(key(d.title)) || (d.id && byId.has(d.id))) && !must.has(key(d.title)))
  const deferredKeys = new Set(deferred.map((d) => key(d.title)))
  const also: AlsoItem[] = []
  for (const t of rankTasks(tasks, model.day)) {
    const k = key(t.content)
    if (must.has(k) || deferredKeys.has(k)) continue
    const fromModel = (model.also ?? []).find((a) => key(a.title) === k || (a.id && a.id === t.id))
    const at = inBlock.get(k) ?? fromModel?.at
    also.push({ title: t.content, minutes: fromModel?.minutes && fromModel.minutes >= 5 && fromModel.minutes <= 240 ? Math.round(fromModel.minutes) : estimateMinutes(t), priority: t.priority ?? 1, ...(t.id ? { id: t.id } : {}), ...(t.project ? { project: t.project } : {}), ...(at ? { at } : {}), ...(t.due && t.due < model.day ? { overdue: true } : {}) })
  }
  also.sort((a, b) => b.priority - a.priority || Number(!!b.overdue) - Number(!!a.overdue))
  return { ...model, also, deferred, why: model.why || packed.why, free: packed.free }
}

/** After blocks moved: each "Also today" item points at the block that holds it now (or none). */
export function relinkAlso(plan: DayProposal): DayProposal {
  if (!plan.also?.length) return plan
  const at = new Map<string, string>()
  for (const b of plan.blocks) for (const t of b.tasks ?? []) at.set(key(t), b.start)
  return {
    ...plan,
    also: plan.also.map((a) => {
      const { at: _old, ...rest } = a
      const now = at.get(key(a.title))
      return now ? { ...rest, at: now } : rest
    })
  }
}

/** "Also today" for the plan card: ticked ones hidden, still in priority order. */
export function alsoLeft(plan: Pick<DayProposal, 'also'>, closed: Set<string>): AlsoItem[] {
  return (plan.also ?? []).filter((a) => !(a.id && closed.has(a.id)) && !closed.has(key(a.title)))
}
