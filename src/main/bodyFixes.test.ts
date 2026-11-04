import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Body } from './body'
import { openDb } from './db'
import { Wallet } from './wallet'

describe('Body fixes', () => {
  it('a removed exercise stays removed; the newest metrics come back', () => {
    const db = openDb(join(mkdtempSync(join(tmpdir(), 'bf-')), 'life.db'))
    const body = new Body(db, new Wallet(db))
    const first = body.exercises()
    expect(first.length).toBeGreaterThan(0)
    body.saveExercise({ ...first[0], archived: true } as any)
    expect(body.exercises().some((e) => e.id === first[0].id)).toBe(false)
    expect(body.exercises().some((e) => e.id === first[0].id)).toBe(false)
    for (let k = 0; k < 120; k++) {
      const d = new Date(Date.UTC(2026, 0, 1) + k * 86400000).toISOString().slice(0, 10)
      db.prepare('INSERT INTO body_metrics (day, weight, waist, note, updated_at) VALUES (?, ?, NULL, NULL, ?)').run(d, 70 + k / 100, d)
    }
    const m = body.metrics(100)
    expect(m).toHaveLength(100)
    expect(m[m.length - 1].day).toBe('2026-04-30')
    expect(m[0].day < m[1].day).toBe(true)
  })
})
