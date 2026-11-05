import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from './db'
import { Wallet } from './wallet'
import { FocusService } from './focus'
import { isPlanFor } from '@core/focus'

describe('must-dos linked to Todoist by id', () => {
  it('a starred task stays linked when renamed, and plain edits keep the link', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'pl-')), 'life.db'))
    const f = new FocusService(db, new Wallet(db))
    const now = new Date(2026, 10, 4, 12)
    f.setPlan([{ text: 'Lab report', todoistId: 't1' }, 'Gym'], now)
    f.togglePlan(0, now)
    // Renamed in Todoist: same id, new words, still done and linked.
    let p = f.setPlan([{ text: 'Lab report v2', todoistId: 't1' }, 'Gym'], now)
    expect(p.items[0]).toEqual({ text: 'Lab report v2', done: true, todoistId: 't1' })
    // Something else sets the plan by words only: the link survives.
    p = f.setPlan(['Lab report v2', 'Gym', 'Read'], now)
    expect(p.items[0].todoistId).toBe('t1')
    expect(p.items[2]).toEqual({ text: 'Read', done: false })
  })
  it('matching: by id when linked, else by words', () => {
    expect(isPlanFor({ text: 'Old name', todoistId: 't1' }, { id: 't1', content: 'New name' })).toBe(true)
    expect(isPlanFor({ text: 'Lab report', todoistId: 't9' }, { id: 't1', content: 'Lab report' })).toBe(false)
    expect(isPlanFor({ text: 'lab report ' }, { id: 't1', content: 'Lab Report' })).toBe(true)
  })
})
