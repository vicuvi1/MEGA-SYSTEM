import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from './db'
import { SleepService } from './sleep'
import { Wallet } from './wallet'

let dir: string
let db: DB
let wallet: Wallet
let sleep: SleepService

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-sleep-test-'))
  db = openDb(join(dir, 'life.db'))
  wallet = new Wallet(db, 'UTC')
  sleep = new SleepService(db, wallet)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('SleepService backend', () => {
  it('logs on-time wake up and awards wallet coins', () => {
    const now = new Date('2026-10-26T06:55:00Z') // Monday 06:55 (target 07:00)
    const res = sleep.logWake('06:55', 5, now)

    expect(res.log.onTime).toBe(true)
    expect(res.log.wakeTime).toBe('06:55')
    expect(res.awarded).toBe(true)
    expect(wallet.summary(now).balance).toBe(10) // +10 for sleep.up_on_time
    expect(res.state.streak).toBe(1)
  })

  it('logs late wake up without awarding coins', () => {
    const now = new Date('2026-10-26T08:30:00Z') // Monday 08:30 (target 07:00)
    const res = sleep.logWake('08:30', 3, now)

    expect(res.log.onTime).toBe(false)
    expect(res.awarded).toBe(false)
    expect(wallet.summary(now).balance).toBe(0)
    expect(res.state.streak).toBe(0)
  })

  it('updates targets and recalculates state', () => {
    const updated = sleep.setTargets('06:30', '08:00', '22:30')
    expect(updated.weekdayTarget).toBe('06:30')
    expect(updated.weekendTarget).toBe('08:00')
    expect(sleep.bedtimeTarget()).toBe('22:30')
  })

  it('logs bedtime and awards coins if on time', () => {
    const now = new Date('2026-10-26T22:50:00Z') // Target 23:00
    const res = sleep.logBed('22:50', now)

    expect(res.log.bedOnTime).toBe(true)
    expect(res.awarded).toBe(true)
    expect(wallet.summary(now).balance).toBe(5) // +5 for sleep.bed_on_time
  })
})
