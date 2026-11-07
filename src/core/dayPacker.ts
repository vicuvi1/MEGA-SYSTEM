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
import { fromMin, toMin, type AlsoItem, type DayProposal, type DeferredItem, type PlanBlock } from './rhythm'
import type { WorkToday } from './lifeFit'
import { pickWorkoutSlot, slotTitle } from './workoutSlot'

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
  /** He asked for it today (added in the chat for today): placed today, never moved to tomorrow. */
  asked?: boolean
}

/** Where a plan may start: now rounded up to the next 5 minutes, plus `bufferMin` (10:00 → 10:05). */
export function planStartAt(now: string, bufferMin = 5): string {
  const m = toMin(now)
  return fromMin(Math.min(23 * 60 + 55, Math.ceil(m / 5) * 5 + bufferMin))
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
  /**
   * Today's work window (My life): partly busy. No deep focus there, only the
   * quick-tasks batch; a short shift blocks only its busy part, "no work
   * tonight" frees it all (core/lifeFit.ts workToday).
   */
  work?: (WorkToday & { rest?: { from: string; to: string } | null }) | null
  /** ME2: his real pace (what he told Ben, then the learned multiplier); default estimateMinutes. */
  estimate?: (t: PlanTask) => number
  /** ME2: hours he usually skips: hard work goes elsewhere when it can. */
  avoid?: number[]
  /**
   * BD8: the home workout's length (Sport Track's 20–45 min plan, already at
   * today's dose). With it, training goes in the best free slot: 12:00–16:00
   * first (before an evening shift), never ending after 22:00, never in the
   * work window or a class. Without it, the old evening slot.
   */
  train?: { minutes: number; easy?: boolean } | null
  /**
   * The share of the free time that stays unplanned (default 0.15, My life):
   * the plan never fills the day to the minute.
   */
  freeShare?: number
  /** A lunch break kept free (default 30 min between 12:00 and 14:00; null: none). */
  meal?: { from: string; to: string; minutes: number } | null
}

/** At least this share of the free time stays unplanned, unless My life says otherwise. */
export const FREE_SHARE = 0.15
export const MEAL_WINDOW = { from: '12:00', to: '14:00', minutes: 30 }
/** The break after a long deep block (60 min or more); shorter blocks get the usual 10. */
export const LONG_BREAK = 15
const cleanShare = (x: number | undefined) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(0.5, x)) : FREE_SHARE)

/**
 * Keeps a lunch break free: the free window that runs through lunchtime loses
 * `minutes` there (12:30 when it can), unless something already leaves that
 * much free time in the window (a gap between events). Mutates `wins`.
 */
export function keepMeal(wins: Win[], meal: { from: string; to: string; minutes: number }): { start: number; minutes: number } | null {
  const a = toMin(meal.from)
  const b = toMin(meal.to)
  // Lunch is already free when part of the window is not in any free window (an event-free gap wouldn't count).
  const inside = wins.filter((w) => w.e > a && w.s < b)
  if (!inside.length) return null
  const w = inside.find((x) => !x.light && Math.min(x.e, b) - Math.max(x.s, a) >= meal.minutes)
  if (!w) return null
  const start = Math.max(w.s, Math.min(toMin('12:30'), Math.min(w.e, b) - meal.minutes))
  const parts: Win[] = []
  if (start - w.s >= 20) parts.push({ ...w, e: start })
  if (w.e - (start + meal.minutes) >= 20) parts.push({ ...w, s: start + meal.minutes })
  wins.splice(wins.indexOf(w), 1, ...parts)
  return { start, minutes: meal.minutes }
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
  /** Inside the work window: light tasks only. */
  light?: boolean
}

/** The free windows with today's work window applied: its busy part cut out, its light part marked. */
export function withWork(wins: Win[], work: (WorkToday & { rest?: { from: string; to: string } | null }) | null | undefined): Win[] {
  if (!work) return wins
  const cut = (list: Win[], r: { from: string; to: string }, mark: boolean): Win[] => {
    const a = toMin(r.from)
    const b = toMin(r.to)
    const out: Win[] = []
    for (const w of list) {
      if (w.e <= a || w.s >= b) {
        out.push(w)
        continue
      }
      if (w.s < a) out.push({ ...w, e: a })
      if (mark) out.push({ s: Math.max(w.s, a), e: Math.min(w.e, b), light: true })
      if (w.e > b) out.push({ ...w, s: b })
    }
    return out.filter((w) => w.e - w.s >= 20)
  }
  let out = wins
  if (work.busy) out = cut(out, work.busy, false)
  if (work.light) out = cut(out, work.light, true)
  // ME3: the hour after a long shift is light time too (no deep work right after work).
  if (work.rest) out = cut(out, work.rest, true)
  return out
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
function place(wins: Win[], c: Chunk, best: number[], minMin: number, avoid: number[] = []): { start: number; minutes: number; light?: boolean } | null {
  const fits = (w: Win, need: number) => w.e - w.s >= need
  const take = (w: Win, start: number, minutes: number) => {
    const i = wins.indexOf(w)
    const parts: Win[] = []
    // A real break after each block: 15 minutes after an hour or more of deep work, else 10.
    const rest = c.kind !== 'quick' && minutes >= 60 ? LONG_BREAK : 10
    if (start - 10 - w.s >= 20) parts.push({ ...w, e: start - 10 })
    if (w.e - (start + minutes + rest) >= 20) parts.push({ ...w, s: start + minutes + rest })
    wins.splice(i, 1, ...parts)
    return { start, minutes, ...(w.light ? { light: true } : {}) }
  }
  if (c.kind === 'quick') {
    // Quick wins fit the work window (light time), so the free day stays for deep work.
    const lw = wins.find((w) => w.light && fits(w, c.minutes))
    if (lw) return take(lw, lw.s, c.minutes)
    const pm = wins.find((w) => !w.light && w.e - Math.max(w.s, toMin('13:00')) >= c.minutes)
    if (pm) return take(pm, Math.max(pm.s, toMin('13:00')), c.minutes)
  }
  // Deep focus never goes into the work window.
  const all = c.kind === 'quick' ? wins : wins.filter((w) => !w.light)
  // ME2: hard work first tries windows that don't start in an hour he usually skips.
  const fresh = c.hard && avoid.length ? all.filter((w) => !avoid.includes(Math.floor(w.s / 60))) : all
  const open = fresh.some((x) => x.e - x.s >= c.minutes) ? fresh : all
  if (c.hard && best.length) {
    for (const h of best.filter((x) => !avoid.includes(x))) {
      const w = open.find((x) => x.s <= h * 60 + 30 && x.e >= Math.max(x.s, h * 60) + c.minutes)
      if (w) return take(w, Math.max(w.s, h * 60), c.minutes)
    }
  }
  const w = open.find((x) => fits(x, c.minutes))
  if (w) return take(w, w.s, c.minutes)
  // Shrink to the biggest window left when it still makes a real block.
  const big = [...open].sort((a, b) => b.e - b.s - (a.e - a.s))[0]
  if (big && big.e - big.s >= minMin) return take(big, big.s, Math.floor((big.e - big.s) / 5) * 5)
  return null
}

const b_minutes = (b: { minutes: number }) => b.minutes
const hm = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
export const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`)

/** The whole day packed without the model (also the fallback when the model returns too little). */
export function packDay(p: PackInputs): DayProposal {
  const short = p.sleptMin != null && p.sleptMin < 360
  const cap = short ? 60 : 90
  const endBy = p.endBy ?? (short ? '21:30' : '22:00')
  // A plan always starts from now (10:00 → 10:05), never with blocks already in the past.
  const after = planStartAt(p.now)

  // Every task once (Todoist can repeat a task in "today" and "@today").
  const seen = new Set<string>()
  const tasks = rankTasks(p.tasks, p.today).filter((t) => {
    const k = t.id ? `#${t.id}` : key(t.content)
    if (!t.content.trim() || seen.has(k)) return false
    seen.add(k)
    return true
  })
  const est = new Map(tasks.map((t) => [t, p.estimate ? p.estimate(t) : estimateMinutes(t)]))
  // What he asked for today (⭐ @today, or added in the chat for today) is never moved to tomorrow.
  const pinned = (t: PlanTask) => !!t.asked || !!t.starred

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
  const pinnedChunks: Chunk[] = []
  for (const t of tasks) {
    if (mustTasks.has(t)) continue
    if (isQuick(est.get(t)!)) quick.push(t)
    else if (pinned(t)) pinnedChunks.push({ title: t.content, minutes: Math.min(cap, Math.max(25, est.get(t)!)), kind: 'focus', tasks: [{ title: t.content, id: t.id, minutes: est.get(t)! }], hard: true })
    else others.push(t)
  }
  // His own asks lead the quick batch (it holds 8).
  quick.sort((a, b) => Number(pinned(b)) - Number(pinned(a)))
  // Other tasks: by project, highest priority first, a block holds up to `cap` minutes.
  const groups = new Map<string, PlanTask[]>()
  for (const t of others) {
    const g = t.project?.trim() || 'Tasks'
    groups.set(g, [...(groups.get(g) ?? []), t])
  }
  const overdue = (t: PlanTask) => !!(t.due && t.due < p.today)
  const weight = (t: PlanTask) => (t.priority ?? 1) + (overdue(t) ? 0.5 : 0)
  const groupChunks: (Chunk & { w: number })[] = []
  for (const [project, list] of groups) {
    let cur: (Chunk & { w: number }) | null = null
    for (const t of list) {
      const m = Math.min(cap, est.get(t)!)
      if (!cur || cur.minutes + m > cap) {
        cur = { title: project, minutes: 0, kind: 'focus', tasks: [], hard: false, w: 0 }
        groupChunks.push(cur)
      }
      cur.minutes += m
      cur.hard ||= (t.priority ?? 1) >= 3 || overdue(t)
      cur.w = Math.max(cur.w, weight(t))
      cur.tasks.push({ title: t.content, id: t.id, minutes: est.get(t)! })
    }
  }
  for (const c of groupChunks) c.title = c.tasks.length === 1 ? c.tasks[0].title : `${c.title}: ${c.tasks.map((x) => x.title).join(', ')}`
  // Highest priority and overdue first, then the bigger ones.
  groupChunks.sort((a, b) => b.w - a.w || b.minutes - a.minutes)
  const quickChunk: Chunk | null = quick.length
    ? (() => {
        const list = quick.slice(0, 8)
        const minutes = Math.min(60, Math.max(20, list.reduce((s, t) => s + est.get(t)!, 0)))
        return { title: `Quick tasks (${list.length})`, minutes: Math.round(minutes / 5) * 5, kind: 'quick' as const, tasks: list.map((t) => ({ title: t.content, id: t.id, minutes: est.get(t)! })), hard: quick.some((t) => overdue(t) || (t.priority ?? 1) >= 3) }
      })()
    : null

  // Place them: goals and must-dos, the urgent work, the quick batch, training, then the rest until the day is full.
  const wins = withWork(freeWindows(p.events, p.today, after, endBy), p.work)
  const freeMin = wins.filter((w) => !w.light).reduce((s, w) => s + w.e - w.s, 0)
  // Lunch stays free, and a share of the free time stays unplanned (never a day packed to the minute).
  const meal = p.meal === null ? null : keepMeal(wins, p.meal ?? MEAL_WINDOW)
  const share = cleanShare(p.freeShare)
  const maxBlocks = short ? 5 : 8
  const budget = Math.min(short ? 240 : 390, Math.floor((freeMin * (1 - share) - (meal?.minutes ?? 0)) / 5) * 5)
  let trainMin = 0
  const firsts = [...chunks, ...pinnedChunks, ...groupChunks.filter((c) => c.hard)]
  const rest = groupChunks.filter((c) => !c.hard)
  // A short night: shorter blocks (75%, at least 25 min).
  if (short) for (const c of [...firsts, ...rest]) c.minutes = Math.max(25, Math.round((c.minutes * 0.75) / 5) * 5)
  const placed: (PlanBlock & { chunk: Chunk })[] = []
  let used = 0
  const tryPlace = (c: Chunk): boolean => {
    // Quick tasks that fit the work window don't take free time (see below).
    const inWork = c.kind === 'quick' && wins.some((w) => w.light && w.e - w.s >= c.minutes)
    if (placed.length >= maxBlocks || (!inWork && budget - used - trainMin < 25)) return false
    const want = inWork ? c : { ...c, minutes: Math.min(c.minutes, budget - used - trainMin) }
    const at = place(wins, want, p.best ?? [], 25, p.avoid ?? [])
    if (!at) return false
    // Quick tasks in the work window use time that was never free: they don't count against the free time.
    if (!at.light) used += at.minutes
    placed.push({ title: c.title.slice(0, 80), start: fromMin(at.start), minutes: at.minutes, kind: c.kind, tasks: c.tasks.map((t) => t.title), chunk: c })
    return true
  }
  /** A chunk that doesn't fit whole is tried task by task (most important first). */
  const fit = (c: Chunk) => {
    if (tryPlace(c) || c.tasks.length < 2) return
    for (const t of c.tasks) tryPlace({ ...c, title: t.title, minutes: Math.min(cap, Math.max(25, short ? Math.round((t.minutes * 0.75) / 5) * 5 : t.minutes)), tasks: [t] })
  }
  // Goals, must-dos and what he asked for today first; a quick batch holding one of his asks right after.
  const pinnedQuick = !!quickChunk && quick.slice(0, 8).some(pinned)
  // BD8: the workout's best slot (12:00–16:00) is kept first; elsewhere only after the important work.
  let training: DayProposal['training'] = null
  const book = (onlyPreferred: boolean) => {
    if (p.workoutDone || !p.train || training) return
    const slot = pickWorkoutSlot(wins, { minutes: short ? Math.min(p.train.minutes, 30) : p.train.minutes })
    if (!slot || (onlyPreferred && !slot.preferred)) return
    training = { time: fromMin(slot.start), what: slotTitle(slot.minutes, { easy: short || p.train.easy }), minutes: slot.minutes }
    trainMin = slot.minutes
    const w = wins.find((x) => !x.light && x.s <= slot.start && x.e >= slot.start + slot.minutes)!
    wins.splice(wins.indexOf(w), 1, ...[{ ...w, e: slot.start - 10 }, { ...w, s: slot.start + slot.minutes + 10 }].filter((x) => x.e - x.s >= 20))
  }
  book(true)
  for (const c of [...chunks, ...pinnedChunks]) fit(c)
  if (quickChunk && pinnedQuick) fit(quickChunk)
  for (const c of groupChunks.filter((c) => c.hard)) fit(c)
  if (quickChunk && !pinnedQuick) fit(quickChunk)

  // Training in the evening when there's room (kept before the lower tasks fill the day).
  book(false)
  if (!p.workoutDone && !p.train) {
    for (const w of wins.filter((x) => !x.light && x.e > toMin('17:00'))) {
      const s = Math.ceil(Math.max(w.s, toMin('17:00')) / 15) * 15
      if (s + 45 <= w.e) {
        training = { time: fromMin(s), what: short ? 'easy: Workout · 30 min' : 'Workout · 45 min' }
        trainMin = 45
        const i = wins.indexOf(w)
        wins.splice(i, 1, ...[{ ...w, e: s - 10 }, { ...w, s: s + 55 }].filter((x) => x.e - x.s >= 20))
        break
      }
    }
  }
  for (const c of rest) fit(c)

  // An ask of his still without a slot: an older, lower-priority block makes room (its tasks go to
  // tomorrow, saying why); with nothing to swap, his ask stays on today's list and the plan asks.
  const placedKeys = () => new Set(placed.flatMap((b) => b.chunk.tasks.map((t) => key(t.title))))
  const byTitle = new Map(tasks.map((t) => [key(t.content), t]))
  const madeRoom: { title: string; for: string }[] = []
  let squeeze: DayProposal['squeeze'] = undefined
  for (const t of tasks.filter((x) => pinned(x) && !mustTasks.has(x))) {
    if (placedKeys().has(key(t.content))) continue
    const need = Math.max(isQuick(est.get(t)!) ? 15 : 25, Math.min(cap, est.get(t)!))
    const swappable = placed
      .filter((b) => b.chunk.kind !== 'goal' && b.chunk.tasks.length > 0 && b.chunk.tasks.every((x) => { const o = byTitle.get(key(x.title)); return !!o && !pinned(o) && !mustTasks.has(o) }))
      .map((b) => ({ b, os: b.chunk.tasks.map((x) => byTitle.get(key(x.title))!) }))
      .sort((a, c) => Math.max(...a.os.map((o) => o.priority ?? 1)) - Math.max(...c.os.map((o) => o.priority ?? 1)) || Number(c.os.some(overdue)) - Number(a.os.some(overdue)) || String(a.os[0].due ?? '9').localeCompare(String(c.os[0].due ?? '9')) || b_minutes(c.b) - b_minutes(a.b))
    const pick = swappable.find((x) => x.b.minutes >= need) ?? null
    if (pick) {
      const i = placed.indexOf(pick.b)
      for (const o of pick.os) madeRoom.push({ title: o.content, for: t.content })
      placed.splice(i, 1, { ...pick.b, title: t.content.slice(0, 80), minutes: Math.min(pick.b.minutes, Math.max(need, 15)), kind: isQuick(est.get(t)!) ? 'quick' : 'focus', tasks: [t.content], chunk: { title: t.content, minutes: need, kind: 'focus', tasks: [{ title: t.content, id: t.id, minutes: est.get(t)! }], hard: true } })
    } else if (!squeeze) {
      const drop = placed.filter((b) => b.chunk.tasks.some((x) => { const o = byTitle.get(key(x.title)); return !!o && !pinned(o) && !mustTasks.has(o) })).flatMap((b) => b.chunk.tasks.map((x) => byTitle.get(key(x.title))!).filter((o) => !!o && !pinned(o) && !mustTasks.has(o))).sort((a, c) => (a.priority ?? 1) - (c.priority ?? 1))[0]
      squeeze = { keep: t.content, ...(drop ? { drop: drop.content } : {}) }
    }
  }
  placed.sort((a, b) => a.start.localeCompare(b.start))
  const blocks: PlanBlock[] = placed.map(({ chunk: _c, ...b }) => b)
  const inBlock = new Map<string, string>()
  for (const b of placed) for (const t of b.chunk.tasks) inBlock.set(key(t.title), b.start)

  // Every other task: in "Also today" with its block. Only when the day is really full does a task move to tomorrow, with the reason.
  const full = used + trainMin >= budget - 25 ? `today already has ${fmtMin(used)} of focus and some free time is kept` : placed.length >= maxBlocks ? `today already has ${placed.length} blocks` : 'no free time left between your events'
  const also: AlsoItem[] = []
  const deferred: DeferredItem[] = []
  for (const t of tasks) {
    if (mustTasks.has(t)) continue
    const minutes = est.get(t)!
    const at = inBlock.get(key(t.content))
    const room = madeRoom.find((x) => key(x.title) === key(t.content))
    if (at) also.push({ title: t.content, minutes, priority: t.priority ?? 1, ...(t.id ? { id: t.id } : {}), ...(t.project ? { project: t.project } : {}), at, ...(overdue(t) ? { overdue: true } : {}) })
    // His own ask for today stays today, on the list, even when the day is full.
    else if (pinned(t)) also.push({ title: t.content, minutes, priority: t.priority ?? 1, ...(t.id ? { id: t.id } : {}), ...(t.project ? { project: t.project } : {}), asked: true, ...(overdue(t) ? { overdue: true } : {}) })
    else if (room) deferred.push({ title: t.content, ...(t.id ? { id: t.id } : {}), why: `Made room for "${room.for.slice(0, 40)}" (you asked for it today): tomorrow` })
    else deferred.push({ title: t.content, ...(t.id ? { id: t.id } : {}), why: short ? `Short night, ${full}: tomorrow` : `The day is full (${full}): tomorrow` })
  }
  also.sort((a, b) => b.priority - a.priority || Number(!!b.overdue) - Number(!!a.overdue))

  const focus = blocks.reduce((s, b) => s + b.minutes, 0)
  const total = tasks.length
  const classes = p.events.filter((e) => !e.allDay).length
  const why = !blocks.length
    ? freeMin < 25
      ? 'No free time between your events today, so the must-dos fit where they can.'
      : 'Nothing to plan today: pick one thing that matters.'
    : `${total} task${total === 1 ? '' : 's'}${classes ? ` and ${classes} event${classes === 1 ? '' : 's'}` : ''}, ${hm(freeMin)} free: ${blocks.length} block${blocks.length === 1 ? '' : 's'} (${fmtMin(focus)})${quick.length ? ', small tasks batched' : ''}${meal ? `, lunch at ${fromMin(meal.start)} kept free` : ''}, ${fmtMin(Math.max(0, freeMin - focus - trainMin))} left free${short ? `. Short night (${hm(p.sleptMin!)}), so shorter blocks and an earlier end` : ''}.`
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
    ...(squeeze ? { squeeze } : {}),
    free: wins.length || blocks.length ? withWork(freeWindows(p.events, p.today, after, endBy), p.work).filter((w) => !w.light).map((w) => ({ start: fromMin(w.s), end: fromMin(w.e) })) : []
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
export function checkModelPlan(model: DayProposal, packed: DayProposal, tasks: PlanTask[], work?: WorkToday | null, freeShare?: number): DayProposal {
  // Deep focus in the work window (or in a short shift's busy part): the packer's plan instead.
  if (workClash(model.blocks, work)) return { ...packed, headline: packed.headline }
  // A model plan that fills the free time (no share left unplanned): the packer's plan, which keeps it.
  const freeTotal = (packed.free ?? []).reduce((s, w) => s + toMin(w.end) - toMin(w.start), 0)
  const modelMin = model.blocks.reduce((s, b) => s + b.minutes, 0) + (model.training ? (model.training.minutes ?? 45) : 0)
  if (freeTotal >= 60 && modelMin > freeTotal * (1 - cleanShare(freeShare)) + 15) return { ...packed, headline: packed.headline }
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

/** A block that breaks the work window rule: deep focus in its light part, anything in its busy part. */
export function workClash(blocks: PlanBlock[], work: WorkToday | null | undefined): PlanBlock | null {
  if (!work) return null
  const over = (b: PlanBlock, r: { from: string; to: string } | null) => !!r && toMin(b.start) < toMin(r.to) && toMin(b.start) + b.minutes > toMin(r.from)
  return blocks.find((b) => over(b, work.busy) || (b.kind !== 'quick' && over(b, work.light))) ?? null
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
