// Best-set onboarding and the weekly strength test (pure, tested). You say how
// many reps you can do in ONE set (push-ups, squats, sit-ups, rows) and how many
// seconds you can plank; every exercise is placed on its ladder so that 5-8 reps
// is hard. Telegram-imported days never count here: level comes from the best
// set. The weekly test logs one max set per main move: it moves levels and the
// chart, and pays no points.
import { FAMILIES, moveById, type Move } from './sportMoves'
import { transferReps } from './sportLevels'
import { shiftDay, type SetLog } from './sportSets'

/** The questions: family, the move the answer is about, and the label. */
export const QUESTIONS: { family: string; move: string; label: string; unit: 'reps' | 'sec'; hint: string }[] = [
  { family: 'pushup', move: 'pushup', label: 'Push-ups', unit: 'reps', hint: 'regular push-ups in one set' },
  { family: 'squat', move: 'squat', label: 'Squats', unit: 'reps', hint: 'bodyweight squats in one set' },
  { family: 'core', move: 'situp', label: 'Sit-ups / abs', unit: 'reps', hint: 'sit-ups in one set' },
  { family: 'row', move: 'table_row_bent', label: 'Rows', unit: 'reps', hint: 'table rows, knees bent (0 if you cannot)' },
  { family: 'plank', move: 'plank', label: 'Plank', unit: 'sec', hint: 'seconds in one plank' }
]

export interface Placed {
  family: string
  /** The move you answered about, and your max there. */
  base: string
  best: number
  /** Where Today starts: the variation, sets × reps (reps or seconds). */
  move: Move
  sets: number
  reps: number
  /** What you could do at most on that variation. */
  max: number
  /** The top of the ladder is still easy: add weight or slow tempo. */
  weighted: boolean
  text: string
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/**
 * The variation where a set of about 9-14 reps is your max, so 4 sets of 5-8
 * are hard (holds: a max near 40 s or more, sets of 30 s or so). 50 push-ups
 * lands on archer push-ups; 20 on wide push-ups.
 */
export function placeBest(family: string, baseMove: string, best: number): Placed | null {
  const steps = FAMILIES[family]?.steps ?? []
  const bi = steps.indexOf(baseMove)
  const n = Math.round(Number(best))
  if (bi < 0 || !Number.isFinite(n) || n < 0) return null
  const hold = moveById(baseMove)?.unit === 'sec'
  const floor = hold ? 40 : 10
  const maxAt = (i: number) => (i >= bi ? transferReps(n, i - bi) : n / Math.pow(0.7, bi - i))
  let pick = 0
  for (let i = 0; i < steps.length; i++) if (maxAt(i) >= floor) pick = i
  // Nobody can place below the easiest step; a 0 answer starts at the bottom.
  const move = moveById(steps[pick])!
  const max = Math.max(1, Math.round(maxAt(pick)))
  const sets = hold ? 3 : 4
  const reps = hold ? clamp(Math.round((max * 0.6) / 5) * 5, 15, 60) : clamp(Math.round(max * 0.6), 5, 8)
  const weighted = pick === steps.length - 1 && maxAt(pick) >= 20
  const u = hold ? ' s' : ''
  return {
    family,
    base: baseMove,
    best: n,
    move,
    sets,
    reps,
    max,
    weighted,
    text: `${n}${u} ${moveById(baseMove)!.name.toLowerCase()} in one set → start on ${move.name.toLowerCase()}, ${sets}×${reps}${u}.${weighted ? ' You are at the top of the ladder: add weight or slow the tempo.' : ''}`
  }
}

/** Place every answered question (blank answers are skipped). */
export function placeAll(answers: Record<string, number | string | null | undefined>): Placed[] {
  const out: Placed[] = []
  for (const q of QUESTIONS) {
    const raw = answers[q.family]
    if (raw == null || raw === '') continue
    const p = placeBest(q.family, q.move, Number(raw))
    if (p) out.push(p)
  }
  return out
}

// ------------------------------------------------------------ the weekly strength test

export const TEST_EVERY_DAYS = 7

/** Days with a test set logged on this exercise (sets flagged `test`). */
export function testDays(log: SetLog | null | undefined): string[] {
  const out = new Set<string>()
  for (const [day, m] of Object.entries(log ?? {})) for (const l of Object.values(m ?? {})) if ((l ?? []).some((s: any) => s?.test)) out.add(day)
  return [...out].sort()
}

/** The weekly test is offered when none was done in the last 7 days and you have trained at all. */
export function testDue(log: SetLog | null | undefined, today: string): boolean {
  if (!Object.keys(log ?? {}).length) return false
  const last = testDays(log).pop()
  return !last || last <= shiftDay(today, -TEST_EVERY_DAYS)
}

export interface BestPoint {
  day: string
  reps: number
  move: string
  score: number
}

/** "X% stronger than N weeks ago" from a family's best-set series (test sets and ordinary sets, never day totals). */
export function strongerThan(series: BestPoint[], today: string): { pct: number; weeks: number } | null {
  if (series.length < 2) return null
  const now = series.filter((p) => p.day >= shiftDay(today, -13)).sort((a, b) => b.score - a.score)[0]
  const first = series[0]
  if (!now || first.day >= now.day) return null
  const weeks = Math.round((Date.parse(now.day) - Date.parse(first.day)) / (7 * 86400000))
  if (weeks < 1) return null
  const then = series.filter((p) => p.day <= shiftDay(first.day, 6)).sort((a, b) => b.score - a.score)[0]
  return { pct: Math.round((now.score / then.score - 1) * 100), weeks }
}
