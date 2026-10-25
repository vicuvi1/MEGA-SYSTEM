// Tasks and schedule blocks: when they happen and what counts as done.
import { addDays } from './dates'
import { LedgerError } from './ledger'

export const DEFAULT_CATEGORIES = [
  { id: 'body', label: 'Body', color: '#FF6B8B' },
  { id: 'face', label: 'Face', color: '#F9A8D4' },
  { id: 'finance', label: 'Finance', color: '#F5C84B' },
  { id: 'university', label: 'University', color: '#7CC4FF' },
  { id: 'life', label: 'Life', color: '#C8F135' }
] as const

/** Weekday bitmask: Monday = 1, Tuesday = 2 ... Sunday = 64. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export const EVERY_DAY = 0b1111111
export const WORK_DAYS = 0b0011111

export function weekdayIndex(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

export function onWeekday(mask: number, day: string): boolean {
  return (mask & (1 << weekdayIndex(day))) !== 0
}

// ---------------- Tasks ----------------

export type Repeat = 'none' | 'daily' | 'weekly'

export interface Task {
  id: number
  title: string
  category: string
  coins: number
  xp: number
  priority: 1 | 2 | 3 // 1 = high
  due: string | null
  repeat: Repeat
  weekdays: number
  notes: string | null
  createdDay: string
}

/** Max coins one task can pay, and max coins from all tasks per day. */
export const TASK_MAX_COINS = 30
export const TASK_MAX_XP = 60
export const TASKS_DAILY_COIN_CAP = 150

export function validateTask(t: Omit<Task, 'id' | 'createdDay'>): void {
  if (!t.title.trim()) throw new LedgerError('A task needs a title')
  if (!Number.isInteger(t.coins) || t.coins < 0 || t.coins > TASK_MAX_COINS) throw new LedgerError(`Coins must be 0 to ${TASK_MAX_COINS}`)
  if (!Number.isInteger(t.xp) || t.xp < 0 || t.xp > TASK_MAX_XP) throw new LedgerError(`XP must be 0 to ${TASK_MAX_XP}`)
  if (![1, 2, 3].includes(t.priority)) throw new LedgerError('Priority must be high, normal or low')
  if (!['none', 'daily', 'weekly'].includes(t.repeat)) throw new LedgerError('Unknown repeat')
  if (t.repeat === 'weekly' && !(t.weekdays & EVERY_DAY)) throw new LedgerError('Pick at least one weekday')
  if (t.due && !/^\d{4}-\d{2}-\d{2}$/.test(t.due)) throw new LedgerError('Due date must be YYYY-MM-DD')
}

/**
 * Does the task show up on `day`? One-off tasks show from creation until
 * done; repeating ones on their days.
 */
export function taskOn(t: Task, day: string, doneDays: Set<string>): boolean {
  if (day < t.createdDay) return false
  if (t.repeat === 'daily') return true
  if (t.repeat === 'weekly') return onWeekday(t.weekdays, day)
  const doneOn = [...doneDays].sort()[0]
  return doneOn ? doneOn === day : true
}

/** The day a completion is recorded under: one-offs finish once, repeats once per day. */
export function alreadyDone(t: Task, day: string, doneDays: Set<string>): boolean {
  return t.repeat === 'none' ? doneDays.size > 0 : doneDays.has(day)
}

export function isOverdue(t: Task, day: string, doneDays: Set<string>): boolean {
  return t.repeat === 'none' && !!t.due && t.due < day && doneDays.size === 0
}

export function planTaskComplete(t: Task, day: string, doneDays: Set<string>, coinsFromTasksToday: number): { coins: number; xp: number } {
  if (alreadyDone(t, day, doneDays)) throw new LedgerError('Already done')
  if (t.repeat !== 'none' && !taskOn(t, day, doneDays)) throw new LedgerError('This task is not scheduled today')
  const room = Math.max(0, TASKS_DAILY_COIN_CAP - coinsFromTasksToday)
  // Over the daily cap the task still counts and gives XP, just no more coins.
  return { coins: Math.min(t.coins, room), xp: t.xp }
}

/** High priority first, then overdue, then by due date, then title. */
export function sortTasks<T extends Pick<Task, 'priority' | 'due' | 'title'> & { done: boolean }>(list: T[]): T[] {
  return list.slice().sort((a, b) =>
    Number(a.done) - Number(b.done) ||
    a.priority - b.priority ||
    (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
    a.title.localeCompare(b.title)
  )
}

// ---------------- Schedule blocks ----------------

export type BlockKind = 'study' | 'workout' | 'other'
export type BlockStatus = 'pending' | 'running' | 'done' | 'skipped' | 'missed'

export interface Block {
  id: number
  title: string
  kind: BlockKind
  start: string // HH:MM
  minutes: number
  weekdays: number // repeating blocks
  date: string | null // a one-off block on this day
  remindMin: number
  createdDay: string
}

/** Which rule a block pays out through when finished or skipped. */
export const BLOCK_RULES: Record<BlockKind, { done: string | null; skipped: string | null }> = {
  study: { done: 'study.block_done', skipped: 'study.block_skipped' },
  workout: { done: 'body.workout_done', skipped: null },
  other: { done: null, skipped: null }
}

/** A block must run for this share of its length before it can be finished. */
export const FINISH_SHARE = 0.8

export function validateBlock(b: Omit<Block, 'id' | 'createdDay'>): void {
  if (!b.title.trim()) throw new LedgerError('A block needs a title')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start)) throw new LedgerError('Start must be HH:MM')
  if (!Number.isInteger(b.minutes) || b.minutes < 5 || b.minutes > 600) throw new LedgerError('Length must be 5 to 600 minutes')
  if (!(b.kind in BLOCK_RULES)) throw new LedgerError('Unknown block type')
  if (!b.date && !(b.weekdays & EVERY_DAY)) throw new LedgerError('Pick weekdays or a date')
  if (!Number.isInteger(b.remindMin) || b.remindMin < 0 || b.remindMin > 120) throw new LedgerError('Reminder must be 0 to 120 minutes')
}

export function blockOn(b: Block, day: string): boolean {
  if (day < b.createdDay && !b.date) return false
  return b.date ? b.date === day : onWeekday(b.weekdays, day)
}

export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Earliest instant a running block may be finished. */
export function finishAllowedAt(startedAt: string, minutes: number): Date {
  return new Date(Date.parse(startedAt) + Math.round(minutes * FINISH_SHARE) * 60_000)
}

export function planFinish(status: BlockStatus, startedAt: string | null, minutes: number, now: Date): void {
  if (status === 'done' || status === 'skipped' || status === 'missed') throw new LedgerError('This block is already closed')
  if (status !== 'running' || !startedAt) throw new LedgerError('Start the focus timer first')
  const at = finishAllowedAt(startedAt, minutes)
  if (now < at) {
    const left = Math.ceil((at.getTime() - now.getTime()) / 60_000)
    throw new LedgerError(`Keep going: ${left} more min before this block counts`)
  }
}

export function planSkip(status: BlockStatus): void {
  if (status === 'done' || status === 'skipped' || status === 'missed') throw new LedgerError('This block is already closed')
}

export interface ReminderBlock {
  id: number
  day: string
  title: string
  kind: BlockKind
  status: BlockStatus
  remindMin: number
  startsAt: string
}

/**
 * Reminders due at `now`: one `remindMin` before the start and one at the
 * start if the block hasn't been started. `sent` holds keys already shown.
 * A reminder more than 10 minutes late is dropped (e.g. the PC was asleep).
 */
export function dueReminders(blocks: ReminderBlock[], now: Date, sent: Set<string>): { key: string; title: string; body: string }[] {
  const out: { key: string; title: string; body: string }[] = []
  const LATE_MS = 10 * 60_000
  for (const b of blocks) {
    if (b.status !== 'pending') continue
    const start = Date.parse(b.startsAt)
    const pay = b.kind === 'study' ? ' Finish it for +coins, skipping costs a few.' : ''
    const marks = [
      { key: `${b.id}:${b.day}:pre`, at: start - b.remindMin * 60_000, title: `${b.title} in ${b.remindMin} min`, body: `Get ready.${pay}`, on: b.remindMin > 0 },
      { key: `${b.id}:${b.day}:start`, at: start, title: `${b.title} starts now`, body: `Open Life System and start the timer.${pay}`, on: true }
    ]
    for (const m of marks) {
      if (!m.on || sent.has(m.key)) continue
      const t = now.getTime()
      if (t >= m.at && t - m.at <= LATE_MS) out.push({ key: m.key, title: m.title, body: m.body })
    }
  }
  return out
}

/**
 * Study blocks from past days that were never closed. They count as missed
 * (with the skip penalty), so ignoring a block isn't a way around it.
 */
export function blocksToMiss(blocks: Block[], closed: Set<string>, today: string, lookbackDays = 7): { block: Block; day: string }[] {
  const out: { block: Block; day: string }[] = []
  for (let i = lookbackDays; i >= 1; i--) {
    const day = addDays(today, -i)
    for (const b of blocks) {
      if (b.kind !== 'study' || day < b.createdDay || !blockOn(b, day)) continue
      if (!closed.has(`${b.id}:${day}`)) out.push({ block: b, day })
    }
  }
  return out
}
