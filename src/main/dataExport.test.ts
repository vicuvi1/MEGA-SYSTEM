import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from './db'
import { Wallet } from './wallet'
import { Body } from './body'
import { MoneyService } from './money'
import { DataExportService } from './dataExport'

let dir: string
let db: DB
let wallet: Wallet
let body: Body
let money: MoneyService
let exporter: DataExportService

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-export-test-'))
  db = openDb(join(dir, 'life.db'))
  wallet = new Wallet(db, 'UTC')
  body = new Body(db, wallet)
  money = new MoneyService(db, wallet)
  exporter = new DataExportService(db, body, money)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('DataExportService (main)', () => {
  it('exports full database state to valid JSON', () => {
    body.logWorkout({
      title: 'Full Body Test',
      items: [{ exerciseId: 'pushups', name: 'Push-ups', amount: 30, unit: 'reps' }]
    })
    money.addExpense(2500, 'food', 'Lunch')

    const jsonStr = exporter.exportJson()
    const parsed = JSON.parse(jsonStr)

    expect(parsed.version).toBe('0.8.0')
    expect(parsed.exportedAt).toBeDefined()
    expect(Array.isArray(parsed.workouts)).toBe(true)
    expect(parsed.workouts.length).toBe(1)
    expect(parsed.workouts[0].title).toBe('Full Body Test')
    expect(Array.isArray(parsed.expenses)).toBe(true)
    expect(parsed.expenses.length).toBe(1)
    expect(parsed.expenses[0].amount).toBe(2500)
    expect(Array.isArray(parsed.ledger)).toBe(true)
  })

  it('exports CSV for workouts and expenses', () => {
    body.logWorkout({
      title: 'Leg Day',
      items: [{ exerciseId: 'squats', name: 'Squats', amount: 40, unit: 'reps' }]
    })
    money.addExpense(1200, 'transit', 'Bus pass')

    const workoutsCsv = exporter.exportCsv('workouts')
    expect(workoutsCsv).toContain('Date,Title,Notes,Exercises')
    expect(workoutsCsv).toContain('Leg Day')

    const expensesCsv = exporter.exportCsv('expenses')
    expect(expensesCsv).toContain('Date,Amount,Currency,Category,Note')
    expect(expensesCsv).toContain('12.00')
    expect(expensesCsv).toContain('transit')
  })
})
