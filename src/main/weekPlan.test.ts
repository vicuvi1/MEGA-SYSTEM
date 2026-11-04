import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from './db'
import { Wallet } from './wallet'
import { WeekPlanService } from './weekPlan'

describe('week plans are kept per week', () => {
  it("planning next week on Sunday doesn't wipe this week's big 3", () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'wp-')), 'life.db'))
    const svc = new WeekPlanService(db, new Wallet(db))
    const wed = new Date(2026, 10, 4, 12) // Wed 4 Nov
    svc.save({ big3: [{ text: 'Lab report', done: false }] }, wed)
    const sun = new Date(2026, 10, 8, 18) // Sun 8 Nov: plans the week of 9 Nov
    svc.save({ big3: [{ text: 'CV', done: false }] }, sun)
    expect(svc.active(sun)?.big3[0].text).toBe('Lab report')
    expect(svc.toggle(0, sun).big3[0].done).toBe(true)
    expect(svc.active(new Date(2026, 10, 10, 12))?.big3[0].text).toBe('CV')
    expect(svc.history().map((p) => p.week)).toEqual(['2026-11-09', '2026-11-02'])
    expect(svc.saved()?.big3[0].text).toBe('CV')
  })
})
