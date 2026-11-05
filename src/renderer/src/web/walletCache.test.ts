import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { effective } from '@core/ledger'
import { BrowserDb } from './browserDb'
import { Wallet } from '../../../main/wallet'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})

function fresh() {
  const raw = new SQL.Database()
  for (const m of MIGRATIONS) raw.exec(m)
  const db = new BrowserDb(raw)
  return { raw, db, w: () => new Wallet(db as any, 'UTC') }
}
const row = (coins: number, day = '2026-11-01') => ({ ts: `${day}T10:00:00.000Z`, day, module: 'test', kind: 'earn' as const, coins, xp: 1 })
const plain = (db: BrowserDb) => (db.prepare('SELECT * FROM ledger ORDER BY id').all() as any[]).map((r) => r.id)

describe('points history read once and kept until it changes', () => {
  it('matches the database after every kind of change', () => {
    const { raw, db, w } = fresh()
    db.transaction(() => { w().append(row(5)); w().append(row(7)) })()
    expect(w().entries().map((e) => e.id)).toEqual(plain(db))
    expect(w().entries()).toEqual(w().entries())
    // Our own write.
    db.transaction(() => w().append(row(3)))()
    expect(w().entries().map((e) => e.coins)).toEqual([5, 7, 3])
    // An undo.
    db.transaction(() => w().undo(2, 'oops', new Date('2026-11-02T10:00:00Z')))()
    expect(w().effective().map((e) => e.coins)).toEqual([5, 3])
    expect(w().effective()).toEqual(effective(w().entries()))
    // A sync that swaps the table under us (bypassing the wallet), same row count and ids.
    raw.run('DROP TRIGGER ledger_no_delete')
    raw.run('DELETE FROM ledger')
    raw.run("INSERT INTO ledger (id, ts, day, module, kind, coins, xp) VALUES (1, 'x', '2026-11-01', 'test', 'earn', 50, 0), (2, 'x', '2026-11-01', 'test', 'earn', 70, 0), (3, 'x', '2026-11-01', 'test', 'earn', 30, 0), (4, 'x', '2026-11-02', 'test', 'undo', -70, 0)")
    expect(w().entries().map((e) => e.coins)).toEqual([50, 70, 30, -70])
  })

  it('never keeps a change that was rolled back', () => {
    const { db, w } = fresh()
    db.transaction(() => w().append(row(5)))()
    expect(w().entries().length).toBe(1)
    expect(() =>
      db.transaction(() => {
        w().append(row(9))
        expect(w().entries().length).toBe(2)
        throw new Error('no')
      })()
    ).toThrow('no')
    expect(w().entries().map((e) => e.coins)).toEqual([5])
  })

  it('hands out a fresh list each time', () => {
    const { db, w } = fresh()
    db.transaction(() => { w().append(row(5)); w().append(row(6)) })()
    const a = w().entries()
    a.reverse()
    a.push(a[0])
    expect(w().entries().map((e) => e.coins)).toEqual([5, 6])
    const b = w().effective()
    b.length = 0
    expect(w().effective().length).toBe(2)
  })

  it('reads one day straight from the database', () => {
    const { db, w } = fresh()
    db.transaction(() => { w().append(row(5, '2026-11-01')); w().append(row(6, '2026-11-02')); w().append(row(7, '2026-11-02')) })()
    expect(w().entriesOn('2026-11-02')).toEqual(w().entries().filter((e) => e.day === '2026-11-02'))
  })
})
