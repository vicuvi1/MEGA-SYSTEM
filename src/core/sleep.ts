import { addDays, daysBetween } from './dates'
import { bestDayStreak, dayStreak } from './streaks'

export interface SleepLog {
  id: number
  day: string // YYYY-MM-DD
  wakeTime: string // HH:mm
  wakeTarget: string // HH:mm
  onTime: boolean
  bedTime: string | null // HH:mm
  bedTarget: string | null // HH:mm
  bedOnTime: boolean | null
  quality: number | null // 1-5
  createdAt: string
}

export interface SleepSummary {
  today: string
  weekdayTarget: string
  weekendTarget: string
  todayLog: SleepLog | null
  streak: number
  bestStreak: number
  onTimeRate: number | null
  avgSleepMin: number | null
  recentLogs: SleepLog[]
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10))
  if (isNaN(h) || isNaN(m)) return 0
  return h * 60 + m
}

export function fromMinutes(min: number): string {
  const norm = ((min % 1440) + 1440) % 1440
  const h = Math.floor(norm / 60)
  const m = norm % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * On-time check: wake up at or before target (with up to 15 min grace, consistent with Waky).
 */
export function isWakeOnTime(wakeTime: string, targetTime: string, graceMinutes = 15): boolean {
  const w = toMinutes(wakeTime)
  const t = toMinutes(targetTime)
  return w <= t + graceMinutes
}

/** Bedtime check: in bed within 30 min of bedtime target. */
export function isBedOnTime(bedTime: string, targetTime: string, graceMinutes = 30): boolean {
  const b = toMinutes(bedTime)
  const t = toMinutes(targetTime)
  const diff = Math.abs(b - t)
  return diff <= graceMinutes || diff >= 1440 - graceMinutes
}

export function targetForDay(day: string, weekdayTarget: string, weekendTarget: string): string {
  const date = new Date(`${day}T12:00:00Z`)
  const dow = date.getUTCDay()
  const isWeekend = dow === 0 || dow === 6
  return isWeekend ? weekendTarget : weekdayTarget
}

export function computeSleepStats(
  logs: SleepLog[],
  today: string,
  weekdayTarget = '07:00',
  weekendTarget = '08:30'
): SleepSummary {
  const valid = logs.filter((l) => l.day <= today).sort((a, b) => b.day.localeCompare(a.day))
  const todayLog = valid.find((l) => l.day === today) ?? null
  const onTimeDays = valid.filter((l) => l.onTime).map((l) => l.day)

  const streak = dayStreak(onTimeDays, today)
  const bestStreak = bestDayStreak(onTimeDays)

  const last14Days = valid.slice(0, 14)
  const onTimeRate = last14Days.length > 0
    ? last14Days.filter((l) => l.onTime).length / last14Days.length
    : null

  let sleepMinsTotal = 0
  let sleepCount = 0
  for (const l of valid) {
    if (l.wakeTime && l.bedTime) {
      const w = toMinutes(l.wakeTime)
      const b = toMinutes(l.bedTime)
      const dur = w >= b ? w - b : 1440 - b + w
      if (dur >= 180 && dur <= 900) {
        sleepMinsTotal += dur
        sleepCount++
      }
    }
  }

  return {
    today,
    weekdayTarget,
    weekendTarget,
    todayLog,
    streak,
    bestStreak,
    onTimeRate,
    avgSleepMin: sleepCount > 0 ? Math.round(sleepMinsTotal / sleepCount) : null,
    recentLogs: valid.slice(0, 14)
  }
}
