import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from './db'
import { ShieldService } from './shields'
import { Wallet } from './wallet'

let dir: string
let db: DB
let wallet: Wallet
let shields: ShieldService

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-shields-test-'))
  db = openDb(join(dir, 'life.db'))
  wallet = new Wallet(db, 'UTC')
  shields = new ShieldService(db, wallet, 'UTC')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('ShieldService backend', () => {
  it('buys a streak shield when balance is sufficient', () => {
    const now = new Date('2026-10-27T12:00:00Z')
    // Award 60 coins across different rules
    wallet.award('discipline.clean_day', '', now)
    wallet.award('body.workout_done', '', now)
    wallet.award('sleep.up_on_time', '', now)
    wallet.award('face.routine_done', '', now)
    wallet.award('study.block_done', '', now) // 20 + 10 + 10 + 5 + 15 = 60 coins

    expect(wallet.summary(now).balance).toBe(60)
    expect(shields.count()).toBe(0)

    const res = shields.buy(now)
    expect(res.shields).toBe(1)
    expect(res.balance).toBe(10) // 60 - 50 = 10
    expect(shields.count()).toBe(1)
  })

  it('consumes a shield', () => {
    expect(shields.consume()).toBe(false) // 0 shields
  })
})
