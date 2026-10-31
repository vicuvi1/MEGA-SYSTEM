// Reads what "Am I improving?" (@core/progress) needs from the database.
import { addDays } from '@core/dates'
import { progressReport, type ProgressInput, type ProgressReport } from '@core/progress'
import { TODOIST_RULE } from '@core/todoist'
import type { DB } from './db'
import type { Wallet } from './wallet'

export class ProgressService {
  constructor(private db: DB, private wallet: Wallet) {}

  input(spending: ProgressInput['spending'], now = new Date()): ProgressInput {
    const today = this.wallet.today(now)
    const since = addDays(today, -60)
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
      discipline: all("SELECT kind, day FROM discipline_events WHERE kind IN ('start', 'reset')"),
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
}
