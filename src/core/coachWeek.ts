// The coach's weekly review (Sunday, reachable any time): what the week was,
// and the decisions to confirm with one tap through the existing mechanisms
// (the calorie check, the roadmap's level-up, the lighter week). The safety
// rules gate every calorie change. Saved in the synced setting coach_weeks.
// Pure: the numbers come in, nothing is read here.
import { addDays } from './dates'
import type { AdjustCheck } from './foodAdjust'
import type { WeekRow } from './bodyComp'
import { KCAL_FLOOR, LOW_KCAL, addOnsFor, safeKcalChange, weightRising } from './coachSafety'

export interface WeekInput {
  /** Monday of the week reviewed. */
  week: string
  /** Weekly averages, oldest first, ending with the reviewed week. */
  weights: WeekRow[]
  /** Waist change in about 2 weeks (cm), null: not known. */
  waist: number | null
  /** Logged food per day of the week (days with a log). */
  food: { day: string; kcal: number; protein: number }[]
  sessions: { done: number; planned: number }
  /** Moves reached this week ("Archer push-ups"). */
  levelUps: string[]
  /** Ladders ready to move up now (the roadmap's rule). */
  ready: { ladder: string; index: number; name: string }[]
  checkins: { energy: number; soreness: number; sleep?: number | null }[]
  /** The calorie check now (core/foodAdjust.ts). */
  adjust: AdjustCheck
  /** Today's food goal (kcal). */
  target: number
  /** The tired warning is on (strength down or every set hard). */
  tired: boolean
  lighterOn: boolean
  /** Week number since the coach started, null: not started. */
  weekNo: number | null
}

export type DecisionKind = 'kcal' | 'level' | 'lighter'
export interface Decision {
  id: string
  kind: DecisionKind
  title: string
  why: string
  /** kcal: the change; level: the new level index. */
  delta?: number
  ladder?: string
  index?: number
}

export interface WeekReview {
  week: string
  stats: {
    avg: number | null
    change: number | null
    waist: number | null
    kcal: number | null
    protein: number | null
    foodDays: number
    sessions: { done: number; planned: number }
    levelUps: string[]
    energy: number | null
    soreness: number | null
    /** Average hours slept from the check-ins (null without any). */
    sleep?: number | null
  }
  decisions: Decision[]
  /** Calm notes (no decision): a cut that the rules held back, low intake. */
  notes: string[]
  summary: string
}

const r1 = (n: number) => Math.round(n * 10) / 10
const r2 = (n: number) => Math.round(n * 100) / 100
const avgOf = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null)
const kgText = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(r1(n)).toFixed(1)} kg`

export function weeklyReview(i: WeekInput): WeekReview {
  const cur = i.weights.find((w) => w.week === i.week) ?? null
  const prev = i.weights.find((w) => w.week === addDays(i.week, -7)) ?? null
  const change = cur?.enough && prev?.enough && cur.avg != null && prev.avg != null ? r2(cur.avg - prev.avg) : null
  const kcal = avgOf(i.food.map((f) => f.kcal))
  const protein = avgOf(i.food.map((f) => f.protein))
  const energy = avgOf(i.checkins.map((c) => c.energy))
  const soreness = avgOf(i.checkins.map((c) => c.soreness))
  const sleep = avgOf(i.checkins.map((c) => c.sleep).filter((x): x is number => typeof x === 'number' && x > 0))
  const decisions: Decision[] = []
  const notes: string[] = []

  // Calories: the one weekly check, gated by the floor and "no cut while not rising".
  if (i.adjust.state === 'suggest') {
    const s = i.adjust.suggestion
    const ok = safeKcalChange({ delta: s.delta, target: i.target, rising: weightRising(i.weights) })
    if (ok.delta) decisions.push({ id: 'kcal', kind: 'kcal', title: s.title, why: `${s.why} Idea: ${s.tip}`, delta: s.delta })
    else if (ok.why) notes.push(ok.why)
  }
  if (kcal != null && kcal < LOW_KCAL && i.food.length >= 3) notes.push(`You ate about ${Math.round(kcal).toLocaleString('en-US')} kcal a day. Easy wins: ${addOnsFor(KCAL_FLOOR - kcal).map((a) => a.label).join(', ')}.`)

  // Level ups: the roadmap's own rule (every working set at the top, 2 sessions in a row).
  for (const r of i.ready) decisions.push({ id: `level:${r.ladder}`, kind: 'level', title: `Move up to ${r.name}`, why: 'Every set was at the top of the range twice in a row.', ladder: r.ladder, index: r.index })

  // A lighter week: strength down or every set hard, or very sore all week.
  if (!i.lighterOn && (i.tired || (soreness != null && soreness >= 4 && i.checkins.length >= 3)))
    decisions.push({ id: 'lighter', kind: 'lighter', title: 'Lighter week (70%)', why: i.tired ? 'Your reps went down or every set felt hard. A lighter week lets you come back stronger.' : 'You felt very sore most days. A lighter week helps you recover.' })

  return {
    week: i.week,
    stats: { avg: cur?.avg ?? null, change, waist: i.waist, kcal: kcal == null ? null : Math.round(kcal), protein: protein == null ? null : Math.round(protein), foodDays: i.food.length, sessions: i.sessions, levelUps: i.levelUps, energy: energy == null ? null : r1(energy), soreness: soreness == null ? null : r1(soreness), sleep: sleep == null ? null : r1(sleep) },
    decisions,
    notes,
    summary: summaryLine(i, change)
  }
}

/** "Week 3: +0.3 kg, 5/5 workouts, archer push-ups unlocked. Keep going." Never a put-down. */
export function summaryLine(i: Pick<WeekInput, 'weekNo' | 'sessions' | 'levelUps'>, change: number | null): string {
  const parts: string[] = []
  if (change != null) parts.push(change >= 0.1 ? kgText(change) : change > -0.1 ? 'weight steady' : `${kgText(change)} (eat a bit more)`)
  parts.push(`${i.sessions.done}/${i.sessions.planned} workouts`)
  if (i.levelUps.length) parts.push(`${i.levelUps.map((x) => x.toLowerCase()).join(' and ')} unlocked`)
  const head = i.weekNo ? `Week ${i.weekNo}` : 'This week'
  const end = i.sessions.done >= i.sessions.planned && i.sessions.planned > 0 ? 'Keep going.' : 'Next week: one more session.'
  return `${head}: ${parts.join(', ')}. ${end}`
}

// ---------- the store (synced setting coach_weeks) ----------

export interface CoachWeekRecord {
  summary: string
  applied: Record<string, number>
  skipped: Record<string, number>
  at: number
}
export interface CoachWeeks {
  v: 1
  weeks: Record<string, CoachWeekRecord>
}
export const WEEKS_KEEP = 26

export function cleanWeeks(raw: unknown): CoachWeeks {
  const o = (raw && typeof raw === 'object' ? raw : {}) as any
  const keys = Object.keys(o.weeks ?? {})
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort()
    .slice(-WEEKS_KEEP)
  const ids = (x: any) => Object.fromEntries(Object.entries(x && typeof x === 'object' ? x : {}).filter(([k, v]) => /^[\w:-]{1,40}$/.test(k) && Number(v) > 0).map(([k, v]) => [k, Number(v)]))
  const weeks: Record<string, CoachWeekRecord> = {}
  for (const k of keys) {
    const w = o.weeks[k]
    weeks[k] = { summary: String(w?.summary ?? '').slice(0, 300), applied: ids(w?.applied), skipped: ids(w?.skipped), at: Number(w?.at) || 0 }
  }
  return { v: 1, weeks }
}

/** A decision answered (applied or skipped), with the week's summary kept. */
export function answerDecision(w: CoachWeeks, review: Pick<WeekReview, 'week' | 'summary'>, id: string, applied: boolean, now: number): CoachWeeks {
  const rec = w.weeks[review.week] ?? { summary: review.summary, applied: {}, skipped: {}, at: now }
  const next: CoachWeekRecord = { ...rec, summary: review.summary, at: now, applied: { ...rec.applied }, skipped: { ...rec.skipped } }
  if (applied) next.applied[id] = now
  else next.skipped[id] = now
  return cleanWeeks({ v: 1, weeks: { ...w.weeks, [review.week]: next } })
}

/** The decisions still open for a week (not applied or skipped). */
export const openDecisions = (w: CoachWeeks, review: WeekReview) => review.decisions.filter((d) => !w.weeks[review.week]?.applied[d.id] && !w.weeks[review.week]?.skipped[d.id])

/** The week the review looks at: Sunday → this week; Monday → last week; other days this week so far. */
export const reviewWeek = (today: string) => {
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7
  const monday = addDays(today, -dow)
  return dow === 0 ? addDays(monday, -7) : monday
}
