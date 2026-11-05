// Reads what "Am I improving?" (@core/progress) needs from the database.
import { addDays } from '@core/dates'
import { progressReport, type ProgressInput, type ProgressReport } from '@core/progress'
import { insights, type Insights } from '@core/insights'
import { growth, type Growth } from '@core/growth'
import { TODOIST_RULE } from '@core/todoist'
import type { DB } from './db'
import type { Wallet } from './wallet'
import { undoneResets } from './discipline'

export class ProgressService {
  constructor(private db: DB, private wallet: Wallet) {}

  input(spending: ProgressInput['spending'], now = new Date(), days = 60): ProgressInput {
    const today = this.wallet.today(now)
    const since = addDays(today, -days)
    const all = <T>(sql: string, ...args: unknown[]) => {
      try {
        return this.db.prepare(sql).all(...args) as T[]
      } catch {
        return [] as T[] // a table an older database doesn't have yet
      }
    }
    const plans = all<{ day: string; items: string }>('SELECT day, items FROM day_plans WHERE day >= ?', since)
    return {
      today,
      focus: all('SELECT day, minutes FROM focus_sessions WHERE day >= ?', since),
      wakes: all<{ day: string; on_time: number }>('SELECT day, on_time FROM sleep_logs WHERE day >= ?', since).map((r) => ({ day: r.day, onTime: !!r.on_time })),
      workouts: all('SELECT day FROM workouts WHERE day >= ?', since),
      discipline: (() => {
        const undone = undoneResets(this.db)
        return all<{ id: number; kind: string; day: string }>("SELECT id, kind, day FROM discipline_events WHERE kind IN ('start', 'reset') ORDER BY id")
          .filter((r) => !undone.has(r.id))
          .map((r) => ({ kind: r.kind, day: r.day }))
      })(),
      todoist: all(
        "SELECT day FROM ledger WHERE rule_id = ? AND kind = 'earn' AND day >= ? AND id NOT IN (SELECT undo_of FROM ledger WHERE undo_of IS NOT NULL)",
        TODOIST_RULE,
        since
      ),
      mustdos: plans.flatMap((p) => {
        try {
          return (JSON.parse(p.items) as { done?: boolean }[]).map((x) => ({ day: p.day, done: !!x.done }))
        } catch {
          return []
        }
      }),
      spending
    }
  }

  report(spending: ProgressInput['spending'], now = new Date()): ProgressReport {
    return progressReport(this.input(spending, now))
  }

  /** Your year: a heatmap of good days and your streaks. */
  insights(now = new Date()): Insights {
    return insights(this.input(null, now, 366))
  }

  /** Growth over weeks and months, you vs your past, records and milestones (all your history). */
  growth(spending: ProgressInput['spending'], now = new Date()): Growth {
    return growth(this.input(spending, now, 3650))
  }
}
