// Body → Growth: the long-run numbers on any database with the better-sqlite3
// API (read only). Every weigh-in and body_metrics day, each day's kcal and
// protein from the food log, the days with reps, and sleep, with an "on time"
// flag per row (logged on its day or the day after) so growth levels can leave
// back-dated logs out. Pure rules: src/core/growthBody.ts, growthLevels.ts.
import type { DB } from './db'
import { sportToday } from '../core/sportShared'
import { kcalOfDay } from '../core/food'
import { proteinOfDay } from '../core/protein'
import { nightMinutes } from '../core/readiness'
import { growthPoints, loggedOnTime, type FoodDay, type SleepNight } from '../core/growthBody'
import type { DayPoint } from '../core/bodyComp'
import type { BodyEvent } from '../core/bodyLog'
import { listBodyComp } from './bodyComp'
import { bodyEvents } from './bodyLog'
import { readPrefs } from './bodyPlus'
import { foodTargetsNow } from './food'

export interface GrowthData {
  today: string
  points: DayPoint[]
  honestPoints: DayPoint[]
  food: FoodDay[]
  reps: { day: string; onTime: boolean }[]
  sleep: SleepNight[]
  gPerKg: number
  kcalGoal: number | null
}

const rowOnTime = (e: BodyEvent) => e.source !== 'earlier' && loggedOnTime(e.day, e.at)

export function growthData(db: DB, now = new Date()): GrowthData {
  const today = sportToday(now)
  const rows = listBodyComp(db, '0000-00-00', today)
  let metrics: { day: string; weight: number | null; waist: number | null; updated_at: string | null }[] = []
  try {
    metrics = (db.prepare('SELECT day, weight, waist, updated_at FROM body_metrics WHERE day <= ? ORDER BY day').all(today) as any[]).map((m) => ({
      day: String(m.day),
      weight: m.weight == null ? null : Number(m.weight),
      waist: m.waist == null ? null : Number(m.waist),
      updated_at: m.updated_at == null ? null : String(m.updated_at)
    }))
  } catch {
    metrics = []
  }
  const { points, honest } = growthPoints(rows, metrics)
  const events = bodyEvents(db, '0000-00-00', today)
  const byDay = new Map<string, BodyEvent[]>()
  for (const e of events) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e])
  const food: FoodDay[] = []
  const reps: { day: string; onTime: boolean }[] = []
  for (const [day, l] of [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const kcal = kcalOfDay(l, day)
    const protein = proteinOfDay(l, day)
    if (kcal > 0 || protein > 0) food.push({ day, kcal: Math.round(kcal), protein: Math.round(protein), proteinOnTime: Math.round(proteinOfDay(l.filter((e) => e.undoes != null || rowOnTime(e)), day)) })
    const r = l.filter((e) => e.kind.startsWith('reps:') && e.amount > 0)
    if (r.length) reps.push({ day, onTime: r.some(rowOnTime) })
  }
  let sleep: SleepNight[] = []
  try {
    sleep = (db.prepare('SELECT day, bed_time, wake_time, created_at FROM sleep_logs WHERE day <= ? ORDER BY day').all(today) as any[]).map((r) => ({
      day: String(r.day),
      minutes: nightMinutes({ bedTime: r.bed_time, wakeTime: r.wake_time }),
      onTime: loggedOnTime(String(r.day), r.created_at)
    }))
  } catch {
    sleep = []
  }
  let kcalGoal: number | null = null
  try {
    kcalGoal = foodTargetsNow(db, today).kcal
  } catch {
    kcalGoal = null
  }
  let gPerKg = 1.8
  try {
    gPerKg = readPrefs(db).gPerKg
  } catch {
    /* defaults */
  }
  return { today, points, honestPoints: honest, food, reps, sleep, gPerKg, kcalGoal }
}
