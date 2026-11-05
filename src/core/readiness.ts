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

export interface ReadinessInput { sleptMin: number | null; soreness: number | null; quality?: number | null }
export interface Readiness { kind: 'full' | 'light' | 'rest'; score: number; why: string }

export function readiness(i: ReadinessInput): Readiness {
  let score = 100
  const why: string[] = []
  if (i.sleptMin != null) {
    const h = i.sleptMin / 60
    if (h < 5.5) (score -= 40), why.push(`only ${h.toFixed(1)} h of sleep`)
    else if (h < 6.5) (score -= 25), why.push(`${h.toFixed(1)} h of sleep`)
    else if (h < 7) (score -= 10), why.push(`${h.toFixed(1)} h of sleep`)
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
