// The 3 daily numbers and the honest day score (feature freeze, 2026-11-11).
// Pure and tested (threeNumbers.test.ts). Everything that shows a day score
// (Today, the island, Ben's evening review on Telegram) uses `honestScore`.
//
//   1. Sleep: asleep by 23:30 and up by 06:45, 5 min grace (last night's sleep_logs row; core/sleep.ts).
//   2. Focus blocks started today (focus_sessions, plus one running now).
//   3. Exactly 3 must-dos (day_plans): done out of 3.
//
//   score = sleep 34 (17 asleep on time + 17 up on time)
//         + focus 33 × min(blocks, 3) / 3
//         + must-dos 33 × min(done, 3) / 3   (0 when the day has no must-dos)
//
// An empty day (no sleep logged, no focus, no must-dos) scores 0, never 96.
// The score pays no points; past days keep the score they were given.

import { BED_BY, isBedOnTime, isWakeOnTime, ON_TIME_GRACE_MIN, UP_BY } from './sleep'
// One meaning of "on time" (core/sleep.ts): the same targets and 5-minute grace as points.
export { BED_BY, ON_TIME_GRACE_MIN, UP_BY }
export const MUST_DOS = 3
export const FOCUS_GOAL = 3
export const WEIGHTS = { bed: 17, up: 17, focus: 33, must: 33 } as const

export interface SleepNight {
  /** "HH:mm" or null when not logged. */
  bedTime: string | null
  wakeTime: string | null
  /** The targets the night was judged by when logged (the row's own); missing: 23:30 / 06:45. */
  bedTarget?: string | null
  wakeTarget?: string | null
}

export interface ThreeFacts {
  /** Last night (the row of the morning it ended in), or null. */
  sleep: SleepNight | null
  /** Focus blocks started today (finished sessions plus a running one). */
  focusBlocks: number
  mustDone: number
  mustTotal: number
}

const hm = (s: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? h * 60 + min : null
}

/**
 * Asleep by 23:30 (plus the 5-minute grace): a bedtime from noon to 23:35 is on
 * time; later (after midnight too) is late. Null when not logged.
 */
export function bedOnTime(bed: string | null | undefined, by: string | null | undefined = BED_BY): boolean | null {
  if (hm(bed) == null) return null
  return isBedOnTime(bed!.trim(), by && hm(by) != null ? by : BED_BY)
}

/** Up by 06:45 (plus the 5-minute grace): a wake-up from 03:00 to 06:50 is on time. Null when not logged. */
export function upOnTime(wake: string | null | undefined, by: string | null | undefined = UP_BY): boolean | null {
  const w = hm(wake)
  if (w == null) return null
  return isWakeOnTime(wake!.trim(), by && hm(by) != null ? by : UP_BY)
}

export interface SleepCheck {
  bedOk: boolean | null
  upOk: boolean | null
  /** Both on time. */
  met: boolean
  /** "Asleep 23:10 ✓ · up 07:20 ✗" or "Not logged". */
  text: string
}

export function sleepCheck(n: SleepNight | null): SleepCheck {
  const bedOk = bedOnTime(n?.bedTime, n?.bedTarget)
  const upOk = upOnTime(n?.wakeTime, n?.wakeTarget)
  const part = (label: string, t: string | null | undefined, ok: boolean | null) => (ok == null ? `${label} not logged` : `${label} ${t} ${ok ? '✓' : '✗'}`)
  const text = bedOk == null && upOk == null ? 'Not logged' : `${part('Asleep', n?.bedTime, bedOk)} · ${part('up', n?.wakeTime, upOk)}`
  return { bedOk, upOk, met: bedOk === true && upOk === true, text }
}

export interface HonestScore {
  score: number
  parts: { sleep: number; focus: number; must: number }
}

export function honestScore(f: ThreeFacts): HonestScore {
  const s = sleepCheck(f.sleep)
  const sleep = (s.bedOk ? WEIGHTS.bed : 0) + (s.upOk ? WEIGHTS.up : 0)
  const blocks = Math.max(0, Math.floor(Number(f.focusBlocks) || 0))
  const focus = (WEIGHTS.focus * Math.min(blocks, FOCUS_GOAL)) / FOCUS_GOAL
  const total = Math.max(0, Math.floor(Number(f.mustTotal) || 0))
  const done = Math.max(0, Math.min(total, Math.floor(Number(f.mustDone) || 0)))
  // Done out of 3, never out of fewer: 1 of 1 is still 1 of 3. No must-dos: 0.
  const must = total ? (WEIGHTS.must * Math.min(done, MUST_DOS)) / MUST_DOS : 0
  const score = Math.max(0, Math.min(100, Math.round(sleep + focus + must)))
  return { score, parts: { sleep, focus: Math.round(focus), must: Math.round(must) } }
}

/** Focus blocks started on `day`: sessions whose start is that day, plus a running one. */
export function focusBlocksStarted(sessions: { startedAt?: string | null }[], running: boolean): number {
  return sessions.filter((s) => !!s.startedAt).length + (running ? 1 : 0)
}

/** "2 of 3 done" (the same words on Today, the island and Telegram). */
export function mustLine(done: number, total: number): string {
  if (!total) return 'No must-dos yet'
  return `${Math.min(done, MUST_DOS)} of ${MUST_DOS} done`
}

/** One line with the 3 numbers, neutral and private (safe for a lock screen). */
export function threeLine(f: ThreeFacts): string {
  const s = sleepCheck(f.sleep)
  const sleep = s.bedOk == null && s.upOk == null ? 'sleep not logged' : s.met ? 'sleep on time' : 'sleep off target'
  return `${sleep} · ${f.focusBlocks} focus block${f.focusBlocks === 1 ? '' : 's'} · ${mustLine(f.mustDone, f.mustTotal).toLowerCase()}`
}

export interface WeekDay extends ThreeFacts {
  day: string
}

/** Sunday's summary of the week's 3 numbers (plain text, no personal details). */
export function weekSummaryText(days: WeekDay[]): string {
  const n = days.length || 1
  const sleepOk = days.filter((d) => sleepCheck(d.sleep).met).length
  const blocks = days.reduce((t, d) => t + Math.max(0, d.focusBlocks), 0)
  const mustDone = days.reduce((t, d) => t + Math.min(MUST_DOS, Math.max(0, d.mustDone)), 0)
  const avg = Math.round(days.reduce((t, d) => t + honestScore(d).score, 0) / n)
  return [
    'Life System: your week',
    `Sleep on time: ${sleepOk} of ${days.length} nights`,
    `Focus blocks started: ${blocks}`,
    `Must-dos done: ${mustDone} of ${days.length * MUST_DOS}`,
    `Average day score: ${avg}/100`
  ].join('\n')
}
