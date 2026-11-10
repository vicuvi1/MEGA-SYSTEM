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
    study.start(algebra, at(13, 9), 'up')
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
    study.start({ id: 'b', name: 'Essay', plannedMin: null }, at(13, 9), 'up')
    expect(study.stop(at(13, 15)).session.minutes).toBe(240)
  })

  it('a timer forgotten overnight is ended at the time you say, on the day it began, without points', () => {
    const { study, wallet } = setup()
    study.start({ id: 'b', name: 'Essay', plannedMin: null }, at(12, 22), 'up')
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

  it('pomodoro: 25 then a break, a long break after 4, keep going counts it; the session keeps its pomodoros', () => {
    const { study, focus } = setup()
    study.change({ op: 'prefs', prefs: { mode: 'pomodoro', work: 25, short: 5, long: 15, every: 2 } }, at(13, 9))
    study.start(algebra, at(13, 9))
    expect((focus.state().running as any).pomo).toMatchObject({ done: 0, at: 25 })
    // Pomodoro 1 done at 9:25: Take 5.
    study.pomoBreak(at(13, 9, 25))
    let run = focus.state().running as any
    expect(run).toMatchObject({ pauseKind: 'break', breakMin: 5, pomo: { done: 1, at: 50 } })
    study.breakEnd(at(13, 9, 30))
    // Pomodoro 2 done at 9:55: the long break (every 2 here).
    study.pomoBreak(at(13, 9, 55))
    run = focus.state().running as any
    expect(run).toMatchObject({ breakMin: 15, pomo: { done: 2, at: 75 } })
    study.breakEnd(at(13, 10, 10))
    // Keep going after the third, then +5 on the fourth.
    study.keepGoing(at(13, 10, 35))
    study.extend(5, at(13, 10, 40))
    expect((focus.state().running as any).pomo).toMatchObject({ done: 3, at: 105 })
    const r = study.finish('Chapter 4, exercises 1–12', at(13, 10, 45))
    expect(r.session.minutes).toBe(85)
    const [s] = study.sessions('2026-11-13')
    expect(s).toMatchObject({ breakMin: 20, pomos: 3, note: 'Chapter 4, exercises 1–12' })
  })

  it('pause and resume are kept apart from breaks; neither counts as study', () => {
    const { study, focus } = setup()
    study.start(algebra, at(13, 9), 'up')
    study.pause(at(13, 9, 10))
    expect((focus.state().running as any)).toMatchObject({ pauseKind: 'pause', breakMin: null })
    study.resume(at(13, 9, 14))
    study.breakStart(5, at(13, 9, 20))
    study.resume(at(13, 9, 25))
    study.pause(at(13, 9, 30))
    const r = study.stop(at(13, 9, 33))
    expect(r.session.minutes).toBe(21)
    expect(study.sessions('2026-11-13')[0]).toMatchObject({ breakMin: 5, pauseMin: 7 })
  })

  it('switch block without stopping: the time so far goes to the old block, the new one starts at once', () => {
    const { study, focus, wallet } = setup()
    study.start(algebra, at(13, 9), 'up')
    const before = wallet.summary().balance
    const { logged, state } = study.switchBlock({ id: 'b', name: 'Essay', plannedMin: 30 }, 'Did the proofs', at(13, 9, 40))
    expect(logged!.session.minutes).toBe(40)
    expect(wallet.summary().balance).toBeGreaterThan(before)
    expect(state.running).toMatchObject({ subject: 'Essay', startedAt: at(13, 9, 40).toISOString(), planned: 30 })
    expect((focus.state().running as any).blockId).toBe('b')
    expect(study.sessions('2026-11-13')[0]).toMatchObject({ blockId: 'a', note: 'Did the proofs' })
    // A switch within 30 seconds logs nothing for the old block.
    const quick = study.switchBlock(algebra, null, at(13, 9, 40, ))
    expect(quick.logged).toBeNull()
    expect(study.sessions('2026-11-13')).toHaveLength(1)
  })

  it('a note added later changes no minutes and no points; best hours come from timed sessions', () => {
    const { study, wallet } = setup()
    study.start(algebra, at(13, 9), 'up')
    const r = study.stop(at(13, 9, 50))
    const bal = wallet.summary().balance
    expect(study.setNote(r.session.id, '  Read   chapter 2 ')).toMatchObject({ note: 'Read chapter 2', minutes: 50 })
    expect(wallet.summary().balance).toBe(bal)
    expect(study.bestHours(at(13, 12)).hours[9].minutes).toBe(50)
  })

  it('repeating blocks move on when done; Todoist study tasks become blocks', () => {
    const { study } = setup()
    study.change({ op: 'save', block: { id: 'r', name: 'Vocab', category: 'English', plannedMin: 15, repeat: 'weekdays', due: '2026-11-13' } }, at(13, 9))
    const s = study.change({ op: 'done', id: 'r', done: true }, at(13, 9))
    expect(s.blocks.find((b) => b.id === 'r')).toMatchObject({ done: false, due: '2026-11-16', lastDone: '2026-11-13' })
    study.change({ op: 'prefs', prefs: { todoist: { projects: ['University'], labels: [] } } }, at(13, 9))
    const t = study.change({ op: 'todoist', tasks: [{ id: '501', content: 'Physics sheet 3', due: '2026-11-14', project: 'University', section: 'Physics', labels: [], duration: 45 }, { id: '502', content: 'Buy milk', due: null, project: 'Home' }] }, at(13, 9))
    expect(t.blocks.find((b) => b.taskId === '501')).toMatchObject({ name: 'Physics sheet 3', category: 'Physics', plannedMin: 45, fromTodoist: true })
    expect(t.blocks.some((b) => b.taskId === '502')).toBe(false)
  })
})
