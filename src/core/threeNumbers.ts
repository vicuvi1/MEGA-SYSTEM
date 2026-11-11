// The 3 daily numbers and the honest day score (feature freeze, 2026-11-11).
// Pure and tested (threeNumbers.test.ts). Everything that shows a day score
// (Today, the island, Ben's evening review on Telegram) uses `honestScore`.
//
//   1. Sleep: asleep by 23:30 and up by 06:45 (last night's sleep_logs row).
//   2. Focus blocks started today (focus_sessions, plus one running now).
//   3. Exactly 3 must-dos (day_plans): done out of 3.
//
//   score = sleep 34 (17 asleep on time + 17 up on time)
//         + focus 33 × min(blocks, 3) / 3
//         + must-dos 33 × min(done, 3) / 3   (0 when the day has no must-dos)
//
// An empty day (no sleep logged, no focus, no must-dos) scores 0, never 96.
// The score pays no points; past days keep the score they were given.

export const BED_BY = '23:30'
export const UP_BY = '06:45'
export const MUST_DOS = 3
export const FOCUS_GOAL = 3
export const WEIGHTS = { bed: 17, up: 17, focus: 33, must: 33 } as const

export interface SleepNight {
  /** "HH:mm" or null when not logged. */
  bedTime: string | null
  wakeTime: string | null
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
 * Asleep by 23:30: a bedtime from noon to 23:30 is on time; 23:31 to 11:59
 * (after midnight too) is late. Null when not logged.
 */
export function bedOnTime(bed: string | null | undefined, by = BED_BY): boolean | null {
  const b = hm(bed)
  const t = hm(by)
  if (b == null || t == null) return null
  const fromNoon = (m: number) => (m - 720 + 1440) % 1440
  return fromNoon(b) <= fromNoon(t)
}

/** Up by 06:45: a wake-up from 03:00 to 06:45 is on time. Null when not logged. */
export function upOnTime(wake: string | null | undefined, by = UP_BY): boolean | null {
  const w = hm(wake)
  const t = hm(by)
  if (w == null || t == null) return null
  return w >= 180 && w <= t
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
  const bedOk = bedOnTime(n?.bedTime)
  const upOk = upOnTime(n?.wakeTime)
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
