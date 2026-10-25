import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from './db'
import { Wallet } from './wallet'
import { Discipline } from './discipline'

let dir: string
let db: DB
let wallet: Wallet
let d: Discipline

const t = (iso: string) => new Date(iso)
const oct25 = t('2026-10-25T10:00:00Z')

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

  it('checks in once a day for coins', () => {
    d.setStart('2026-10-15', oct25)
    d.checkIn(oct25)
    expect(wallet.summary(oct25).balance).toBe(20)
    expect(d.state(oct25).checkedInToday).toBe(true)
    expect(() => d.checkIn(oct25)).toThrow('Already')
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
})
