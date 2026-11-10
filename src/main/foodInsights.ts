// The food extras on any database (this device's copy, or the bot server's):
// the gallery, the charts, the accuracy check, the next meal, the workout note,
// "protein left", the night summary and the newest logged meal (for the
// island's notice). Pure logic: core/foodInsights.ts, core/foodTiming.ts,
// core/foodScore.ts. Read only; nothing here pays points.
import type { DB } from './db'
import { getSetting } from './settings'
import { addDays } from '../core/dates'
import { sportToday } from '../core/sportShared'
import { liveIds } from '../core/bodyLog'
import { isProteinKind } from '../core/protein'
import { DEFAULT_BED } from '../core/lifeFit'
import { mealsOfDay, type DayMeal, type MealType } from '../core/food'
import { accuracyCheck, daySummary, foodCharts, galleryDays, type Accuracy, type DaySummary, type FoodCharts, type GalleryDay } from '../core/foodInsights'
import { nextMeal, proteinLeftLine, usualMealTimes, usualTrainStart, workoutNote, type NextMeal } from '../core/foodTiming'
import { bodyEvents, sportBlob } from './bodyLog'
import { bodyPoints, foodDayTotals, readFoodLog, whatNextNow } from './food'

/** The live meals of the last `days` days (oldest day first), with totals and removed ones marked. */
export function mealsSince(db: DB, now = new Date(), days = 21): DayMeal[] {
  const today = sportToday(now)
  const from = addDays(today, -(days - 1))
  const log = readFoodLog(db, today)
  const events = bodyEvents(db, addDays(from, -1), today)
  const out: DayMeal[] = []
  for (let k = days - 1; k >= 0; k--) out.push(...mealsOfDay(log, events, addDays(today, -k)))
  return out
}

/** Today's training: the first and last set logged in Sport Track, or null. */
export function trainingSpan(db: DB, day: string): { start: Date; end: Date } | null {
  try {
    const sets = sportBlob(db)?.sets?.[day]
    if (!sets || typeof sets !== 'object') return null
    const ts: number[] = []
    for (const list of Object.values(sets) as any[]) for (const s of Array.isArray(list) ? list : []) if (typeof s?.at === 'string' && Number.isFinite(Date.parse(s.at))) ts.push(Date.parse(s.at))
    return ts.length ? { start: new Date(Math.min(...ts)), end: new Date(Math.max(...ts)) } : null
  } catch {
    return null
  }
}

/** The first set of each of the last 14 days he trained (for his usual training time). */
export function trainStarts(db: DB, today: string): { day: string; at: string }[] {
  const out: { day: string; at: string }[] = []
  for (let k = 1; k <= 14; k++) {
    const d = addDays(today, -k)
    const s = trainingSpan(db, d)
    if (s) out.push({ day: d, at: s.start.toISOString() })
  }
  return out
}

/** Protein logged today (any way: meals, quick logs), with when. */
export function proteinMoments(db: DB, day: string): { at: Date; g: number }[] {
  const ev = bodyEvents(db, day).filter((e) => e.day === day && isProteinKind(e.kind))
  const live = liveIds(ev)
  return ev.filter((e) => !e.undoes && live.has(e.id) && e.amount > 0).map((e) => ({ at: new Date(e.at), g: Number(e.amount) || 0 }))
}

const bedMinute = (db: DB) => {
  const raw = getSetting(db, 'sleep_bed_target')
  const bed = raw && /^\d{1,2}:\d{2}$/.test(raw) ? raw : DEFAULT_BED
  const m = Number(bed.split(':')[0]) * 60 + Number(bed.split(':')[1])
  return m < 12 * 60 ? m + 1440 : m
}

/** "You trained at 17:10 with no protein…" while it still helps, else null. */
export function workoutNoteNow(db: DB, now = new Date()): string | null {
  const today = sportToday(now)
  const span = trainingSpan(db, today)
  if (!span) return null
  return workoutNote({ now, start: span.start, end: span.end, protein: proteinMoments(db, today), idea: whatNextNow(db, now).ideas[0]?.text })
}

/** The next meal: how much and what, from what is left today and the time until training (his usual time) or bed. */
export function nextMealNow(db: DB, now = new Date()): NextMeal {
  const today = sportToday(now)
  const t = foodDayTotals(db, now)
  const span = trainingSpan(db, today)
  const usualTrain = span ? null : usualTrainStart(trainStarts(db, today), today)
  const endMin = span ? span.end.getHours() * 60 + span.end.getMinutes() : null
  return nextMeal({ now, kcalLeft: t.targets.kcal - t.kcal, proteinLeft: t.targets.protein - t.protein, bed: bedMinute(db), trainAt: usualTrain, trainEnd: endMin != null && endMin < 240 ? endMin + 1440 : endMin, ideas: whatNextNow(db, now).ideas.map((x) => x.text) })
}

/** His usual breakfast, lunch and dinner times from the last 3 weeks of logs. */
export function usualTimesNow(db: DB, now = new Date()) {
  return usualMealTimes(mealsSince(db, now, 22), sportToday(now))
}

/** Logged kcal vs the weight trend over the last 2 weeks. */
export function accuracyNow(db: DB, now = new Date()): Accuracy {
  const today = sportToday(now)
  const meals = mealsSince(db, now, 15).filter((m) => !m.removed && !m.supp)
  const by = new Map<string, number>()
  for (const m of meals) by.set(m.day, (by.get(m.day) ?? 0) + m.totals.kcal)
  const t = foodDayTotals(db, now).targets
  const weights = bodyPoints(db, today, 21).filter((p) => p.weight != null).map((p) => ({ day: p.day, weight: p.weight as number }))
  const maint = t.fixed ? t.kcal - 350 : t.maintenance
  return accuracyCheck({ today, days: [...by.entries()].map(([day, kcal]) => ({ day, kcal })), weights, maintenance: maint, rough: !!t.fixed })
}

/** The food gallery: meals by day with totals (14 days). */
export const foodGallery = (db: DB, now = new Date(), days = 14): GalleryDay[] => galleryDays(mealsSince(db, now, days), sportToday(now), days)
/** The charts from the last 14 days. */
export const foodChartsNow = (db: DB, now = new Date(), days = 14): FoodCharts => foodCharts(mealsSince(db, now, days), sportToday(now), days)

/** Tonight's food summary (null when nothing was logged today). */
export function daySummaryNow(db: DB, now = new Date()): DaySummary | null {
  const today = sportToday(now)
  const t = foodDayTotals(db, now)
  return daySummary({ meals: mealsSince(db, now, 1), day: today, protein: t.protein, kcal: t.kcal, goals: { protein: t.targets.protein, kcal: t.targets.kcal }, ideas: whatNextNow(db, now).ideas.map((x) => x.text) })
}

/** "🥩 58 g protein left today: …" (with the workout note when he trained without protein). */
export function proteinLeftNow(db: DB, now = new Date()): string[] {
  const t = foodDayTotals(db, now)
  return [proteinLeftLine({ protein: t.protein, goal: t.targets.protein, ideas: whatNextNow(db, now).ideas.map((x) => x.text) }), workoutNoteNow(db, now) ?? ''].filter(Boolean)
}

export interface LoggedMeal {
  id: string
  name: string
  type: MealType
  kcal: number
  protein: number
  at: string
  source: string
}
/** The newest live meal logged (its save time) at or after `sinceMs` today, supplements left out: for the island's "Lunch logged" notice. */
export function lastLoggedMeal(db: DB, sinceMs: number, now = new Date()): LoggedMeal | null {
  const today = sportToday(now)
  const ev = bodyEvents(db, today).filter((e) => e.day === today && e.kind === 'protein:food')
  const live = liveIds(ev)
  // When each meal row was written (its own `at` can be the meal's time, e.g. an edit keeps it).
  const meals = mealsOfDay(readFoodLog(db, today), bodyEvents(db, addDays(today, -1), today), today).filter((m) => !m.removed && !m.supp && live.has(`${m.id}-p`))
  const fresh = meals.filter((m) => Date.parse(m.at) >= sinceMs).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const m = fresh[0]
  return m ? { id: m.id, name: m.name, type: m.type, kcal: Math.round(m.totals.kcal), protein: Math.round(m.totals.protein), at: m.at, source: m.source ?? 'manual' } : null
}
