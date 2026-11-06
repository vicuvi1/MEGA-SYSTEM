import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from './db'
import { Wallet } from './wallet'
import { GoalsService, moneyBetween } from './goals'
import { FocusService } from './focus'

let dir: string
let db: DB
let wallet: Wallet
let goals: GoalsService
const at = (d: string, h = 10) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00Z`)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-goals-test-'))
  db = openDb(join(dir, 'life.db'))
  wallet = new Wallet(db, 'UTC')
  goals = new GoalsService(db, wallet)
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const coins = () => (db.prepare("SELECT COALESCE(SUM(coins), 0) AS c FROM ledger WHERE rule_id LIKE 'goal.%'").get() as any).c as number

describe('measurable goals', () => {
  it('saves next to the hour goals without mixing them up', () => {
    const g = goals.save({ title: 'Read 12 books', unit: 'custom', unitLabel: 'books', target: 12, deadline: '2026-12-31', cadence: 'weekly' }, at('2026-11-01'))
    expect(g).toMatchObject({ title: 'Read 12 books', start: 0, target: 12, unitLabel: 'books', startDay: '2026-11-01' })
    // the focus page's hour goals don't see it
    expect(new FocusService(db, wallet).state(at('2026-11-01')).goals).toEqual([])
    expect(goals.cards(at('2026-11-02'))).toHaveLength(1)
  })

  it('check-ins are appended, pay +3 once per period, milestones +15 each', () => {
    const g = goals.save({ title: 'Profit 5,000 lei', unit: 'lei', start: 1000, target: 5000, deadline: '2026-12-31', cadence: 'weekly' }, at('2026-10-01'))
    const r1 = goals.checkIn(g.id, 2100, 'me', null, at('2026-11-03'))
    // first of the week (+3) and the 25% milestone (2000) (+15)
    expect(r1.paid).toBe(18)
    expect(r1.milestones.map((m) => m.value)).toEqual([2000])
    // same week again: no check-in pay, no milestone
    const r2 = goals.checkIn(g.id, 2200, 'me', null, at('2026-11-04'))
    expect(r2.paid).toBe(0)
    // going down and up again over the same milestone pays nothing twice
    goals.checkIn(g.id, 1900, 'me', null, at('2026-11-10'))
    const r4 = goals.checkIn(g.id, 2100, 'me', null, at('2026-11-11'))
    expect(r4.paid).toBe(0)
    expect(goals.checkins(g.id)).toHaveLength(4)
    expect(coins()).toBe(18 + 3)
  })

  it('reaching the target marks it done, with one bonus', () => {
    const g = goals.save({ title: '100 stars', unit: 'custom', unitLabel: 'stars', start: 90, target: 100, deadline: '2026-12-31', cadence: 'weekly', milestones: [] }, at('2026-11-01'))
    const r = goals.checkIn(g.id, 101, 'me', null, at('2026-11-02'))
    expect(r.done).toBe(true)
    expect(r.card.status).toBe('done')
    expect(goals.goal(g.id)?.doneDay).toBe('2026-11-02')
  })

  it('auto goals read the app data, keep one number a day, and never pay', () => {
    db.prepare("INSERT INTO body_metrics (day, weight, updated_at) VALUES ('2026-11-01', 80, 'x')").run()
    const g = goals.save({ title: 'Lose 5 kg', unit: 'kg', target: 75, deadline: '2027-02-01', source: { kind: 'body.weight' } }, at('2026-11-01'))
    expect(g.start).toBe(80)
    db.prepare("INSERT INTO body_metrics (day, weight, updated_at) VALUES ('2026-11-08', 78.6, 'x')").run()
    expect(goals.cards(at('2026-11-08'))[0].value).toBe(78.6)
    expect(goals.syncAuto(at('2026-11-08'))).toEqual([g.id])
    expect(goals.syncAuto(at('2026-11-08', 15))).toEqual([])
    expect(goals.checkins(g.id).map((c) => c.by)).toEqual(['auto'])
    expect(goals.cards(at('2026-11-08'))[0].due).toBe(false)
    expect(coins()).toBe(0)
  })

  it('focus hours and workouts count since the start', () => {
    const g = goals.save({ title: '30h of Rust', unit: 'hours', target: 30, deadline: '2026-12-31', source: { kind: 'focus.hours', arg: 'Rust' } }, at('2026-11-01'))
    db.prepare("INSERT INTO focus_sessions (day, subject, minutes, coins, started_at, ended_at) VALUES ('2026-11-02', 'rust', 90, 0, 'x', 'x')").run()
    expect(goals.autoValue(g, at('2026-11-03'))).toBe(1.5)
  })

  it('refuses unclear goals', () => {
    expect(() => goals.save({ title: '', unit: 'lei', target: 5, deadline: '2026-12-31' }, at('2026-11-01'))).toThrow(/Name the goal/)
    expect(() => goals.save({ title: 'x', unit: 'lei', target: 5, deadline: '2026-10-01' }, at('2026-11-01'))).toThrow(/after today/)
    expect(() => goals.save({ title: 'x', unit: 'count', target: 0, deadline: '2026-12-01' }, at('2026-11-01'))).toThrow(/already/)
    expect(() => goals.save({ title: 'x', unit: 'count', target: 9, deadline: '2026-12-01', source: { kind: 'sport.reps' } }, at('2026-11-01'))).toThrow(/which one/)
  })

  it('money from Finance Helper (bani to lei)', () => {
    const st = { tx: [{ type: 'income', date: '2026-11-02', base: 500000 }, { type: 'expense', date: '2026-11-03', amount: 120000 }, { type: 'expense', date: '2026-10-30', amount: 99900 }, { type: 'expense', date: '2026-11-04', amount: 1000, deleted: true }] }
    expect(moneyBetween(st, '2026-11-01', '2026-11-30')).toEqual({ income: 5000, spent: 1200 })
    const g = goals.save({ title: 'Profit 5k', unit: 'lei', target: 5000, deadline: '2026-12-31', source: { kind: 'money.profit' } }, at('2026-11-05'), st)
    expect(g.start).toBe(3800)
  })
})
