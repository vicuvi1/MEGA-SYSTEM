// Custom Center: your reminder rules ("every 45 min at the PC: 20 push-ups",
// "at 21:00: log food"). Pure: when a rule fires next, and whether it may show
// now. The gate is the one the island calls before it shows a custom
// reminder: it keeps the app's existing protections (no reminders in a call
// or a meeting, during a focus timer, in quiet hours, after bedtime, a gap
// between interruptions, a cap per rule and a cap for the day).
import { calendarDay } from '../dates'
import type { CustomState, ReminderRule } from './model'

const DAY_MS = 864e5
const mins = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
const minuteOfDay = (t: number) => {
  const d = new Date(t)
  return d.getHours() * 60 + d.getMinutes()
}
/** The local time `hm` on the day of `t`. */
function on(t: number, hm: string, plusDays = 0): number {
  const d = new Date(t)
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + plusDays, 0, 0, 0, 0)
  x.setHours(Number(hm.slice(0, 2)), Number(hm.slice(3, 5)), 0, 0)
  return x.getTime()
}
const dayKeyOf = (t: number) => calendarDay(new Date(t))

/** Is minute-of-day `m` inside from–to (to before from runs past midnight)? */
export function inWindow(m: number, from: string, to: string): boolean {
  if (!from || !to) return true
  const a = mins(from)
  const b = mins(to)
  return a <= b ? m >= a && m < b : m >= a || m < b
}

const dayOk = (r: Pick<ReminderRule, 'days'>, t: number) => !r.days.length || r.days.includes(new Date(t).getDay())

export interface FireInput {
  /** When this rule last fired (ms), or null. */
  lastAt: number | null
  /** How many times it fired today. */
  todayCount: number
  /** Since when you have been active at the PC without a break (ms), or null when away / unknown. */
  activeSince: number | null
}

/**
 * When the rule fires next (ms), or null when it won't (off, capped for today,
 * or an "at the PC" rule while you're away). Ignores the gate: that is checked
 * when it is due.
 */
export function nextFire(r: ReminderRule, now: number, f: FireInput): number | null {
  if (!r.on) return null
  if (r.kind === 'at') {
    // Today's time not shown yet (even if it passed while the gate held it back) is due; else the next allowed day.
    for (let k = 0; k <= 7; k++) {
      const t = on(now, r.at, k)
      if (k === 0 && (f.todayCount >= r.cap || (f.lastAt != null && dayKeyOf(f.lastAt) === dayKeyOf(t)))) continue
      if (dayOk(r, t)) return Math.max(t, now)
    }
    return null
  }
  // every N minutes
  if (r.atPc && f.activeSince == null) return null
  const step = r.everyMin * 60_000
  const anchor = Math.max(f.lastAt ?? -Infinity, r.atPc ? (f.activeSince as number) : -Infinity)
  let t = Number.isFinite(anchor) ? anchor + step : now
  if (t < now) t = now
  // Move it into an allowed day and window (look up to 8 days ahead).
  for (let i = 0; i < 8 * 48; i++) {
    const capped = dayKeyOf(t) === dayKeyOf(now) && f.todayCount >= r.cap
    if (!capped && dayOk(r, t) && inWindow(minuteOfDay(t), r.from, r.to)) return t
    if (capped || !dayOk(r, t)) {
      t = on(t, r.from || '00:00', 1)
      continue
    }
    // Outside the window today: its next start.
    const start = on(t, r.from)
    t = start > t ? start : on(t, r.from, 1)
  }
  return null
}

/** The existing protections, as the island knows them now. */
export interface GateContext {
  now: number
  /** In a call (mic or camera in use) or a meeting on the calendar. */
  call: boolean
  /** A focus timer is running. */
  focus: boolean
  /** Quiet hours or "quiet for N min" are on. */
  quiet: boolean
  /** Your bedtime (HH:MM, from My life) and wake time; between them nothing shows. */
  bedtime: string | null
  wake: string | null
  /** When the island last interrupted you with anything (ms). */
  lastInterruptAt: number
  /** Minutes between any two interruptions (the island's gap). */
  gapMin: number
  /** Custom reminders shown today, all rules together. */
  shownToday: number
  /** At most this many custom reminders a day, all together. */
  dayCap: number
}

export type GateWhy = 'ok' | 'off' | 'call' | 'focus' | 'quiet' | 'bedtime' | 'gap' | 'rule-cap' | 'day-cap'
export const GATE_TEXT: Record<GateWhy, string> = {
  ok: 'Shows now',
  off: 'This reminder is off',
  call: 'Waiting: you are in a call or a meeting',
  focus: 'Waiting: a focus timer is running',
  quiet: 'Waiting: quiet time is on',
  bedtime: 'Not after bedtime',
  gap: 'Waiting: something else just showed',
  'rule-cap': 'Done for today (its daily limit)',
  'day-cap': 'Done for today (the daily limit for your reminders)'
}

/** May this rule show now? `wait`: try again soon (call, focus, quiet, gap); `skip`: not today or not now. */
export function reminderGate(r: Pick<ReminderRule, 'on' | 'cap'>, todayCount: number, c: GateContext): { show: boolean; why: GateWhy } {
  const no = (why: GateWhy) => ({ show: false, why })
  if (!r.on) return no('off')
  if (todayCount >= r.cap) return no('rule-cap')
  if (c.shownToday >= c.dayCap) return no('day-cap')
  if (c.bedtime && c.wake && inWindow(minuteOfDay(c.now), c.bedtime, c.wake)) return no('bedtime')
  if (c.call) return no('call')
  if (c.focus) return no('focus')
  if (c.quiet) return no('quiet')
  if (c.now - c.lastInterruptAt < c.gapMin * 60_000) return no('gap')
  return { show: true, why: 'ok' }
}

/** Default protections for the gate when the island has no better numbers. */
export const DEFAULT_GATE = { gapMin: 15, dayCap: 12 } as const

/** The fire input of a rule from the stored state (today on the clock of `now`). */
export function fireInput(state: CustomState, id: string, now: number, activeSince: number | null): FireInput {
  const f = state.fired[id]
  return { lastAt: f ? f.at : null, todayCount: f && f.day === dayKeyOf(now) ? f.n : 0, activeSince }
}

/** The state after a rule fired (or you tapped Done on it). */
export function noteFired(state: CustomState, id: string, now: number): CustomState {
  const day = dayKeyOf(now)
  const f = state.fired[id]
  const n = f && f.day === day ? f.n + 1 : 1
  return { ...state, fired: { ...state.fired, [id]: { at: now, day, n } } }
}

/** "every 45 min at the PC", "at 21:00 on weekdays". */
export function ruleText(r: ReminderRule): string {
  const d = [...r.days].sort().join(',')
  const days = !r.days.length || d === '0,1,2,3,4,5,6' ? '' : d === '1,2,3,4,5' ? ' on weekdays' : d === '0,6' ? ' at weekends' : ` on ${r.days.map((x) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x]).join(', ')}`
  const win = r.from && r.to ? `, ${r.from}–${r.to}` : ''
  return r.kind === 'at' ? `at ${r.at}${days}` : `every ${r.everyMin} min${r.atPc ? ' at the PC' : ''}${days}${win}`
}

export const _test = { dayKeyOf, DAY_MS }
