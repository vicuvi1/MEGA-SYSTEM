import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type DB } from './db'
import { readSetting } from './settings'
import { addBodyMeasurement, bodyCompView, latestBodyComp, listBodyComp, removeBodyMeasurement } from './bodyComp'
// @ts-expect-error plain JS module without types
import { stmtProblem } from '../../api/_sqlguard.mjs'

// Made-up numbers only; local times so the tests hold in any time zone.
let dir: string
let db: DB
const NOW = new Date(2026, 10, 9, 9, 0) // Mon 9 Nov 2026, 09:00
const t = (d: number, h = 7, min = 0, m = 10) => new Date(2026, m, d, h, min).toISOString()
const metric = (day: string) => db.prepare('SELECT weight, waist FROM body_metrics WHERE day = ?').get(day) as any
const ledger = () => (db.prepare('SELECT COUNT(*) AS n FROM ledger').get() as any).n

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  dir = mkdtempSync(join(tmpdir(), 'life-bodycomp-test-'))
  db = openDb(join(dir, 'life.db'))
})
afterEach(() => {
  vi.useRealTimers()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('body composition on the database', () => {
  it('saves a weigh-in, keeps body_metrics filled, pays no points', () => {
    const before = ledger()
    const r = addBodyMeasurement(db, { at: t(9, 7, 10), weight_kg: 72.4, body_fat_pct: 15.1, muscle_kg: 58, waist_cm: 80.5 }, 'manual', NOW)
    expect(r.added).toBe(true)
    expect(r.prev).toBeNull()
    expect(listBodyComp(db)).toHaveLength(1)
    expect(latestBodyComp(db)?.body_fat_pct).toBe(15.1)
    expect(metric('2026-11-09')).toEqual({ weight: 72.4, waist: 80.5 })
    expect(ledger()).toBe(before)
  })

  it('the same weigh-in twice is one row; the later save wins', () => {
    addBodyMeasurement(db, { at: t(9, 7, 10), weight_kg: 72.4 }, 'manual', NOW)
    const again = addBodyMeasurement(db, { at: t(9, 7, 10), weight_kg: 72.41, body_fat_pct: 15 }, 'sync', new Date(NOW.getTime() + 60_000))
    expect(again.added).toBe(true)
    const old = addBodyMeasurement(db, { at: t(9, 7, 10), weight_kg: 72.4, body_fat_pct: 18 }, 'manual', new Date(NOW.getTime() - 60_000))
    expect(old.added).toBe(false)
    const rows = listBodyComp(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'sync', body_fat_pct: 15 })
  })

  it('body_metrics holds the first morning weight; a later weigh-in does not replace it', () => {
    addBodyMeasurement(db, { at: t(8, 19), weight_kg: 73.2 }, 'manual', NOW)
    addBodyMeasurement(db, { at: t(8, 7), weight_kg: 72.5 }, 'manual', NOW)
    addBodyMeasurement(db, { at: t(8, 9), weight_kg: 72.8 }, 'manual', NOW)
    expect(metric('2026-11-08').weight).toBe(72.5)
  })

  it('never overwrites a weight that came from elsewhere, nor older days', () => {
    db.prepare("INSERT INTO body_metrics (day, weight, waist, note, updated_at) VALUES ('2026-11-09', 71.9, 81, 'Telegram', 'x'), ('2026-11-01', 70, 82, NULL, 'x')").run()
    const r = addBodyMeasurement(db, { at: t(9, 8), weight_kg: 72.3 }, 'manual', NOW)
    expect(r.prev).toEqual({ weight: 71.9, waist: 81 })
    expect(metric('2026-11-09')).toEqual({ weight: 71.9, waist: 81 })
    expect(metric('2026-11-01')).toEqual({ weight: 70, waist: 82 })
  })

  it('Undo removes the weigh-in and puts body_metrics back', () => {
    const a = addBodyMeasurement(db, { at: t(9, 7), weight_kg: 72.4, waist_cm: 80 }, 'manual', NOW)
    expect(removeBodyMeasurement(db, a.row.id, a.prev, NOW)).toBe(true)
    expect(listBodyComp(db)).toHaveLength(0)
    expect(metric('2026-11-09')).toBeUndefined()
    // With an older value that day: it comes back.
    db.prepare("INSERT INTO body_metrics (day, weight, waist, note, updated_at) VALUES ('2026-11-08', NULL, 81, NULL, 'x')").run()
    const b = addBodyMeasurement(db, { at: t(8, 7), weight_kg: 72.1, waist_cm: 80.2 }, 'manual', NOW)
    expect(metric('2026-11-08')).toEqual({ weight: 72.1, waist: 80.2 })
    removeBodyMeasurement(db, b.row.id, b.prev, NOW)
    expect(metric('2026-11-08')).toEqual({ weight: null, waist: 81 })
    // A second weigh-in that day: the other one takes over.
    addBodyMeasurement(db, { at: t(7, 7), weight_kg: 72 }, 'manual', NOW)
    const c = addBodyMeasurement(db, { at: t(7, 6), weight_kg: 71.8 }, 'manual', NOW)
    expect(metric('2026-11-07').weight).toBe(71.8)
    removeBodyMeasurement(db, c.row.id, c.prev, NOW)
    expect(metric('2026-11-07').weight).toBe(72)
    expect(removeBodyMeasurement(db, 'nope', null, NOW)).toBe(false)
  })

  it('refuses bad numbers', () => {
    expect(() => addBodyMeasurement(db, { weight_kg: 400 }, 'manual', NOW)).toThrow(/between 30 and 250/)
    expect(listBodyComp(db)).toHaveLength(0)
  })

  it('the view: weekly average, band, smoothed fat and muscle, kcal from the food log, monthly numbers', () => {
    const add = (d: number, w: number, fat: number, m = 10) => addBodyMeasurement(db, { at: t(d, 7, 0, m), weight_kg: w, body_fat_pct: fat, muscle_kg: w * 0.8 }, 'manual', NOW)
    for (const d of [26, 27, 28]) add(d, 71, 16, 9)
    for (const d of [2, 3, 4, 5]) add(d, 71.4, 15.8)
    add(9, 71.6, 15.7)
    db.prepare("INSERT INTO body_log (id, at, day, kind, amount, source, undoes) VALUES ('m1-k', 'x', '2026-11-03', 'kcal:food', 2600, 'web', NULL), ('m2-k', 'x', '2026-11-04', 'kcal:food', 2800, 'web', NULL)").run()
    const v = bodyCompView(db, NOW)
    expect(v.head).toMatchObject({ which: 'last week', avg: 71.4, delta: 0.4, band: 'in' })
    expect(v.thisWeek).toBe(1)
    expect(v.kcal).toEqual({ avg: 2700, days: 2, which: 'last week' })
    expect(v.fatAvg.length).toBe(8)
    expect(v.latest?.weight_kg).toBe(71.6)
    expect(v.month.from).toBe('2026-11-01')
    expect(v.month.fatPct).toBe(-0.2)
  })

  it('plans one Sunday waist reminder, and a logged waist settles it', () => {
    addBodyMeasurement(db, { at: t(9, 7), weight_kg: 72 }, 'manual', NOW)
    addBodyMeasurement(db, { at: t(9, 8), weight_kg: 72.2 }, 'manual', NOW)
    let list = readSetting(db, 'coach_reminders') as any[]
    expect(list.filter((r) => r.id.startsWith('waist:'))).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'waist:2026-11-15', kind: 'remind' })
    expect(new Date(list[0].at).getHours()).toBe(10)
    addBodyMeasurement(db, { at: t(10, 7), weight_kg: 72.1, waist_cm: 80 }, 'manual', new Date(2026, 10, 10, 8))
    list = readSetting(db, 'coach_reminders') as any[]
    expect(list.find((r) => r.id === 'waist:2026-11-15')?.done).toBe(true)
    expect(list.find((r) => r.id === 'waist:2026-11-22')).toBeTruthy()
  })

  it('pages may read and write body_comp through /api/db (it is not a server-only table)', () => {
    expect(stmtProblem({ sql: 'SELECT * FROM body_comp' })).toBeNull()
    expect(stmtProblem({ sql: "INSERT INTO body_comp (id, at, day, weight_kg, source, dedupe, updated_at) VALUES ('a', 'b', 'c', 70, 'manual', 'd', 'e') ON CONFLICT(dedupe) DO UPDATE SET weight_kg = excluded.weight_kg WHERE excluded.updated_at > body_comp.updated_at" })).toBeNull()
  })
})
