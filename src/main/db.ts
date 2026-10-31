import Database from 'better-sqlite3'
import { DEFAULT_RULES } from '@core/rules'
import { DEFAULT_EXERCISES } from '@core/body'
import { MIGRATIONS } from '@core/schema'

export type DB = Database.Database

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}

function seedDefaults(db: DB): void {
  const insertRule = db.prepare(
    `INSERT OR IGNORE INTO rules (id, module, title, coins, xp, daily_cap, cooldown_min, enabled, sort)
     VALUES (@id, @module, @title, @coins, @xp, @dailyCap, @cooldownMin, @enabled, @sort)`
  )
  const insertExercise = db.prepare(
    `INSERT OR IGNORE INTO exercises (id, name, unit, target, category, sort, archived)
     VALUES (@id, @name, @unit, @target, @category, @sort, 0)`
  )

  db.transaction(() => {
    DEFAULT_RULES.forEach((r, i) => insertRule.run({ ...r, enabled: r.enabled ? 1 : 0, sort: i }))
    DEFAULT_EXERCISES.forEach((e) => insertExercise.run(e))
  })()
}

export function openDb(file: string): DB {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 3000')
  db.pragma('temp_store = MEMORY')
  migrate(db)
  seedDefaults(db)
  return db
}

export { getSetting, setSetting } from './settings'
