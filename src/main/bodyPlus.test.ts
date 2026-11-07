import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from './db'
import { bodyPlusView, bodyWeekReport, logMeal, logProtein, readinessNow, savePrefs, saveTape, tickSupp } from './bodyPlus'
import { toggleEntry } from './bodyLog'

let dir: string
let db: DB
const now = new Date('2026-11-07T12:00:00')
const ledgerTotals = (d: DB) => d.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(coins), 0) AS c FROM ledger').get()

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-bodyplus-test-'))
  db = openDb(join(dir, 'life.db'))
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('body boost on the database', () => {
  it('protein rows in the one log: today, removed entries, saved meals, goal from the latest weight', () => {
    db.prepare("INSERT INTO body_metrics (day, weight, waist, note, updated_at) VALUES ('2026-11-06', 70, NULL, NULL, 'x')").run()
    const id = logProtein(db, { food: 'egg', g: 12 }, 'web', { now })
    logProtein(db, { food: 'other', g: 30 }, 'telegram', { now: new Date(now.getTime() + 60_000) })
    savePrefs(db, { meals: [{ id: 'meal-b', name: 'Breakfast', items: [{ food: 'egg', qty: 3 }, { food: 'cottage', qty: 2 }] }] })
    expect(logMeal(db, 'meal-b', 'web', new Date(now.getTime() + 120_000))).toMatchObject({ g: 46, name: 'Breakfast' })
    toggleEntry(db, id, 'web', now)
    const v = bodyPlusView(db, now)
    expect(v.today).toBe(76)
    expect(v.goal.g).toBe(125)
    expect(v.entries.map((e) => [e.name, e.removed])).toEqual([
      ['Egg', true],
      ['Protein', false],
      ['Breakfast', false]
    ])
    expect(() => logProtein(db, { food: 'other', g: 900 }, 'web', { now })).toThrow()
  })
  it('supplements tick once a day and pay nothing', () => {
    savePrefs(db, { supps: ['creatine'] })
    const before = ledgerTotals(db)
    expect(tickSupp(db, 'creatine', 'web', now)).toBe(true)
    expect(tickSupp(db, 'creatine', 'web', now)).toBe(false)
    const v = bodyPlusView(db, now)
    expect(v.supps).toMatchObject([{ id: 'creatine', taken: true, streak: 1 }])
    expect(ledgerTotals(db)).toEqual(before)
  })
  it('tape measurements: one row per day, sane numbers only', () => {
    saveTape(db, { arm: 33.5, chest: 96, thigh: 9999 }, now)
    const list = saveTape(db, { shoulders: 112 }, now)
    expect(list).toEqual([{ day: '2026-11-07', arm: 33.5, chest: 96, shoulders: 112 }])
  })
  it('readiness reads last night and your pick for today', () => {
    db.prepare("INSERT INTO sleep_logs (day, wake_time, wake_target, on_time, bed_time, bed_target, bed_on_time, created_at) VALUES ('2026-11-07', '06:30', '06:30', 1, '01:10', '23:30', 0, 'x')").run()
    expect(readinessNow(db, 2, now)).toMatchObject({ mode: 'light', hold: true })
    savePrefs(db, { ready: { day: '2026-11-07', mode: 'full' } })
    expect(readinessNow(db, 2, now)).toMatchObject({ mode: 'full', hold: false, auto: false })
  })
  it('the weekly body report works on an empty database', () => {
    const r = bodyWeekReport(db, now)
    expect(r.lines.length).toBeGreaterThanOrEqual(4)
    expect(r.focus).toBeTruthy()
  })
})
