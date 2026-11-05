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
  /** Tonight's bedtime, once logged (it sits on tomorrow morning's row). */
  tonight?: SleepLog | null
  /** Your bedtime target. */
  bedTarget?: string
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
/** On time = within 20 minutes of the target (the same grace as Waky). */
export function isWakeOnTime(wakeTime: string, targetTime: string, graceMinutes = 20): boolean {
  const w = toMinutes(wakeTime)
  const t = toMinutes(targetTime)
  return w <= t + graceMinutes
}

/** Bedtime check: in bed by the target, with 30 min grace. Earlier is on time too (P6). */
export function isBedOnTime(bedTime: string, targetTime: string, graceMinutes = 30): boolean {
  // Minutes since noon, so 23:30 and 00:30 compare the right way round.
  const night = (m: number) => (m - 720 + 1440) % 1440
  return night(toMinutes(bedTime)) <= night(toMinutes(targetTime)) + graceMinutes
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
  // A row with only a bedtime (the night before a wake-up) isn't a morning yet.
  const valid = logs.filter((l) => l.day <= today && !!l.wakeTime).sort((a, b) => b.day.localeCompare(a.day))
  const todayLog = valid.find((l) => l.day === today) ?? null
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)
  const tonight = logs.find((l) => l.day === tomorrow && !!l.bedTime) ?? null
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
    tonight,
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

/** The morning a bedtime belongs to: tomorrow's row for an evening or a late night (12:00–04:00). */
export function bedNightDay(appToday: string, hour: number): string {
  return hour >= 12 || hour < 4 ? new Date(Date.parse(`${appToday}T12:00:00Z`) + 86400000).toISOString().slice(0, 10) : appToday
}

/** What Waky has that the sleep log is missing: wake-ups and bedtimes to copy over. */
export interface WakyFill {
  wakes: { day: string; time: string }[]
  /** `day`: the morning row the night belongs to. */
  beds: { day: string; time: string }[]
}

const HHMM = /^(\d{1,2}):(\d{2})$/
const cleanTime = (t: unknown): string | null => {
  const m = HHMM.exec(String(t ?? '').trim())
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}
const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)

/**
 * Waky's mornings (`days[date].time`) and nights (`nights[evening date].time`,
 * the night of that evening) for the last `horizon` days, where the sleep log
 * has no time yet. Times already in the log are never overwritten: a time you
 * typed in Life System wins (Waky's own edits come through "Edit day").
 */
export function wakyFill(waky: unknown, logs: Pick<SleepLog, 'day' | 'wakeTime' | 'bedTime'>[], today: string, horizon = 14): WakyFill {
  const w = (waky && typeof waky === 'object' ? waky : {}) as { days?: Record<string, { time?: unknown }>; nights?: Record<string, { time?: unknown }> }
  const byDay = new Map(logs.map((l) => [l.day, l]))
  const recent = (d: string) => isDay(d) && d <= today && daysBetween(d, today) <= horizon
  const wakes: WakyFill['wakes'] = []
  for (const [day, rec] of Object.entries(w.days ?? {})) {
    const time = cleanTime(rec?.time)
    if (!time || !recent(day) || byDay.get(day)?.wakeTime) continue
    wakes.push({ day, time })
  }
  const beds: WakyFill['beds'] = []
  for (const [evening, rec] of Object.entries(w.nights ?? {})) {
    const time = cleanTime(rec?.time)
    if (!time || !isDay(evening)) continue
    const day = addDays(evening, 1)
    if (!recent(day) && day !== addDays(today, 1)) continue
    if (byDay.get(day)?.bedTime) continue
    beds.push({ day, time })
  }
  return { wakes: wakes.sort((a, b) => a.day.localeCompare(b.day)), beds: beds.sort((a, b) => a.day.localeCompare(b.day)) }
}
