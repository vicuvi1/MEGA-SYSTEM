// Readiness: last night's sleep, how sore you are and how you slept say
// whether today is a full, light or rest day for training (pure).
import type { SleepLog } from './sleep'

/** Hours actually slept that night: bedtime and wake-up on the same morning's row. */
export function nightMinutes(log: Pick<SleepLog, 'bedTime' | 'wakeTime'> | null | undefined): number | null {
  if (!log?.bedTime || !log.wakeTime) return null
  const toM = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  let m = toM(log.wakeTime) - toM(log.bedTime)
  if (m <= 0) m += 1440
  return m >= 120 && m <= 16 * 60 ? m : null
}

export interface ReadinessInput {
  sleptMin: number | null
  soreness: number | null
  quality?: number | null
  /** Your sleep need in minutes (Sleep care), default 8 h: the sleep part is how far under it you slept. */
  needMin?: number | null
}

/** The usual sleep need when none is set. */
export const NEED_MIN_DEFAULT = 480
export interface Readiness { kind: 'full' | 'light' | 'rest'; score: number; why: string }

export function readiness(i: ReadinessInput): Readiness {
  let score = 100
  const why: string[] = []
  if (i.sleptMin != null) {
    const h = i.sleptMin / 60
    // Hours under your need (8 h need: under 5.5 h, 6.5 h and 7 h are the steps).
    const need = Number(i.needMin) >= 300 && Number(i.needMin) <= 720 ? Number(i.needMin) : NEED_MIN_DEFAULT
    const short = (need - i.sleptMin) / 60
    if (short > 2.5) (score -= 40), why.push(`only ${h.toFixed(1)} h of sleep`)
    else if (short > 1.5) (score -= 25), why.push(`${h.toFixed(1)} h of sleep`)
    else if (short > 1) (score -= 10), why.push(`${h.toFixed(1)} h of sleep`)
    else why.push(`${h.toFixed(1)} h of sleep`)
  }
  if (i.soreness != null) {
    if (i.soreness >= 5) (score -= 45), why.push('very sore')
    else if (i.soreness >= 4) (score -= 25), why.push('sore')
    else if (i.soreness <= 2) why.push('fresh')
  }
  if (i.quality != null && i.quality <= 2) (score -= 15), why.push('slept badly')
  score = Math.max(0, Math.min(100, score))
  const kind = score >= 80 ? 'full' : score >= 50 ? 'light' : 'rest'
  const head = kind === 'full' ? 'Go full: train as planned' : kind === 'light' ? 'Go light: half the sets, easy pace' : 'Rest or a walk today'
  return { kind, score, why: why.length ? `${head} (${why.join(', ')})` : head }
}
