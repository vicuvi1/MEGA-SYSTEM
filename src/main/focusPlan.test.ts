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
