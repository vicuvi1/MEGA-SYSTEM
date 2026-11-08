// The coach's rules for growing muscle, in code (pure, tested). Every
// suggestion in Sport Track and from Ben comes from here, and nothing (not even
// the weekly AI review) may break them:
//   1. 10-20 hard sets a week per muscle group, trained on at least 2 days.
//   2. Sets stop 1-2 reps short of failure (RIR 1-2).
//   3. Progressive overload in a fixed order: reps up to the top of the range,
//      then the next harder variation (or, at the top of a ladder, added
//      weight), then back to the bottom of the range.
//   4. The rest timer suits the rep range.
//   5. A deload every 4-6 weeks when progress stalls.
//   6. Protein about 1.6-2.2 g/kg and sleep 7+ hours (from the Body data).
// Nothing here pays points.
import { moveById, type Move } from './sportMoves'
import { moveOf } from './sportLadders'
import { coachFor, type CoachInput } from './sportCoach'
import { rangeFor } from './sportProgress'
import { MUSCLES, hardSets, mondayOf, muscleOf, setsOn, shiftDay, type Muscle, type SetLog } from './sportSets'
import { stallsOf, SHORT_SLEEP_MIN, LOW_PROTEIN, type InsightData } from './sportInsight'

export const RULES = {
  setsLo: 10,
  setsHi: 20,
  minDays: 2,
  rir: '1–2 reps before you could not do another',
  protein: { lo: 1.6, hi: 2.2 },
  sleepHours: 7,
  deloadWeeks: { lo: 4, hi: 6 },
  /** Added weight steps (kg) when a ladder has no harder move. */
  kgFirst: 5,
  kgStep: 2
} as const

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const u = (m: Move) => (m.unit === 'sec' ? ' s' : '')

/** What to say for each muscle: the move group and the body part. */
export const BODY_PART: Record<Muscle, { work: string; part: string; start: string }> = {
  push: { work: 'pushing', part: 'chest and shoulders', start: 'pushup' },
  pull: { work: 'pulling', part: 'back', start: 'door_row' },
  legs: { work: 'leg work', part: 'legs', start: 'split_squat' },
  core: { work: 'core work', part: 'core', start: 'plank' }
}

/** Rule 4: seconds of rest for a set of `reps` (or seconds for a hold) on a move. */
export function restFor(move: Pick<Move, 'unit' | 'diff'>, reps: number): number {
  if (move.unit === 'sec') return 60
  if (reps <= 8) return move.diff >= 4 ? 180 : 150
  if (reps <= 12) return 105
  if (reps <= 20) return 75
  return 60
}
export const restText = (s: number) => (s % 60 === 0 ? `${s / 60} min` : s >= 120 ? `${Math.floor(s / 60)}.${Math.round((s % 60) / 6)} min` : `${s} s`)

export interface CoachCtx extends Omit<CoachInput, 'exId'> {
  /** Body data that already exists (protein, sleep, readiness). */
  body?: InsightData | null
  /** The weekly review's program for this week (sportReview.ts). */
  program?: { week: string; target: Record<Muscle, number>; sessions: number; deload: boolean } | null
}

// ------------------------------------------------------------ rule 1: volume and frequency

export interface MuscleLoad {
  id: Muscle
  short: string
  /** Hard sets in the last 7 days (today included), and the days you trained it. */
  sets: number
  days: number
  /** The weekly goal for it (10 by default, the review may set up to 20). */
  goal: number
  status: 'low' | 'ok' | 'high'
  /** Trained on fewer than 2 days (and you have trained it at all). */
  freqLow: boolean
}

export function muscleLoad(ctx: Pick<CoachCtx, 'sets' | 'exercises' | 'today' | 'program'>): MuscleLoad[] {
  const from = shiftDay(ctx.today, -6)
  const sets: Record<Muscle, number> = { push: 0, pull: 0, core: 0, legs: 0 }
  const dset: Record<Muscle, Set<string>> = { push: new Set(), pull: new Set(), core: new Set(), legs: new Set() }
  for (const ex of ctx.exercises) {
    const mv = moveOf(ex)
    const mu = muscleOf(mv?.group)
    if (!mu) continue
    for (const day of Object.keys(ctx.sets ?? {})) {
      if (day < from || day > ctx.today) continue
      const l = setsOn(ctx.sets, day, String(ex.id)).map((s) => s.reps)
      if (!l.length) continue
      sets[mu] += hardSets(l, mv?.unit)
      dset[mu].add(day)
    }
  }
  const prog = ctx.program && ctx.program.week === mondayOf(ctx.today) ? ctx.program.target : null
  return MUSCLES.map((m) => {
    const goal = clamp(prog?.[m.id] ?? RULES.setsLo, RULES.setsLo, RULES.setsHi)
    const n = sets[m.id]
    return { id: m.id, short: m.short, sets: n, days: dset[m.id].size, goal, status: n < RULES.setsLo ? 'low' : n > RULES.setsHi ? 'high' : 'ok', freqLow: n > 0 && dset[m.id].size < RULES.minDays }
  })
}

// ------------------------------------------------------------ rule 5: deload

export interface DeloadCheck {
  due: boolean
  /** Weeks in a row with 2+ training days, up to this one. */
  weeks: number
  why: string
}

/** Weeks in a row (counting back from this one) with training on 2+ days. */
export function trainedWeeks(log: SetLog | null | undefined, today: string): number {
  let n = 0
  let mon = mondayOf(today)
  for (let i = 0; i < 12; i++, mon = shiftDay(mon, -7)) {
    const days = Object.keys(log ?? {}).filter((d) => d >= mon && d <= shiftDay(mon, 6) && Object.keys(log![d] ?? {}).length > 0).length
    // The current week may still be young: it never breaks the run.
    if (days >= 2) n++
    else if (i === 0) continue
    else break
  }
  return n
}

export function deloadCheck(ctx: Pick<CoachCtx, 'sets' | 'exercises' | 'today' | 'deload'>): DeloadCheck {
  const weeks = trainedWeeks(ctx.sets, ctx.today)
  if (ctx.deload) return { due: false, weeks, why: 'An easy week is already running.' }
  const stalled = stallsOf(ctx.sets, ctx.exercises, ctx.today)
  if (weeks >= RULES.deloadWeeks.hi) return { due: true, weeks, why: `${weeks} hard weeks in a row: time for an easy week.` }
  if (weeks >= RULES.deloadWeeks.lo && stalled.length) return { due: true, weeks, why: `${weeks} hard weeks and ${stalled[0].name.toLowerCase()} stopped improving: an easy week brings it back.` }
  return { due: false, weeks, why: '' }
}

// ------------------------------------------------------------ rule 3: overload

export type OverloadKind = 'reps' | 'harder' | 'weight' | 'tempo' | 'back' | 'start' | 'deload'

export interface Overload {
  kind: OverloadKind
  /** The move to do (the harder one for 'harder', the easier one for 'back'). */
  move: Move
  sets: number
  reps: number
  kg: number
  tempo: string
  /** What changed and why, one line. */
  text: string
}

/** The kg you used last in this exercise (0: none). */
export function lastKg(log: SetLog | null | undefined, exId: string, until: string): number {
  for (const day of Object.keys(log ?? {}).filter((d) => d <= until).sort().reverse()) {
    const k = Math.max(0, ...setsOn(log, day, exId).map((s) => Number(s.kg) || 0))
    if (k > 0) return k
  }
  return 0
}

/** The next step for one exercise, in the fixed order: reps, then harder or weight, then back to the bottom. */
export function overload(ctx: CoachCtx, exId: string): Overload | null {
  const c = coachFor({ ...ctx, exId })
  if (!c) return null
  const move = c.move
  const kg = lastKg(ctx.sets, exId, ctx.today)
  const base = { move, sets: c.sets, reps: c.goal, kg, tempo: kg ? '2-0-1' : '2-0-1' }
  const eq = (n: number) => `${c.sets}×${n}${u(move)}${kg ? ` +${kg} kg` : ''}`
  if (c.status === 'deload') return { ...base, kind: 'deload', text: `Easy week: ${eq(c.goal)}, stop 3 reps before it gets hard.` }
  if (c.status === 'new') return { ...base, kind: 'start', text: `First time: ${eq(c.goal)}, stop ${RULES.rir}.` }
  if (c.status === 'stuck') {
    const back = c.stepBack?.to
    return { ...base, move: back ?? move, kind: 'back', reps: c.lo, tempo: '3-1-1', text: back ? `Two tough sessions: go back to ${back.name.toLowerCase()} at ${c.sets}×${c.lo}${u(back)} and add a slow 3-1-1 tempo.` : `Two tough sessions: ${c.sets}×${c.lo}${u(move)}, 2–3 min rest and a slow 3-1-1 tempo.` }
  }
  const reset = c.ready ? (ctx.strength && c.ready.to.unit === 'reps' ? 5 : rangeFor(c.ready.to).lo) : 0
  if (c.status === 'ready' && c.ready) return { ...base, move: c.ready.to, kind: 'harder', sets: c.sets, reps: reset, kg: 0, text: `You reached the top of the range, so the next step is ${c.ready.to.name.toLowerCase()} at ${c.sets}×${reset}${u(c.ready.to)} (back to the bottom of its range).` }
  if (c.status === 'top') {
    const add = kg ? kg + RULES.kgStep : RULES.kgFirst
    return { ...base, kind: 'weight', kg: add, reps: c.lo, text: `Top of the ladder and the top of the range: add weight. ${c.sets}×${c.lo}${u(move)} +${add} kg in a backpack, then climb back up.` }
  }
  return { ...base, kind: 'reps', text: `${eq(c.goal)}: one more rep than last time, stop ${RULES.rir}.` }
}

// ------------------------------------------------------------ rule 6: body data

export function bodyLines(b: InsightData | null | undefined): { lines: string[]; low: ('protein' | 'sleep')[] } {
  const lines: string[] = []
  const low: ('protein' | 'sleep')[] = []
  const p = b?.protein
  if (p && p.days > 0 && p.goal > 0) {
    if (p.avg / p.goal < LOW_PROTEIN) { lines.push(`Protein averaged ${p.avg} g against your ${p.goal} g goal (1.6–2.2 g per kg builds muscle).`); low.push('protein') }
  }
  const s = b?.sleep
  if (s && s.avgMin != null && s.nights > 0 && s.avgMin < SHORT_SLEEP_MIN) { lines.push(`You slept ${Math.floor(s.avgMin / 60)}h${String(Math.round(s.avgMin % 60)).padStart(2, '0')} on average: muscle grows in sleep, aim for 7 h or more.`); low.push('sleep') }
  return { lines, low }
}

// ------------------------------------------------------------ the session and the card

export interface SessionItem {
  exId: string
  name: string
  /** The variation to do (can differ from the exercise on the routine). */
  move: Move
  sets: number
  reps: number
  kg: number
  tempo: string
  rest: number
  kind: OverloadKind
  /** Sets added to reach 10 for a muscle that is behind. */
  added: number
  /** "4×6 archer push-ups, 150 s rest, slow 3-1-1" */
  line: string
}

export interface Priority {
  text: string
  muscle: Muscle | null
  addSets: number
}

/** The single most important thing this week. */
export function priority(ctx: CoachCtx, load = muscleLoad(ctx)): Priority {
  const any = load.some((l) => l.sets > 0)
  if (!any) return { text: 'Do today’s session and log every set: the coach learns from your numbers.', muscle: null, addSets: 0 }
  const dl = deloadCheck(ctx)
  if (dl.due) return { text: `${dl.why} Cut each exercise by one set and stop 3 reps short for a week.`, muscle: null, addSets: 0 }
  const low = [...load].filter((l) => l.status === 'low').sort((a, b) => a.sets / a.goal - b.sets / b.goal)[0]
  if (low) {
    const add = clamp(low.goal - low.sets, 2, 4)
    const bp = BODY_PART[low.id]
    return { text: `Add ${add} sets of ${bp.work}: your ${bp.part} ${low.id === 'legs' ? 'are' : 'is'} behind (${low.sets} of ${low.goal} hard sets this week).`, muscle: low.id, addSets: add }
  }
  const freq = load.find((l) => l.freqLow)
  if (freq) return { text: `Train your ${BODY_PART[freq.id].part} on 2 days a week, not 1: split its sets over two sessions.`, muscle: freq.id, addSets: 0 }
  const b = bodyLines(ctx.body)
  if (b.low[0] === 'protein') return { text: b.lines[0] + ' Fix that first.', muscle: null, addSets: 0 }
  if (b.low[0] === 'sleep') return { text: b.lines[b.lines.length - 1] + ' Fix that first.', muscle: null, addSets: 0 }
  const high = load.find((l) => l.status === 'high')
  if (high) return { text: `${BODY_PART[high.id].part[0].toUpperCase()}${BODY_PART[high.id].part.slice(1)} is over 20 hard sets: more will not grow it faster. Drop a set or two.`, muscle: high.id, addSets: 0 }
  return { text: 'Beat last time by one rep on every move, and stop 1–2 reps before failure.', muscle: null, addSets: 0 }
}

/** Today's exact session: the active exercises with sets × reps, the variation, weight or tempo, rest, and volume added where a muscle is behind. */
export function sessionPlan(ctx: CoachCtx, load = muscleLoad(ctx)): SessionItem[] {
  const items: SessionItem[] = []
  const active = ctx.exercises.filter((e) => e.active !== false && !(e as any).plan)
  for (const ex of active) {
    const o = overload(ctx, String(ex.id))
    if (!o) continue
    let sets = o.sets
    let added = 0
    const mu = muscleOf(o.move.group)
    const l = mu && load.find((x) => x.id === mu)
    if (l && l.status === 'low' && !ctx.deload && o.kind !== 'deload' && sets < 5) {
      added = 1
      sets += 1
    }
    const rest = restFor(o.move, o.reps)
    const slow = o.tempo !== '2-0-1' ? `, slow ${o.tempo}` : ''
    const weight = o.kg > 0 ? ` +${o.kg} kg` : ''
    items.push({ exId: String(ex.id), name: ex.name, move: o.move, sets, reps: o.reps, kg: o.kg, tempo: o.tempo, rest, kind: o.kind, added, line: `${sets}×${o.reps}${u(o.move)} ${o.move.name.toLowerCase()}${weight}, rest ${restText(rest)}${slow}` })
  }
  return items
}

export interface CoachCard {
  /** The one thing that matters most this week. */
  focus: Priority
  session: SessionItem[]
  /** Why it is built this way, one line. */
  why: string
  body: string[]
  /** A muscle with no exercise yet: the move to add. */
  missing: { muscle: Muscle; move: Move }[]
  deload: DeloadCheck
  load: MuscleLoad[]
}

export function coachCard(ctx: CoachCtx): CoachCard {
  const load = muscleLoad(ctx)
  const focus = priority(ctx, load)
  const session = sessionPlan(ctx, load)
  const have = new Set(ctx.exercises.filter((e) => e.active !== false).map((e) => muscleOf(moveOf(e)?.group)))
  const missing = (Object.keys(BODY_PART) as Muscle[]).filter((m) => !have.has(m)).map((m) => ({ muscle: m, move: moveById(BODY_PART[m].start)! }))
  const deload = deloadCheck(ctx)
  const kinds = new Set(session.map((s) => s.kind))
  const why =
    kinds.has('harder') ? 'You hit the top of the range, so the move gets harder and the reps go back down: that is how muscle keeps growing.'
    : kinds.has('weight') ? 'You are at the top of the ladder, so the load goes up with a backpack.'
    : kinds.has('back') ? 'Two tough sessions means you need more recovery, not less effort: a step back now gives a bigger jump next week.'
    : ctx.deload || kinds.has('deload') ? 'An easy week: the same moves with fewer sets, so your body catches up.'
    : `Each muscle needs ${RULES.setsLo}–${RULES.setsHi} hard sets a week on 2 or more days, ending 1–2 reps short of failure, and one more rep each time.`
  return { focus, session, why, body: bodyLines(ctx.body).lines, missing, deload, load }
}
