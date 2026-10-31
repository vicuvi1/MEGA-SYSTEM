import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from './db'

const openDatabase = () => openDb(join(mkdtempSync(join(tmpdir(), 'pts-')), 'life.db'))
import { Wallet } from './wallet'
import { WeekPlanService } from './weekPlan'
import { applyPointsV2, payOnce } from './points'

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
})
