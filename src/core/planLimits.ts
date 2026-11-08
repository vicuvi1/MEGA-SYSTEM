// Time limits you set for the planner (pure, tested in planLimits.test.ts).
// Synced setting `plan_limits`, edited in Coach → Daily rhythm.
//
//   - maxFocusMin: at most this much focus/work time a day (null: no limit).
//   - offAt: nothing planned ends after this time ("off at 21:00").
//   - protect: blocks of a fixed length kept free on set days (training 45 min
//     at 18:00 on Mon/Wed/Fri, lunch 12:30 for 40 min). They are fixed time,
//     like a calendar event: the planner plans around them.
//   - caps: at most this much of one kind a day ("study: 4h").
//
// The packer, the audit and the automatic re-plan never break them. Only draft
// blocks the planner made are trimmed or taken off (their tasks go on today's
// list); pinned, approved, ticked and calendar blocks are yours and stay.
// What a limit makes impossible is said plainly (see planDeadlines.ts).
import type { CalEvent } from './dayTime'
import { blockLook, type LookKind } from './planLook'
import { fromMin, toMin, type DayProposal, type PlanBlock } from './rhythm'

export interface ProtectedBlock {
  title: string
  /** HH:MM. */
  start: string
  minutes: number
  /** Weekdays it is on (0 = Sunday … 6 = Saturday). Empty: every day. */
  days: number[]
}

/** The kinds a cap can hold (the block looks, without breaks and meals). */
export type CapKind = Extract<LookKind, 'deep' | 'study' | 'chores'>
export const CAP_KINDS: CapKind[] = ['study', 'deep', 'chores']
export const CAP_NAMES: Record<CapKind, string> = { study: 'Study', deep: 'Deep work', chores: 'Small tasks' }

export interface PlanLimits {
  maxFocusMin: number | null
  offAt: string | null
  protect: ProtectedBlock[]
  caps: { kind: CapKind; minutes: number }[]
}

/** The limits for one day (protected blocks of that weekday only). */
export interface DayLimits {
  maxFocusMin: number | null
  offAt: string | null
  protect: { title: string; start: string; minutes: number }[]
  caps: { kind: CapKind; minutes: number }[]
}

export const PLAN_LIMITS = 'plan_limits'
export const NO_LIMITS: PlanLimits = { maxFocusMin: null, offAt: null, protect: [], caps: [] }

const HM = /^([01]\d|2[0-3]):[0-5]\d$/
const mins = (x: unknown, lo: number, hi: number): number | null => {
  const n = Math.round(Number(x))
  return x == null || x === '' || !Number.isFinite(n) || n < lo ? null : Math.min(hi, Math.round(n / 5) * 5)
}

/** Checks and tidies what was saved (anything odd is dropped, never guessed). */
export function cleanLimits(raw: unknown): PlanLimits {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const protect: ProtectedBlock[] = (Array.isArray(r.protect) ? r.protect : [])
    .map((p: any) => ({
      title: String(p?.title ?? '').trim().slice(0, 60),
      start: HM.test(p?.start) ? p.start : '',
      minutes: mins(p?.minutes, 5, 240) ?? 0,
      days: [...new Set((Array.isArray(p?.days) ? p.days : []).map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() as number[]
    }))
    .filter((p: ProtectedBlock) => p.title && p.start && p.minutes > 0)
    .slice(0, 8)
  const caps = (Array.isArray(r.caps) ? r.caps : [])
    .map((c: any) => ({ kind: c?.kind as CapKind, minutes: mins(c?.minutes, 15, 16 * 60) ?? 0 }))
    .filter((c: { kind: CapKind; minutes: number }, i: number, all: { kind: CapKind }[]) => CAP_KINDS.includes(c.kind) && c.minutes > 0 && all.findIndex((x) => x.kind === c.kind) === i)
  return { maxFocusMin: mins(r.maxFocusMin, 30, 16 * 60), offAt: HM.test(r.offAt) ? r.offAt : null, protect, caps }
}

const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay()

/** The limits that hold on `day`. `focusCap` (a light day of the week plan) can only make the cap lower. */
export function limitsFor(l: PlanLimits, day: string, focusCap?: number | null): DayLimits {
  const wd = weekday(day)
  const cap = focusCap != null && focusCap >= 0 ? (l.maxFocusMin == null ? focusCap : Math.min(l.maxFocusMin, focusCap)) : l.maxFocusMin
  return {
    maxFocusMin: cap,
    offAt: l.offAt,
    protect: l.protect.filter((p) => !p.days.length || p.days.includes(wd)).map(({ title, start, minutes }) => ({ title, start, minutes })),
    caps: l.caps
  }
}

export const hasLimits = (l: DayLimits | null | undefined): l is DayLimits => !!l && (l.maxFocusMin != null || !!l.offAt || l.protect.length > 0 || l.caps.length > 0)

/** The id of a protected block's fixed time (never a Google id: it is only in the plan's view). */
export const PROTECT_ID = 'limit:'

/** The protected blocks of the day as fixed events (the planner plans around them like a class). */
export function protectedEvents(l: DayLimits | null | undefined, day: string): CalEvent[] {
  if (!l) return []
  return l.protect.map((p, i) => {
    const s = new Date(`${day}T${p.start}:00`)
    return { id: `${PROTECT_ID}${i}`, calendarId: 'limits', title: p.title, start: s.toISOString(), end: new Date(s.getTime() + p.minutes * 60000).toISOString(), allDay: false }
  })
}

/** The calendar's events plus the day's protected blocks (one that is already in the calendar at that time is not added twice). */
export function withProtected(events: CalEvent[], l: DayLimits | null | undefined, day: string): CalEvent[] {
  const extra = protectedEvents(l, day).filter((p) => !events.some((e) => e.id === p.id || (!e.allDay && Date.parse(e.start) === Date.parse(p.start) && e.title.trim().toLowerCase() === p.title.trim().toLowerCase())))
  return extra.length ? [...events, ...extra] : events
}

/** Where the plan must end: the earlier of `endBy` and the off time. */
export function endWith(endBy: string, l: DayLimits | null | undefined): string {
  return l?.offAt && toMin(l.offAt) < toMin(endBy) ? l.offAt : endBy
}

/** Does this block count as focus/work time (not training, a break or a meal)? */
export function isWork(b: Pick<PlanBlock, 'title' | 'kind'>): boolean {
  const k = blockLook(b.title, b.kind).kind
  return k !== 'sport' && k !== 'break' && k !== 'meal'
}

/** The cap kind a block counts toward (null: none). */
export function capKind(b: Pick<PlanBlock, 'title' | 'kind'>): CapKind | null {
  const k = blockLook(b.title, b.kind).kind
  return k === 'study' || k === 'deep' || k === 'chores' ? k : null
}

export const fmtH = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min`)

export interface LimitBreak {
  code: 'offat' | 'focus' | 'cap' | 'protect'
  text: string
  /** Block ids that break it. */
  ids: string[]
  /** Minutes over (focus and caps). */
  over: number
}

/** Every limit the plan breaks (empty: it keeps them all). */
export function limitBreaks(plan: DayProposal, l: DayLimits | null | undefined): LimitBreak[] {
  if (!hasLimits(l)) return []
  const out: LimitBreak[] = []
  const blocks = plan.blocks.map((b, i) => ({ ...b, id: b.id ?? `#${i}` }))
  if (l.offAt) {
    const off = toMin(l.offAt)
    const late = blocks.filter((b) => toMin(b.start) + b.minutes > off)
    if (late.length) out.push({ code: 'offat', text: `Runs past your off time (${l.offAt})`, ids: late.map((b) => b.id), over: 0 })
  }
  const prot = protectedEvents(l, plan.day).map((e) => ({ s: toMin(fromIso(e.start)), e: toMin(fromIso(e.end)) || 24 * 60 }))
  const onProt = blocks.filter((b) => prot.some((p) => toMin(b.start) < p.e && p.s < toMin(b.start) + b.minutes))
  if (onProt.length) out.push({ code: 'protect', text: `${onProt.length === 1 ? 'A block sits' : `${onProt.length} blocks sit`} on protected time`, ids: onProt.map((b) => b.id), over: 0 })
  const work = blocks.filter(isWork)
  if (l.maxFocusMin != null) {
    const total = work.reduce((t, b) => t + b.minutes, 0)
    if (total > l.maxFocusMin) out.push({ code: 'focus', text: `${fmtH(total)} of work, your limit is ${fmtH(l.maxFocusMin)}`, ids: work.map((b) => b.id), over: total - l.maxFocusMin })
  }
  for (const c of l.caps) {
    const of = work.filter((b) => capKind(b) === c.kind)
    const total = of.reduce((t, b) => t + b.minutes, 0)
    if (total > c.minutes) out.push({ code: 'cap', text: `${fmtH(total)} of ${CAP_NAMES[c.kind].toLowerCase()}, your limit is ${fmtH(c.minutes)}`, ids: of.map((b) => b.id), over: total - c.minutes })
  }
  return out
}

/** HH:MM (local) of an ISO time. */
function fromIso(iso: string): string {
  const d = new Date(iso)
  return fromMin(d.getHours() * 60 + d.getMinutes())
}

/**
 * Makes the plan keep the limits, changing only draft blocks the planner made
 * (`loose`): a block past the off time is cut to end there (or leaves when
 * under 25 min stay), a block on protected time leaves, and work over a cap is
 * trimmed from the least important block (`rank`, higher = less important;
 * never under 25 min), else that block leaves. Blocks that leave go to
 * `toList` (their tasks back on today's list). Idempotent.
 */
export function keepLimits(
  raw: DayProposal,
  l: DayLimits | null | undefined,
  o: { loose: (b: PlanBlock) => boolean; rank: (b: PlanBlock, plan: DayProposal) => number; toList: (plan: DayProposal, b: PlanBlock) => DayProposal; after?: number }
): { plan: DayProposal; changed: string[] } {
  if (!hasLimits(l)) return { plan: raw, changed: [] }
  let plan = raw
  const changed: string[] = []
  const after = o.after ?? 0
  // Only blocks still ahead are changed (the past is never rewritten).
  const mine = (b: PlanBlock) => o.loose(b) && toMin(b.start) + b.minutes > after
  if (l.offAt) {
    const off = toMin(l.offAt)
    for (const b of plan.blocks.filter((x) => mine(x) && toMin(x.start) + x.minutes > off)) {
      const room = Math.floor((off - toMin(b.start)) / 5) * 5
      if (room >= 25) plan = { ...plan, blocks: plan.blocks.map((x) => (x === b ? { ...x, minutes: room } : x)) }
      else plan = o.toList(plan, b)
      changed.push('offat')
    }
  }
  const prot = protectedEvents(l, plan.day).map((e) => ({ s: toMin(fromIso(e.start)), e: toMin(fromIso(e.end)) || 24 * 60 }))
  // The workout slot the planner put past the off time or on protected time leaves the plan (not yours: not pinned,
  // approved or in the calendar). The workout itself is not touched: only the plan's slot for it.
  const t = plan.training
  if (t && !t.locked && !t.ok && !t.sync?.eventId) {
    const s = toMin(t.time)
    const e = s + (t.minutes ?? (Number(/(\d+)\s*min/.exec(t.what)?.[1]) || 45))
    if (e > after && ((l.offAt && e > toMin(l.offAt)) || prot.some((p) => s < p.e && p.s < e))) {
      plan = { ...plan, training: null }
      changed.push(l.offAt && e > toMin(l.offAt) ? 'offat' : 'protect')
    }
  }
  for (const b of plan.blocks.filter((x) => mine(x) && prot.some((p) => toMin(x.start) < p.e && p.s < toMin(x.start) + x.minutes))) {
    // Cut to the part before the protected time when that still makes a block; else it leaves.
    const p = prot.find((q) => toMin(b.start) < q.e && q.s < toMin(b.start) + b.minutes)!
    const room = Math.floor((p.s - 10 - toMin(b.start)) / 5) * 5
    if (room >= 25) plan = { ...plan, blocks: plan.blocks.map((x) => (x === b ? { ...x, minutes: room } : x)) }
    else plan = o.toList(plan, b)
    changed.push('protect')
  }
  const trim = (over: () => number, inScope: (b: PlanBlock) => boolean, code: string) => {
    for (let guard = 0; guard < 20; guard++) {
      const need = over()
      if (need <= 0) return
      const cand = plan.blocks.filter((b) => mine(b) && isWork(b) && inScope(b)).sort((a, c) => o.rank(c, plan) - o.rank(a, plan) || c.start.localeCompare(a.start))[0]
      if (!cand) return
      const cut = Math.ceil(need / 5) * 5
      if (cand.minutes - cut >= 25) plan = { ...plan, blocks: plan.blocks.map((x) => (x === cand ? { ...x, minutes: x.minutes - cut } : x)) }
      else plan = o.toList(plan, cand)
      changed.push(code)
    }
  }
  if (l.maxFocusMin != null) {
    const cap = l.maxFocusMin
    trim(() => plan.blocks.filter(isWork).reduce((t, b) => t + b.minutes, 0) - cap, () => true, 'focus')
  }
  for (const c of l.caps) trim(() => plan.blocks.filter((b) => isWork(b) && capKind(b) === c.kind).reduce((t, b) => t + b.minutes, 0) - c.minutes, (b) => capKind(b) === c.kind, 'cap')
  return { plan, changed: [...new Set(changed)] }
}

/** Would one more block of `minutes` still keep the work limit and its kind's cap? */
export function underLimits(plan: Pick<DayProposal, 'blocks'>, add: Pick<PlanBlock, 'title' | 'kind' | 'minutes'>, l: DayLimits | null | undefined): boolean {
  if (!l || !isWork(add)) return true
  const work = plan.blocks.filter(isWork)
  if (l.maxFocusMin != null && work.reduce((t, b) => t + b.minutes, 0) + add.minutes > l.maxFocusMin) return false
  const k = capKind(add)
  const cap = l.caps.find((c) => c.kind === k)
  return !cap || work.filter((b) => capKind(b) === k).reduce((t, b) => t + b.minutes, 0) + add.minutes <= cap.minutes
}

/** One plain line about the limits that changed the plan ("Kept your limits: off at 21:00, 4h of work"). */
export function limitsLine(changed: string[], l: DayLimits | null | undefined): string | null {
  if (!changed.length || !l) return null
  const parts: string[] = []
  if (changed.includes('offat') && l.offAt) parts.push(`off at ${l.offAt}`)
  if (changed.includes('focus') && l.maxFocusMin != null) parts.push(`${fmtH(l.maxFocusMin)} of work`)
  if (changed.includes('cap')) parts.push(...l.caps.map((c) => `${fmtH(c.minutes)} of ${CAP_NAMES[c.kind].toLowerCase()}`))
  if (changed.includes('protect')) parts.push('protected time')
  return parts.length ? `Kept your limits: ${parts.join(', ')}` : null
}
