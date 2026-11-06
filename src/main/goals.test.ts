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

describe('kinds of goals', () => {
  it('a habit you log by hand: a tap a day, +3 once a week, take-backs', () => {
    const g = goals.save({ title: 'Read 4× a week', unit: 'count', target: 4, deadline: '', meta: { type: 'habit', per: 'week' } }, at('2026-11-01'))
    expect(g.deadline).toBe('2099-12-31')
    expect(goals.meta(g.id).type).toBe('habit')
    const r = goals.logPeriod(g.id, 1, at('2026-11-03'))
    expect(r.paid).toBe(3)
    expect(r.card.value).toBe(1)
    expect(goals.logPeriod(g.id, 1, at('2026-11-04')).paid).toBe(0)
    expect(goals.logPeriod(g.id, -1, at('2026-11-04')).card.value).toBe(1)
    expect(() => goals.logPeriod(g.id, -1, at('2026-11-04'))).toThrow(/Nothing to take back/)
    // Ben's "goalcheck: G1 | 3": the number now this week
    expect(goals.checkIn(g.id, 3, 'ben', null, at('2026-11-05')).card.value).toBe(3)
    expect(coins()).toBe(3)
  })
  it('a habit from data: workouts this week, no points', () => {
    const g = goals.save({ title: 'Work out 4× a week', unit: 'count', target: 4, deadline: '', source: { kind: 'body.workouts' }, meta: { type: 'habit' } }, at('2026-11-01'))
    for (const d of ['2026-11-02', '2026-11-03', '2026-11-03']) db.prepare("INSERT INTO workouts (day, ts, title, items_json) VALUES (?, 'x', 'Home', '[]')").run(d)
    const c = goals.cards(at('2026-11-04')).find((x) => x.goal.id === g.id)!
    expect(c.value).toBe(2) // two days, not three workouts
    expect(() => goals.logPeriod(g.id, 1, at('2026-11-04'))).toThrow(/counts itself/)
    expect(coins()).toBe(0)
  })
  it('a limit from the island’s PC time', () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('island_day_log', ?)").run(JSON.stringify({ '2026-11-03': { focus: [], blocks: [], hours: { '20': { gaming: 50, coding: 10 }, '21': { gaming: 40 } } } }))
    const g = goals.save({ title: 'Gaming: at most 5h a week', unit: 'hours', target: 5, deadline: '', source: { kind: 'pc.kind', arg: 'gaming' }, meta: { type: 'limit' } }, at('2026-11-01'))
    expect(goals.card(g.id, at('2026-11-04'))!.value).toBe(1.5)
    expect(goals.dailyValues({ kind: 'pc.work' }, '2026-11-01', '2026-11-30')).toEqual({ '2026-11-03': 0.17 })
  })
  it('bedtimes after midnight are late', () => {
    for (const [d, t] of [['2026-11-02', '23:40'], ['2026-11-03', '00:30'], ['2026-11-04', '23:59']]) db.prepare("INSERT INTO sleep_logs (day, wake_time, wake_target, bed_time, created_at) VALUES (?, '07:00', '07:00', ?, 'x')").run(d, t)
    expect(goals.dailyValues({ kind: 'sleep.bed', arg: '00:00' }, '2026-11-01', '2026-11-08')).toEqual({ '2026-11-02': 1, '2026-11-03': 0, '2026-11-04': 1 })
  })
  it('a project: ticking steps moves the share, milestones pay once, the last step reaches it', () => {
    const steps = ['Domain 1', 'Domain 2', 'Domain 3', 'Book the exam'].map((text, i) => ({ id: `s${i}`, text, weight: 1, done: null }))
    const g = goals.save({ title: 'Security+', unit: 'pct', target: 100, deadline: '2027-01-31', meta: { type: 'project', steps } }, at('2026-11-01'))
    const r1 = goals.toggleStep(g.id, 's0', at('2026-11-02'))
    expect(r1.card.pct).toBe(25)
    expect(r1.paid).toBe(3 + 15)
    goals.toggleStep(g.id, 's0', at('2026-11-02'))
    expect(goals.toggleStep(g.id, 's0', at('2026-11-02')).paid).toBe(0)
    for (const s of ['s1', 's2', 's3']) goals.toggleStep(g.id, s, at('2026-11-03'))
    expect(goals.goal(g.id)?.doneDay).toBe('2026-11-03')
    expect(() => goals.save({ title: 'No steps', unit: 'pct', target: 100, deadline: '2027-01-31', meta: { type: 'project' } }, at('2026-11-01'))).toThrow(/steps/)
  })
  it('pause, pin, order and done; old goals keep working as targets', () => {
    const a = goals.save({ title: 'A', unit: 'count', target: 10, deadline: '2026-12-31' }, at('2026-11-01'))
    const b = goals.save({ title: 'B', unit: 'count', target: 10, deadline: '2026-12-31' }, at('2026-11-01'))
    db.prepare('DELETE FROM settings WHERE key = ?').run(`goal_meta:${a.id}`)
    expect(goals.meta(a.id).type).toBe('target')
    goals.setPaused(b.id, true)
    expect(goals.cards(at('2026-11-02')).map((c) => c.goal.id)).toEqual([a.id])
    expect(goals.cards(at('2026-11-02'), undefined, { paused: true })).toHaveLength(2)
    goals.setPinned(a.id, true)
    goals.setPinned(b.id, true)
    expect([goals.meta(a.id).pinned, goals.meta(b.id).pinned]).toEqual([false, true])
    goals.reorder([b.id, a.id])
    expect([goals.meta(b.id).order, goals.meta(a.id).order]).toEqual([0, 1])
    goals.setDone(a.id, true, at('2026-11-05'))
    expect(goals.card(a.id, at('2026-11-05'))!.status).toBe('done')
    // an edit without meta keeps the extras
    goals.setMeta(b.id, { emoji: '🚀', vision: 'Me, calm' })
    goals.save({ id: b.id, title: 'B2', unit: 'count', target: 12, deadline: '2026-12-31' }, at('2026-11-05'))
    expect(goals.meta(b.id)).toMatchObject({ emoji: '🚀', vision: 'Me, calm', paused: true })
  })
})
