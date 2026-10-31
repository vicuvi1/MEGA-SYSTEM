import { computeSleepStats, isBedOnTime, isWakeOnTime, targetForDay, type SleepLog, type SleepSummary } from '@core/sleep'
import { daysBetween } from '@core/dates'
import { LedgerError } from '@core/ledger'
import type { DB } from './db'
import { getSetting, setSetting } from './settings'
import type { Wallet } from './wallet'

interface SleepLogRow {
  id: number
  day: string
  wake_time: string
  wake_target: string
  on_time: number
  bed_time: string | null
  bed_target: string | null
  bed_on_time: number | null
  quality: number | null
  created_at: string
}

function toLog(r: SleepLogRow): SleepLog {
  return {
    id: r.id,
    day: r.day,
    wakeTime: r.wake_time,
    wakeTarget: r.wake_target,
    onTime: Boolean(r.on_time),
    bedTime: r.bed_time,
    bedTarget: r.bed_target,
    bedOnTime: r.bed_on_time !== null ? Boolean(r.bed_on_time) : null,
    quality: r.quality,
    createdAt: r.created_at
  }
}

export class SleepService {
  constructor(private db: DB, private wallet: Wallet) {}

  weekdayTarget(): string {
    return getSetting(this.db, 'sleep_weekday_target') || '07:00'
  }

  weekendTarget(): string {
    return getSetting(this.db, 'sleep_weekend_target') || '08:30'
  }

  bedtimeTarget(): string {
    return getSetting(this.db, 'sleep_bed_target') || '23:00'
  }

  setTargets(weekday: string, weekend: string, bedtime?: string): SleepSummary {
    if (weekday) setSetting(this.db, 'sleep_weekday_target', weekday)
    if (weekend) setSetting(this.db, 'sleep_weekend_target', weekend)
    if (bedtime) setSetting(this.db, 'sleep_bed_target', bedtime)
    return this.state()
  }

  logs(): SleepLog[] {
    const rows = this.db.prepare('SELECT * FROM sleep_logs ORDER BY day DESC').all() as SleepLogRow[]
    return rows.map(toLog)
  }

  state(now = new Date()): SleepSummary {
    const today = this.wallet.today(now)
    return computeSleepStats(this.logs(), today, this.weekdayTarget(), this.weekendTarget())
  }

  logWake(
    time?: string,
    quality?: number,
    now = new Date()
  ): { log: SleepLog; state: SleepSummary; awarded: boolean } {
    const today = this.wallet.today(now)
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const wakeTime = time || `${hh}:${mm}`
    const target = targetForDay(today, this.weekdayTarget(), this.weekendTarget())
    const onTime = isWakeOnTime(wakeTime, target)

    const existing = this.db.prepare('SELECT * FROM sleep_logs WHERE day = ?').get(today) as SleepLogRow | undefined

    if (existing) {
      this.db
        .prepare('UPDATE sleep_logs SET wake_time = ?, wake_target = ?, on_time = ?, quality = ? WHERE day = ?')
        .run(wakeTime, target, onTime ? 1 : 0, quality ?? existing.quality, today)
    } else {
      this.db
        .prepare(
          'INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, bed_time, bed_target, bed_on_time, quality, created_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?)'
        )
        .run(today, wakeTime, target, onTime ? 1 : 0, quality ?? null, now.toISOString())
    }

    let awarded = false
    if (onTime) {
      try {
        this.wallet.award('sleep.up_on_time', `Up at ${wakeTime} (target ${target})`, now)
        awarded = true
      } catch {
        // already awarded today or daily cap reached
      }
    }

    const updated = this.db.prepare('SELECT * FROM sleep_logs WHERE day = ?').get(today) as SleepLogRow
    return {
      log: toLog(updated),
      state: this.state(now),
      awarded
    }
  }

  /**
   * The real wake-up time for a day you forgot to log (or logged late).
   * Today: like logging it then (pays "up on time" if it was, once a day).
   * An earlier day (up to 14 back): the record is corrected, so the streak
   * and stats are right, but no coins are paid for the past.
   */
  setWake(day: string, time: string, now = new Date()): { log: SleepLog; state: SleepSummary; awarded: boolean } {
    const today = this.wallet.today(now)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new LedgerError('Pick a day')
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(time).trim())
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new LedgerError('Use a time like 06:45')
    const wakeTime = `${m[1].padStart(2, '0')}:${m[2]}`
    if (day > today) throw new LedgerError('That day has not come yet')
    if (daysBetween(day, today) > 14) throw new LedgerError('Only the last 14 days can be changed')
    if (day === today) return this.logWake(wakeTime, undefined, now)

    const target = targetForDay(day, this.weekdayTarget(), this.weekendTarget())
    const onTime = isWakeOnTime(wakeTime, target)
    const existing = this.db.prepare('SELECT * FROM sleep_logs WHERE day = ?').get(day) as SleepLogRow | undefined
    if (existing) {
      this.db.prepare('UPDATE sleep_logs SET wake_time = ?, wake_target = ?, on_time = ? WHERE day = ?').run(wakeTime, target, onTime ? 1 : 0, day)
    } else {
      this.db
        .prepare('INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, bed_time, bed_target, bed_on_time, quality, created_at) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)')
        .run(day, wakeTime, target, onTime ? 1 : 0, now.toISOString())
    }
    const updated = this.db.prepare('SELECT * FROM sleep_logs WHERE day = ?').get(day) as SleepLogRow
    return { log: toLog(updated), state: this.state(now), awarded: false }
  }

  logBed(
    time?: string,
    now = new Date()
  ): { log: SleepLog; state: SleepSummary; awarded: boolean } {
    const today = this.wallet.today(now)
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const bedTime = time || `${hh}:${mm}`
    const target = this.bedtimeTarget()
    const onTime = isBedOnTime(bedTime, target)

    const existing = this.db.prepare('SELECT * FROM sleep_logs WHERE day = ?').get(today) as SleepLogRow | undefined

    if (existing) {
      this.db
        .prepare('UPDATE sleep_logs SET bed_time = ?, bed_target = ?, bed_on_time = ? WHERE day = ?')
        .run(bedTime, target, onTime ? 1 : 0, today)
    } else {
      const wakeTarget = targetForDay(today, this.weekdayTarget(), this.weekendTarget())
      this.db
        .prepare(
          'INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, bed_time, bed_target, bed_on_time, quality, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, NULL, ?)'
        )
        .run(today, '07:00', wakeTarget, bedTime, target, onTime ? 1 : 0, now.toISOString())
    }

    let awarded = false
    if (onTime) {
      try {
        this.wallet.award('sleep.bed_on_time', `In bed at ${bedTime} (target ${target})`, now)
        awarded = true
      } catch {
        // already awarded today
      }
    }

    const updated = this.db.prepare('SELECT * FROM sleep_logs WHERE day = ?').get(today) as SleepLogRow
    return {
      log: toLog(updated),
      state: this.state(now),
      awarded
    }
  }
}
