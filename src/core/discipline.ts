// The private Discipline streak. Everything is derived from dated events, so
// the count can't be bumped by hand: it is simply the days since the last reset.
import { addDays, daysBetween } from './dates'
import { LedgerError } from './ledger'
import { cleanStats, type CleanStats } from './streaks'

export type DisciplineKind = 'start' | 'reset' | 'checkin' | 'oath' | 'urge'

export interface DisciplineEvent {
  id: number
  kind: DisciplineKind
  day: string // the day it is about
  ts: string // when it was recorded
}

export const MILESTONES: { days: number; coins: number }[] = [
  { days: 3, coins: 15 },
  { days: 7, coins: 40 },
  { days: 10, coins: 60 },
  { days: 14, coins: 80 },
  { days: 30, coins: 200 },
  { days: 60, coins: 350 },
  { days: 90, coins: 600 },
  { days: 180, coins: 1000 },
  { days: 365, coins: 2000 }
]

export const DISCIPLINE_RANKS: { days: number; name: string }[] = [
  { days: 0, name: 'Initiate' },
  { days: 3, name: 'Squire' },
  { days: 7, name: 'Warrior' },
  { days: 14, name: 'Guardian' },
  { days: 30, name: 'Knight' },
  { days: 60, name: 'Champion' },
  { days: 90, name: 'Spartan' },
  { days: 180, name: 'Legend' }
]

/** Seconds the urge crusher must run before it counts. */
export const URGE_SECONDS = 180
export const URGE_GRACE_SECONDS = 10

export const QUOTES = [
  'Discipline is choosing what you want most over what you want now.',
  'The urge is a wave. You do not have to surf it, you only have to let it pass.',
  'Every clean day is a vote for the person you are becoming.',
  'You are not your impulses. You are the one who notices them.',
  'Hard choices, easy life. Easy choices, hard life.',
  'One day at a time is still a day won.',
  'Boredom is not an emergency. Stand up, move, breathe.',
  'Strong is built in the moments nobody sees.',
  'A slip is a lesson, not a verdict. Start again today.',
  'Your future self is watching. Give them a reason to be proud.',
  'Energy saved is energy you get to spend on your goals.',
  'Comfort is the enemy of progress. Do the harder thing.',
  'The first five minutes are the hardest. After that it gets quiet.',
  'You have done hard things before. This is one more.',
  'Win the morning, win the day.',
  'Control the phone or the phone controls you.',
  'Real confidence is a promise to yourself, kept.',
  'Cold water, ten push-ups, fresh air. Then decide.',
  'Small daily wins beat big rare ones.',
  'The streak is the proof. Keep stacking days.'
]

export function quoteFor(day: string): string {
  // Same quote all day, a new one tomorrow.
  const n = daysBetween('2026-01-01', day)
  return QUOTES[((n % QUOTES.length) + QUOTES.length) % QUOTES.length]
}

export function rankFor(days: number): { name: string; next: { name: string; days: number } | null } {
  let i = 0
  for (let k = 0; k < DISCIPLINE_RANKS.length; k++) if (days >= DISCIPLINE_RANKS[k].days) i = k
  const next = DISCIPLINE_RANKS[i + 1]
  return { name: DISCIPLINE_RANKS[i].name, next: next ?? null }
}

/** The current start date is the latest `start` event. */
export function startOf(events: DisciplineEvent[]): DisciplineEvent | null {
  const starts = events.filter((e) => e.kind === 'start').sort((a, b) => a.id - b.id)
  return starts[starts.length - 1] ?? null
}

export function statsOf(events: DisciplineEvent[], today: string): CleanStats {
  const start = startOf(events)
  return cleanStats(start?.day ?? null, events.filter((e) => e.kind === 'reset').map((e) => e.day), today)
}

export function milestoneRef(since: string, days: number): string {
  return `milestone:${since}:${days}`
}

export type MilestoneStatus = 'locked' | 'claimable' | 'claimed' | 'before-setup'

/**
 * Milestones of the current streak. A milestone whose day came before the
 * streak was entered in the app shows as reached but pays nothing, so a
 * backdated start date can't unlock a pile of coins at once.
 */
export function milestonesOf(
  events: DisciplineEvent[],
  today: string,
  claimedRefs: Set<string>,
  setupDay: (startEvent: DisciplineEvent) => string
): { days: number; coins: number; status: MilestoneStatus; reachedOn: string | null }[] {
  const start = startOf(events)
  const stats = statsOf(events, today)
  if (!start || !stats.since) return MILESTONES.map((m) => ({ ...m, status: 'locked' as const, reachedOn: null }))
  const recorded = setupDay(start)
  return MILESTONES.map((m) => {
    if (stats.current < m.days) return { ...m, status: 'locked' as const, reachedOn: null }
    const reachedOn = addDays(stats.since!, m.days)
    if (claimedRefs.has(milestoneRef(stats.since!, m.days))) return { ...m, status: 'claimed' as const, reachedOn }
    return { ...m, status: reachedOn < recorded ? ('before-setup' as const) : ('claimable' as const), reachedOn }
  })
}

export function validateStart(day: string, today: string, events: DisciplineEvent[]): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new LedgerError('Pick a date')
  if (day > today) throw new LedgerError('The start date cannot be in the future')
  if (daysBetween(day, today) > 3650) throw new LedgerError('That date is too far back')
  if (events.some((e) => e.kind === 'reset')) throw new LedgerError('After a reset the date comes from the reset itself')
}

export function planCheckIn(events: DisciplineEvent[], today: string): void {
  if (!startOf(events)) throw new LedgerError('Set your start date first')
  if (events.some((e) => e.kind === 'reset' && e.day === today)) throw new LedgerError('Today was a reset day. Check in again tomorrow.')
  if (events.some((e) => e.kind === 'checkin' && e.day === today)) throw new LedgerError('Already checked in today')
}

export function planUrgeFinish(startedAt: string | null, now: Date): void {
  if (!startedAt) throw new LedgerError('Start the urge crusher first')
  const elapsed = (now.getTime() - Date.parse(startedAt)) / 1000
  if (elapsed < URGE_SECONDS - URGE_GRACE_SECONDS) {
    throw new LedgerError(`Stay with it ${Math.ceil(URGE_SECONDS - URGE_GRACE_SECONDS - elapsed)} more seconds`)
  }
}

/** Day-by-day map of the current streak for the campaign grid (first `size` days). */
export function campaignMap(stats: CleanStats, size = 90): { day: number; state: 'done' | 'today' | 'ahead'; milestone: boolean }[] {
  const milestoneDays = new Set(MILESTONES.map((m) => m.days))
  return Array.from({ length: size }, (_, i) => {
    const day = i + 1
    return {
      day,
      state: day <= stats.current ? 'done' : day === stats.current + 1 ? 'today' : 'ahead',
      milestone: milestoneDays.has(day)
    }
  })
}

/**
 * The streak as "Day N", everywhere (Today, MAN, Ben, Telegram, the island).
 * The start day is Day 1; a reset day is Day 0 and the next day Day 1.
 * (`current` counts whole days since the start / last reset.)
 */
export function dayNumber(s: { current: number; resets: number; setup?: boolean }): number {
  if (s.setup === false) return 0
  return s.current + (s.resets === 0 ? 1 : 0)
}

/**
 * The ONE day number to show (owner, 2026-11-12): the page ring, the 90-day
 * campaign, Today, the alert and the island all say "Day N" from `state.day`.
 * `current` (whole clean days) stays for badges, ranks and milestones only.
 */
export function dayShown(s: { day?: number | null; current: number; resets?: number; setup?: boolean }): number {
  return typeof s.day === 'number' ? s.day : dayNumber({ current: s.current, resets: s.resets ?? 0, setup: s.setup })
}

/**
 * When the clean-day check-in can be done (MN3, H2): from 19:00 (until the day
 * turns at 04:00) it is for today; in the morning (until 12:00) for yesterday,
 * if yesterday wasn't checked in or reset; otherwise it waits for 19:00.
 */
export function checkInWindow(events: DisciplineEvent[], appToday: string, hour: number): { mode: 'today' | 'yesterday' | 'wait'; day: string } {
  if (hour >= 19 || hour < 4) return { mode: 'today', day: appToday }
  const yesterday = addDays(appToday, -1)
  const start = startOf(events)
  const open = hour < 12 && !!start && yesterday >= start.day && !events.some((e) => (e.kind === 'checkin' || e.kind === 'reset') && e.day === yesterday)
  return open ? { mode: 'yesterday', day: yesterday } : { mode: 'wait', day: appToday }
}

export interface DisciplineMark {
  day: string
  kind: DisciplineKind
  /** Local hour of the event, 0–23. */
  hour: number
}

/**
 * Honest charts (MN25) from what really happened: the last `weeks` weeks as
 * days (clean = a check-in, reset, or nothing logged), and urges by time of
 * day. Days before the start date are 'before'.
 */
export function disciplineCharts(marks: DisciplineMark[], today: string, start: string | null, weeks = 12) {
  const byDay = new Map<string, Set<DisciplineKind>>()
  for (const m of marks) {
    const s = byDay.get(m.day) ?? new Set<DisciplineKind>()
    s.add(m.kind)
    byDay.set(m.day, s)
  }
  const n = weeks * 7
  const days = Array.from({ length: n }, (_, i) => {
    const day = addDays(today, i - n + 1)
    const k = byDay.get(day)
    const state: 'before' | 'reset' | 'clean' | 'none' = !start || day < start ? 'before' : k?.has('reset') ? 'reset' : k?.has('checkin') ? 'clean' : 'none'
    return { day, state, urges: marks.filter((m) => m.day === day && m.kind === 'urge').length }
  })
  const slots = [
    { label: 'Night (0–6)', from: 0, to: 6 },
    { label: 'Morning (6–12)', from: 6, to: 12 },
    { label: 'Afternoon (12–18)', from: 12, to: 18 },
    { label: 'Evening (18–24)', from: 18, to: 24 }
  ]
  const urges = marks.filter((m) => m.kind === 'urge')
  const byTime = slots.map((s) => ({ label: s.label, count: urges.filter((u) => u.hour >= s.from && u.hour < s.to).length }))
  return { days, byTime, urges: urges.length, logged: days.filter((d) => d.state === 'clean').length }
}

/** A reset can be taken back for 10 minutes (MN7): a test or a wrong tap. */
export const RESET_UNDO_MINUTES = 10
export function resetUndoable(events: DisciplineEvent[], today: string, now: Date): DisciplineEvent | null {
  const r = [...events].reverse().find((e) => e.kind === 'reset')
  if (!r || r.day !== today) return null
  return now.getTime() - Date.parse(r.ts) <= RESET_UNDO_MINUTES * 60_000 ? r : null
}
