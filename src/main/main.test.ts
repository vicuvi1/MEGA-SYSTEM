import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from './db'
import { Wallet } from './wallet'

let dir: string
let db: DB

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-test-'))
  db = openDb(join(dir, 'life.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('database', () => {
  it('seeds default rules once and keeps the ledger append-only', () => {
    const w = new Wallet(db, 'UTC')
    const n = w.rules().length
    expect(n).toBeGreaterThan(5)
    db.close()
    db = openDb(join(dir, 'life.db'))
    expect(new Wallet(db, 'UTC').rules().length).toBe(n)

    const id = new Wallet(db, 'UTC').award('sleep.up_on_time')
    expect(() => db.prepare('UPDATE ledger SET coins = 999 WHERE id = ?').run(id)).toThrow('append-only')
    expect(() => db.prepare('DELETE FROM ledger WHERE id = ?').run(id)).toThrow('append-only')
  })
})

describe('wallet', () => {
  it('awards, enforces caps and undoes', () => {
    const w = new Wallet(db, 'UTC')
    const now = new Date('2026-10-25T09:00:00Z')
    const id = w.award('sleep.up_on_time', undefined, now)
    expect(w.summary(now)).toMatchObject({ balance: 10, totalXp: 20, todayCoins: 10 })
    expect(w.summary(now).todayRules).toContain('sleep.up_on_time')
    expect(() => w.award('sleep.up_on_time', undefined, now)).toThrow('Daily limit')
    w.undo(id, 'pressed by mistake', now)
    expect(w.summary(now)).toMatchObject({ balance: 0, totalXp: 0 })
    expect(w.summary(now).todayRules).not.toContain('sleep.up_on_time')
    expect(w.history().length).toBe(2)
  })
  it('clamps a penalty at a zero balance', () => {
    const w = new Wallet(db, 'UTC')
    w.award('study.block_skipped')
    expect(w.summary().balance).toBe(0)
  })
  it('saves edited rules and validates them', () => {
    const w = new Wallet(db, 'UTC')
    const r = w.rule('body.workout_done')
    w.saveRule({ ...r, coins: 12 })
    expect(w.rule('body.workout_done').coins).toBe(12)
    expect(() => w.saveRule({ ...r, xp: -1 })).toThrow()
    w.saveRule({ ...r, id: 'custom.read', title: 'Read 20 pages', module: 'tasks' })
    expect(w.rules().at(-1)?.id).toBe('custom.read')
  })
})
