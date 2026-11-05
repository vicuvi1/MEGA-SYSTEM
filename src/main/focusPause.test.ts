import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from './db'
import { Wallet } from './wallet'
import { FocusService } from './focus'
import { focusEndsAt, focusedMinutes, pausedMsOf, sessionMinutes } from '@core/focus'

const fresh = () => {
  const db = openDb(join(mkdtempSync(join(tmpdir(), 'fpause-')), 'life.db'))
  return { db, f: new FocusService(db, new Wallet(db)) }
}
const at = (h: number, m: number) => new Date(2026, 10, 4, h, m)

describe('IC1: pausing the focus timer', () => {
  it('paused time does not count and does not pay', () => {
    const { f } = fresh()
    f.start('Algebra', 50, at(10, 0))
    f.pause(at(10, 20))
    expect(f.state(at(10, 25)).running?.pausedAt).toBe(at(10, 20).toISOString())
    f.resume(at(10, 40))
    const run = f.state(at(10, 41)).running!
    expect(run.pausedAt).toBeNull()
    expect(run.pausedMs).toBe(20 * 60_000)
    // The end moved 20 minutes later.
    expect(focusEndsAt(run)).toBe(at(11, 10).getTime())
    const done = f.stop(at(11, 10))
    // 70 minutes on the clock, 20 of them paused: 50 real minutes.
    expect(done.session.minutes).toBe(50)
    expect(done.coins).toBe(15)
  })
  it('stopping while paused leaves the pause going on out', () => {
    const { f } = fresh()
    f.start('Essay', 25, at(9, 0))
    f.pause(at(9, 10))
    expect(f.stop(at(9, 50)).session.minutes).toBe(10)
  })
  it('pausing twice keeps the first pause; resuming a running timer does nothing', () => {
    const { f } = fresh()
    f.start('Read', 25, at(9, 0))
    f.resume(at(9, 1))
    f.pause(at(9, 5))
    f.pause(at(9, 8))
    expect(f.state(at(9, 9)).running?.pausedAt).toBe(at(9, 5).toISOString())
  })
  it('no timer: pause and resume say so; rename changes the subject', () => {
    const { f } = fresh()
    expect(() => f.pause(at(9, 0))).toThrow('No focus session')
    expect(() => f.resume(at(9, 0))).toThrow('No focus session')
    f.start('Read', 25, at(9, 0))
    expect(f.rename('History', at(9, 1)).running?.subject).toBe('History')
    expect(() => f.rename('  ', at(9, 1))).toThrow()
  })
  it('keeps only valid stages', () => {
    const { f } = fresh()
    const st = f.start('Read', 25, at(9, 0), null, [{ kind: 'break', minutes: 5 }, { kind: 'next', minutes: 50, subject: 'Math' }, { kind: 'nope' as any, minutes: 3 }])
    expect(st.running?.stages).toEqual([{ kind: 'break', minutes: 5 }, { kind: 'next', minutes: 50, subject: 'Math' }])
  })
})

describe('pause helpers', () => {
  const run = { startedAt: at(10, 0).toISOString(), planned: 30, pausedAt: at(10, 10).toISOString(), pausedMs: 5 * 60_000 }
  it('adds the pause going on now', () => {
    expect(pausedMsOf(run, at(10, 20).getTime())).toBe(15 * 60_000)
    expect(pausedMsOf({ ...run, pausedAt: null }, at(10, 20).getTime())).toBe(5 * 60_000)
  })
  it('ends later by the earlier pauses; counts only real minutes', () => {
    expect(focusEndsAt(run)).toBe(at(10, 35).getTime())
    expect(focusedMinutes(run, at(10, 20).getTime())).toBe(5)
    expect(sessionMinutes(run.startedAt, 30, at(10, 40), 10 * 60_000)).toBe(30)
  })
})
