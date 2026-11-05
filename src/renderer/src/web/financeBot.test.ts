import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { BrowserDb } from './browserDb'
import { deleteMoney, editMoney, financeState, keepMoneyAsk, logMoney, moneyButton, previewMoney, recentMoney, takeMoneyAsk } from './financeBot'

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

describe('the coach fixes money records', () => {
  it('lists recent ones, edits and deletes them', () => {
    const d = db()
    const r = logMoney(d, 'water 250', 'b:9', TODAY)!
    const list = recentMoney(d, TODAY)
    expect(list[0].id).toBe(r.tx.id)
    expect(list[0].line).toContain('250')
    expect(list.some((m) => m.id === 'old')).toBe(false) // older than 3 days
    const e = editMoney(d, r.tx.id, { amount: 25, account: 'wallet' })
    expect(e.ok).toBe(true)
    expect(financeState(d).tx.find((t: any) => t.id === r.tx.id)).toMatchObject({ amount: 2500, base: 2500, account: 'wallet' })
    expect(editMoney(d, r.tx.id, { category: 'nonsense-xyz' }).ok).toBe(false)
    expect(deleteMoney(d, r.tx.id)).toContain('25')
    const st = financeState(d)
    expect(st.tx.some((t: any) => t.id === r.tx.id)).toBe(false)
    expect(st.deleted[r.tx.id]).toBeTruthy()
    expect(deleteMoney(d, r.tx.id)).toBeNull()
  })
})

describe('unclear money asks first (X5)', () => {
  it('previews without logging, and keeps the text for one tap', () => {
    const d = db()
    const p = previewMoney(d, 'taxi 45')!
    expect(p.amount).toBe(4500)
    expect(p.label).toContain('45 MDL')
    expect(financeState(d).tx).toHaveLength(1)
    const id = keepMoneyAsk(d, 'taxi 45', 1000)
    expect(takeMoneyAsk(d, id)).toBe('taxi 45')
    expect(takeMoneyAsk(d, id)).toBeNull()
  })
})

describe('quick add in the app (MF1): the main lei wallet unless you name one', () => {
  const main = { mainAccount: true }
  it('"45 food maib" goes to the maib card', () => {
    expect(logMoney(db(), '45 food maib', 'q:1', TODAY, Date.now(), main)!.tx).toMatchObject({ type: 'expense', amount: 4500, account: 'maib', date: TODAY })
  })
  it('"120+45 groceries yesterday" adds up, books yesterday, from the wallet', () => {
    expect(logMoney(db(), '120+45 groceries yesterday', 'q:2', TODAY, Date.now(), main)!.tx).toMatchObject({ amount: 16500, account: 'wallet', date: '2026-10-30' })
  })
  it('"taxi 45" uses the wallet, not the card you used last for taxi (the bot keeps that)', () => {
    expect(logMoney(db(), 'taxi 45', 'q:3', TODAY, Date.now(), main)!.tx).toMatchObject({ account: 'wallet', category: 'transport' })
    expect(logMoney(db(), 'taxi 45', 'q:4', TODAY)!.tx.account).toBe('maib')
  })
  it('"+500 salary" is income into the wallet; the preview says the same', () => {
    expect(logMoney(db(), '+500 salary', 'q:5', TODAY, Date.now(), main)!.tx).toMatchObject({ type: 'income', amount: 50000, account: 'wallet' })
    expect(previewMoney(db(), '45 food maib', main)).toMatchObject({ amount: 4500, type: 'expense', account: 'Maib card' })
    expect(previewMoney(db(), 'hello there', main)).toBeNull()
  })
})
