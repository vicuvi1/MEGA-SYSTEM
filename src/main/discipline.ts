import { addDays } from '@core/dates'
import {
  dayNumber, milestoneRef, milestonesOf, planCheckIn, planUrgeFinish, quoteFor, rankFor, startOf, statsOf, validateStart,
  type DisciplineEvent, type DisciplineKind
} from '@core/discipline'
import { effective, LedgerError } from '@core/ledger'
import type { DisciplineState } from '@shared/api'
import type { DB } from './db'
import { getSetting, setSetting } from './settings'
import type { Wallet } from './wallet'

export class Discipline {
  constructor(private db: DB, private wallet: Wallet) {}

  private events(): DisciplineEvent[] {
    return this.db.prepare('SELECT id, kind, day, ts FROM discipline_events ORDER BY id').all() as DisciplineEvent[]
  }

  private record(kind: DisciplineKind, day: string, now: Date): void {
    this.db.prepare('INSERT INTO discipline_events (kind, day, ts) VALUES (?, ?, ?)').run(kind, day, now.toISOString())
  }

  private claimedRefs(): Set<string> {
    return new Set(effective(this.wallet.entries()).map((e) => e.ref ?? '').filter((r) => r.startsWith('milestone:')))
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
      stealth: getSetting(this.db, 'discipline_stealth') === '1',
      quote: quoteFor(today)
    }
  }

  setStart(day: string, now = new Date()): void {
    const events = this.events()
    validateStart(day, this.wallet.today(now), events)
    this.record('start', day, now)
  }

  checkIn(now = new Date()): void {
    this.db.transaction(() => {
      const today = this.wallet.today(now)
      planCheckIn(this.events(), today)
      this.wallet.awardRule('discipline.clean_day', { now, ref: `discipline:checkin:${today}` })
      this.record('checkin', today, now)
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
    setSetting(this.db, 'discipline_stealth', on ? '1' : '0')
  }
}
