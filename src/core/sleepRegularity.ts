// How steady your sleep is (pure): the spread of bed and wake times over the
// last two weeks gives a 0–100 regularity score, and the shift of your
// sleep's midpoint on weekend mornings against weekdays is "social jet lag".
// Hours slept pair the bedtime and wake-up of the same night (one morning's row).
import type { SleepLog } from './sleep'
import { nightMinutes } from './readiness'

const toM = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
/** Minutes around midnight-noon, so 23:30 and 00:30 are an hour apart (not 23). */
const around = (m: number) => (m >= 12 * 60 ? m - 1440 : m)
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
}
const isWeekendMorning = (day: string) => [0, 6].includes(new Date(`${day}T12:00:00Z`).getUTCDay())

export interface Regularity {
  score: number | null
  bedSpreadMin: number | null
  wakeSpreadMin: number | null
  /** Weekend sleep midpoint minus weekdays', in minutes (positive: later on weekends). */
  socialJetLagMin: number | null
  nights: { day: string; minutes: number }[]
  avgMin: number | null
}

export function sleepRegularity(logs: SleepLog[]): Regularity {
  const recent = [...logs].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14)
  const beds = recent.filter((l) => l.bedTime).map((l) => around(toM(l.bedTime!)))
  const wakes = recent.filter((l) => l.wakeTime).map((l) => toM(l.wakeTime))
  const bedSpread = beds.length >= 3 ? Math.round(sd(beds)) : null
  const wakeSpread = wakes.length >= 3 ? Math.round(sd(wakes)) : null
  const spreads = [bedSpread, wakeSpread].filter((x): x is number => x != null)
  const score = spreads.length ? Math.max(0, Math.min(100, Math.round(100 - (spreads.reduce((a, b) => a + b, 0) / spreads.length) * (50 / 60)))) : null
  const nights = recent.map((l) => ({ day: l.day, minutes: nightMinutes(l) })).filter((n): n is { day: string; minutes: number } => n.minutes != null)
  const mid = (l: SleepLog) => (l.bedTime && l.wakeTime ? around(toM(l.bedTime)) + (nightMinutes(l) ?? 0) / 2 : null)
  const wk = recent.filter((l) => !isWeekendMorning(l.day)).map(mid).filter((x): x is number => x != null)
  const we = recent.filter((l) => isWeekendMorning(l.day)).map(mid).filter((x): x is number => x != null)
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  return {
    score,
    bedSpreadMin: bedSpread,
    wakeSpreadMin: wakeSpread,
    socialJetLagMin: wk.length && we.length ? Math.round(avg(we) - avg(wk)) : null,
    nights: nights.reverse(),
    avgMin: nights.length ? Math.round(avg(nights.map((n) => n.minutes))) : null
  }
}
