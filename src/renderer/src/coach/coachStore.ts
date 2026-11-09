// The coach's data side: the plan's inputs and today's real logs, read from
// this device's copy of the database (food, body_comp, sleep, workouts) and
// Sport Track's state (the page passes its own copy, the freshest; else the
// synced one). No browser code here, so it runs wherever the services do.
import { getSetting, setSetting } from '../../../main/settings'
import { addDays } from '@core/dates'
import { sportToday } from '@core/sportShared'
import { COACH_CONFIG, COACH_DAYS, COACH_WEEKS, cleanCoach, coachWeekNo, type CoachConfig } from '@core/coachConfig'
import { cleanDays, dailyPlan, dayOf, snapOf, ticksOf, withSnap, type CoachDays, type DailyPlan, type DayFacts, type PlanMove } from '@core/coachPlan'
import { cleanWeeks, reviewWeek, weeklyReview, type CoachWeeks, type WeekReview } from '@core/coachWeek'
import { currentLevel, doneSessions, levelStatus, moveSessions, sessionItems, sessionMinutes, setsFor, suggestNow, trainOf, type TrainData } from '@core/trainLog'
import { laddersFor, moveName } from '@core/trainLadders'
import { allHardWeek, lighterOn, strengthDrops } from '@core/trainWarnings'
import type { SessionType } from '@core/trainWeek'
import { kcalOfDay, mealsOfDay } from '@core/food'
import { proteinOfDay } from '@core/protein'
import { weeklyAverages } from '@core/bodyComp'
import { waistChange } from '@core/foodAdjust'
import { bodyEvents, sportBlob } from '../../../main/bodyLog'
import { adjustNow, bodyPoints, foodTargetsNow, readFoodGoals, readFoodLog, readFoodSaved } from '../../../main/food'
import { listBodyComp } from '../../../main/bodyComp'

type DB = any

const safe = <T>(fn: () => T, d: T): T => {
  try {
    return fn()
  } catch {
    return d
  }
}
const readJson = (db: DB, key: string): unknown => safe(() => JSON.parse(getSetting(db, key) || 'null'), null)

export const loadCoach = (db: DB): CoachConfig => cleanCoach(readJson(db, COACH_CONFIG))
export const saveCoach = (db: DB, c: CoachConfig) => setSetting(db, COACH_CONFIG, JSON.stringify(cleanCoach({ ...c, updatedAt: Date.now() })))
export const loadDays = (db: DB, today: string): CoachDays => cleanDays(readJson(db, COACH_DAYS), today)
export const saveDays = (db: DB, d: CoachDays, today: string) => setSetting(db, COACH_DAYS, JSON.stringify(cleanDays(d, today)))
export const loadWeeks = (db: DB): CoachWeeks => cleanWeeks(readJson(db, COACH_WEEKS))
export const saveWeeks = (db: DB, w: CoachWeeks) => setSetting(db, COACH_WEEKS, JSON.stringify(cleanWeeks(w)))

/** Sport Track's state: the page's copy when given, else the synced one. */
const sportOf = (db: DB, st?: any) => (st && typeof st === 'object' ? st : safe(() => sportBlob(db), null))

/** Logged kcal per day (days with a log) from `from` to `to`. */
export function kcalDays(db: DB, from: string, to: string): { day: string; kcal: number; protein: number }[] {
  const ev = safe(() => bodyEvents(db, from, to), [])
  const out: { day: string; kcal: number; protein: number }[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const kcal = kcalOfDay(ev, d)
    if (kcal > 0) out.push({ day: d, kcal, protein: Math.round(proteinOfDay(ev, d)) })
  }
  return out
}

function movesOf(st: any, data: TrainData, type: SessionType, today: string): { moves: PlanMove[]; minutes: number } {
  const items = safe(() => sessionItems(st ?? {}, data, type, today), [])
  return { moves: items.map((x) => ({ name: x.name, sets: x.sets, last: x.lastLine })), minutes: items.length ? sessionMinutes(items) : 0 }
}

export interface CoachToday {
  today: string
  config: CoachConfig
  plan: DailyPlan
  facts: DayFacts
  days: CoachDays
}

/** Today's plan and facts (nothing written). */
export function coachToday(db: DB, stIn?: any, now = new Date()): CoachToday {
  const today = sportToday(now)
  const config = loadCoach(db)
  const st = sportOf(db, stIn)
  const data = trainOf(st)
  const up = movesOf(st, data, 'upper', today)
  const legs = movesOf(st, data, 'legs', today)
  const targets = safe(() => foodTargetsNow(db, today), null)
  const goals = safe(() => readFoodGoals(db), null)
  const done = doneSessions(data.log)
  const plan = dailyPlan({
    date: today,
    config,
    week: data.week,
    done,
    moves: { upper: up.moves, legs: legs.moves },
    minutes: { upper: up.minutes, legs: legs.minutes },
    food: { goal: targets?.kcal ?? 2700, protein: targets?.protein ?? 125, saved: readFoodSaved(db), adjLog: goals?.adjLog ?? [] },
    intake: kcalDays(db, addDays(today, -8), addDays(today, -1)),
    lighter: !!safe(() => lighterOn(st, today), null)
  })
  return { today, config, plan, facts: factsOf(db, st, today, done), days: loadDays(db, today) }
}

/** What really happened today: a workout, meals, a weigh-in. */
export function factsOf(db: DB, st: any, day: string, done = doneSessions(trainOf(st).log)): DayFacts {
  const setsToday = st?.sets?.[day] && Object.values(st.sets[day]).some((l: any) => Array.isArray(l) && l.length)
  const workout = done.some((s) => s.date === day) || !!setsToday || !!safe(() => db.prepare('SELECT 1 FROM workouts WHERE day = ? LIMIT 1').get(day), null)
  const events = safe(() => bodyEvents(db, addDays(day, -1), day), [])
  const meals = safe(() => mealsOfDay(readFoodLog(db, day), events, day), [])
    .filter((m) => !m.removed && !m.supp)
    .map((m) => ({ slot: (m as any).slot ?? null, type: m.type }))
  const weigh = safe(() => listBodyComp(db, day, day).length > 0, false) || !!safe(() => db.prepare('SELECT 1 FROM body_metrics WHERE day = ? AND weight IS NOT NULL LIMIT 1').get(day), null)
  return { workout, meals, weigh, bed: null }
}

/** The day's ticks, and the day's short record saved when it changed. */
export function ticksNow(db: DB, t: CoachToday, write: boolean) {
  const ticks = ticksOf(t.plan, t.facts, dayOf(t.days, t.today).manual)
  if (write) {
    const next = withSnap(t.days, t.today, snapOf(t.plan, ticks))
    if (next) saveDays(db, next, t.today)
  }
  return ticks
}

// ---------- the weekly review ----------

export function weekReviewOf(db: DB, stIn?: any, now = new Date()): WeekReview {
  const today = sportToday(now)
  const week = reviewWeek(today)
  const end = addDays(week, 6) < today ? addDays(week, 6) : today
  const config = loadCoach(db)
  const st = sportOf(db, stIn)
  const data = trainOf(st)
  const points = safe(() => bodyPoints(db, today, 42), [])
  const weights = weeklyAverages(points, today, 5).filter((w) => w.week <= week)
  const done = new Set(doneSessions(data.log).filter((s) => s.date >= week && s.date <= end).map((s) => s.date))
  for (const r of safe(() => db.prepare('SELECT DISTINCT day FROM workouts WHERE day >= ? AND day <= ?').all(week, end) as any[], [])) done.add(String(r.day))
  const levelUps: string[] = []
  const ready: { ladder: string; index: number; name: string }[] = []
  for (const ladder of data.ladders) {
    const lv = data.levels[ladder.id]
    for (const [idx, d] of Object.entries(lv?.reached ?? {})) if (d >= week && d <= end && ladder.levels[Number(idx)]) levelUps.push(moveName(ladder.levels[Number(idx)].move))
    safe(() => {
      const cur = currentLevel(st ?? {}, data, ladder)
      const level = ladder.levels[cur.index]
      const next = ladder.levels[cur.index + 1]
      if (!level || !next) return
      const sessions = moveSessions(st ?? {}, level.move, today)
      const status = levelStatus(sessions, level, setsFor(laddersFor(data.ladders, ladder.type).indexOf(ladder), ladder.type), cur.since)
      if (status.state === 'complete' && suggestNow(status, sessions[sessions.length - 1] ?? null, lv?.declinedOn)) ready.push({ ladder: ladder.id, index: cur.index + 1, name: moveName(next.move) })
    }, undefined)
  }
  const days = loadDays(db, today)
  const checkins = Object.entries(days.days)
    .filter(([d, x]) => d >= week && d <= end && x.checkin)
    .map(([, x]) => ({ energy: x.checkin!.energy, soreness: x.checkin!.soreness }))
  const tired = safe(() => strengthDrops(st?.sets ?? {}, Array.isArray(st?.exercises) ? st.exercises : [], today).length > 0 || allHardWeek(st?.sets ?? {}, today), false)
  return weeklyReview({
    week,
    weights,
    waist: waistChange(points, end),
    food: kcalDays(db, week, end),
    sessions: { done: done.size, planned: data.week.days.filter((d) => d !== 'rest').length },
    levelUps,
    ready,
    checkins,
    adjust: safe(() => adjustNow(db, now), { state: 'none', kind: 'nodata', title: '', why: '', perWeek: null } as any),
    target: safe(() => foodTargetsNow(db, today).kcal, 2700),
    tired,
    lighterOn: !!safe(() => lighterOn(st, today), null),
    weekNo: coachWeekNo(config, end)
  })
}
