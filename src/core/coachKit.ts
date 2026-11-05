// The coach's toolkit, pure and tested:
// - short references (E1, T3) so the model can point at a calendar event or
//   a Todoist task without copying long ids;
// - "big asks" that deserve longer thinking;
// - reminders and check-ins it schedules, and when a follow-up nudge is
//   allowed ("follow up until I act", but never spam, and never when paused).
import type { CalEvent } from './dayTime'
import type { TodoTask } from './todoist'
import { calendarDay } from './dates'

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
  return calendarDay(d)
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

/**
 * You wrote to the coach: the follow-ups your message answers stop (T3).
 * With your words, only a reply about it counts ("done", "not yet", "no",
 * or a word from the promise); "water 250" or "taxi 45" doesn't. With no
 * text (old callers), every open one stops, as before.
 */
export function answered(list: Reminder[], now = new Date(), text?: string, replyTo?: boolean): Reminder[] {
  const t = String(text ?? '').toLowerCase()
  const about = (r: Reminder) => {
    if (text == null || replyTo) return true
    if (/\b(done|did it|did|yes|yep|no|nope|not yet|later|skip|skipped|finished|can'?t|cannot|tomorrow|forgot|failed|gata|da|nu|am făcut|am facut|сделал|нет|да)\b/i.test(t)) return true
    const words = (String(r.text ?? '').toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => !['that', 'this', 'with', 'your', 'will', 'have', 'from', 'today', 'tonight'].includes(w))
    return words.some((w) => t.includes(w.slice(0, 5)))
  }
  return list.map((r) => (!r.done && r.sentAt && Date.parse(r.sentAt) <= now.getTime() && about(r) ? { ...r, done: true, ignored: false, answeredAt: now.toISOString() } : r))
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
  /** Nudges in a row that nothing followed (W3): the gap grows 45 → 90 → 120 min. */
  ignored?: number
  /** Per hour of the day: [nudges sent, nudges followed by something within the gap] (W9). */
  slots?: Record<string, [number, number]>
  /** The hour of the last nudge (to score it when the next one comes). */
  lastHour?: number
  /** A lower daily cap (W20: Ben chose fewer nudges because they weren't working). */
  max?: number
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

/** Fewer, better nudges (W3, W21): 8 a day at most. */
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
  // No wake-up logged yet this morning: maybe still asleep, so no "nothing done" (T2).
  if (!f.wakeLogged && f.time < '11:00') return false
  if (f.focusRunning) return false
  if (f.openMustDos === 0 && f.focusMinToday >= 50) return false
  if (f.idleMin < 60) return false
  const count = st.day === f.today ? (st.count ?? 0) : 0
  if (count >= Math.min(NUDGE_MAX_PER_DAY, st.max ?? NUDGE_MAX_PER_DAY)) return false
  if (st.lastAt && now.getTime() - Date.parse(st.lastAt) < nudgeGapMin(st) * 60000) return false
  // W9: an hour where he almost never reacts gets no nudge (after 4+ tries there).
  if (badHour(st, now.getHours())) return false
  return true
}

/** W3: 45 minutes, 90 after one ignored nudge, 2 hours after two in a row. */
export function nudgeGapMin(st: NudgeState): number {
  const n = st.ignored ?? 0
  return n >= 2 ? 120 : n === 1 ? 90 : FOLLOW_EVERY_MIN
}

/** W9: he reacts to under 15% of nudges at this hour (4+ sent). */
export function badHour(st: NudgeState, hour: number): boolean {
  const s = st.slots?.[String(hour)]
  return !!s && s[0] >= 4 && s[1] / s[0] < 0.15
}

/**
 * A nudge went out. `idleMin` (minutes since anything was done) scores the
 * previous nudge: something happened since it → he reacted (reset the
 * back-off, a point for that hour); nothing → one more ignored.
 */
export function nudged(st: NudgeState, today: string, now = new Date(), idleMin?: number): NudgeState {
  const sameDay = st.day === today
  let ignored = sameDay ? st.ignored ?? 0 : 0
  const slots = { ...(st.slots ?? {}) }
  if (sameDay && st.lastAt && idleMin != null) {
    const since = (now.getTime() - Date.parse(st.lastAt)) / 60000
    const acted = idleMin < since - 1
    ignored = acted ? 0 : ignored + 1
    if (st.lastHour != null) {
      const k = String(st.lastHour)
      const [sent, ok] = slots[k] ?? [0, 0]
      slots[k] = [Math.min(60, sent + 1), Math.min(60, ok + (acted ? 1 : 0))]
    }
  }
  return { ...st, lastAt: now.toISOString(), day: today, count: (sameDay ? (st.count ?? 0) : 0) + 1, announced: sameDay ? st.announced : [], ignored, slots, lastHour: now.getHours() }
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

/** What a promise is about, from its words (B12). */
export function promiseKind(text: string): 'study' | 'training' | 'sleep' | 'money' | 'tasks' | 'other' {
  const t = text.toLowerCase()
  if (/\b(stud|learn|read|lab|exam|homework|course|lecture|chapter|math|algebra|code|coding|practice)/.test(t)) return 'study'
  if (/\b(gym|train|workout|run|pushup|squat|exercise|walk|stretch)/.test(t)) return 'training'
  if (/\b(sleep|bed|wake|up at|alarm|phone away)/.test(t)) return 'sleep'
  if (/\b(spend|buy|money|budget|save|lei|pay)/.test(t)) return 'money'
  if (/\b(task|email|call|send|finish|submit|clean|cv|apply)/.test(t)) return 'tasks'
  return 'other'
}

/**
 * B12: how reliable each kind of promise is over 30 days, so Ben asks small
 * where Victor usually fails and asks more where he delivers.
 * "Promise reliability (30 days): study 3/10 kept → ask for 15 minutes, not hours; training 6/7 kept → he delivers, raise the bar."
 */
export function promiseReliability(list: Reminder[], now = new Date()): string {
  const month = list.filter((r) => r.kind === 'checkin' && Date.parse(r.createdAt) > now.getTime() - 30 * 86400000 && (r.outcome || r.ignored))
  const by = new Map<string, { kept: number; all: number }>()
  for (const r of month) {
    const k = promiseKind(r.text)
    const v = by.get(k) ?? { kept: 0, all: 0 }
    v.all++
    if (r.outcome === 'kept') v.kept++
    by.set(k, v)
  }
  const parts = [...by]
    .filter(([, v]) => v.all >= 3)
    .sort((a, b) => b[1].all - a[1].all)
    .map(([k, v]) => {
      const rate = v.kept / v.all
      return `${k} ${v.kept}/${v.all} kept → ${rate < 0.4 ? 'ask for something tiny (10–15 min) and timed' : rate >= 0.75 ? 'he delivers, raise the bar a little' : 'keep it small and concrete'}`
    })
  return parts.length ? `Promise reliability (30 days): ${parts.join('; ')}.` : ''
}

/** One line for the coach (and the escalating follow-ups). */
export function promiseLine(s: PromiseStats): string {
  if (!s.kept && !s.broken && !s.ignored) return ''
  return `Promises in the last 7 days: ${s.kept} kept, ${s.broken} broken, ${s.ignored} ignored${s.misses.length ? `. Missed: ${s.misses.map((m) => `"${m.slice(0, 60)}"`).join(', ')}` : ''}.`
}

/**
 * Asking again about something you said you'd do. Below tone 5 it gets more
 * helpful each time (smaller step, move it); at tone 5 it gets sharper.
 */
export function followUpText(r: Reminder, s: PromiseStats, tone = 4): string {
  const tries = r.tries ?? 0
  const misses = s.broken + s.ignored
  if (tries === 0) return `🔔 ${r.text}`
  if (tone < 5) {
    if (tries === 1) return `🔔 ${r.text}\n<i>Still on? "Done", "not yet" or "later" all work.</i>`
    if (tries === 2) return `🎯 ${r.text}\nToo big right now? Tell me what's in the way and I'll make it smaller or move it.`
    return `🎯 Last check on: ${r.text}\nIf it's not happening today, just say so and I'll move it to tomorrow.`
  }
  if (tries === 1) return `😤 ${r.text}\n<i>Asking again. "Not yet" is an answer too.</i>`
  if (tries === 2) return `😠 ${r.text}\n<b>Third time.</b>${misses ? ` ${misses} promise${misses === 1 ? '' : 's'} missed this week already.` : ''} Answer me.`
  return `😡 Last call: ${r.text}\n${misses ? `This would be miss #${misses + 1} this week. ` : ''}You said you'd do it. Do it now, or tell me why not.`
}

// ---- The coach's mood: how it feels about your day, from the data --------

export type Mood = 'proud' | 'happy' | 'chill' | 'focused' | 'annoyed' | 'angry' | 'furious'
/** 🎯 focused: a slipping day below tone 5 (Ben helps instead of glaring). */
export const MOOD_FACE: Record<Mood, string> = { proud: '😎', happy: '😄', chill: '🙂', focused: '🎯', annoyed: '😤', angry: '😠', furious: '😡' }
export const isMood = (m: unknown): m is Mood => typeof m === 'string' && m in MOOD_FACE

export interface MoodFacts {
  /** Local hour 0–23. */
  hour: number
  focusMinToday: number
  /** Minutes since anything was done today (Infinity: nothing yet). */
  idleMin: number
  openMustDos: number
  mustDosDone: number
  /** Broken + ignored promises in the last 7 days, and kept ones. */
  missedWeek: number
  keptWeek: number
  /** Goals behind their pace by an hour or more. */
  goalsBehind: number
}

/**
 * Proud when the day is strong, angry when you're slipping on purpose:
 * missed promises, goals falling behind, hours with nothing done.
 */
export function coachMood(f: MoodFacts): { mood: Mood; why: string } {
  let heat = 0
  const why: string[] = []
  if (f.missedWeek >= 3) (heat += 2), why.push(`${f.missedWeek} promises missed this week`)
  else if (f.missedWeek >= 1) (heat += 1), why.push(`${f.missedWeek} promise${f.missedWeek === 1 ? '' : 's'} missed this week`)
  if (f.goalsBehind) (heat += f.goalsBehind >= 2 ? 2 : 1), why.push(`${f.goalsBehind} goal${f.goalsBehind === 1 ? '' : 's'} behind`)
  if (f.hour >= 11 && f.focusMinToday === 0) (heat += f.hour >= 16 ? 2 : 1), why.push('no focus yet today')
  if (f.hour >= 10 && f.idleMin >= 180 && f.openMustDos) (heat += 1), why.push(`nothing done for ${Number.isFinite(f.idleMin) ? `${Math.round(f.idleMin / 60)}h` : 'the whole day'}`)
  let good = 0
  if (f.focusMinToday >= 100) (good += 2), why.push(`${f.focusMinToday} min of focus today`)
  else if (f.focusMinToday >= 50) good += 1
  if (f.mustDosDone >= 2 && f.openMustDos === 0) (good += 2), why.push('every must-do done')
  else if (f.mustDosDone >= 1) good += 1
  if (f.keptWeek >= 3 && f.missedWeek === 0) (good += 1), why.push(`${f.keptWeek} promises kept`)
  const score = good - heat
  const mood: Mood = heat >= 5 ? 'furious' : heat >= 3 && good < 2 ? 'angry' : score <= -1 ? 'annoyed' : score >= 4 ? 'proud' : score >= 2 ? 'happy' : 'chill'
  return { mood, why: why.join(', ') || 'a normal day so far' }
}
