// The coach's toolkit, pure and tested:
// - short references (E1, T3) so the model can point at a calendar event or
//   a Todoist task without copying long ids;
// - "big asks" that deserve longer thinking;
// - reminders and check-ins it schedules, and when a follow-up nudge is
//   allowed ("follow up until I act", but never spam, and never when paused).
import type { CalEvent } from './dayTime'
import type { TodoTask } from './todoist'

export interface Refs {
  events: Map<string, CalEvent>
  tasks: Map<string, TodoTask>
}

const hm = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const dayOf = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** E1… for events (time order), T1… for tasks; the lines the model sees. */
export function makeRefs(events: CalEvent[], tasks: TodoTask[]): { refs: Refs; lines: string } {
  const refs: Refs = { events: new Map(), tasks: new Map() }
  const ev = events.filter((e) => !e.allDay).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 40)
  const evLines = ev.map((e, i) => {
    refs.events.set(`E${i + 1}`, e)
    return `E${i + 1} ${dayOf(e.start).slice(5)} ${hm(e.start)}–${hm(e.end)} ${e.title}`
  })
  const tLines = tasks.slice(0, 60).map((t, i) => {
    refs.tasks.set(`T${i + 1}`, t)
    return `T${i + 1} ${t.content}${t.due ? ` (due ${t.due}${t.dueTime ? ` ${t.dueTime}` : ''})` : ''}${t.priority > 1 ? ` P${5 - t.priority}` : ''}${t.section ? ` [${t.section}]` : ''}${t.labels?.includes('today') ? ' ⭐' : ''}`
  })
  return {
    refs,
    lines: [evLines.length ? `Calendar events (use the E-number):\n${evLines.join('\n')}` : 'Calendar events: none (or not connected)', tLines.length ? `Todoist tasks (use the T-number):\n${tLines.join('\n')}` : 'Todoist tasks: none (or not connected)'].join('\n')
  }
}

/** Plans, reviews, reshuffles and "why" questions get the slower, deeper model. */
export function isBigAsk(text: string): boolean {
  const t = text.toLowerCase()
  return t.length > 160 || /\b(plan|replan|re-plan|schedule|reschedule|shift|move everything|organi[sz]e|review|analy[sz]|why|strategy|week|month|budget|prioriti[sz]e|clean up|what should i|help me (decide|figure))\b/.test(t)
}

// ---- Reminders and check-ins -------------------------------------------

export interface Reminder {
  id: string
  /** When to send (ISO). */
  at: string
  text: string
  /** A check-in asks and, with `follow`, asks again until you answer. */
  kind: 'remind' | 'checkin'
  follow?: boolean
  tries?: number
  sentAt?: string | null
  done?: boolean
  createdAt: string
  /** When you wrote back after it was sent. */
  answeredAt?: string | null
  /** A check-in never answered after every follow-up. */
  ignored?: boolean
  /** The coach's call after your answer: promise kept or broken. */
  outcome?: 'kept' | 'broken' | null
}

export const REMINDERS = 'coach_reminders'
export const NUDGES = 'coach_nudges'
export const FOLLOW_EVERY_MIN = 45
export const FOLLOW_MAX = 4

export function addReminder(list: Reminder[], r: Omit<Reminder, 'id' | 'createdAt'>, now = new Date()): Reminder[] {
  const id = `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  return [...list.filter((x) => !x.done || Date.parse(x.at) > now.getTime() - 8 * 86400000), { ...r, id, createdAt: now.toISOString() }].slice(-60)
}

/** Reminders to send now. */
export function dueReminders(list: Reminder[], now = new Date()): Reminder[] {
  return list.filter((r) => !r.done && Date.parse(r.at) <= now.getTime() && Date.parse(r.at) > now.getTime() - 6 * 3600_000)
}

/**
 * After sending: a plain reminder is done; a follow-up check-in comes back
 * in 45 minutes (up to 4 times) unless you answered since.
 */
export function afterSend(list: Reminder[], id: string, now = new Date()): Reminder[] {
  return list.map((r) => {
    if (r.id !== id) return r
    const tries = (r.tries ?? 0) + 1
    if (r.kind === 'checkin' && r.follow && tries < FOLLOW_MAX) return { ...r, tries, sentAt: now.toISOString(), at: new Date(now.getTime() + FOLLOW_EVERY_MIN * 60000).toISOString() }
    return { ...r, tries, sentAt: now.toISOString(), done: true, ...(r.kind === 'checkin' && r.follow ? { ignored: true } : {}) }
  })
}

/** You wrote to the coach: open follow-ups stop. */
export function answered(list: Reminder[], now = new Date()): Reminder[] {
  return list.map((r) => (!r.done && r.sentAt && Date.parse(r.sentAt) <= now.getTime() ? { ...r, done: true, ignored: false, answeredAt: now.toISOString() } : r))
}

// ---- Follow-up nudges when you're slipping -------------------------------

export interface NudgeState {
  /** Day the nudges were paused ("pause nudges today"). */
  pausedDay?: string | null
  /** Snoozed until (ISO). */
  snoozeUntil?: string | null
  lastAt?: string | null
  day?: string | null
  count?: number
  /** Calendar block ids already announced today. */
  announced?: string[]
}

export interface NudgeFacts {
  today: string
  /** Local "HH:MM". */
  time: string
  focusRunning: boolean
  focusMinToday: number
  openMustDos: number
  /** Minutes since anything was logged, ticked or focused (Infinity: nothing today). */
  idleMin: number
  wakeLogged: boolean
}

export const NUDGE_MAX_PER_DAY = 8

/**
 * "Follow up until I act": between 09:00 and 21:30, when nothing is running,
 * something is open and you've been idle 60+ minutes, nudge, then again every
 * 45 minutes. Never while paused or snoozed, at most 8 a day.
 */
export function shouldNudge(st: NudgeState, f: NudgeFacts, now = new Date()): boolean {
  if (st.pausedDay === f.today) return false
  if (st.snoozeUntil && Date.parse(st.snoozeUntil) > now.getTime()) return false
  if (f.time < '09:00' || f.time > '21:30') return false
  if (f.focusRunning) return false
  if (f.openMustDos === 0 && f.focusMinToday >= 50) return false
  if (f.idleMin < 60) return false
  const count = st.day === f.today ? (st.count ?? 0) : 0
  if (count >= NUDGE_MAX_PER_DAY) return false
  if (st.lastAt && now.getTime() - Date.parse(st.lastAt) < FOLLOW_EVERY_MIN * 60000) return false
  return true
}

export function nudged(st: NudgeState, today: string, now = new Date()): NudgeState {
  return { ...st, lastAt: now.toISOString(), day: today, count: (st.day === today ? (st.count ?? 0) : 0) + 1, announced: st.day === today ? st.announced : [] }
}

/** He's saying something went wrong ("that's not money", "undo", "wrong amount", "nu e bine"). */
export function isCorrection(text: string): boolean {
  const t = text.toLowerCase()
  return /\b(wrong|mistake|not money|not an expense|that'?s water|undo|delete (it|that)|remove (it|that)|fix (it|that)|incorrect|shouldn'?t (be|have)|didn'?t (spend|buy|pay)|greșit|gresit|nu e (bine|corect)|nu sunt bani|șterge|sterge|неправильно|удали|ошибка|не деньги)\b/.test(t) || /\bnot money\b|\bthats water\b|\bthat's water\b/.test(t.replace(/[^\w' ]/g, ''))
}

// ---- Promises: every check-in is something you said you'd do ------------

/** Check-ins of the last 2 days without a verdict yet, as P1, P2… for the coach. */
export function promiseRefs(list: Reminder[], now = new Date()): { refs: Map<string, string>; lines: string } {
  const refs = new Map<string, string>()
  const open = list.filter((r) => r.kind === 'checkin' && r.sentAt && !r.outcome && Date.parse(r.createdAt) > now.getTime() - 2 * 86400000).slice(-6)
  const lines = open.map((r, i) => {
    refs.set(`P${i + 1}`, r.id)
    const state = r.answeredAt ? 'he answered' : r.ignored ? 'IGNORED (no answer to any follow-up)' : `asked ${r.tries ?? 1}×, no answer yet`
    return `P${i + 1} "${r.text}" (${new Date(r.sentAt as string).toTimeString().slice(0, 5)}, ${state})`
  })
  return { refs, lines: lines.length ? `Promises you're checking (use the P-number):\n${lines.join('\n')}` : '' }
}

export function setOutcome(list: Reminder[], id: string, outcome: 'kept' | 'broken'): Reminder[] {
  return list.map((r) => (r.id === id ? { ...r, outcome, done: true } : r))
}

export interface PromiseStats {
  kept: number
  broken: number
  ignored: number
  open: number
  /** Broken or ignored, newest first (for calling it out). */
  misses: string[]
}

/** The last 7 days of promises: kept, broken, ignored. */
export function promiseStats(list: Reminder[], now = new Date()): PromiseStats {
  const week = list.filter((r) => r.kind === 'checkin' && Date.parse(r.createdAt) > now.getTime() - 7 * 86400000)
  const missed = week.filter((r) => r.outcome === 'broken' || (r.ignored && r.outcome !== 'kept'))
  return {
    kept: week.filter((r) => r.outcome === 'kept').length,
    broken: week.filter((r) => r.outcome === 'broken').length,
    ignored: week.filter((r) => r.ignored && !r.outcome).length,
    open: week.filter((r) => !r.done).length,
    misses: missed.slice(-5).reverse().map((r) => r.text)
  }
}

/** One line for the coach (and the escalating follow-ups). */
export function promiseLine(s: PromiseStats): string {
  if (!s.kept && !s.broken && !s.ignored) return ''
  return `Promises in the last 7 days: ${s.kept} kept, ${s.broken} broken, ${s.ignored} ignored${s.misses.length ? `. Missed: ${s.misses.map((m) => `"${m.slice(0, 60)}"`).join(', ')}` : ''}.`
}

/** The follow-up gets sharper each time, and names the pattern when there is one. */
export function followUpText(r: Reminder, s: PromiseStats): string {
  const tries = r.tries ?? 0
  const misses = s.broken + s.ignored
  if (tries === 0) return `🔔 ${r.text}`
  if (tries === 1) return `🔔 ${r.text}\n<i>Asking again. "Not yet" is an answer too.</i>`
  if (tries === 2) return `⏰ ${r.text}\n<b>Third time.</b>${misses ? ` ${misses} promise${misses === 1 ? '' : 's'} missed this week already.` : ''} Answer me.`
  return `🚨 Last call: ${r.text}\n${misses ? `This would be miss #${misses + 1} this week. ` : ''}You said you'd do it. Do it now, or tell me why not.`
}
