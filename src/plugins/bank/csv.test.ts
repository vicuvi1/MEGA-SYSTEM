// Bank statements: made-up CSVs only.
import { describe, expect, it } from 'vitest'
import { guessCategory, parseAmount, parseBankCsv, parseDate, rowHash, splitLine, uniqueRows } from './csv'
import { importBank, importText } from './index'
import { fakeDb } from '../testDb'

describe('bank CSV parsing', () => {
  it('reads amounts in many formats', () => {
    expect(parseAmount('-1.234,56 MDL')).toBe(-1234.56)
    expect(parseAmount('1,234.56')).toBe(1234.56)
    expect(parseAmount('12,50')).toBe(12.5)
    expect(parseAmount('(45.00)')).toBe(-45)
    expect(parseAmount('1 200')).toBe(1200)
    expect(parseAmount('30-')).toBe(-30)
    expect(parseAmount('2026-11-05')).toBeNull()
    expect(parseAmount('')).toBeNull()
  })

  it('reads dates, day first', () => {
    expect(parseDate('05.11.2026')).toBe('2026-11-05')
    expect(parseDate('2026-11-05 14:02')).toBe('2026-11-05')
    expect(parseDate('5/11/26')).toBe('2026-11-05')
    expect(parseDate('31.13.2026')).toBeNull()
  })

  it('splits quoted cells', () => {
    expect(splitLine('"a;b";"say ""hi""";3', ';')).toEqual(['a;b', 'say "hi"', '3'])
  })

  it('reads a semicolon export with one signed amount column', () => {
    const csv = ['Account statement', 'Data;Descriere;Suma;Valuta', '01.11.2026;Test Market;-245,50;MDL', '02.11.2026;Salary Example Co;12 000,00;MDL', '03.11.2026;Cafe Example;-60,00;MDL', 'Total;;11694,50;'].join('\n')
    const r = parseBankCsv(csv)
    expect(r.rows).toEqual([
      { date: '2026-11-01', amount: -245.5, description: 'Test Market' },
      { date: '2026-11-02', amount: 12000, description: 'Salary Example Co' },
      { date: '2026-11-03', amount: -60, description: 'Cafe Example' }
    ])
    expect(r.bad).toBe(0)
    expect(r.allPositive).toBe(false)
  })

  it('reads debit and credit columns', () => {
    const csv = 'Date,Details,Debit,Credit\n2026-11-01,"Bolt ride, city",35.00,\n2026-11-02,Refund,,20.00\n'
    expect(parseBankCsv(csv).rows).toEqual([
      { date: '2026-11-01', amount: -35, description: 'Bolt ride, city' },
      { date: '2026-11-02', amount: 20, description: 'Refund' }
    ])
  })

  it('works without a header row', () => {
    const csv = '01/11/2026\tPharmacy Example\t-80.10\n02/11/2026\tGrocery Example\t-120.00\n'
    expect(parseBankCsv(csv).rows.map((r) => r.amount)).toEqual([-80.1, -120])
  })

  it('removes repeats by date + amount + description', () => {
    const a = { date: '2026-11-01', amount: -10, description: 'Coffee  Shop' }
    const b = { date: '2026-11-01', amount: -10, description: 'coffee shop' }
    expect(rowHash(a)).toBe(rowHash(b))
    expect(uniqueRows([a, b, { ...a, amount: -11 }])).toHaveLength(2)
  })

  it('guesses a category from the description', () => {
    expect(guessCategory('PHARMACY EXAMPLE')).toBe('health')
    expect(guessCategory('Glovo order')).toBe('food')
    expect(guessCategory('Something else')).toBe('other')
  })
})

describe('bank import into the Finance Helper inbox', () => {
  const csv = 'Date;Description;Amount\n01.11.2026;Test Market;-245,50\n01.11.2026;Test Market;-245,50\n02.11.2026;Pay Example;1000,00\n'
  it('queues new payments once and skips what is already there', () => {
    const db = fakeDb()
    const now = new Date('2026-11-05T10:00:00Z')
    const r = importBank(db, csv, now)
    expect(r).toMatchObject({ added: 2, known: 0, repeats: 1 })
    const inbox = JSON.parse(db.rows.get('finance_inbox_json'))
    expect(inbox).toMatchObject([
      { amount: 24550, type: 'expense', date: '2026-11-01', note: 'Test Market' },
      { amount: 100000, type: 'income', date: '2026-11-02' }
    ])
    expect(inbox[0].id).toMatch(/^tg-life-bank-[0-9a-f]{8}$/)
    // The same file again: nothing new.
    expect(importBank(db, csv, now)).toMatchObject({ added: 0, known: 2 })
    expect(importText(importBank(db, csv, now))).toContain('0 new payments')
  })

  it('skips payments Finance Helper already has (same day, amount and type)', () => {
    const db = fakeDb()
    db.rows.set('app_sync_finance', JSON.stringify({ data: { tx: [{ date: '2026-11-01', amount: 24550, type: 'expense' }] } }))
    expect(importBank(db, csv, new Date('2026-11-05T10:00:00Z'))).toMatchObject({ added: 1, known: 1 })
  })

  it('says plainly when the file has no payments', () => {
    expect(importText(importBank(fakeDb(), 'hello\nworld'))).toMatch(/No payments found/)
  })
})
