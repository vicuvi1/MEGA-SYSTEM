import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from './db'
import { Wallet } from './wallet'
import { Auth } from './auth'
import { Backups } from './backup'

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
    expect(() => w.award('sleep.up_on_time', undefined, now)).toThrow('Daily limit')
    w.undo(id, 'pressed by mistake', now)
    expect(w.summary(now)).toMatchObject({ balance: 0, totalXp: 0 })
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

describe('auth', () => {
  it('sets, checks and rate-limits the PIN', () => {
    let t = 0
    const a = new Auth(db, () => t)
    expect(a.status()).toEqual({ pinSet: false, locked: false })
    expect(() => a.setPin('12')).toThrow('4 to 12 digits')
    a.setPin('1234')
    a.lock()
    expect(a.isLocked()).toBe(true)
    for (let i = 0; i < 4; i++) expect(() => a.unlock('0000')).toThrow('Wrong PIN')
    expect(() => a.unlock('0000')).toThrow('Too many tries')
    expect(() => a.unlock('1234')).toThrow('Wait')
    t += 31_000
    expect(a.unlock('1234').locked).toBe(false)
    expect(() => a.setPin('5678', '9999')).toThrow('Current PIN')
    // A fresh process starts locked
    expect(new Auth(db).isLocked()).toBe(true)
  })
})

describe('backups', () => {
  function setup(drive: boolean) {
    const driveRoot = join(dir, 'drive')
    if (drive) mkdirSync(driveRoot)
    let pass: string | null = null
    let clock = new Date(2026, 9, 25, 10, 0, 0)
    const b = new Backups({
      db: () => db,
      driveRoot,
      dir: join(driveRoot, 'Life System', 'backups'),
      pendingDir: join(dir, 'pending'),
      passphrase: () => pass,
      now: () => clock
    })
    return { b, driveRoot, setPass: (p: string) => (pass = p), tick: () => (clock = new Date(clock.getTime() + 60_000)) }
  }

  it('needs a passphrase, writes encrypted snapshots, skips when unchanged and verifies', () => {
    const { b, setPass, tick } = setup(true)
    expect(b.run().lastError).toMatch(/passphrase/)
    setPass('long passphrase')
    new Wallet(db, 'UTC').award('sleep.up_on_time')
    let s = b.run()
    expect(s.lastError).toBeNull()
    expect(s.count).toBe(1)
    const file = join(s.dir, s.last!.name)
    expect(readFileSync(file).subarray(0, 4).toString()).toBe('LSB1')
    tick()
    s = b.run()
    expect(s.count).toBe(1) // nothing changed
    tick()
    expect(b.run(true).count).toBe(2)
    const v = b.verifyLatest()
    expect(v.ok).toBe(true)
    expect(v.detail).toContain('1 wallet entries')
  })

  it('keeps snapshots locally while Drive is missing, then moves them over', () => {
    const { b, driveRoot, setPass, tick } = setup(false)
    setPass('long passphrase')
    let s = b.run(true)
    expect(s.driveAvailable).toBe(false)
    expect(s.pending).toBe(1)
    expect(s.lastError).toMatch(/Google Drive not found/)
    mkdirSync(driveRoot)
    tick()
    s = b.run(true)
    expect(s.pending).toBe(0)
    expect(s.count).toBe(2)
    expect(s.lastError).toBeNull()
  })

  it('restores a backup into a working database', () => {
    const { b, setPass } = setup(true)
    setPass('long passphrase')
    const w = new Wallet(db, 'UTC')
    w.award('sleep.up_on_time')
    w.award('discipline.clean_day')
    const name = b.run(true).last!.name
    expect(() => b.prepareRestore(name, 'wrong')).toThrow('Wrong passphrase')
    const ready = b.prepareRestore(name, 'long passphrase')
    const restored = openDb(ready)
    expect(new Wallet(restored, 'UTC').summary().balance).toBe(30)
    restored.close()
    rmSync(ready, { force: true })
    expect(existsSync(ready)).toBe(false)
    expect(readdirSync(join(dir, 'drive', 'Life System', 'backups')).length).toBe(1)
  })
})
