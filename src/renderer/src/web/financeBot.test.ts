import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { BrowserDb } from './browserDb'
import { financeState, logMoney, moneyButton } from './financeBot'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})

const TODAY = '2026-10-31'
function db() {
  const raw = new SQL.Database()
  raw.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const d = new BrowserDb(raw) as any
  const data = {
    settings: {
      currency: 'MDL',
      updatedAt: 1,
      accounts: [
        { id: 'wallet', name: 'Wallet', kind: 'cash', updatedAt: 1 },
        { id: 'maib', name: 'Maib card', bank: 'maib', kind: 'card', updatedAt: 1 }
      ]
    },
    tx: [{ id: 'old', type: 'expense', amount: 4000, currency: 'MDL', rate: 1, base: 4000, date: '2026-10-20', category: 'transport', account: 'maib', note: 'taxi', createdAt: 1, updatedAt: 1 }],
    people: [],
    deleted: {}
  }
  d.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('app_sync_finance', JSON.stringify({ savedAt: 1, data }))
  return d
}

describe('money messages, the smart way', () => {
  it('learns from your past: "taxi 45" goes to Transport, from the card you used for taxi', () => {
    const d = db()
    const r = logMoney(d, 'taxi 45', 'b:1', TODAY)!
    expect(r.tx).toMatchObject({ type: 'expense', amount: 4500, category: 'transport', account: 'maib', date: TODAY })
    expect(financeState(d).tx.some((t: any) => t.id === r.tx.id)).toBe(true)
    // Buttons: each account, the category, undo.
    expect(JSON.stringify(r.keyboard)).toContain('fa|')
    expect(JSON.stringify(r.keyboard)).toContain('fu|')
  })

  it('takes the account named in the message, and knows Romanian/Russian words', () => {
    const d = db()
    expect(logMoney(d, '120 magazin wallet', 'b:2', TODAY)!.tx).toMatchObject({ account: 'wallet', category: 'food', amount: 12000 })
    expect(logMoney(d, 'cafea 35', 'b:3', TODAY)!.tx.category).toBe('food')
    expect(logMoney(d, '120+45 groceries', 'b:4', TODAY)!.tx.amount).toBe(16500)
    expect(logMoney(d, 'coffee 35 yesterday', 'b:5', TODAY)!.tx.date).toBe('2026-10-30')
  })

  it('"+500 salary" is income in Work', () => {
    expect(logMoney(db(), '+500 salary', 'b:6', TODAY)!.tx).toMatchObject({ type: 'income', category: 'work', amount: 50000 })
  })

  it('buttons change the account and category, and undo removes it for good', () => {
    const d = db()
    const { tx } = logMoney(d, 'lunch 80', 'b:7', TODAY)!
    expect(moneyButton(d, `fa|${tx.id}|wallet`, TODAY)!.toast).toContain('Wallet')
    expect(moneyButton(d, `fk|${tx.id}|fun`, TODAY)!.toast).toContain('Fun')
    const t = financeState(d).tx.find((x: any) => x.id === tx.id)
    expect(t).toMatchObject({ account: 'wallet', category: 'fun' })
    expect(JSON.stringify(moneyButton(d, `fc|${tx.id}`, TODAY)!.keyboard)).toContain('fk|')
    moneyButton(d, `fu|${tx.id}`, TODAY)
    const after = financeState(d)
    expect(after.tx.some((x: any) => x.id === tx.id)).toBe(false)
    expect(after.deleted[tx.id]).toBeGreaterThan(0)
  })

  it('not a money message, or Finance Helper never synced: leaves it to the other commands', () => {
    expect(logMoney(db(), 'hello there', 'b:8', TODAY)).toBeNull()
    const empty = new BrowserDb(new SQL.Database()) as any
    empty.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    expect(logMoney(empty, 'taxi 45', 'b:9', TODAY)).toBeNull()
  })
})
