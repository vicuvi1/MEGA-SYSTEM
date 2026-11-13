import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from './db'

const openDatabase = () => openDb(join(mkdtempSync(join(tmpdir(), 'pts-')), 'life.db'))
import { Wallet } from './wallet'
import { WeekPlanService } from './weekPlan'
import { applyPointsV2, applyPointsV3, payOnce } from './points'

describe('points without the game', () => {
  it('lowers habit points once, leaving your own changes', () => {
    const db = openDatabase()
    db.prepare("UPDATE rules SET coins = 7 WHERE id = 'face.routine_done'").run() // your own value
    expect(applyPointsV2(db)).toBe(true)
    const coins = (id: string) => (db.prepare('SELECT coins FROM rules WHERE id = ?').get(id) as { coins: number }).coins
    expect(coins('sleep.up_on_time')).toBe(3)
    expect(coins('discipline.clean_day')).toBe(3)
    expect(coins('face.routine_done')).toBe(7)
    expect(coins('tasks.todoist_done')).toBe(8)
    db.prepare("UPDATE rules SET coins = 10 WHERE id = 'sleep.up_on_time'").run()
    expect(applyPointsV2(db)).toBe(false) // never again
    expect(coins('sleep.up_on_time')).toBe(10)
  })

  it('week goals: each big task done pays 25 once', () => {
    const db = openDatabase()
    const wallet = new Wallet(db)
    const wp = new WeekPlanService(db, wallet)
    const now = new Date('2026-11-04T10:00:00')
    wp.save({ week: '2026-11-02', focus: 'wake', note: '', big3: [{ text: 'Etica', done: false }] }, now)
    const before = wallet.summary(now).balance
    wp.toggle(0, now)
    wp.toggle(0, now)
    wp.toggle(0, now)
    expect(wallet.summary(now).balance - before).toBe(25)
    expect(payOnce(wallet, 'x:1', 50, 'bonus', now)).toBe(true)
    expect(payOnce(wallet, 'x:1', 50, 'bonus', now)).toBe(false)
  })

  it('v3: five clear rules (habits +2, Todoist +5), your own values stay', () => {
    const db = openDatabase()
    const coins = (id: string) => (db.prepare('SELECT coins FROM rules WHERE id = ?').get(id) as { coins: number }).coins
    db.prepare("UPDATE rules SET coins = 7 WHERE id = 'face.routine_done'").run() // your own value
    applyPointsV2(db)
    expect(applyPointsV3(db)).toBe(true)
    for (const id of ['sleep.up_on_time', 'discipline.clean_day', 'discipline.oath', 'body.workout_done', 'money.logged']) expect(coins(id)).toBe(2)
    expect(coins('face.routine_done')).toBe(7)
    expect(coins('tasks.todoist_done')).toBe(5)
    expect(coins('discipline.reset')).toBe(-5)
    expect(applyPointsV3(db)).toBe(false)
  })
})

describe('Show coins and rewards is only a display switch', () => {
  it('coins are still earned and stored with it off (the default)', () => {
    const db = openDatabase()
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('simple_mode', ?)").run(JSON.stringify({ on: true, coins: false }))
    const wallet = new Wallet(db)
    const now = new Date('2026-11-04T10:00:00')
    const before = wallet.summary(now).balance
    expect(payOnce(wallet, 'coins-off:1', 7, 'done while hidden', now)).toBe(true)
    expect(wallet.summary(now).balance - before).toBe(7)
    expect((db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE note = 'done while hidden'").get() as { n: number }).n).toBe(1)
  })
})
