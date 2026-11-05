import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from './db'
import { Wallet } from './wallet'
import { Body } from './body'
import { restInWeek, weekStart } from '@core/body'

describe('rest-day budget', () => {
  it('two a week are free, a third uses a shield, none left → refused', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'rb-')), 'life.db'))
    const body = new Body(db, new Wallet(db))
    let shields = 1
    body.setShields({ count: () => shields, consume: () => (shields > 0 ? (shields--, true) : false) })
    const now = new Date(2026, 10, 6, 12) // Friday
    body.setRest('2026-11-02', true, now)
    expect(body.setRest('2026-11-03', true, now).restLeftThisWeek).toBe(0)
    body.setRest('2026-11-04', true, now) // 3rd: the shield goes
    expect(shields).toBe(0)
    expect(() => body.setRest('2026-11-05', true, now)).toThrow(/streak shield/)
    // Next week starts fresh.
    expect(() => body.setRest('2026-11-09', true, now)).not.toThrow()
  })
  it('weeks start on Monday', () => {
    expect(weekStart('2026-11-08')).toBe('2026-11-02') // Sunday
    expect(restInWeek(['2026-11-02', '2026-11-08', '2026-11-09'], '2026-11-05')).toBe(2)
  })
})
