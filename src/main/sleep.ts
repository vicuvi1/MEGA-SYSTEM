import { bedNightDay, computeSleepStats, isBedOnTime, isWakeOnTime, targetForDay, type SleepLog, type SleepSummary } from '@core/sleep'
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
    // The rule's name follows your target ("Up by 06:30", not a fixed 07:00).
    if (weekday) this.db.prepare("UPDATE rules SET title = ? WHERE id = 'sleep.up_on_time'").run(`Up by ${weekday}`)
    return this.state()
  }

  logs(): SleepLog[] {
    const rows = this.db.prepare('SELECT * FROM sleep_logs ORDER BY day DESC').all() as SleepLogRow[]
    return rows.map(toLog)
  }

  state(now = new Date()): SleepSummary {
    const today = this.wallet.today(now)
    return { ...computeSleepStats(this.logs(), today, this.weekdayTarget(), this.weekendTarget()), bedTarget: this.bedtimeTarget() }
  }

  /** How you slept (1–5) for a morning already logged (the bot's check-in buttons). */
  setQuality(day: string, quality: number): SleepLog {
    const q = Math.round(quality)
    if (!(q >= 1 && q <= 5)) throw new LedgerError('Sleep quality is 1 to 5')
    const row = this.db.prepare('SELECT * FROM sleep_logs WHERE day = ?').get(day) as SleepLogRow | undefined
    if (!row) throw new LedgerError('Log the wake-up first')
    this.db.prepare('UPDATE sleep_logs SET quality = ? WHERE day = ?').run(q, day)
    return toLog({ ...row, quality: q })
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

    // "I'm up" again later (after a nap, or at 3 am before the day turns) keeps
    // the first wake-up of the day; only a time you type changes it (X8).
    if (existing && existing.wake_time && !time) return { log: toLog(existing), state: this.state(now), awarded: false }

    // Corrected to a late time: the "up on time" points go back (P3).
    if (existing && existing.on_time && !onTime) this.unpay('sleep.up_on_time', today, now)
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

  /** Takes back a sleep reward paid that day (a correction made it wrong). */
  private unpay(ruleId: string, day: string, now: Date): void {
    const all = this.wallet.entries()
    const undone = new Set(all.map((e) => e.undoOf).filter((x): x is number => x != null))
    const paid = all.filter((e) => e.ruleId === ruleId && e.day === day && e.coins > 0 && !undone.has(e.id)).pop()
    if (paid) {
      try {
        this.wallet.undo(paid.id, 'Sleep time corrected', now)
      } catch {
        /* already taken back */
      }
    }
  }

  logBed(
    time?: string,
    now = new Date()
  ): { log: SleepLog; state: SleepSummary; awarded: boolean } {
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const bedTime = time || `${hh}:${mm}`
    const target = this.bedtimeTarget()
    const onTime = isBedOnTime(bedTime, target)
    // A night belongs to the morning it ends in: bed at 23:30 (or 01:30) goes on
    // tomorrow morning's row, next to that wake-up, so hours slept are right.
    const today = bedNightDay(this.wallet.today(now), now.getHours())

    const existing = this.db.prepare('SELECT * FROM sleep_logs WHERE day = ?').get(today) as SleepLogRow | undefined

    // Corrected to a late bedtime: the "in bed on time" points go back (P3).
    if (existing && existing.bed_on_time && !onTime) this.unpay('sleep.bed_on_time', this.wallet.today(now), now)
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
        // No wake-up yet: an empty wake time (never a made-up 07:00).
        .run(today, '', wakeTarget, bedTime, target, onTime ? 1 : 0, now.toISOString())
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
