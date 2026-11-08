// BD7: training readiness that changes the workout. Last night's sleep (Waky),
// how sore you are (a 1–5 tap) and yesterday's hard sets give today's dose in
// Sport Track: Full, Lighter (70 %) or Short (50 %). You still train every
// planned day, at a dose you can recover from. Under 6 hours of sleep also
// holds progression (same reps as last time, no level-ups). Your own pick for
// today always wins. Pure and tested; builds on core/readiness.ts.
import { readiness } from './readiness'

export type DoseMode = 'full' | 'light' | 'short'

export interface TrainReadyInput {
  sleptMin: number | null
  soreness: number | null
  quality?: number | null
  /** Your sleep need in minutes (Sleep care); default 8 h. */
  needMin?: number | null
  /** Hard sets logged yesterday (all muscles). */
  ydaySets?: number | null
  /** Your pick for today (Full / Lighter / Short in Sport Track or on Body), if any. */
  override?: DoseMode | null
}

export interface TrainReady {
  mode: DoseMode
  /** Share of the plan: 100, 70 or 50. */
  pct: number
  /** Hold progression today (under 6 h of sleep): repeat last time, no level-ups. */
  hold: boolean
  score: number
  /** The plain reasons ("5.2 h of sleep, sore"). */
  why: string
  /** One line for the card. */
  line: string
  /** The mode came from the numbers (false: you picked it). */
  auto: boolean
  /** What the numbers alone say (shown next to your pick). */
  suggested: DoseMode
}

export const DOSE_PCT: Record<DoseMode, number> = { full: 100, light: 70, short: 50 }
export const DOSE_LABEL: Record<DoseMode, string> = { full: 'Full', light: 'Lighter 70%', short: 'Short 50%' }
/** Under this much sleep, progression holds. */
export const HOLD_UNDER_MIN = 360

export function trainReadiness(i: TrainReadyInput): TrainReady {
  const base = readiness({ sleptMin: i.sleptMin, soreness: i.soreness, quality: i.quality, needMin: i.needMin })
  let score = base.score
  const why = (/\(([^)]*)\)/.exec(base.why)?.[1] ?? '').split(', ').filter(Boolean)
  const y = Number(i.ydaySets) || 0
  if (y >= 25) (score -= 25), why.push(`${y} hard sets yesterday`)
  else if (y >= 15) (score -= 10), why.push(`${y} hard sets yesterday`)
  score = Math.max(0, Math.min(100, score))
  const suggested: DoseMode = score >= 80 ? 'full' : score >= 50 ? 'light' : 'short'
  const mode = i.override ?? suggested
  const short = i.sleptMin != null && i.sleptMin < HOLD_UNDER_MIN
  // Your "Full" today also means "push on": then nothing holds.
  const hold = short && i.override !== 'full'
  const reasons = why.join(', ')
  const head = mode === 'full' ? 'Full workout as planned' : mode === 'light' ? 'Lighter day: 70% of the plan, 2 sets each' : 'Short day: half the plan, the main moves only'
  const line = `${head}${reasons ? ` (${reasons})` : ''}${hold ? '. Short night: same reps as last time, no level-ups today.' : '.'}${i.override && i.override !== suggested ? ` You picked it; the numbers say ${DOSE_LABEL[suggested]}.` : ''}`
  return { mode, pct: DOSE_PCT[mode], hold, score, why: reasons, line, auto: !i.override, suggested }
}

/** Minutes of today's workout at this dose (the plan's 20–45 min, never under 15). */
export const doseMinutes = (planMin: number, mode: DoseMode) => Math.max(15, Math.round(((Number(planMin) || 30) * DOSE_PCT[mode]) / 100 / 5) * 5)
