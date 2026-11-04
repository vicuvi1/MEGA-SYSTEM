import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from './db'
import { Wallet } from './wallet'
import { FocusService } from './focus'

describe('must-do points', () => {
  it('pay per must-do (not per position), at most 3 a day', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'fp-')), 'life.db'))
    const f = new FocusService(db, new Wallet(db))
    const now = new Date(2026, 10, 4, 12)
    f.setPlan(['Lab report', 'CV', 'Read'], now)
    expect(f.togglePlan(0, now).coins).toBe(10)
    // "Lab report" removed: "CV" moves into position 0 and still pays.
    f.setPlan(['CV', 'Read', 'Gym', 'Call mom'], now)
    expect(f.togglePlan(0, now).coins).toBe(10)
    expect(f.togglePlan(0, now).coins).toBe(0) // unticked
    expect(f.togglePlan(0, now).coins).toBe(0) // ticked again: already paid
    expect(f.togglePlan(1, now).coins).toBe(10)
    expect(f.togglePlan(2, now).coins).toBe(0) // 4th today: over the cap
  })
})

describe('one focus session, one payout', () => {
  it('stopping the same timer twice logs it once', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'fs-')), 'life.db'))
    const f = new FocusService(db, new Wallet(db))
    const t0 = new Date(2026, 10, 4, 10)
    f.start('Algebra', 50, t0)
    const first = f.stop(new Date(2026, 10, 4, 10, 50))
    expect(first.coins).toBeGreaterThan(0)
    expect(() => f.stop(new Date(2026, 10, 4, 10, 51))).toThrow('No focus session')
    expect((db.prepare('SELECT COUNT(*) AS n FROM focus_sessions').get() as { n: number }).n).toBe(1)
  })
})
