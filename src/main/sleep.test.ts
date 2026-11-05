import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from './db'
import { SleepService } from './sleep'
import { setSetting } from './settings'
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

describe('the first wake-up of the day stays (X8)', () => {
  it('a later "I am up" (nap) does not move it; a typed time does', () => {
    const morning = new Date(2026, 9, 26, 6, 55)
    sleep.logWake(undefined, undefined, morning)
    const nap = sleep.logWake(undefined, undefined, new Date(2026, 9, 26, 15, 10))
    expect(nap.log.wakeTime).toBe('06:55')
    expect(nap.awarded).toBe(false)
    const fixed = sleep.logWake('07:20', undefined, new Date(2026, 9, 26, 15, 11))
    expect(fixed.log.wakeTime).toBe('07:20')
  })
})

describe('a corrected sleep time takes its points back (P3)', () => {
  it('on time, then corrected to late: the points go back', () => {
    const at = new Date(2026, 9, 26, 6, 50)
    const first = sleep.logWake('06:50', undefined, at)
    expect(first.awarded).toBe(true)
    const before = wallet.summary(at).balance
    sleep.logWake('09:30', undefined, new Date(2026, 9, 26, 10, 0))
    expect(wallet.summary(at).balance).toBeLessThan(before)
  })

  it("copies Waky's mornings and nights into the sleep log, never over a time already there", () => {
    sleep.logWake('06:10', undefined, new Date('2026-10-27T06:10:00Z')) // typed here: stays
    const waky = {
      days: { '2026-10-26': { time: '6:40' }, '2026-10-27': { time: '06:50' }, '2026-10-29': { time: '06:20' }, '2026-09-01': { time: '06:00' }, bad: { time: 'x' } },
      nights: { '2026-10-26': { time: '23:15' }, '2026-10-28': { time: '00:40' } }
    }
    setSetting(db, 'app_sync_waky', JSON.stringify({ savedAt: 1, data: waky }))
    const now = new Date('2026-10-29T10:00:00Z')
    const r = sleep.fromWaky(now)
    expect(r).toMatchObject({ wakes: 2, beds: 2 })
    const byDay = Object.fromEntries(sleep.logs().map((l) => [l.day, l]))
    expect(byDay['2026-10-26'].wakeTime).toBe('06:40')
    expect(byDay['2026-10-27']).toMatchObject({ wakeTime: '06:10', bedTime: '23:15' })
    expect(byDay['2026-10-29']).toMatchObject({ wakeTime: '06:20', bedTime: '00:40' })
    expect(byDay['2026-09-01']).toBeUndefined()
    // Synced hours later: recorded, not paid (only a live wake-up pays, H1).
    expect(r.awarded).toBe(false)
    expect(sleep.fromWaky(now)).toMatchObject({ wakes: 0, beds: 0, awarded: false })
  })

  it('only a wake-up logged as you get up pays; a time typed later is recorded only (H1)', () => {
    const late = sleep.logWake('06:30', undefined, new Date('2026-10-27T09:40:00Z'))
    expect(late).toMatchObject({ awarded: false, log: { wakeTime: '06:30', onTime: true } })
    const db2 = sleep.logWake('06:31', undefined, new Date('2026-10-28T06:40:00Z'))
    expect(db2.awarded).toBe(true)
  })
})
