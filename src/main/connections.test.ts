import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FINANCE, WAKY } from '../core/connect.fixtures'
import { openDb, type DB } from './db'
import { Wallet } from './wallet'
import { Connections } from './connections'

let dir: string
let db: DB
let wallet: Wallet
let conn: Connections
let wakyFile: string
let finFile: string
let manDir: string

const oct25 = new Date('2026-10-25T12:00:00Z')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-conn-'))
  db = openDb(join(dir, 'life.db'))
  wallet = new Wallet(db, 'UTC')
  wakyFile = join(dir, 'waky.json')
  finFile = join(dir, 'finance-helper-sync.json')
  manDir = join(dir, 'leveldb')
  writeFileSync(wakyFile, WAKY)
  // Finance Helper last saved on the evening of the 25th
  writeFileSync(finFile, FINANCE(Date.parse('2026-10-25T20:00:00Z')))
  mkdirSync(manDir)
  writeFileSync(join(manDir, '000003.log'), Buffer.from('\x01{"streakDays":10,"longestStreak":10,"totalVictories":9,"lastCheckin":"2026-10-25"}\x00', 'latin1'))
  conn = new Connections(db, wallet, { waky: [join(dir, 'missing.json'), wakyFile], finance: [finFile], man: [manDir] })
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('connections', () => {
  it('finds the apps and reports what they hold', () => {
    const s = conn.state(oct25)
    expect(s.waky).toMatchObject({ found: true, path: wakyFile, streak: 1, connectedSince: null })
    expect(s.waky.today).toEqual({ time: '06:32', target: '06:30', onTime: true })
    expect(s.finance).toMatchObject({ found: true, currency: 'MDL', staleDays: 0 })
    expect(s.finance.today).toEqual({ logged: true, everydaySpent: 7000 })
    expect(s.man.suggestion).toMatchObject({ start: '2026-10-15', showsDays: 10 })
  })

  it('pays nothing until an app is connected, then only from the connect day, once', () => {
    expect(conn.sync(oct25)).toBe(0)
    conn.connect('waky', oct25)
    // 25th: up on time and the bedtime before it was on time; the 24th is before connecting.
    expect(conn.sync(oct25)).toBe(2)
    expect(conn.sync(oct25)).toBe(0)
    expect(wallet.summary(oct25).balance).toBe(15)
  })

  it('pays logging and staying under the daily budget for finished days', () => {
    conn.setDailyBudget(150) // 150 MDL
    // Pretend we connected on the 24th
    conn.connect('finance', new Date('2026-10-24T08:00:00Z'))
    const paid = conn.sync(oct25)
    // 24th: logged + 120 MDL everyday (rent excluded) under 150; 25th: logged only (day not over)
    expect(paid).toBe(3)
    const refs = wallet.entries().map((e) => e.ref)
    expect(refs).toEqual(expect.arrayContaining(['fin:logged:2026-10-24', 'fin:budget:2026-10-24', 'fin:logged:2026-10-25']))
    expect(refs).not.toContain('fin:budget:2026-10-25')
  })

  it('does not judge a day that ended after Finance Helper last saved', () => {
    writeFileSync(finFile, FINANCE(Date.parse('2026-10-24T09:00:00Z')))
    conn.setDailyBudget(150)
    conn.connect('finance', new Date('2026-10-24T08:00:00Z'))
    conn.sync(oct25)
    expect(wallet.entries().map((e) => e.ref)).not.toContain('fin:budget:2026-10-24')
  })

  it('never pays a payout again after it was undone', () => {
    conn.connect('waky', oct25)
    conn.sync(oct25)
    const first = wallet.entries()[0]
    wallet.undo(first.id, 'was not true', oct25)
    expect(conn.sync(oct25)).toBe(0)
  })

  it('validates a chosen path', () => {
    expect(() => conn.setPath('waky', join(dir, 'nope.json'))).toThrow('does not exist')
    expect(() => conn.setPath('waky', finFile)).toThrow('Waky')
    expect(() => conn.disconnect('waky')).not.toThrow()
  })
})
