import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from './db'
import { Wallet } from './wallet'
import { Discipline } from './discipline'
import { readSetting, writeSetting } from './settings'
import { REMINDERS } from '@core/coachKit'
import { comebackParts, comebackPlan, comebackRef, dropComeback } from '@core/comeback'
import { dayShown } from '@core/discipline'

let dir: string
let db: DB
let wallet: Wallet
let d: Discipline

const t = (iso: string) => new Date(iso)
const oct25 = t('2026-10-25T20:00:00Z') // the check-in opens at 19:00 (H2)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-disc-'))
  db = openDb(join(dir, 'life.db'))
  wallet = new Wallet(db, 'UTC')
  d = new Discipline(db, wallet)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('discipline service', () => {
  it('starts from an entered date and derives the streak', () => {
    expect(d.state(oct25).setup).toBe(false)
    d.setStart('2026-10-15', oct25)
    const s = d.state(oct25)
    expect(s).toMatchObject({ setup: true, current: 10, rank: 'Warrior', canEditStart: true })
    expect(s.milestones.find((m) => m.days === 10)?.status).toBe('claimable')
    expect(s.milestones.find((m) => m.days === 7)?.status).toBe('before-setup')
  })

  it('checks in once a day for coins (and a reached milestone pays itself: P7)', () => {
    d.setStart('2026-10-15', oct25)
    d.checkIn(oct25)
    expect(wallet.summary(oct25).balance).toBe(20 + 60)
    expect(d.state(oct25).milestones.find((m) => m.days === 10)?.status).not.toBe('claimable')
    expect(d.state(oct25).checkedInToday).toBe(true)
    expect(() => d.checkIn(oct25)).toThrow('Already')
  })

  it('a check-in works even with its rule turned off (P7)', () => {
    d.setStart('2026-10-24', oct25)
    const r = wallet.rules().find((x) => x.id === 'discipline.clean_day')!
    wallet.saveRule({ ...r, enabled: false })
    d.checkIn(oct25)
    expect(d.state(oct25).checkedInToday).toBe(true)
  })

  it('claims a milestone once', () => {
    d.setStart('2026-10-15', oct25)
    expect(d.claim(10, oct25)).toBe(60)
    expect(() => d.claim(10, oct25)).toThrow('Nothing to claim')
    expect(() => d.claim(7, oct25)).toThrow('Nothing to claim')
    expect(wallet.summary(oct25)).toMatchObject({ balance: 60, totalXp: 60 })
  })

  it('reset: day 0 again, best kept, small penalty, no check-in that day, start date locked', () => {
    d.setStart('2026-10-15', oct25)
    d.claim(10, oct25) // 60 coins
    d.reset(oct25)
    const s = d.state(oct25)
    expect(s).toMatchObject({ current: 0, best: 10, resets: 1, resetToday: true, canEditStart: false })
    expect(wallet.summary(oct25).balance).toBe(40)
    expect(() => d.checkIn(oct25)).toThrow('reset day')
    expect(() => d.reset(oct25)).toThrow('Already reset')
    expect(() => d.setStart('2026-10-01', oct25)).toThrow('reset')
    const oct28 = t('2026-10-28T10:00:00Z')
    expect(d.state(oct28).current).toBe(3)
    expect(d.state(oct28).milestones.find((m) => m.days === 3)?.status).toBe('claimable')
  })

  it('the urge crusher must run 3 minutes and keeps its start across calls', () => {
    d.setStart('2026-10-15', oct25)
    d.startUrge(t('2026-10-25T10:00:00Z'))
    d.startUrge(t('2026-10-25T10:01:00Z')) // ignored, keeps the first start
    expect(() => d.finishUrge(t('2026-10-25T10:01:30Z'))).toThrow('more seconds')
    d.finishUrge(t('2026-10-25T10:03:00Z'))
    const s = d.state(t('2026-10-25T10:03:00Z'))
    expect(s.urgeStartedAt).toBeNull()
    expect(s.urgesThisWeek).toBe(1)
    expect(wallet.summary(oct25).balance).toBe(10)
    expect(() => d.finishUrge(t('2026-10-25T10:10:00Z'))).toThrow('Start')
  })

  it('oath once a day; stealth setting; log is append-only', () => {
    d.setStart('2026-10-15', oct25)
    d.oath(oct25)
    expect(() => d.oath(oct25)).toThrow('already')
    d.setStealth(true)
    expect(d.state(oct25).stealth).toBe(true)
    expect(() => db.prepare('DELETE FROM discipline_events').run()).toThrow('append-only')
  })

  it('awards clean day coins (+20), XP (+40), and oath coins (+10) for check-in synchronization', () => {
    d.setStart('2026-10-23', oct25) // day 2: no milestone reached
    // Synchronize check-in
    d.checkIn(oct25)
    expect(d.state(oct25).checkedInToday).toBe(true)
    let summary = wallet.summary(oct25)
    expect(summary.balance).toBe(20)
    expect(summary.totalXp).toBe(40)

    // Synchronize oath
    d.oath(oct25)
    expect(d.state(oct25).oathToday).toBe(true)
    summary = wallet.summary(oct25)
    expect(summary.balance).toBe(23) // 20 + 3
    expect(summary.totalXp).toBe(45) // 40 + 5
  })

  it('the clean-day check-in waits for the evening; in the morning it is for yesterday (H2)', () => {
    d.setStart('2026-10-15', oct25)
    expect(() => d.checkIn(t('2026-10-25T15:00:00Z'))).toThrow(/19:00/)
    d.checkIn(t('2026-10-26T08:00:00Z')) // the morning after: yesterday's
    const days = db.prepare("SELECT day FROM discipline_events WHERE kind = 'checkin'").all().map((r: any) => r.day)
    expect(days).toEqual(['2026-10-25'])
    expect(() => d.checkIn(t('2026-10-26T09:00:00Z'))).toThrow(/19:00/) // yesterday done, today not over
    d.checkIn(t('2026-10-26T21:00:00Z'))
    expect(db.prepare("SELECT COUNT(*) AS n FROM discipline_events WHERE kind = 'checkin'").get()).toMatchObject({ n: 2 })
  })

  it('MN7: a reset taken back in 10 minutes gives the coins back and keeps the streak', () => {
    d.setStart('2026-10-15', oct25)
    const before = wallet.summary(oct25).balance
    const streak = d.state(oct25).current
    d.reset(oct25)
    expect(d.state(oct25).current).toBe(0)
    expect(d.state(oct25).undoResetUntil).toBeTruthy()
    d.undoReset(t('2026-10-25T20:05:00Z'))
    const s = d.state(t('2026-10-25T20:05:00Z'))
    expect(s.current).toBe(streak)
    expect(s.resetToday).toBe(false)
    expect(s.canEditStart).toBe(true)
    expect(wallet.summary(oct25).balance).toBe(before)
    d.reset(t('2026-10-25T21:00:00Z'))
    expect(() => d.undoReset(t('2026-10-25T21:20:00Z'))).toThrow('first 10 minutes')
  })

  it('MN3/MN25: says when the check-in opens, and keeps 6 months of history', () => {
    d.setStart('2026-10-15', oct25)
    expect(d.state(t('2026-10-25T14:00:00Z')).checkIn?.mode).toBe('wait')
    expect(d.state(oct25).checkIn?.mode).toBe('today')
    d.checkIn(oct25)
    expect(d.state(oct25).checkIn?.mode).toBe('done')
    expect(d.state(oct25).history?.some((h) => h.kind === 'checkin' && h.day === '2026-10-25')).toBe(true)
  })

  it('the page gets your runs, the first start date and your why', () => {
    d.setStart('2026-10-01', oct25)
    d.reset(t('2026-10-20T20:00:00Z'))
    const s = d.state(oct25)
    expect(s.startedOn).toBe('2026-10-01')
    expect(s.runs).toEqual([
      { from: '2026-10-01', to: '2026-10-20', days: 19, ended: 'reset' },
      { from: '2026-10-20', to: '2026-10-25', days: 5, ended: 'now' }
    ])
    expect(s.why).toBeNull()
    d.setWhy('  To be present for the people I love.  ')
    expect(d.state(oct25).why).toBe('To be present for the people I love.')
    d.setWhy('')
    expect(d.state(oct25).why).toBeNull()
  })
})

describe('owner picks (2026-11-12): one day number, comeback undo, your time zone', () => {
  it('one day number: the start day is Day 1, a reset day Day 0, everywhere from state.day', () => {
    d.setStart('2026-10-25', oct25)
    expect(dayShown(d.state(oct25))).toBe(1)
    expect(d.state(oct25)).toMatchObject({ current: 0, day: 1 })
    expect(dayShown(d.state(t('2026-10-27T20:00:00Z')))).toBe(3)
    d.reset(t('2026-10-27T20:00:00Z'))
    expect(dayShown(d.state(t('2026-10-27T20:01:00Z')))).toBe(0)
    expect(dayShown(d.state(t('2026-10-28T20:00:00Z')))).toBe(1)
    // A state without `day` (older data) gives the same number.
    expect(dayShown({ current: 4, resets: 0, setup: true })).toBe(5)
    expect(dayShown({ current: 4, resets: 2, setup: true })).toBe(4)
  })

  it("undoing a reset also removes that reset's comeback check-ins (and only those)", () => {
    d.setStart('2026-10-15', oct25)
    d.reset(oct25)
    const mine = { id: 'a', at: '2026-10-25T22:00:00Z', text: 'x', kind: 'checkin' as const, createdAt: '', ref: comebackRef('2026-10-25') }
    const other = { id: 'b', at: '2026-10-26T09:00:00Z', text: 'your own', kind: 'remind' as const, createdAt: '' }
    writeSetting(db, REMINDERS, [mine, other])
    d.undoReset(t('2026-10-25T20:05:00Z'))
    expect(readSetting(db, REMINDERS).map((r) => r.id)).toEqual(['b'])
  })

  it('nothing from the comeback plan is created while Coach and Tasks are off', () => {
    const plan = comebackPlan(new Date(2030, 0, 2, 20, 0), null)
    expect(comebackParts(plan, { coach: false, tasks: false })).toEqual({ checkins: [], tasks: [] })
    const on = comebackParts(plan, { coach: true, tasks: true })
    expect(on.checkins.length).toBe(4)
    expect(on.tasks.length).toBe(3)
    expect(dropComeback([{ ref: 'comeback:2030-01-02' }, { ref: undefined }], comebackRef('2030-01-02'))).toEqual([{ ref: undefined }])
  })

  it('check-in hours and the history use the configured time zone, not the PC clock', () => {
    const tz = new Discipline(db, new Wallet(db, 'Asia/Tokyo'))
    // 11:00 UTC is 20:00 in Tokyo: the evening check-in is open there.
    const at = t('2026-10-25T11:00:00Z')
    tz.setStart('2026-10-15', at)
    expect(tz.state(at).checkIn?.mode).toBe('today')
    tz.checkIn(at)
    expect(tz.state(at).history?.find((h) => h.kind === 'checkin')?.hour).toBe(20)
    // 03:00 UTC is 12:00 in Tokyo: midday waits for 19:00.
    expect(new Discipline(db, new Wallet(db, 'Asia/Tokyo')).state(t('2026-10-26T03:00:00Z')).checkIn?.mode).toBe('wait')
  })
})
