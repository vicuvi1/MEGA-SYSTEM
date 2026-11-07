// BD3: weekly sets per muscle, the planner side. Sport Track already counts
// hard sets per muscle this week (sportSets.hardSetsByMuscle) and plans a
// 20–45 min week (sportProgram.weekPlan). This adds: how many hard sets the
// week's plan gives each muscle against the 10–20 that grow it (and what to
// change when it's outside), done vs planned so far, and one next step per
// move: one more rep, a slower 3-second lowering, a pause at the bottom, or
// the next ladder step. Pure and tested. Nothing here pays points.
import { MUSCLES, WEEKLY_SETS, hardSetsByMuscle, mondayOf, muscleOf, sessionsOf, shiftDay, type Muscle, type SetLog } from './sportSets'
import { progressFor, rangeFor, type Progress } from './sportProgress'
import type { WeekDay } from './sportProgram'
import type { Move } from './sportMoves'
import type { SportEx } from './sportLadders'

export interface MuscleWeek {
  id: Muscle
  name: string
  short: string
  /** Hard sets done this week so far. */
  done: number
  /** Hard sets the week's plan gives it. */
  planned: number
  /** Planned sets on the days still to come (today included when nothing's logged yet). */
  left: number
  status: 'low' | 'ok' | 'high'
  /** What to change, in plain words (null when the plan is in the zone). */
  tip: string | null
}

/** Hard sets a week's plan gives each muscle (3 sets × each move on each training day). */
export function plannedSetsByMuscle(week: WeekDay[], fromDay?: string): Record<Muscle, number> {
  const out: Record<Muscle, number> = { push: 0, pull: 0, core: 0, legs: 0 }
  for (const d of week) {
    if (!d.session || (fromDay && d.day < fromDay)) continue
    for (const it of d.session.items) {
      const mu = muscleOf(it.move.group)
      if (mu) out[mu] += it.sets
    }
  }
  return out
}

/** The week per muscle: done, planned, the 10–20 zone and a tip. */
export function muscleWeek(o: { log: SetLog | null | undefined; exercises: SportEx[]; week: WeekDay[]; today: string }): MuscleWeek[] {
  const mon = mondayOf(o.today)
  const done = hardSetsByMuscle(o.log, o.exercises, mon, shiftDay(mon, 6))
  const planned = plannedSetsByMuscle(o.week)
  const trainedToday = Object.keys(o.log?.[o.today] ?? {}).length > 0
  const left = plannedSetsByMuscle(o.week, trainedToday ? shiftDay(o.today, 1) : o.today)
  const sessions = o.week.filter((d) => d.session).length || 1
  return MUSCLES.map((m) => {
    const p = planned[m.id]
    const status: MuscleWeek['status'] = p < WEEKLY_SETS.lo ? 'low' : p > WEEKLY_SETS.hi ? 'high' : 'ok'
    const per = Math.ceil((WEEKLY_SETS.lo - p) / sessions)
    const tip =
      status === 'low'
        ? p === 0
          ? `Nothing for ${m.short.toLowerCase()} in the plan yet: add one move for it (3 sets) to each session.`
          : `${p} sets a week is under 10: add ${per} set${per === 1 ? '' : 's'} of a ${m.short.toLowerCase()} move to each session, or go up to 4 sessions.`
        : status === 'high'
          ? `${p} sets is over 20: more won't grow it faster. Drop a set or two.`
          : null
    return { id: m.id, name: m.name, short: m.short, done: done[m.id], planned: p, left: left[m.id], status, tip }
  })
}

export type StepKind = 'start' | 'rep' | 'tempo' | 'pause' | 'level' | 'easier' | 'hold' | 'back'

export interface NextStep {
  kind: StepKind
  /** A short label for a chip ("+1 rep", "3-s lowering"). */
  label: string
  /** One plain line. */
  text: string
}

const LABEL: Record<StepKind, string> = { start: 'Start', rep: '+1 rep', tempo: '3-s lowering', pause: '2-s pause', level: 'Next step', easier: 'Easier step', hold: 'Repeat', back: 'Ease back in' }

/**
 * The next step for one move. Building: one more rep. A plateau (the last two
 * sessions no better than the one before) switches to a slower 3-second
 * lowering, then a 2-second pause at the bottom, which make the same reps
 * harder. At the top of the range: the next ladder step (or tempo and pause
 * on the last step). A short night (hold): repeat last time.
 */
export function nextStepFor(o: { log: SetLog | null | undefined; exId: string; move: Move | null; today: string; hold?: boolean; progress?: Progress }): NextStep {
  const p = o.progress ?? progressFor({ log: o.log, exId: o.exId, move: o.move, today: o.today })
  const u = p.range.unit === 'sec' ? ' s' : ''
  const mk = (kind: StepKind, text: string): NextStep => ({ kind, label: LABEL[kind], text })
  if (p.status === 'new') return mk('start', `First time: ${p.sets}×${p.range.lo}${u}, stop 1–2 reps before you can't do another.`)
  if (o.hold && p.last) {
    const lastMin = Math.min(...p.last.reps.slice(0, p.sets))
    return mk('hold', `Short night: repeat ${p.sets}×${Math.max(p.range.lo, lastMin)}${u} like last time. Progress waits for a good night.`)
  }
  if (p.status === 'comeback') return mk('back', p.line)
  if (p.status === 'stuck') return mk('easier', p.line)
  if (p.status === 'ready' && p.next) return mk('level', `Move up to ${p.next.name}: start at ${p.sets}×${rangeFor(p.next).lo}${rangeFor(p.next).unit === 'sec' ? ' s' : ''}.`)
  const past = sessionsOf(o.log, o.exId, o.today).filter((s) => s.day < o.today)
  const mins = past.slice(-3).map((s) => Math.min(...s.reps.slice(0, p.sets)))
  const plateau = mins.length === 3 && mins[2] <= mins[0] && mins[1] <= mins[0]
  if (p.status === 'top' || plateau) {
    // Tempo first; when the last session already used it (a plateau that lasts), a pause.
    const long = past.length >= 4 && Math.min(...past[past.length - 4].reps.slice(0, p.sets)) >= mins[2]
    return long
      ? mk('pause', `Same reps, harder: hold a 2-second pause at the bottom of every rep (${p.sets}×${p.goal}${u}).`)
      : mk('tempo', `Same reps, harder: lower slowly for 3 seconds on every rep (${p.sets}×${p.goal}${u}).`)
  }
  return mk('rep', `One more rep: aim for ${p.sets}×${p.goal}${u} today (next level at ${p.nextAt}).`)
}
