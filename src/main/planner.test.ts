import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EVERY_DAY, TASKS_DAILY_COIN_CAP } from '@core/plan'
import { openDb, type DB } from './db'
import { Wallet } from './wallet'
import { Schedule, Tasks } from './planner'

let dir: string
let db: DB
let wallet: Wallet
let tasks: Tasks
let schedule: Schedule

// Monday 2026-10-26, 10:00 UTC (the wallet uses UTC days in tests)
const mon = new Date('2026-10-26T10:00:00Z')
const at = (iso: string) => new Date(iso)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-plan-'))
  db = openDb(join(dir, 'life.db'))
  wallet = new Wallet(db, 'UTC')
  tasks = new Tasks(db, wallet)
  schedule = new Schedule(db, wallet)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const newTask = (p: Record<string, unknown> = {}) => ({
  title: 'Read 20 pages', category: 'university', coins: 10, xp: 20, priority: 2 as const, due: null,
  repeat: 'none' as const, weekdays: 0, notes: null, ...p
})

describe('tasks service', () => {
  it('seeds the five categories', () => {
    expect(tasks.categories().map((c) => c.id)).toEqual(['body', 'face', 'finance', 'university', 'life'])
  })

  it('completes a one-off task once and pays coins and XP', () => {
    tasks.save(newTask(), mon)
    const id = tasks.state(mon).tasks[0].id
    tasks.complete(id, mon)
    expect(wallet.summary(mon)).toMatchObject({ balance: 10, totalXp: 20 })
    expect(tasks.state(mon).tasks[0].done).toBe(true)
    expect(() => tasks.complete(id, mon)).toThrow('Already done')
    // Gone the next day
    expect(tasks.state(at('2026-10-27T10:00:00Z')).tasks).toHaveLength(0)
  })

  it('unticks a task by undoing its coins', () => {
    tasks.save(newTask(), mon)
    const id = tasks.state(mon).tasks[0].id
    tasks.complete(id, mon)
    tasks.uncomplete(id, mon)
    expect(wallet.summary(mon).balance).toBe(0)
    expect(tasks.state(mon).tasks[0].done).toBe(false)
    tasks.complete(id, mon) // can tick again
    expect(wallet.summary(mon).balance).toBe(10)
  })

  it('treats a completion undone in History as not done', () => {
    tasks.save(newTask(), mon)
    const id = tasks.state(mon).tasks[0].id
    const ledgerId = tasks.complete(id, mon)
    wallet.undo(ledgerId, 'did not really do it', mon)
    expect(tasks.state(mon).tasks[0].done).toBe(false)
    expect(() => tasks.complete(id, mon)).not.toThrow()
  })

  it('repeats daily tasks and caps coins from tasks per day', () => {
    for (let i = 0; i < 6; i++) tasks.save(newTask({ title: `Daily ${i}`, coins: 30, repeat: 'daily' }), mon)
    for (const t of tasks.state(mon).tasks) tasks.complete(t.id, mon)
    expect(wallet.summary(mon).balance).toBe(TASKS_DAILY_COIN_CAP)
    expect(wallet.summary(mon).totalXp).toBe(6 * 20)
    const tue = at('2026-10-27T10:00:00Z')
    expect(tasks.state(tue).tasks.every((t) => !t.done)).toBe(true)
  })

  it('validates input and categories', () => {
    expect(() => tasks.save(newTask({ category: 'nope' }), mon)).toThrow('category')
    expect(() => tasks.save(newTask({ coins: 99 }), mon)).toThrow('Coins')
    tasks.saveCategory({ id: 'Deen', label: 'Deen', color: '#6EE7D8' })
    tasks.save(newTask({ category: 'deen' }), mon)
    expect(tasks.state(mon).tasks).toHaveLength(1)
  })
})

describe('schedule service', () => {
  const math = { title: 'Math', kind: 'study' as const, start: '18:00', minutes: 50, weekdays: EVERY_DAY, date: null, remindMin: 5 }

  it('needs the timer to run before a study block pays out', () => {
    schedule.save(math, mon)
    const id = schedule.state(undefined, mon).blocks[0].id
    expect(() => schedule.finish(id, mon)).toThrow('Start the focus timer')
    schedule.start(id, at('2026-10-26T15:00:00Z'))
    expect(schedule.state(undefined, at('2026-10-26T15:01:00Z')).blocks[0]).toMatchObject({ status: 'running' })
    expect(() => schedule.finish(id, at('2026-10-26T15:20:00Z'))).toThrow('more min')
    schedule.finish(id, at('2026-10-26T15:41:00Z'))
    const s = schedule.state(undefined, at('2026-10-26T15:42:00Z'))
    expect(s.blocks[0].status).toBe('done')
    expect(wallet.summary(at('2026-10-26T15:42:00Z')).balance).toBe(15)
  })

  it('allows only one running block at a time', () => {
    schedule.save(math, mon)
    schedule.save({ ...math, title: 'Physics', start: '20:00' }, mon)
    const [a, b] = schedule.state(undefined, mon).blocks
    schedule.start(a.id, mon)
    expect(() => schedule.start(b.id, mon)).toThrow('Finish or skip "Math" first')
  })

  it('skipping costs the penalty but never below zero', () => {
    schedule.save(math, mon)
    const id = schedule.state(undefined, mon).blocks[0].id
    wallet.award('sleep.up_on_time', undefined, mon) // +10
    schedule.skip(id, mon)
    expect(wallet.summary(mon).balance).toBe(5)
    expect(() => schedule.skip(id, mon)).toThrow('closed')
  })

  it('marks study blocks left open on past days as missed', () => {
    schedule.save(math, mon) // created Monday, every day
    const id = schedule.state(undefined, mon).blocks[0].id
    schedule.start(id, mon) // started Monday but never finished
    wallet.award('sleep.up_on_time', undefined, mon)
    const wed = at('2026-10-28T10:00:00Z')
    schedule.state(undefined, wed)
    const missed = db.prepare("SELECT day FROM block_log WHERE status = 'missed' ORDER BY day").all() as { day: string }[]
    expect(missed.map((m) => m.day)).toEqual(['2026-10-26', '2026-10-27'])
    expect(wallet.summary(wed).balance).toBe(0) // 10 - 5 - 5
    schedule.state(undefined, wed) // idempotent
    expect(db.prepare("SELECT COUNT(*) n FROM block_log WHERE status = 'missed'").get()).toEqual({ n: 2 })
  })

  it('only shows blocks on their days and validates input', () => {
    schedule.save({ ...math, weekdays: 0, date: '2026-10-30' }, mon)
    expect(schedule.state(undefined, mon).blocks).toHaveLength(0)
    expect(schedule.state('2026-10-30', mon).blocks).toHaveLength(1)
    expect(() => schedule.save({ ...math, start: '7pm' }, mon)).toThrow('HH:MM')
  })
})
