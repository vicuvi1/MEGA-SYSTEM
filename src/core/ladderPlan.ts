// The planner places the goal ladder's week steps (core/goalLadder.ts):
// - study: the focus hours still to do this week become sessions through the
//   deadline-backwards mechanism (core/planDeadlines.ts), with Monday as the
//   "deadline", in the room left after your real deadlines, within your limits;
// - workouts: the days your training split already has (Body → Training), from
//   today to Sunday, skipping days you trained.
// Everything placed is a DRAFT block: nothing is approved, booked or paid here.
// Pure; additive to the planner (planDeadlines/planWeek stay as they were).
import { addDays } from './dates'
import { minutesByDay, planDeadlines, type DayRoom, type DeadlineGoal, type DeadlinePlan } from './planDeadlines'
import { activeGoals, goalWeek, mondayOf, targetOf, type Ladder, type LadderFacts } from './goalLadder'
import type { DayType as TrainDay } from './trainWeek'

export const LADDER_STUDY_ID = 'ladder-study'

/** This week's study still to do as a deadline goal (due next Monday), or null (not confirmed yet, or done). */
export function ladderStudyGoal(l: Ladder, facts: LadderFacts, today: string): DeadlineGoal | null {
  const g = activeGoals(l).find((x) => x.id === 'study')
  // Only once you made the study goal yours (confirmed its milestones or set its weekly hours):
  // a template alone never adds blocks to your day.
  if (!g || (g.milestones == null && g.targets.focusHours == null)) return null
  const target = targetOf(g, 'focusHours', facts)
  if (!target) return null
  const monday = mondayOf(today)
  // Done so far this week, today included (today's minutes count toward today's session).
  const done = goalWeek(g, facts, monday, addDays(monday, 7)).actions.find((a) => a.metric === 'focusHours')?.done ?? 0
  const leftMin = Math.round(Math.max(0, target - done) * 60)
  if (leftMin < 25) return null
  return { id: LADDER_STUDY_ID, title: 'Weekly focus', subject: 'Study', deadline: addDays(monday, 7), leftMin }
}

/**
 * The week's study sessions in the room your real deadlines leave: their
 * minutes come off each day first, so an exam is never pushed out.
 * One session per day at most (stable ids: no duplicates on a re-plan).
 */
export function placeStudy(goal: DeadlineGoal | null, rooms: DayRoom[], existing: DeadlinePlan[], today: string): DeadlinePlan | null {
  if (!goal) return null
  const used = minutesByDay(existing)
  const left = rooms.filter((r) => r.day < goal.deadline).map((r) => ({ ...r, minutes: Math.max(0, r.minutes - (used.get(r.day) ?? 0)) }))
  return planDeadlines([goal], left, today)[0] ?? null
}

export interface WorkoutSlot {
  day: string
  type: Exclude<TrainDay, 'rest'>
  draft: true
}

/**
 * Workouts still to do this week on your split's training days (today to
 * Sunday, days already trained skipped), at most `left` of them.
 */
export function placeWorkouts(split: TrainDay[], trainedDays: string[], today: string, left: number): WorkoutSlot[] {
  const out: WorkoutSlot[] = []
  const sunday = addDays(mondayOf(today), 6)
  for (let d = today; d <= sunday && out.length < left; d = addDays(d, 1)) {
    const t = split[(new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7]
    if (!t || t === 'rest' || trainedDays.includes(d)) continue
    out.push({ day: d, type: t, draft: true })
  }
  return out
}

/** The week's steps placed: study sessions and workout days (all drafts). */
export function placeWeekSteps(o: { ladder: Ladder; facts: LadderFacts; today: string; rooms: DayRoom[]; existing: DeadlinePlan[]; split: TrainDay[] }): { study: DeadlinePlan | null; workouts: WorkoutSlot[] } {
  const study = placeStudy(ladderStudyGoal(o.ladder, o.facts, o.today), o.rooms, o.existing, o.today)
  const gain = activeGoals(o.ladder).find((g) => g.id === 'gain' || g.id === 'strong')
  let workouts: WorkoutSlot[] = []
  if (gain) {
    const monday = mondayOf(o.today)
    const metric = gain.id === 'gain' ? 'workouts' : 'sessions'
    const target = targetOf(gain, metric, o.facts) ?? 0
    const byDay = o.facts.daily.workouts ?? {}
    const trained = Object.keys(byDay).filter((d) => d >= monday && (byDay[d] ?? 0) > 0)
    workouts = placeWorkouts(o.split, trained, o.today, Math.max(0, target - trained.length))
  }
  return { study, workouts }
}
