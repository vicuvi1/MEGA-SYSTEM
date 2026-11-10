import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from './db'
import { Wallet } from './wallet'
import { FocusService } from './focus'
import { StudyService } from './studyTime'
import { readSetting } from './settings'

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m)

function setup() {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'st-')), 'life.db'))
  const wallet = new Wallet(db)
  return { db, wallet, study: new StudyService(db, wallet), focus: new FocusService(db, wallet) }
}
const algebra = { id: 'a', name: 'Algebra', plannedMin: 50 }

describe('Study Time on the one focus timer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(13, 9))
  })
  afterEach(() => vi.useRealTimers())

  it('start → break → back → stop: one session with its block and break minutes, paid as live time', () => {
    const { study, focus } = setup()
    study.start(algebra, at(13, 9))
    const run = focus.state(at(13, 9, 1)).running as any
    expect(run).toMatchObject({ subject: 'Algebra', planned: 50, blockId: 'a' })
    // Only one timer: a second start is refused.
    expect(() => study.start({ id: 'b', name: 'Essay', plannedMin: null }, at(13, 9, 2))).toThrow('already running')
    study.breakStart(10, at(13, 9, 30))
    expect((focus.state().running as any).breakMin).toBe(10)
    study.breakEnd(at(13, 9, 40))
    expect((focus.state().running as any).breakMin).toBeNull()
    const r = study.stop(at(13, 10, 10))
    expect(r.session.minutes).toBe(60)
    expect(r.coins).toBeGreaterThan(0)
    const [s] = study.sessions('2026-11-13')
    expect(s).toMatchObject({ blockId: 'a', minutes: 60, breakMin: 10, source: 'timer', day: '2026-11-13' })
  })

  it('the running timer survives a restart: a new service on the same file sees it', () => {
    const { db, wallet, study } = setup()
    study.start(algebra, at(13, 9))
    const again = new StudyService(db, wallet)
    const r = again.stop(at(13, 9, 45))
    expect(r.session.minutes).toBe(45)
  })

  it('an open stopwatch counts up to 4 h at most', () => {
    const { study } = setup()
    study.start({ id: 'b', name: 'Essay', plannedMin: null }, at(13, 9))
    expect(study.stop(at(13, 15)).session.minutes).toBe(240)
  })

  it('a timer forgotten overnight is ended at the time you say, on the day it began, without points', () => {
    const { study, wallet } = setup()
    study.start({ id: 'b', name: 'Essay', plannedMin: null }, at(12, 22))
    const before = wallet.summary().balance
    const r = study.stopAt(at(12, 23, 30).toISOString(), at(13, 8))
    expect(r.session.minutes).toBe(90)
    expect(r.coins).toBe(0)
    expect(wallet.summary().balance).toBe(before)
    expect(study.sessions('2026-11-12')[0]).toMatchObject({ day: '2026-11-12', blockId: 'b', source: 'fixed', minutes: 90 })
  })

  it('typed-in sessions pay nothing; editing a paid one gives its points back; removing deletes its note', () => {
    const { study, wallet, db } = setup()
    study.add({ subject: 'Algebra', blockId: 'a', minutes: 30, breakMin: 5, day: '2026-11-11' }, at(13, 9))
    const typed = study.sessions('2026-11-01')[0]
    expect(typed).toMatchObject({ day: '2026-11-11', minutes: 30, breakMin: 5, source: 'manual', blockId: 'a' })
    expect(() => study.add({ subject: 'x', minutes: 30, day: '2026-11-20' }, at(13, 9))).toThrow('not come')

    study.start(algebra, at(13, 9))
    const r = study.stop(at(13, 9, 50))
    const paid = wallet.summary().balance
    expect(r.coins).toBeGreaterThan(0)
    const edited = study.edit(r.session.id, { minutes: 70 }, at(13, 10))
    expect(edited).toMatchObject({ minutes: 70, source: 'manual' })
    expect(wallet.summary().balance).toBe(paid - r.coins)
    // Changing only the block keeps a session as it was.
    expect(study.edit(typed.id, { blockId: 'b' }, at(13, 10))).toMatchObject({ blockId: 'b', minutes: 30, source: 'manual' })

    study.remove(typed.id, at(13, 10))
    expect(study.sessions('2026-11-01').map((s) => s.id)).toEqual([r.session.id])
    expect(Object.keys((readSetting(db, 'study_log') as object) ?? {})).toHaveLength(1)
  })

  it('blocks are one synced setting, changed one op at a time', () => {
    const { study } = setup()
    expect(study.blocks()).toBeNull()
    study.change({ op: 'starter' }, at(13, 9))
    const s = study.change({ op: 'save', block: { id: 'x', name: 'Physics', category: 'Science', tags: ['lab'], plannedMin: 45, quick: true } }, at(13, 9))
    expect(s.blocks.map((b) => b.name)).toContain('Physics')
    expect(study.blocks()!.categories.map((c) => c.name)).toContain('Science')
  })
})
