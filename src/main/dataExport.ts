import { redactRows } from '../core/backupPlan'
import { toExpensesCsv, toWorkoutsCsv } from '@core/dataExport'
import type { Body } from './body'
import type { DB } from './db'
import type { MoneyService } from './money'

export class DataExportService {
  constructor(private db: DB, private body: Body, private money: MoneyService) {}

  exportJson(): string {
    const payload = {
      version: '0.8.0',
      exportedAt: new Date().toISOString(),
      ledger: this.db.prepare('SELECT * FROM ledger ORDER BY id ASC').all(),
      workouts: this.body.workouts(1000),
      bodyMetrics: this.body.metrics(),
      exercises: this.body.exercises(),
      sleepLogs: this.db.prepare('SELECT * FROM sleep_logs ORDER BY day ASC').all(),
      expenses: this.money.expenses(1000),
      rules: this.db.prepare('SELECT * FROM rules ORDER BY sort ASC').all(),
      disciplineEvents: this.db.prepare('SELECT * FROM discipline_events ORDER BY id ASC').all(),
      tasks: this.db.prepare('SELECT * FROM tasks ORDER BY id ASC').all(),
      blocks: this.db.prepare('SELECT * FROM blocks ORDER BY id ASC').all(),
      settings: redactRows('settings', this.db.prepare('SELECT * FROM settings').all() as Record<string, unknown>[])
    }
    return JSON.stringify(payload, null, 2)
  }

  exportCsv(kind: 'workouts' | 'expenses'): string {
    if (kind === 'workouts') {
      return toWorkoutsCsv(this.body.workouts(1000))
    }
    return toExpensesCsv(this.money.expenses(1000), this.money.currency())
  }
}
