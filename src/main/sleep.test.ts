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

describe('one meaning of on time (23:30 / 06:45, 5 min grace)', () => {
  it('defaults to 06:45 every day and 23:30 at night; 06:55 is late, 06:50 is not', () => {
    expect([sleep.weekdayTarget(), sleep.weekendTarget(), sleep.bedtimeTarget()]).toEqual(['06:45', '06:45', '23:30'])
    // Saturday: no 08:30 weekend default any more.
    expect(sleep.logWake('06:55', undefined, new Date('2026-10-31T06:55:00Z')).log.onTime).toBe(false)
    expect(sleep.logWake('06:50', undefined, new Date('2026-11-02T06:50:00Z')).log.onTime).toBe(true)
    expect(sleep.logBed('23:36', new Date('2026-11-02T23:36:00Z')).log.bedOnTime).toBe(false)
    expect(sleep.logBed('23:35', new Date('2026-11-03T23:35:00Z')).log.bedOnTime).toBe(true)
  })
})

describe('"Going to bed" checks you really stopped', () => {
  // Local clock times (the check reads the PC's own clock), so the test is the same on any OS and zone.
  const L = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m)
  let w: Wallet
  let s: SleepService
  beforeEach(() => {
    w = new Wallet(db)
    s = new SleepService(db, w)
  })
  it('still on the PC 30+ minutes after the tap: the bed points go back, and the bedtime becomes the last PC use', () => {
    const tap = L(2, 23, 20)
    expect(s.logBed(undefined, tap).awarded).toBe(true)
    expect(w.summary(tap).balance).toBe(5)
    expect(s.state(tap).bedCheck).toMatchObject({ day: '2026-11-03', stillUp: false, done: false, lines: ['23:20: you tapped "Going to bed".'] })
    // Active every minute until 23:52.
    for (let m = 21; m <= 52; m++) s.bedActivity(0, L(2, 23, m))
    expect(w.summary(L(2, 23, 52)).balance).toBe(0)
    expect(s.state(L(2, 23, 52)).bedCheck?.stillUp).toBe(true)
    // Last used at 00:40, then left alone: 30 minutes later the bedtime is 00:40, late, and pays nothing.
    for (let m = 53; m <= 59; m++) s.bedActivity(0, L(2, 23, m))
    for (let m = 0; m <= 40; m++) s.bedActivity(0, L(3, 0, m))
    let said: string | null = null
    for (let m = 41; m <= 80 && !said; m++) said = s.bedActivity((m - 40) * 60, L(3, Math.floor(m / 60), m % 60)).said
    expect(said).toBe('Bedtime set to 00:40, the last time the PC was used.')
    const row = s.logs().find((l) => l.day === '2026-11-03')!
    expect([row.bedTime, row.bedOnTime]).toEqual(['00:40', false])
    expect(w.summary(L(3, 7, 0)).balance).toBe(0)
    expect(s.state(L(3, 7, 0)).bedCheck?.lines).toEqual([
      '23:20: you tapped "Going to bed".',
      '23:51: the PC was still in use more than 30 minutes after that, so the bed points went back.',
      'Bedtime set to 00:40, the last time the PC was used.'
    ])
  })
  it('the PC left alone after the tap (or asleep): the tap and its points stand, and the morning is not "still up"', () => {
    s.logBed(undefined, L(2, 23, 20))
    for (let m = 21; m <= 25; m++) s.bedActivity(0, L(2, 23, m))
    // The PC went to sleep at 23:25; the next tick comes in the morning with fresh input.
    expect(s.bedActivity(0, L(3, 6, 40)).said).toBe(null)
    expect(s.state(L(3, 6, 40)).bedCheck).toMatchObject({ stillUp: false, done: true })
    expect(w.summary(L(3, 6, 40)).balance).toBe(5)
    expect(s.logs().find((l) => l.day === '2026-11-03')!.bedTime).toBe('23:20')
  })
  it('a bedtime typed long after is a record, not watched', () => {
    s.logBed('23:00', L(3, 9, 0))
    expect(s.state(L(3, 9, 0)).bedCheck ?? null).toBe(null)
  })
})

describe('SleepService backend', () => {
  it('logs on-time wake up and awards wallet coins', () => {
    const now = new Date('2026-10-26T06:40:00Z') // Monday 06:40 (target 06:45)
    const res = sleep.logWake('06:40', 5, now)

    expect(res.log.onTime).toBe(true)
    expect(res.log.wakeTime).toBe('06:40')
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
