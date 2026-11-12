import { bedNightDay, computeSleepStats, isBedOnTime, isWakeOnTime, targetForDay, wakyFill, type SleepLog, type SleepSummary } from '@core/sleep'
import { daysBetween } from '@core/dates'
import { bedWatchStep, cleanBedWatch, startBedWatch, type BedWatch } from '@core/bedSense'
import { LedgerError } from '@core/ledger'
import { DEFAULT_BED, DEFAULT_WAKE } from '@core/lifeFit'
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
    return getSetting(this.db, 'sleep_weekday_target') || DEFAULT_WAKE
  }

  weekendTarget(): string {
    // One meaning of on time: the weekend uses the same 06:45 unless you set your own.
    return getSetting(this.db, 'sleep_weekend_target') || this.weekdayTarget()
  }

  bedtimeTarget(): string {
    return getSetting(this.db, 'sleep_bed_target') || DEFAULT_BED
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
    const w = this.bedWatch()
    // What the "Going to bed" check saw, for the night just gone or tonight (shown on the Sleep page).
    const bedCheck = w && daysBetween(today, w.day) >= 0 && daysBetween(today, w.day) <= 1 ? { day: w.day, lines: w.log, stillUp: w.stillUp, done: w.done } : null
    return { ...computeSleepStats(this.logs(), today, this.weekdayTarget(), this.weekendTarget()), bedTarget: this.bedtimeTarget(), bedCheck }
  }

  private bedWatch(): BedWatch | null {
    try {
      return cleanBedWatch(JSON.parse(getSetting(this.db, 'sleep_bed_watch') || 'null'))
    } catch {
      return null
    }
  }

  /**
   * The desktop's minute check after a "Going to bed" tap (core/bedSense.ts):
   * still on the PC 30+ minutes later takes the bed points back; once the PC is
   * left alone, the bedtime becomes the last moment it was used (a record, no
   * points). Returns the sentence to show when something changed.
   */
  bedActivity(idleSec: number, now = new Date()): { said: string | null } {
    const w = this.bedWatch()
    if (!w || w.done) return { said: null }
    const { watch, step } = bedWatchStep(w, now, idleSec)
    // Saved when something happened, else every 5 minutes (a synced setting: no write every minute).
    if (step.kind !== 'none' || (watch.lastTick ?? 0) - (w.lastTick ?? w.tapAt) >= 5 * 60_000) setSetting(this.db, 'sleep_bed_watch', JSON.stringify(watch))
    if (step.kind === 'stillUp') {
      this.unpay('sleep.bed_on_time', watch.payDay, now)
      return { said: watch.log[watch.log.length - 1] }
    }
    if (step.kind === 'settle') {
      const row = this.db.prepare('SELECT * FROM sleep_logs WHERE day = ?').get(watch.day) as SleepLogRow | undefined
      if (row) {
        const target = row.bed_target || this.bedtimeTarget()
        this.db.prepare('UPDATE sleep_logs SET bed_time = ?, bed_on_time = ? WHERE day = ?').run(step.time, isBedOnTime(step.time, target) ? 1 : 0, watch.day)
      }
      return { said: watch.log[watch.log.length - 1] }
    }
    return { said: null }
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

    // Points only for a wake-up logged as you get up (a tap, the Waky alarm,
    // or a time within 20 minutes of now). A time typed later is recorded,
    // not paid (H1).
    const nowMin = now.getHours() * 60 + now.getMinutes()
    const [wh, wm] = wakeTime.split(':').map(Number)
    // BG18: around midnight 23:55 and 00:05 are 10 minutes apart, not 1430.
    const gap = Math.abs(nowMin - (wh * 60 + wm)) % 1440
    const live = !time || Math.min(gap, 1440 - gap) <= 20
    let awarded = false
    if (onTime && live) {
      try {
        awarded = !!this.wallet.payOnce('sleep.up_on_time', { day: today, ref: `up:${today}`, note: `Up at ${wakeTime} (target ${target})`, now })
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

    // A bedtime logged as you go (a tap, or a time within 20 minutes of now): the desktop
    // checks that the PC really stops (bedActivity). A time typed later is not watched.
    const [bh, bm] = bedTime.split(':').map(Number)
    const gap = Math.abs(now.getHours() * 60 + now.getMinutes() - (bh * 60 + bm)) % 1440
    if (!time || Math.min(gap, 1440 - gap) <= 20) setSetting(this.db, 'sleep_bed_watch', JSON.stringify(startBedWatch(now, today, this.wallet.today(now), bedTime)))

    let awarded = false
    if (onTime) {
      try {
        awarded = !!this.wallet.payOnce('sleep.bed_on_time', { day: this.wallet.today(now), ref: `bed:${today}`, note: `In bed at ${bedTime} (target ${target})`, now })
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

  /** A bedtime for a past night (the morning row `day`): the record only, no coins. */
  setBed(day: string, time: string, now = new Date()): SleepLog {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) throw new LedgerError('Use a day and a time like 23:30')
    const target = this.bedtimeTarget()
    const onTime = isBedOnTime(time, target) ? 1 : 0
    const existing = this.db.prepare('SELECT * FROM sleep_logs WHERE day = ?').get(day) as SleepLogRow | undefined
    if (existing) this.db.prepare('UPDATE sleep_logs SET bed_time = ?, bed_target = ?, bed_on_time = ? WHERE day = ?').run(time, target, onTime, day)
    else
      this.db
        .prepare('INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, bed_time, bed_target, bed_on_time, quality, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, NULL, ?)')
        .run(day, '', targetForDay(day, this.weekdayTarget(), this.weekendTarget()), time, target, onTime, now.toISOString())
    return toLog(this.db.prepare('SELECT * FROM sleep_logs WHERE day = ?').get(day) as SleepLogRow)
  }

  /**
   * Copies Waky's wake-ups and bedtimes (its synced data) into the sleep log
   * where the log has no time yet. Today's wake-up and tonight's bedtime pay
   * like logging them here (once); earlier days are records only.
   */
  fromWaky(now = new Date()): { wakes: number; beds: number; awarded: boolean } {
    let waky: unknown = null
    try {
      waky = JSON.parse(getSetting(this.db, 'app_sync_waky') || 'null')?.data ?? JSON.parse(getSetting(this.db, 'waky_backup_json') || 'null')
    } catch {
      return { wakes: 0, beds: 0, awarded: false }
    }
    if (!waky) return { wakes: 0, beds: 0, awarded: false }
    const today = this.wallet.today(now)
    const plan = wakyFill(waky, this.logs(), today)
    let awarded = false
    for (const w of plan.wakes) {
      try {
        awarded = (w.day === today ? this.logWake(w.time, undefined, now) : this.setWake(w.day, w.time, now)).awarded || awarded
      } catch {
        /* out of range: Waky keeps it */
      }
    }
    // Tonight's bedtime (it's evening or night now): like logging it here.
    const night = now.getHours() >= 12 || now.getHours() < 4
    const tonight = bedNightDay(today, now.getHours())
    for (const b of plan.beds) {
      if (night && b.day === tonight) awarded = this.logBed(b.time, now).awarded || awarded
      else this.setBed(b.day, b.time, now)
    }
    return { wakes: plan.wakes.length, beds: plan.beds.length, awarded }
  }
}
