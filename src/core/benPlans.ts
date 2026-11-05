// Ben plans for you (pure, tested): the auto-planned week, "rescue my day",
// spaced-repetition study topics and habit stacks. Times are local "HH:MM",
// days "YYYY-MM-DD". Nothing here touches the calendar: the caller books what
// these return.

import { addDays } from './dates'
import type { EnergyMap } from './benKnows'

export interface Busy {
  start: number
  end: number
}
export interface Slot {
  day: string
  start: string
  minutes: number
}
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const localMs = (day: string, t: string) => new Date(`${day}T${t}:00`).getTime()

/** Free minutes-of-day ranges in [from, to) around busy times (with a 10-min buffer). */
export function freeRanges(day: string, busy: Busy[], from = '08:00', to = '22:00', buffer = 10): [number, number][] {
  const d0 = localMs(day, '00:00')
  const taken = busy
    .map((b) => [Math.floor((b.start - d0) / 60000) - buffer, Math.ceil((b.end - d0) / 60000) + buffer] as [number, number])
    .filter(([a, b]) => b > toMin(from) && a < toMin(to))
    .sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  let cur = toMin(from)
  for (const [a, b] of taken) {
    if (a > cur) out.push([cur, Math.min(a, toMin(to))])
    cur = Math.max(cur, b)
  }
  if (cur < toMin(to)) out.push([cur, toMin(to)])
  return out.filter(([a, b]) => b - a >= 25)
}

// --------------------------------------------------------- auto-planned week

export interface WeekGoal {
  title: string
  /** Hours still needed. */
  hoursLeft: number
  deadline: string
}
export interface WeekInput {
  /** Monday of the week to plan. */
  start: string
  today: string
  busy: Busy[]
  goals: WeekGoal[]
  energy: EnergyMap
  /** Days to keep free of training (rest days) and how many gym sessions a week. */
  restDays?: string[]
  gymPerWeek?: number
  gymMinutes?: number
  /** Your study topics due for review this week (10–20 min each). */
  reviews?: { day: string; title: string }[]
  /** Days off from deep work (e.g. Sunday). */
  offDays?: number[]
}
export interface WeekBlock {
  day: string
  start: string
  minutes: number
  title: string
  kind: 'deep' | 'gym' | 'review' | 'buffer'
}

const BLOCK = 50

/**
 * The whole week: deep-work blocks for each goal (sooner deadline → more, in
 * your best hours), gym sessions spread out (never on rest days), a short
 * review slot for due study topics and one buffer block a day for spill-over.
 */
export function planWeek(i: WeekInput): WeekBlock[] {
  const days = Array.from({ length: 7 }, (_, k) => addDays(i.start, k)).filter((d) => d >= i.today)
  const out: WeekBlock[] = []
  const busy = [...i.busy]
  const book = (day: string, startMin: number, minutes: number, title: string, kind: WeekBlock['kind']) => {
    out.push({ day, start: hm(startMin), minutes, title, kind })
    busy.push({ start: localMs(day, hm(startMin)), end: localMs(day, hm(startMin)) + minutes * 60000 })
  }
  const order = i.energy.ready ? [...i.energy.hours].sort((a, b) => b.score - a.score).map((x) => x.h) : [9, 10, 11, 15, 16, 14, 17, 18, 8, 19, 20]
  const place = (day: string, minutes: number, hours: number[] = order): number | null => {
    const free = freeRanges(day, busy)
    for (const h of hours) {
      for (const st of [h * 60, h * 60 + 30]) {
        if (free.some(([a, b]) => st >= a && st + minutes <= b)) return st
      }
    }
    return null
  }
  const off = new Set(i.offDays ?? [0])
  const workDays = days.filter((d) => !off.has(new Date(`${d}T12:00:00Z`).getUTCDay()))
  // 1) Goals: blocks needed this week = hoursLeft spread over the weeks to the deadline.
  const goals = [...i.goals].filter((g) => g.hoursLeft > 0 && g.deadline >= i.today).sort((a, b) => a.deadline.localeCompare(b.deadline))
  for (const g of goals) {
    const daysLeft = Math.max(1, Math.round((Date.parse(`${g.deadline}T12:00:00Z`) - Date.parse(`${i.today}T12:00:00Z`)) / 86400000))
    const weeksLeft = Math.max(1, daysLeft / 7)
    let blocks = Math.min(10, Math.ceil(((g.hoursLeft / weeksLeft) * 60) / BLOCK))
    const usable = workDays.filter((d) => d <= g.deadline)
    let k = 0
    let guard = 0
    while (blocks > 0 && usable.length && guard++ < 40) {
      const day = usable[k % usable.length]
      const perDay = out.filter((b) => b.day === day && b.kind === 'deep').length
      if (perDay < 3) {
        const st = place(day, BLOCK)
        if (st != null) {
          book(day, st, BLOCK, g.title, 'deep')
          blocks--
        }
      }
      k++
    }
  }
  // 2) Gym: spread out, never two days in a row, never on rest days.
  const gym = i.gymPerWeek ?? 3
  const rest = new Set(i.restDays ?? [])
  const gymDays: string[] = []
  for (const d of days) {
    if (gymDays.length >= gym) break
    if (rest.has(d)) continue
    if (gymDays.length && addDays(gymDays[gymDays.length - 1], 1) === d) continue
    const st = place(d, i.gymMinutes ?? 60, [18, 17, 19, 7, 16, 20])
    if (st != null) {
      book(d, st, i.gymMinutes ?? 60, 'Gym', 'gym')
      gymDays.push(d)
    }
  }
  // 3) Study reviews: one short slot on the day they're due.
  const byDay = new Map<string, string[]>()
  for (const r of i.reviews ?? []) if (days.includes(r.day)) byDay.set(r.day, [...(byDay.get(r.day) ?? []), r.title])
  for (const [d, titles] of byDay) {
    const mins = Math.min(45, 15 * titles.length)
    const st = place(d, mins, [8, 13, 12, 20, 21, 19])
    if (st != null) book(d, st, mins, `Review: ${titles.slice(0, 3).join(', ')}`, 'review')
  }
  // 4) A buffer late afternoon on work days with deep work (for whatever slipped).
  for (const d of workDays) {
    if (!out.some((b) => b.day === d && b.kind === 'deep')) continue
    const st = place(d, 30, [17, 18, 16, 19])
    if (st != null) book(d, st, 30, 'Buffer (catch up)', 'buffer')
  }
  return out.sort((a, b) => (a.day + a.start).localeCompare(b.day + b.start))
}

// ------------------------------------------------------------- rescue my day

export interface DayBlock {
  id: string
  title: string
  start: number
  end: number
  /** A must-do or fixed event (class, meeting): never shrunk or moved. */
  fixed?: boolean
  must?: boolean
}
export interface RescueMove {
  id: string
  title: string
  action: 'keep' | 'shrink' | 'move' | 'tomorrow'
  /** New local start/end (ms) for shrink/move. */
  start?: number
  end?: number
  why: string
}
export interface Rescue {
  moves: RescueMove[]
  /** Short lines for the screen / message. */
  lines: string[]
  freeMin: number
}

/**
 * The day fell apart: keep the must-dos and fixed events, shrink the other
 * blocks (to ~60%, at least 25 min), pack them into what's left before the
 * end of the day, and send what doesn't fit to tomorrow.
 */
/**
 * W1: today's calendar as rescue blocks: Ben's own blocks can shrink or move,
 * everything else (classes, meetings) is fixed. Training blocks (💪) stay put.
 */
export function rescueFromEvents(events: { id: string; title: string; start: string; end: string; allDay?: boolean; ours?: boolean; declined?: boolean }[], now: number, endOfDay: number): Rescue & { blocks: DayBlock[] } {
  const blocks: DayBlock[] = events
    .filter((e) => !e.allDay && !e.declined && Date.parse(e.end) > now - 6 * 3600_000)
    .map((e) => ({ id: e.id, title: e.title, start: Date.parse(e.start), end: Date.parse(e.end), fixed: !e.ours || e.title.includes('💪') }))
  // Missed blocks of Ben's (ended, not done) come back too, to fit them in what's left.
  const r = rescueDay(blocks.map((b) => (b.fixed || b.end > now ? b : { ...b, must: true })), now, endOfDay)
  return { ...r, blocks }
}

export function rescueDay(blocks: DayBlock[], now: number, endOfDay: number, opts: { shrink?: number } = {}): Rescue {
  const k = opts.shrink ?? 0.6
  // Missed must-dos come back too (they still have to happen today).
  const coming = blocks.filter((b) => b.end > now || (b.must && !b.fixed)).sort((a, b) => a.start - b.start)
  const fixed = coming.filter((b) => b.fixed)
  const musts = coming.filter((b) => !b.fixed && b.must)
  const rest = coming.filter((b) => !b.fixed && !b.must)
  const taken: Busy[] = fixed.map((b) => ({ start: b.start, end: b.end }))
  const moves: RescueMove[] = fixed.map((b) => ({ id: b.id, title: b.title, action: 'keep', why: 'fixed' }))
  const slot = (len: number, notBefore: number): number | null => {
    let t = Math.max(now, notBefore)
    t = Math.ceil(t / (5 * 60000)) * 5 * 60000
    const sorted = [...taken].sort((a, b) => a.start - b.start)
    for (const b of sorted) {
      if (t + len <= b.start - 5 * 60000) break
      if (b.end + 5 * 60000 > t) t = Math.max(t, b.end + 5 * 60000)
    }
    return t + len <= endOfDay ? t : null
  }
  const placeOne = (b: DayBlock, len: number, kind: 'keep' | 'shrink' | 'move') => {
    const st = slot(len, b.start <= now ? now : b.start)
    const st2 = st ?? slot(len, now)
    if (st2 == null) return false
    taken.push({ start: st2, end: st2 + len })
    const same = Math.abs(st2 - b.start) < 60000 && Math.abs(st2 + len - b.end) < 60000
    moves.push({ id: b.id, title: b.title, action: same ? 'keep' : kind, start: st2, end: st2 + len, why: kind === 'shrink' ? `${Math.round(len / 60000)} min instead of ${Math.round((b.end - b.start) / 60000)}` : same ? 'still fits' : 'moved to fit' })
    return true
  }
  for (const b of musts) if (!placeOne(b, b.end - b.start, 'move')) placeOne(b, Math.max(25 * 60000, (b.end - b.start) * k), 'shrink') || moves.push({ id: b.id, title: b.title, action: 'tomorrow', why: "doesn't fit today" })
  for (const b of rest) {
    const len = Math.max(25 * 60000, Math.round(((b.end - b.start) * k) / (5 * 60000)) * 5 * 60000)
    if (!placeOne(b, Math.min(len, b.end - b.start), len < b.end - b.start ? 'shrink' : 'move')) moves.push({ id: b.id, title: b.title, action: 'tomorrow', why: "doesn't fit today" })
  }
  const t = (ms: number) => new Date(ms).toTimeString().slice(0, 5)
  const lines = moves
    .filter((m) => m.action !== 'keep' || !fixed.some((f) => f.id === m.id))
    .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity))
    .map((m) => (m.action === 'tomorrow' ? `➡️ ${m.title} → tomorrow` : m.action === 'shrink' ? `✂️ ${m.title} ${t(m.start!)}–${t(m.end!)} (${m.why})` : m.action === 'move' ? `↪️ ${m.title} → ${t(m.start!)}` : `✓ ${m.title} ${t(m.start!)}`))
  const freeMin = Math.max(0, Math.round((endOfDay - now - taken.reduce((s, b) => s + Math.max(0, Math.min(b.end, endOfDay) - Math.max(b.start, now)), 0)) / 60000))
  return { moves, lines, freeMin }
}

// -------------------------------------------------------------- study coach

export interface StudyTopic {
  id: string
  exam: string
  topic: string
  /** The day it was first learned. */
  learned: string
  /** Days it was reviewed. */
  reviews: string[]
  examDay?: string | null
}
/** Review after 1, 3, 7, 14, 30 days (each from the previous review). */
export const SRS_STEPS = [1, 3, 7, 14, 30]

export function nextReview(t: StudyTopic): string | null {
  const n = t.reviews.length
  if (n >= SRS_STEPS.length) return null
  const base = n ? t.reviews[n - 1] : t.learned
  let due = addDays(base, SRS_STEPS[n])
  // Before an exam, nothing waits past the day before.
  if (t.examDay && due >= t.examDay) due = addDays(t.examDay, -1) >= base ? addDays(t.examDay, -1) : t.examDay
  return due
}

export function dueTopics(list: StudyTopic[], today: string): StudyTopic[] {
  return list.filter((t) => (t.examDay ? t.examDay >= today : true)).filter((t) => {
    const d = nextReview(t)
    return d != null && d <= today
  })
}

export function addTopic(list: StudyTopic[], exam: string, topic: string, today: string, examDay?: string | null): StudyTopic[] {
  const key = `${exam}|${topic}`.toLowerCase()
  if (list.some((t) => `${t.exam}|${t.topic}`.toLowerCase() === key)) return list
  return [...list, { id: `s${Date.now().toString(36)}${list.length}`, exam: exam.slice(0, 60), topic: topic.slice(0, 80), learned: today, reviews: [], examDay: examDay ?? null }].slice(-200)
}

export function reviewTopic(list: StudyTopic[], id: string, today: string): StudyTopic[] {
  return list.map((t) => (t.id === id && !t.reviews.includes(today) ? { ...t, reviews: [...t.reviews, today] } : t))
}

export const studyLine = (t: StudyTopic) => `${t.exam} · ${t.topic} review: ${t.reviews.length ? 15 : 20} min today`

// ------------------------------------------------------------- habit stacks

export interface Stack {
  id: string
  /** The cue it hangs on ("after coffee"). */
  cue: string
  steps: string[]
  /** day → steps done (indexes). */
  log: Record<string, number[]>
  createdAt: string
}

/** "after coffee → 10 pushups → plan review" (also > or ,) into a stack. */
export function parseStack(text: string, today: string): Stack | null {
  const parts = String(text ?? '')
    .split(/\s*(?:→|->|>|,|\bthen\b|\bapoi\b)\s*/i)
    .map((x) => x.trim())
    .filter(Boolean)
  if (parts.length < 2) return null
  const cue = parts[0].replace(/^(after|când|cand|dupa|după)\s+/i, '').slice(0, 60)
  return { id: `h${Date.now().toString(36)}`, cue, steps: parts.slice(1, 6).map((s) => s.slice(0, 60)), log: {}, createdAt: today }
}

export function tickStack(s: Stack, day: string, step: number): Stack {
  const cur = s.log[day] ?? []
  const next = cur.includes(step) ? cur.filter((x) => x !== step) : [...cur, step].sort((a, b) => a - b)
  return { ...s, log: { ...s.log, [day]: next } }
}

/** Days in a row (ending today or yesterday) with every step done. */
export function stackStreak(s: Stack, today: string): number {
  const full = (d: string) => (s.log[d] ?? []).length >= s.steps.length
  let d = full(today) ? today : addDays(today, -1)
  let n = 0
  while (full(d) && n < 400) {
    n++
    d = addDays(d, -1)
  }
  return n
}

/** Share of the last 14 days with the whole chain done. */
export function stackRate(s: Stack, today: string): number {
  const since = s.createdAt > addDays(today, -13) ? s.createdAt : addDays(today, -13)
  let days = 0
  let full = 0
  for (let d = since; d <= today; d = addDays(d, 1)) {
    days++
    if ((s.log[d] ?? []).length >= s.steps.length) full++
  }
  return days ? Math.round((full / days) * 100) : 0
}

// ---- The planning agent's steps (N5) --------------------------------------
export interface AgentStep { label: string; detail: string }

/**
 * What Ben did to plan your week, in at most 4 steps: read the calendar,
 * find free time, check deadlines, propose. The proposal waits for your OK.
 */
export function planningSteps(i: { events: number; busyMin: number; days: number; goals: { title: string; hoursLeft: number; deadline: string }[]; today: string; blocks: WeekBlock[] }): AgentStep[] {
  const freeH = Math.max(0, Math.round(((i.days * 14 * 60 - i.busyMin) / 60) * 10) / 10)
  const soon = [...i.goals].filter((g) => g.hoursLeft > 0).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 2)
  const deep = i.blocks.filter((b) => b.kind === 'deep')
  const days = (d: string) => Math.max(0, Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${i.today}T12:00:00Z`)) / 86400000))
  return [
    { label: 'Read your calendar', detail: `${i.events} event${i.events === 1 ? '' : 's'} in the next ${i.days} days` },
    { label: 'Found free time', detail: `about ${freeH} h free between 8:00 and 22:00` },
    { label: 'Checked deadlines', detail: soon.length ? soon.map((g) => `${g.title}: ${g.hoursLeft} h left, ${days(g.deadline)} days`).join(' · ') : 'no goal with a deadline' },
    { label: 'Proposed', detail: `${i.blocks.length} blocks (${(deep.reduce((t, b) => t + b.minutes, 0) / 60).toFixed(1)} h deep work). Waiting for your OK.` }
  ]
}
