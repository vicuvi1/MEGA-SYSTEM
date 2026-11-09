// Body → Training → Progress: the training streak, sessions per week against
// the plan, weekly hard sets per muscle, reps per exercise per week and the
// monthly progress-photo nudge. Rest days never break the streak: only a
// planned session that didn't happen (and wasn't made up within 2 days)
// does. Pure and tested (trainStreak.test.ts). Nothing here pays points.
import { hardSetsByMuscle, mondayOf, shiftDay, weeklyVolume, type Muscle, type SetLog } from './sportSets'
import type { DayLog, SportEx } from './sportLadders'
import { daysBetween, planned, type DoneSession, type TrainWeek } from './trainWeek'

export interface Streak {
  /** Sessions in a row with no missed planned session between them. */
  sessions: number
  /** The day the streak started (null: no streak). */
  since: string | null
  /** The last planned session that was missed (null: none in the window). */
  brokenOn: string | null
}

/**
 * A planned day `d` counts as kept when a session was logged that day, or the same session was made up on
 * one of the next 2 days that was planned for something else (a rest day or the other session).
 */
export function keptDay(week: TrainWeek, done: DoneSession[], d: string): boolean {
  const plan = planned(week, d)
  if (plan === 'rest') return true
  if (done.some((s) => s.date === d)) return true
  for (let i = 1; i <= 2; i++) {
    const n = shiftDay(d, i)
    if (planned(week, n) !== plan && done.some((s) => s.date === n && s.type === plan)) return true
  }
  return false
}

/**
 * The current streak: walk back from today; every logged session counts (extra ones on rest days too),
 * rest days are skipped, and the first missed planned session ends it. Today's planned session isn't
 * missed yet (the day isn't over), nor is one that can still be made up (yesterday or the day before).
 */
export function trainStreak(week: TrainWeek, done: DoneSession[], today: string, maxDays = 180): Streak {
  const dates = new Set(done.map((s) => s.date))
  if (!dates.size) return { sessions: 0, since: null, brokenOn: null }
  const first = [...dates].sort()[0]
  let sessions = 0
  let since: string | null = null
  let brokenOn: string | null = null
  for (let i = 0; i <= maxDays; i++) {
    const d = shiftDay(today, -i)
    if (d < first) break
    if (dates.has(d)) {
      sessions += done.filter((s) => s.date === d).length
      since = d
      continue
    }
    // Still open: today, and a planned day that can still be made up.
    if (daysBetween(d, today) <= 2 && planned(week, d) !== 'rest') continue
    if (!keptDay(week, done, d)) {
      brokenOn = d
      break
    }
  }
  return { sessions, since: sessions ? since : null, brokenOn }
}

export interface WeekCount {
  /** Monday. */
  monday: string
  done: number
  planned: number
}

/** Sessions per week against the plan, the last `weeks` weeks (this one last). */
export function sessionsPerWeek(week: TrainWeek, done: DoneSession[], today: string, weeks = 8): WeekCount[] {
  const mon = mondayOf(today)
  const plannedN = week.days.filter((d) => d !== 'rest').length
  return Array.from({ length: weeks }, (_, k) => {
    const monday = shiftDay(mon, -7 * (weeks - 1 - k))
    const end = shiftDay(monday, 6)
    return {
      monday,
      done: done.filter((s) => s.date >= monday && s.date <= end).length,
      planned: plannedN
    }
  })
}

/** Hard sets per muscle group for each of the last `weeks` weeks (this one last). */
export function hardSetsWeeks(log: SetLog | null | undefined, exercises: SportEx[], today: string, weeks = 6): { monday: string; sets: Record<Muscle, number> }[] {
  const mon = mondayOf(today)
  return Array.from({ length: weeks }, (_, k) => {
    const monday = shiftDay(mon, -7 * (weeks - 1 - k))
    return {
      monday,
      sets: hardSetsByMuscle(log, exercises, monday, shiftDay(monday, 6))
    }
  })
}

export interface ExerciseReps {
  id: string
  name: string
  unit: string
  weeks: { monday: string; total: number }[]
  total: number
}

/** Reps (or seconds) per week for each exercise you did in the last `weeks` weeks, most done first (up to `max`). */
export function repsPerExercise(days: DayLog | null | undefined, exercises: SportEx[], today: string, weeks = 8, max = 6): ExerciseReps[] {
  return (Array.isArray(exercises) ? exercises : [])
    .map((e) => {
      const w = weeklyVolume(days, [String(e.id)], today, weeks)
      return {
        id: String(e.id),
        name: String(e.name || ''),
        unit: String(e.unit || 'reps'),
        weeks: w,
        total: w.reduce((n, x) => n + x.total, 0)
      }
    })
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, max)
}

/** A progress photo is due once a month: none yet, or the latest is 28+ days old. */
export function photoDue(lastPhotoDay: string | null, today: string): { due: boolean; line: string } {
  if (!lastPhotoDay)
    return {
      due: true,
      line: 'No progress photo yet. One a month shows changes the mirror hides.'
    }
  const d = daysBetween(lastPhotoDay, today)
  if (d >= 28)
    return {
      due: true,
      line: `Your last progress photo was ${d} days ago. Time for this month's.`
    }
  return {
    due: false,
    line: `Last progress photo ${d === 0 ? 'today' : `${d} day${d === 1 ? '' : 's'} ago`}. Next one in ${28 - d} days.`
  }
}
