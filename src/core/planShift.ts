// A day plan always starts from NOW (pure, tested in planShift.test.ts).
//
// Asked for (or opened) at 10:00, a plan must not show blocks at 07:00 that
// are already gone. planStartAt() is where a plan may start (now, rounded up
// to the next 5 minutes, plus a short buffer). shiftPlan() moves the blocks
// that are in the past and were not started into the time that is left,
// around the calendar's fixed events (classes, meetings stay where they are)
// and the blocks still ahead; must-dos and what he asked for today go first.
// A block that no longer fits stays on today's list (never moved to tomorrow).
import { freeWindows, planStartAt, relinkAlso } from './dayPacker'
export { planStartAt }
import { fromMin, toMin, type DayProposal, type PlanBlock } from './rhythm'
import type { CalEvent } from './dayTime'

/** A focus session as a time span (ms since 1970). */
export interface Span {
  s: number
  e: number
}

/** Was this block started (a focus session overlaps its time)? */
export function blockStarted(b: Pick<PlanBlock, 'start' | 'minutes'>, day: string, sessions: Span[]): boolean {
  const from = Date.parse(`${day}T${b.start}:00`)
  const to = from + b.minutes * 60000
  return sessions.some((x) => x.s < to && x.e > from)
}

/** Blocks that start before `now` (10 min of grace) and were not started: the plan is late. */
export function lateBlocks(plan: Pick<DayProposal, 'day' | 'blocks'>, now: string, sessions: Span[] = []): PlanBlock[] {
  const cut = toMin(now) - 10
  return plan.blocks.filter((b) => toMin(b.start) < cut && !blockStarted(b, plan.day, sessions))
}

export interface ShiftResult {
  plan: DayProposal
  /** Each block that moved: its old and new start (approved plans move their calendar events too). */
  moves: { title: string; from: string; to: string; minutes: number }[]
  /** Blocks that no longer fit today: their tasks stay on today's list. */
  unplaced: string[]
}

/**
 * Moves the plan's past, unstarted blocks into the time left from planStartAt(now).
 * Blocks still ahead and started ones stay; fixed events never move.
 * `asked`: titles he asked for today (they go first, with the must-dos).
 */
export function shiftPlan(plan: DayProposal, o: { now: string; events: CalEvent[]; sessions?: Span[]; endBy?: string; asked?: string[] }): ShiftResult {
  const startAt = planStartAt(o.now)
  const s0 = toMin(startAt)
  const sessions = o.sessions ?? []
  const keep: PlanBlock[] = []
  const late: PlanBlock[] = []
  for (const b of plan.blocks) {
    if (toMin(b.start) >= s0 || blockStarted(b, plan.day, sessions)) keep.push(b)
    else late.push(b)
  }
  if (!late.length) return { plan, moves: [], unplaced: [] }
  const lower = (x: string) => x.trim().toLowerCase()
  const must = new Set(plan.mustdos.map(lower))
  const asked = new Set((o.asked ?? []).map(lower))
  const rank = (b: PlanBlock) => {
    const ts = [b.title, ...(b.tasks ?? [])].map(lower)
    if (ts.some((t) => must.has(t) || asked.has(t))) return 0
    return b.kind === 'goal' ? 1 : b.kind === 'quick' ? 3 : 2
  }
  late.sort((a, b) => rank(a) - rank(b) || a.start.localeCompare(b.start))
  // Free time: from now to the end of the day, minus events, the blocks still ahead and training.
  const busy: CalEvent[] = [...o.events]
  const asEvent = (start: string, minutes: number, id: string): CalEvent => ({ id, calendarId: 'plan', title: id, start: new Date(`${plan.day}T${start}:00`).toISOString(), end: new Date(new Date(`${plan.day}T${start}:00`).getTime() + minutes * 60000).toISOString(), allDay: false })
  keep.forEach((b, i) => busy.push(asEvent(b.start, b.minutes, `keep${i}`)))
  if (plan.training && toMin(plan.training.time) >= s0) busy.push(asEvent(plan.training.time, Number(/(\d+)\s*min/.exec(plan.training.what)?.[1]) || 45, 'training'))
  let wins = freeWindows(busy, plan.day, startAt, o.endBy ?? '22:00')
  const moves: ShiftResult['moves'] = []
  const unplaced: string[] = []
  const placed: PlanBlock[] = []
  for (const b of late) {
    let w = wins.find((x) => x.e - x.s >= b.minutes)
    let minutes = b.minutes
    if (!w) {
      // Shrunk to the biggest window left when that is still a real block (25 min+).
      const big = [...wins].sort((a, c) => c.e - c.s - (a.e - a.s))[0]
      if (big && big.e - big.s >= 25) {
        w = big
        minutes = Math.floor((big.e - big.s) / 5) * 5
      }
    }
    if (!w) {
      unplaced.push(b.title)
      continue
    }
    const start = w.s
    const parts = [{ ...w, e: start - 10 }, { ...w, s: start + minutes + 10 }].filter((x) => x.e - x.s >= 20)
    wins = [...wins.slice(0, wins.indexOf(w)), ...parts, ...wins.slice(wins.indexOf(w) + 1)]
    placed.push({ ...b, start: fromMin(start), minutes })
    moves.push({ title: b.title, from: b.start, to: fromMin(start), minutes })
  }
  // Training that was planned for earlier: the first free 45 minutes from 17:00 (or from now).
  let training = plan.training
  if (training && toMin(training.time) < s0) {
    const len = Number(/(\d+)\s*min/.exec(training.what)?.[1]) || 45
    const from = Math.max(s0, toMin('17:00'))
    const w = wins.find((x) => x.e - Math.max(x.s, from) >= len) ?? wins.find((x) => x.e - x.s >= len)
    if (w) {
      const at = w.e - Math.max(w.s, from) >= len ? Math.max(w.s, from) : w.s
      training = { ...training, time: fromMin(Math.ceil(at / 5) * 5) }
    }
  }
  const blocks = [...keep, ...placed].sort((a, b) => a.start.localeCompare(b.start))
  // Tasks of a block that no longer fits stay on today's list (no time), never tomorrow.
  const gone = late.filter((b) => unplaced.includes(b.title))
  const also = [...(plan.also ?? [])]
  for (const b of gone) for (const t of b.tasks?.length ? b.tasks : [b.title]) if (!must.has(lower(t)) && !also.some((a) => lower(a.title) === lower(t))) also.push({ title: t, minutes: Math.round(b.minutes / Math.max(1, b.tasks?.length ?? 1)), priority: 1 })
  const note = `Starts at ${startAt}: ${moves.length} block${moves.length === 1 ? '' : 's'} moved to the time left${unplaced.length ? `, ${unplaced.length} on the list` : ''}`
  return { plan: relinkAlso({ ...plan, blocks, training, also, why: plan.why ? `${plan.why} ${note}.` : `${note}.` }), moves, unplaced }
}

// ---- What he asked for today (the chat): never moved to tomorrow --------------

/** Synced setting: the tasks he asked Ben to add for today ({day, titles}). */
export const PLAN_ASKED = 'plan_asked'

/** Today's asks (an older day's list is empty). */
export function askedToday(raw: unknown, day: string): string[] {
  const r = raw as { day?: string; titles?: unknown } | null
  return r && r.day === day && Array.isArray(r.titles) ? r.titles.filter((x): x is string => typeof x === 'string').slice(-30) : []
}

/** One more ask for today (kept at 30). */
export function addAsked(raw: unknown, day: string, title: string): { day: string; titles: string[] } {
  const t = title.trim().slice(0, 200)
  const list = askedToday(raw, day)
  return { day, titles: t && !list.some((x) => x.toLowerCase() === t.toLowerCase()) ? [...list, t].slice(-30) : list }
}

/** Is a task one of his asks for today (by its title, ignoring "today"/"@today" words)? */
export function isAsked(content: string, asked: string[]): boolean {
  const k = (s: string) => s.toLowerCase().replace(/@?\b(today|azi|сегодня)\b/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const c = k(content)
  return !!c && asked.some((a) => k(a) === c)
}

/** He asked for it today in his own words ("add X today", "X @today", "for today"). */
export const saysToday = (text: string) => /(^|\s)@today\b|\b(today|azi|astăzi|astazi)\b|сегодня/i.test(text)
