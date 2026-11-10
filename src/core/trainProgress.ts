// Sport Track → Progress and Exercises, as pure data (docs/design/sport-track/
// Progress.dc.html and Exercises.dc.html): path progress (a segmented bar per
// chain, the current step partly filled by its real unlock progress, the unlock
// checks with real values), the period KPIs, the strength-over-time points with
// the step-ups marked, personal records, and the step cards of one chain.
// Everything comes from the workouts you logged (trainLog); nothing is made up
// and nothing here pays points. Tested in trainProgress.test.ts.
import { requirementsOf, type Requirement } from './sportTrain'
import { currentLevel, sessionItems, trainOf, type TrainData } from './trainLog'
import { allowed, effectiveLevel, stepFrom } from './trainGear'
import { moveInfo, moveName, rangeText, type Ladder, type LadderId } from './trainLadders'
import { SHORT_DAYS, dowOf, daysBetween } from './trainWeek'
import { shiftDay } from './sportSets'

export const PERIODS = [
  { id: 'week', label: 'Week', days: 7 },
  { id: '4w', label: '4 weeks', days: 28 },
  { id: '12w', label: '12 weeks', days: 84 }
] as const
export type ProgressPeriod = (typeof PERIODS)[number]['id']

const chainName = (n: string) => n.replace(/ \(.*\)$/, '')
/** The names the design uses for each chain. */
export const PATH_NAME: Record<LadderId, string> = { push: 'Push', pull: 'Pull', shoulders: 'Shoulders', single: 'Legs', hinge: 'Hinge', core: 'Core' }
export const PATH_MUSCLES: Record<LadderId, string> = { push: 'Chest, shoulders, triceps', pull: 'Back, biceps, grip', shoulders: 'Shoulders, triceps, core', single: 'Quads and glutes, one leg at a time', hinge: 'Hamstrings and glutes', core: 'Abs and the middle of the body' }

// ---------------------------------------------------------------- path progress

export interface PathSeg {
  label: string
  /** 0–1: mastered steps are 1, your step is its unlock progress, later steps 0. */
  fill: number
  state: 'done' | 'current' | 'later'
}

export interface PathRow {
  ladder: LadderId
  name: string
  /** Your step (1-based) and how many steps the chain has. */
  step: number
  of: number
  move: string
  moveName: string
  /** The next step your gear allows (null: the top). */
  next: string | null
  segs: PathSeg[]
  /** 0–100, how close you are to the next step. */
  pct: number
  first: string
  last: string
  /** What unlocks the next step, with your real values. */
  checks: Requirement[]
  /** A stand-in for your gear: it has no steps of its own to show. */
  stand: boolean
  /** Not started on this step yet (no sessions). */
  fresh: boolean
}

/** Every chain's progress bar with your gear and your steps (one-day picks ignored). */
export function pathProgress(st: any, today: string): PathRow[] {
  const probe = { ...(st ?? {}), trainPicks: null }
  const data = trainOf(probe)
  const rows: PathRow[] = []
  for (const type of ['upper', 'legs'] as const)
    for (const it of sessionItems(probe, data, type, today)) {
      const l = it.ladder
      const stand = it.alt
      const at = stand ? -1 : it.index
      const nextAt = stand ? null : stepFrom(l, it.index + 1, 1, data.gear)
      const complete = it.status.state === 'complete'
      const frac = nextAt == null ? 1 : complete ? 1 : it.status.pct
      rows.push({
        ladder: l.id,
        name: PATH_NAME[l.id] ?? chainName(l.name),
        step: stand ? 0 : at + 1,
        of: l.levels.length,
        move: it.level.move,
        moveName: it.name,
        next: nextAt == null ? null : moveName(l.levels[nextAt].move),
        segs: l.levels.map((v, i) => ({
          label: `Step ${i + 1}: ${moveName(v.move)}`,
          fill: stand ? 0 : i < at ? 1 : i === at ? frac : 0,
          state: !stand && i < at ? 'done' : !stand && i === at ? 'current' : 'later'
        })),
        pct: Math.round(frac * 100),
        first: moveName(l.levels[0].move),
        last: moveName(l.levels[l.levels.length - 1].move),
        checks: requirementsOf(it).filter((r) => r.id !== 'form'),
        stand,
        fresh: it.status.state === 'new'
      })
    }
  const order: LadderId[] = ['push', 'pull', 'shoulders', 'single', 'hinge', 'core']
  return rows.sort((a, b) => order.indexOf(a.ladder) - order.indexOf(b.ladder))
}

// ---------------------------------------------------------------- the step cards (Exercises)

export type StepState = 'done' | 'now' | 'next' | 'locked'
export interface StepCard {
  /** Index on the chain. */
  index: number
  n: number
  move: string
  name: string
  range: string
  state: StepState
  /** "Mastered", "You are here", "Next · 1 session to go", "Locked". */
  text: string
  /** Gear you don't own rules this step out of your plan (shown, but not usable). */
  gear: boolean
}
export interface PathView {
  ladder: Ladder
  id: LadderId
  name: string
  muscles: string
  step: number
  of: number
  cards: StepCard[]
  /** The step the plan really uses (your step, or the nearest your gear allows). */
  nowIndex: number
}

/** "1 session to go" / "2 sessions to go" for the step after yours. */
const toGo = (it: { status: { need: number; hits: number } }) => {
  const left = Math.max(0, it.status.need - it.status.hits)
  return left ? `${left} ${left === 1 ? 'session' : 'sessions'} to go` : 'unlocked'
}

/** Every chain as step cards, for the Exercises section. */
export function pathViews(st: any, today: string): PathView[] {
  const probe = { ...(st ?? {}), trainPicks: null }
  const data = trainOf(probe)
  const items = new Map<LadderId, ReturnType<typeof sessionItems>[number]>()
  for (const type of ['upper', 'legs'] as const) for (const it of sessionItems(probe, data, type, today)) items.set(it.ladder.id, it)
  const order: LadderId[] = ['push', 'pull', 'shoulders', 'single', 'hinge', 'core']
  return order
    .map((id) => {
      const l = data.ladders.find((x) => x.id === id)
      const it = items.get(id)
      if (!l || !it) return null
      const eff = effectiveLevel(l, currentLevel(probe, data, l, today).index, data.gear)
      const nowAt = it.alt ? -1 : it.index
      const nextAt = it.alt ? null : stepFrom(l, nowAt + 1, 1, data.gear)
      const cards: StepCard[] = l.levels.map((v, i) => {
        const ok = allowed(v.move, data.gear)
        const state: StepState = i === nowAt ? 'now' : i < nowAt ? 'done' : i === nextAt ? 'next' : 'locked'
        const text = state === 'now' ? 'You are here' : state === 'done' ? 'Mastered' : state === 'next' ? `Next · ${toGo(it)}` : 'Locked'
        return { index: i, n: i + 1, move: v.move, name: moveName(v.move), range: rangeText(v), state, text, gear: !ok }
      })
      return { ladder: l, id, name: PATH_NAME[id] ?? chainName(l.name), muscles: PATH_MUSCLES[id] ?? '', step: nowAt + 1, of: l.levels.length, cards, nowIndex: eff.index } as PathView
    })
    .filter((x): x is PathView => !!x)
}

export interface MoveBest {
  reps: number
  /** Weekday short name of the day, e.g. "Tue". */
  when: string
  day: string
  /** Workouts that included this move. */
  sessions: number
  unit: 'reps' | 'sec'
}

/** Your best set of a move from the workouts logged in trainLog (null: never done). */
export function moveBest(data: TrainData, move: string): MoveBest | null {
  let best: MoveBest | null = null
  let sessions = 0
  const unit = moveInfo(move)?.unit ?? 'reps'
  for (const s of [...data.log].sort((a, b) => a.date.localeCompare(b.date))) {
    let did = false
    for (const e of s.exercises) {
      if (e.move !== move) continue
      for (const x of e.sets) {
        did = true
        if (!best || x.reps >= best.reps) best = { reps: x.reps, when: SHORT_DAYS[dowOf(s.date)], day: s.date, sessions: 0, unit }
      }
    }
    if (did) sessions++
  }
  return best ? { ...best, sessions } : null
}

export const repsText = (n: number, unit: 'reps' | 'sec') => (unit === 'sec' ? (n >= 60 ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : `${n} s`) : `${n} ${n === 1 ? 'rep' : 'reps'}`)

// ---------------------------------------------------------------- personal records

export interface RecordRow {
  move: string
  name: string
  best: string
  when: string
  day: string
  /** "+3" over your best before it; "new" for the first time. */
  change: string
}

/** The moves where you set a new best most recently (at most `max`). Needs a workout in the log. */
export function personalRecords(st: any, max = 6): RecordRow[] {
  const data = trainOf(st)
  const sessions = [...data.log].filter((s) => s.exercises.some((e) => e.sets.length)).sort((a, b) => a.date.localeCompare(b.date))
  const byMove = new Map<string, { day: string; reps: number; prev: number }[]>()
  const top = new Map<string, number>()
  for (const s of sessions) {
    const dayBest = new Map<string, number>()
    for (const e of s.exercises) for (const x of e.sets) dayBest.set(e.move, Math.max(dayBest.get(e.move) ?? 0, x.reps))
    for (const [move, reps] of dayBest) {
      const was = top.get(move) ?? 0
      if (reps > was) {
        const l = byMove.get(move) ?? []
        l.push({ day: s.date, reps, prev: was })
        byMove.set(move, l)
        top.set(move, reps)
      }
    }
  }
  const rows: RecordRow[] = []
  for (const [move, list] of byMove) {
    const last = list[list.length - 1]
    const unit = moveInfo(move)?.unit ?? 'reps'
    const diff = last.reps - last.prev
    rows.push({
      move,
      name: moveName(move),
      best: repsText(last.reps, unit),
      when: SHORT_DAYS[dowOf(last.day)],
      day: last.day,
      change: last.prev ? (unit === 'sec' ? `+${diff} s` : `+${diff}`) : 'new'
    })
  }
  return rows.sort((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name)).slice(0, max)
}

// ---------------------------------------------------------------- period KPIs

export interface Kpis {
  from: string
  days: number
  workouts: number
  /** Against the same number of days before. */
  workoutsBefore: number
  hardSets: number
  perWeek: number
  /** Steps reached in the period (not counting where you were placed). */
  unlocked: { day: string; ladder: LadderId; name: string }[]
}

const inRange = (day: string, from: string, to: string) => day >= from && day <= to

/** Steps reached since a day: every `reached` entry except the first of a chain (that is where you were placed). */
export function stepsUnlocked(st: any, from: string, to: string): Kpis['unlocked'] {
  const data = trainOf(st)
  const out: Kpis['unlocked'] = []
  for (const l of data.ladders) {
    const lv = data.levels[l.id]
    if (!lv) continue
    const entries = Object.entries(lv.reached ?? {}).sort((a, b) => a[1].localeCompare(b[1]) || Number(a[0]) - Number(b[0]))
    entries.forEach(([k, day], i) => {
      const at = Number(k)
      // The first entry is where you were placed; a step back is not an unlock.
      if (i === 0 || at <= Number(entries[i - 1][0])) return
      if (inRange(day, from, to) && l.levels[at]) out.push({ day, ladder: l.id, name: moveName(l.levels[at].move) })
    })
  }
  return out.sort((a, b) => a.day.localeCompare(b.day))
}

export function kpisFor(st: any, today: string, days: number): Kpis {
  const data = trainOf(st)
  const from = shiftDay(today, -(days - 1))
  const prevFrom = shiftDay(from, -days)
  const prevTo = shiftDay(from, -1)
  const real = data.log.filter((s) => s.exercises.some((e) => e.sets.length))
  const hard = real.filter((s) => inRange(s.date, from, today)).reduce((n, s) => n + s.exercises.reduce((m, e) => m + e.sets.filter((x) => x.feel !== 'easy').length, 0), 0)
  return {
    from,
    days,
    workouts: real.filter((s) => inRange(s.date, from, today)).length,
    workoutsBefore: real.filter((s) => inRange(s.date, prevFrom, prevTo)).length,
    hardSets: hard,
    perWeek: Math.round(hard / (days / 7)),
    unlocked: stepsUnlocked(st, from, today)
  }
}

/** The first and last weigh-in in a period (null: fewer than two, a week apart). */
export function weightRange(points: { day: string; weight?: number | null; waist?: number | null }[], from: string, to: string, key: 'weight' | 'waist' = 'weight'): { change: number; from: number; to: number } | null {
  const have = points.filter((p) => inRange(p.day, from, to) && p[key] != null)
  if (have.length < 2) return null
  const a = have[0]
  const b = have[have.length - 1]
  if (daysBetween(a.day, b.day) < 6) return null
  const r1 = (n: number) => Math.round(n * 10) / 10
  return { from: r1(a[key] as number), to: r1(b[key] as number), change: r1((b[key] as number) - (a[key] as number)) }
}

// ---------------------------------------------------------------- strength over time

export interface StrengthChart {
  ladder: LadderId
  /** One bucket per week (per day for a week). */
  buckets: { label: string; from: string; to: string; score: number | null }[]
  /** Steps reached in the span, with the bucket they fall in. */
  ups: { bucket: number; name: string; day: string }[]
  /** Points drawn (buckets with a set). */
  hasData: boolean
}

/** One set's strength on a chain: 100 × 1.2^step × (1 + reps / 30); holds count 3 s as a rep (as sportStrength does). */
export const stepScore = (index: number, reps: number, unit: 'reps' | 'sec') => Math.round(100 * Math.pow(1.2, Math.max(0, index)) * (1 + Math.max(0, unit === 'sec' ? reps / 3 : reps) / 30))

/** The best set per week on one chain (steps count: 12 push-ups on step 3 beats 12 on step 2). */
export function strengthChart(st: any, today: string, ladderId: LadderId, period: ProgressPeriod): StrengthChart {
  const data = trainOf(st)
  const l = data.ladders.find((x) => x.id === ladderId)
  const empty: StrengthChart = { ladder: ladderId, buckets: [], ups: [], hasData: false }
  if (!l) return empty
  const buckets: StrengthChart['buckets'] = []
  if (period === 'week') {
    for (let i = 6; i >= 0; i--) {
      const d = shiftDay(today, -i)
      buckets.push({ label: i === 0 ? 'Today' : SHORT_DAYS[dowOf(d)], from: d, to: d, score: null })
    }
  } else {
    const n = period === '4w' ? 4 : 12
    for (let i = n - 1; i >= 0; i--) {
      const to = shiftDay(today, -7 * i)
      buckets.push({ label: i === 0 ? 'Now' : `W${n - i}`, from: shiftDay(to, -6), to, score: null })
    }
  }
  for (const s of data.log)
    for (const e of s.exercises) {
      if (e.ladder !== ladderId) continue
      const at = l.levels.findIndex((v) => v.move === e.move)
      if (at < 0) continue
      const unit = l.levels[at].unit
      for (const x of e.sets) {
        const b = buckets.find((k) => inRange(s.date, k.from, k.to))
        if (!b) continue
        const sc = stepScore(at, x.reps, unit)
        if (b.score == null || sc > b.score) b.score = sc
      }
    }
  const from = buckets[0].from
  const ups = stepsUnlocked(st, from, today)
    .filter((u) => u.ladder === ladderId)
    .map((u) => ({ bucket: Math.max(0, buckets.findIndex((k) => inRange(u.day, k.from, k.to))), name: u.name, day: u.day }))
  return { ladder: ladderId, buckets, ups, hasData: buckets.some((b) => b.score != null) }
}
