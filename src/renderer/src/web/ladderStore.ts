// The goal ladder's data side: the saved ladder (synced setting `goal_ladder`)
// and the facts it scores, counted from logs the app already keeps:
// workouts (Sport Track's workouts + training sessions), protein days (the
// food counter), weigh-ins and weekly average weight (body_comp, else
// body_metrics), focus hours (the focus timer), job applications, portfolio
// pieces and flashcard reviews (Career), money saved (Finance Helper), sleep
// (Waky's sleep logs). Nothing is typed in for the ladder and nothing pays.
// No browser code: Ben's prompt context (sagaStore) reads it too.
import { getSetting, setSetting } from '../../../main/settings'
import { addDays, daysBetween } from '@core/dates'
import { ladderStudyGoal, placeStudy } from '@core/ladderPlan'
import { dayRooms, type WeekShape } from '@core/planWeek'
import type { PlanLimits } from '@core/planLimits'
import type { DeadlinePlan } from '@core/planDeadlines'
import type { CalEvent } from '@core/dayTime'
import { cleanLadder, EMPTY_FACTS, LADDER_KEY, ladderCards, mondayOf, quarterOf, type Ladder, type LadderCard, type LadderFacts, type Metric, type Quarter } from '@core/goalLadder'
import { currentSeason } from '@core/season'
import { trainOf, currentLevel } from '@core/trainLog'
import { moveName } from '@core/trainLadders'
import { weeklyAverages } from '@core/bodyComp'
import { proteinOfDay } from '@core/protein'
import { bodyEvents, sportBlob } from '../../../main/bodyLog'
import { bodyPoints, foodTargetsNow } from '../../../main/food'
import { listBodyComp } from '../../../main/bodyComp'
import { loadCards, loadJobs, loadProofs } from './career'
import { loadSeasons } from './sagaStore'
import type { Services } from './webServices'

export const loadLadder = (db: any): Ladder => {
  try {
    return cleanLadder(JSON.parse(getSetting(db, LADDER_KEY) || 'null'))
  } catch {
    return cleanLadder(null)
  }
}
export const saveLadder = (db: any, l: Ladder) => setSetting(db, LADDER_KEY, JSON.stringify(cleanLadder(l)))

/** The quarter: the current Season (12 weeks; an old one 8), else the ladder's own 12 weeks. */
export function quarterNow(db: any, l: Ladder, today: string): Quarter {
  const s = currentSeason(loadSeasons(db), today)
  return quarterOf(s && s.start <= today ? { start: s.start, weeks: s.weeks, name: s.name } : null, l.start, today)
}

const safe = <T>(fn: () => T, d: T): T => {
  try {
    return fn()
  } catch {
    return d
  }
}
const inc = (m: Record<string, number>, day: string, n = 1) => (m[day] = Math.round(((m[day] ?? 0) + n) * 100) / 100)
const hm = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Counts every action the ladder scores, day by day, from `from` to `today`. */
export function ladderFacts(s: Services, from: string, today: string, finance?: any): LadderFacts {
  const db = s.db
  const daily: Partial<Record<Metric, Record<string, number>>> = {}
  const put = (m: Metric) => (daily[m] ??= {})
  const inRange = (d: unknown): d is string => typeof d === 'string' && d >= from && d <= today

  // Training: Sport Track's workouts and the training log (one workout a day counts once).
  const blob = safe(() => sportBlob(db), null)
  const train = trainOf(blob)
  const trainedDays = new Set<string>()
  for (const r of safe(() => db.prepare('SELECT DISTINCT day FROM workouts WHERE day >= ? AND day <= ?').all(from, today) as any[], [])) trainedDays.add(String(r.day))
  const sessions = put('sessions')
  const hard = put('hardSets')
  for (const sess of train.log) {
    if (!inRange(sess.date) || !sess.exercises.some((e) => e.sets.length)) continue
    trainedDays.add(sess.date)
    inc(sessions, sess.date)
    // A hard set: close to failure (an effort tap of hard or ok; easy sets don't count).
    const n = sess.exercises.reduce((t, e) => t + e.sets.filter((x) => x.feel !== 'easy').length, 0)
    if (n) inc(hard, sess.date, n)
  }
  const workouts = put('workouts')
  for (const d of trainedDays) inc(workouts, d)
  let levelUps = 0
  for (const st of Object.values(train.levels)) for (const d of Object.values(st?.reached ?? {})) if (inRange(d)) levelUps++
  const levels = train.ladders
    .filter((l) => l.id === 'push' || l.id === 'pull')
    .map((l) => safe(() => `${l.name}: ${moveName(l.levels[currentLevel(blob, train, l, today).index]?.move ?? '')}`, ''))
    .filter((x) => x && !x.endsWith(': '))

  // Food: days the protein goal was reached (the day's own target, training days included).
  const events = safe(() => bodyEvents(db, from, today), [])
  const protein = put('proteinDays')
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const goal = safe(() => foodTargetsNow(db, d).protein, 0)
    if (goal > 0 && safe(() => proteinOfDay(events, d), 0) >= goal) inc(protein, d)
  }

  // Body: days with a weigh-in, and weekly average weight.
  const weigh = put('weighIns')
  const wDays = new Set<string>(listBodyComp(db, from, today).map((r) => r.day))
  for (const r of safe(() => db.prepare('SELECT day FROM body_metrics WHERE weight IS NOT NULL AND day >= ? AND day <= ?').all(from, today) as any[], [])) wDays.add(String(r.day))
  for (const d of wDays) inc(weigh, d)
  const weeks = Math.min(20, Math.ceil((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 6048e5) + 2)
  const points = safe(() => bodyPoints(db, today, weeks * 7), [])
  const weights = weeklyAverages(points, today, weeks).filter((w) => w.avg != null).map((w) => ({ week: w.week, avg: w.avg as number }))

  // Focus: hours a day, and study sessions (25+ min) on a subject with an open deadline.
  const focus = put('focusHours')
  const dl = put('deadlineSessions')
  const subjects = new Set(safe(() => db.prepare("SELECT subject FROM focus_goals WHERE archived = 0 AND COALESCE(kind, 'hours') = 'hours' AND deadline >= ?").all(today) as any[], []).map((r) => String(r.subject).toLowerCase()))
  for (const r of safe(() => db.prepare('SELECT day, subject, minutes FROM focus_sessions WHERE day >= ? AND day <= ?').all(from, today) as any[], [])) {
    inc(focus, String(r.day), (Number(r.minutes) || 0) / 60)
    if (Number(r.minutes) >= 25 && subjects.has(String(r.subject).toLowerCase())) inc(dl, String(r.day))
  }

  // Money: income minus spending a day (Finance Helper).
  const money = safe(() => s.goals.dailyValues({ kind: 'money.saved' }, from, today, finance), null)
  if (money) daily.moneySaved = money

  // Career: applications sent, portfolio pieces, days with a flashcard review.
  const apps = put('applications')
  for (const j of safe(() => loadJobs(db).jobs, [])) if (inRange(j.applied)) inc(apps, j.applied)
  const port = put('portfolio')
  for (const p of safe(() => loadProofs(db), [])) if (inRange(p.day)) inc(port, p.day)
  const cards = put('flashcardDays')
  for (const d of new Set(safe(() => loadCards(db).log, []).map((m) => m.day))) if (inRange(d)) cards[d] = 1

  // Sleep: a good night is in bed on time and 7.5 h or more.
  const nights = put('sleepNights')
  const hours: number[] = []
  for (const r of safe(() => db.prepare('SELECT day, wake_time, bed_time, bed_on_time FROM sleep_logs WHERE day >= ? ORDER BY day').all(addDays(today, -60)) as any[], [])) {
    const b = hm(r.bed_time)
    const w = hm(r.wake_time)
    if (b == null || w == null) continue
    const h = ((w - b + 1440) % 1440) / 60
    hours.push(h)
    if (inRange(String(r.day)) && Number(r.bed_on_time) === 1 && h >= 7.5) inc(nights, String(r.day))
  }
  const last = hours.slice(-14)

  return {
    ...EMPTY_FACTS,
    daily,
    weights,
    splitDays: train.week.days.filter((d) => d !== 'rest').length,
    hasDeadlines: subjects.size > 0,
    levels,
    levelUps,
    sleepAvg: last.length ? last.reduce((t, h) => t + h, 0) / last.length : null
  }
}

export interface LadderView {
  today: string
  quarter: Quarter
  ladder: Ladder
  facts: LadderFacts
  cards: LadderCard[]
}

/** Everything the screens need, worked out once. */
export function ladderView(s: Services, opts: { finance?: any; now?: Date } = {}): LadderView {
  const now = opts.now ?? new Date()
  const today = s.wallet.today(now)
  const ladder = loadLadder(s.db)
  const quarter = quarterNow(s.db, ladder, today)
  // From the week before the quarter (for the starting weight and last week's steps).
  const from = addDays(quarter.start < mondayOf(today) ? quarter.start : mondayOf(today), -7)
  const facts = ladderFacts(s, from, today, opts.finance)
  return { today, quarter, ladder, facts, cards: ladderCards(ladder, facts, quarter, today) }
}

/**
 * Today's draft study session for the quarter's study goal (the planner's
 * hook, web/rhythmBot propose): the week's focus hours still to do, planned
 * backward to Monday in the room your real deadlines leave, within your
 * limits and week plan. null: nothing to place today.
 */
export function ladderStudyToday(s: Services, existing: DeadlinePlan[], o: { today: string; limits: PlanLimits; week: WeekShape; freeShare?: number }, now: string, events: CalEvent[]): { title: string; minutes: number; id: string; why: string } | null {
  const l = loadLadder(s.db)
  const facts = ladderFacts(s, mondayOf(o.today), o.today)
  const goal = ladderStudyGoal(l, facts, o.today)
  if (!goal) return null
  const rooms = dayRooms({ today: o.today, now, days: Math.max(1, daysBetween(o.today, goal.deadline)), events, week: o.week, limits: o.limits, freeShare: o.freeShare })
  const today = placeStudy(goal, rooms, existing, o.today)?.sessions.find((x) => x.day === o.today)
  if (!today || today.minutes < 20) return null
  return { title: today.title, minutes: Math.min(90, today.minutes), id: today.id, why: `quarter goal: study session ${today.n} of ${today.of} this week` }
}
