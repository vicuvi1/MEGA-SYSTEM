import { addDays } from '@core/dates'
import {
  checkInWindow, dayNumber, milestoneRef, milestonesOf, planCheckIn, planUrgeFinish, quoteFor, rankFor, resetUndoable, RESET_UNDO_MINUTES, startOf, statsOf, validateStart,
  type DisciplineEvent, type DisciplineKind
} from '@core/discipline'
import { streakRuns } from '@core/disciplineView'
import { REMINDERS } from '@core/coachKit'
import { comebackRef, dropComeback } from '@core/comeback'
import { LedgerError } from '@core/ledger'
import type { DisciplineState } from '@shared/api'
import type { DB } from './db'
import { getSetting, setSetting, readSetting, writeSetting } from './settings'
import type { Wallet } from './wallet'

const UNDONE_KEY = 'discipline_undone_resets'
/** Resets that were taken back in their first 10 minutes (MN7). */
export function undoneResets(db: DB): Set<number> {
  try {
    const v = JSON.parse(getSetting(db, UNDONE_KEY) || '[]')
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'number') : [])
  } catch {
    return new Set()
  }
}

export class Discipline {
  constructor(private db: DB, private wallet: Wallet) {}

  private events(): DisciplineEvent[] {
    const undone = undoneResets(this.db)
    const all = this.db.prepare('SELECT id, kind, day, ts FROM discipline_events ORDER BY id').all() as DisciplineEvent[]
    return undone.size ? all.filter((e) => !undone.has(e.id)) : all
  }

  private record(kind: DisciplineKind, day: string, now: Date): void {
    this.db.prepare('INSERT INTO discipline_events (kind, day, ts) VALUES (?, ?, ?)').run(kind, day, now.toISOString())
  }

  private claimedRefs(): Set<string> {
    return new Set(this.wallet.effective().map((e) => e.ref ?? '').filter((r) => r.startsWith('milestone:')))
  }

  private milestones(events: DisciplineEvent[], today: string) {
    return milestonesOf(events, today, this.claimedRefs(), (start) => this.wallet.today(new Date(start.ts)))
  }

  state(now = new Date()): DisciplineState {
    const today = this.wallet.today(now)
    const events = this.events()
    const stats = statsOf(events, today)
    const rank = rankFor(stats.current)
    const weekAgo = addDays(today, -6)
    const has = (kind: DisciplineKind) => events.some((e) => e.kind === kind && e.day === today)
    return {
      setup: !!startOf(events),
      today,
      since: stats.since,
      current: stats.current,
      day: dayNumber({ current: stats.current, resets: stats.relapses, setup: !!startOf(events) }),
      best: stats.best,
      totalClean: stats.totalClean,
      resets: stats.relapses,
      rank: rank.name,
      nextRank: rank.next,
      checkedInToday: has('checkin'),
      oathToday: has('oath'),
      resetToday: has('reset'),
      canEditStart: !events.some((e) => e.kind === 'reset'),
      milestones: this.milestones(events, today),
      urgeStartedAt: getSetting(this.db, 'urge_started_at') || null,
      urgesThisWeek: events.filter((e) => e.kind === 'urge' && e.day >= weekAgo).length,
      stealth: readSetting(this.db, 'discipline_stealth'),
      quote: quoteFor(today),
      checkIn: (() => {
        // Hours on the configured time zone's clock, the same one as wallet.today (not the PC's).
        const w = checkInWindow(events, today, this.wallet.hour(now))
        const done = events.some((e) => (e.kind === 'checkin' || e.kind === 'reset') && e.day === w.day)
        return { mode: done && w.mode !== 'wait' ? ('done' as const) : w.mode, day: w.day }
      })(),
      history: events
        .filter((e) => e.day >= addDays(today, -7 * 27) && e.kind !== 'start')
        .map((e) => ({ day: e.day, kind: e.kind, hour: this.wallet.hour(new Date(e.ts)) })),
      undoResetUntil: (() => {
        const r = resetUndoable(events, today, now)
        return r ? new Date(Date.parse(r.ts) + RESET_UNDO_MINUTES * 60_000).toISOString() : null
      })(),
      startedOn: startOf(events)?.day ?? null,
      runs: streakRuns(startOf(events)?.day ?? null, events.filter((e) => e.kind === 'reset').map((e) => e.day), today),
      why: getSetting(this.db, 'discipline_why') || null
    }
  }

  /**
   * Take back a reset made in the last 10 minutes (MN7: a test, or a wrong
   * tap). The reset is removed and its coin penalty is given back.
   */
  undoReset(now = new Date()): void {
    this.db.transaction(() => {
      const today = this.wallet.today(now)
      const r = resetUndoable(this.events(), today, now)
      if (!r) throw new LedgerError('A reset can only be taken back in the first 10 minutes.')
      // The log stays append-only: the reset is marked as taken back.
      setSetting(this.db, UNDONE_KEY, JSON.stringify([...undoneResets(this.db), r.id]))
      // The comeback plan's check-ins for this reset go with it (core/comeback.ts).
      const reminders = readSetting(this.db, REMINDERS)
      const kept = dropComeback(reminders, comebackRef(r.day))
      if (kept.length !== reminders.length) writeSetting(this.db, REMINDERS, kept)
      const undone = new Set(this.wallet.entries().filter((e) => e.kind === 'undo').map((e) => e.undoOf))
      for (const e of this.wallet.entries()) {
        if (undone.has(e.id) || e.kind === 'undo' || e.ts < r.ts.slice(0, 19)) continue
        if (e.ruleId === 'discipline.reset' || e.ref === 'perk:rulers_authority') this.wallet.undo(e.id, 'Reset taken back', now)
      }
    }).immediate()
  }

  setStart(day: string, now = new Date()): void {
    const events = this.events()
    validateStart(day, this.wallet.today(now), events)
    this.record('start', day, now)
  }

  /**
   * The clean-day check-in is for a day you lived (H2): from 19:00 (until the
   * day turns at 04:00) for today; in the morning (until 12:00) for
   * yesterday, if you didn't check it in. Earlier in the day it waits.
   */
  /** Returns the day it was for and the points really paid (BG10). */
  checkIn(now = new Date()): { day: string; coins: number } {
    return this.db.transaction(() => {
      const appToday = this.wallet.today(now)
      const win = checkInWindow(this.events(), appToday, this.wallet.hour(now))
      if (win.mode === 'wait') throw new LedgerError('The clean-day check-in opens at 19:00, when the day is done.')
      const today = win.day
      planCheckIn(this.events(), today)
      // A rule you turned off (or a used limit) never blocks the check-in itself (P7).
      let coins = 0
      try {
        const id = this.wallet.awardRule('discipline.clean_day', { now, day: today, ref: `discipline:checkin:${today}` })
        coins = this.wallet.entries().find((e) => e.id === id)?.coins ?? 0
      } catch (e) {
        if (!(e instanceof LedgerError)) throw e
      }
      this.record('checkin', today, now)
      // Milestones you reached are paid straight away, no "Claim" tap needed (P7).
      const events = this.events()
      for (const m of this.milestones(events, appToday)) if (m.status === 'claimable') this.claim(m.days, now)
      return { day: today, coins }
    }).immediate()
  }

  oath(now = new Date()): void {
    this.db.transaction(() => {
      const today = this.wallet.today(now)
      if (this.events().some((e) => e.kind === 'oath' && e.day === today)) throw new LedgerError('Oath already sworn today')
      this.wallet.awardRule('discipline.oath', { now })
      this.record('oath', today, now)
    }).immediate()
  }

  /** An honest reset: the current streak starts again; best and total stay. */
  reset(now = new Date()): void {
    this.db.transaction(() => {
      const today = this.wallet.today(now)
      const events = this.events()
      if (!startOf(events)) throw new LedgerError('Set your start date first')
      if (events.some((e) => e.kind === 'reset' && e.day === today)) throw new LedgerError('Already reset today. Tomorrow is day 1.')
      let penaltyAwarded = false
      try {
        this.wallet.awardRule('discipline.reset', { now })
        penaltyAwarded = true
      } catch (e) {
        if (!(e instanceof LedgerError)) throw e // penalty switched off or capped: still reset
      }
      if (penaltyAwarded) {
        try {
          const summary = this.wallet.summary(now)
          const hasRulersAuthority = summary.level.perks.some((p) => p.id === 'rulers_authority' && p.unlocked)
          if (hasRulersAuthority) {
            const entries = this.wallet.entries()
            const lastEntry = entries[entries.length - 1]
            if (lastEntry && lastEntry.ruleId === 'discipline.reset' && lastEntry.coins < 0) {
              const refundCoins = Math.round(Math.abs(lastEntry.coins) * 0.5)
              if (refundCoins > 0) {
                this.wallet.append({
                  ts: now.toISOString(),
                  day: today,
                  module: 'perks',
                  kind: 'earn',
                  coins: refundCoins,
                  xp: 0,
                  ref: 'perk:rulers_authority',
                  note: "Ruler's Authority: 50% Urge Reset Penalty Refund"
                })
              }
            }
          }
        } catch {
          // Perk non-fatal
        }
      }
      this.record('reset', today, now)
      setSetting(this.db, 'urge_started_at', '')
    }).immediate()
  }

  claim(days: number, now = new Date()): number {
    return this.db.transaction(() => {
      const today = this.wallet.today(now)
      const events = this.events()
      const m = this.milestones(events, today).find((x) => x.days === days)
      if (!m || m.status !== 'claimable') throw new LedgerError('Nothing to claim for that milestone')
      const since = statsOf(events, today).since!
      this.wallet.append({ ts: now.toISOString(), day: today, module: 'discipline', kind: 'earn', coins: m.coins, xp: m.coins, ref: milestoneRef(since, days), note: `${days}-day milestone` })
      return m.coins
    }).immediate()
  }

  startUrge(now = new Date()): void {
    if (getSetting(this.db, 'urge_started_at')) return // already running: keep the original start
    setSetting(this.db, 'urge_started_at', now.toISOString())
  }

  finishUrge(now = new Date()): void {
    this.db.transaction(() => {
      const started = getSetting(this.db, 'urge_started_at') || null
      planUrgeFinish(started, now)
      try {
        this.wallet.awardRule('discipline.urge_resisted', { now })
      } catch (e) {
        if (!(e instanceof LedgerError)) throw e // over the daily limit: it still counts as crushed
      }
      this.record('urge', this.wallet.today(now), now)
      setSetting(this.db, 'urge_started_at', '')
    }).immediate()
  }

  cancelUrge(): void {
    setSetting(this.db, 'urge_started_at', '')
  }

  setStealth(on: boolean): void {
    writeSetting(this.db, 'discipline_stealth', on)
  }

  /** Your reason for the streak, in your words (up to 300 characters). */
  setWhy(text: string): void {
    setSetting(this.db, 'discipline_why', String(text ?? '').trim().slice(0, 300))
  }
}
