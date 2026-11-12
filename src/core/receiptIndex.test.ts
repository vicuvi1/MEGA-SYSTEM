import { describe, expect, it } from 'vitest'
import { capReceipts, checkReceipt, cleanReceipts, mergeReceipts, planReceiptSync, receiptFileName, receiptFolderPath, receiptProps, type ReceiptIndex } from './receiptIndex'

const e = (over: Record<string, unknown> = {}) => ({ tx: 't1', name: 'paper.jpg', mime: 'image/jpeg', size: 1000, date: '2026-11-03', updatedAt: 10, ...over })
const ix = (items: Record<string, any>): ReceiptIndex => ({ v: 1, items })

describe('money receipts index', () => {
  it('mergeReceipts: later change wins, a Drive id is never lost, a tombstone wins', () => {
    const a = ix({ 'r-aaaa11': e({ name: 'old.jpg', driveId: 'd1', updatedAt: 10 }) })
    const b = ix({ 'r-aaaa11': e({ name: 'new.jpg', updatedAt: 20 }) })
    const m = mergeReceipts(a, b)
    expect(m.items['r-aaaa11']).toMatchObject({ name: 'new.jpg', driveId: 'd1', updatedAt: 20 })
    expect(mergeReceipts(b, a)).toEqual(m)
    const gone = mergeReceipts(m, ix({ 'r-aaaa11': e({ gone: 5, updatedAt: 1 }) }))
    expect(gone.items['r-aaaa11'].gone).toBe(5)
    expect(gone.items['r-aaaa11'].driveId).toBe('d1')
    // Both sides' receipts are kept.
    expect(Object.keys(mergeReceipts(a, ix({ 'r-bbbb22': e() })).items).sort()).toEqual(['r-aaaa11', 'r-bbbb22'])
  })

  it('cleanReceipts drops malformed rows and ids, never image data', () => {
    const c = cleanReceipts({ items: { 'r-good11': e({ driveId: 'ok_1', data: 'data:image/png;base64,AAAA' }), bad: e(), 'r-x': e(), 'r-weird1': 'nope', 'r-bad222': e({ driveId: "x' or 1" }) } })
    expect(Object.keys(c.items).sort()).toEqual(['r-bad222', 'r-good11'])
    expect(JSON.stringify(c)).not.toContain('base64')
    expect(c.items['r-bad222'].driveId).toBeUndefined()
    expect(cleanReceipts(null)).toEqual({ v: 1, items: {} })
  })

  it('over the cap, the oldest tombstones go first and a live receipt is never dropped', () => {
    const items: Record<string, any> = {}
    for (let i = 0; i < 50; i++) items[`r-live${String(i).padStart(3, '0')}`] = e()
    for (let i = 0; i < 50; i++) items[`r-dead${String(i).padStart(3, '0')}`] = e({ gone: i + 1 })
    const capped = capReceipts(ix(items), 8000)
    const live = Object.keys(capped.items).filter((k) => k.startsWith('r-live'))
    expect(live).toHaveLength(50)
    expect(capped.items['r-dead000']).toBeUndefined()
  })

  it('folder Life System/Receipts/YYYY-MM, a safe file name and appProperties with the ids', () => {
    expect(receiptFolderPath('2026-11-03')).toEqual(['Life System', 'Receipts', '2026-11'])
    expect(receiptFileName('r-ab12cd', '2026-11-03', 'Printer paper / A4: "bulk"', 'application/pdf')).toBe('2026-11-03 Printer paper A4 bulk r-ab12cd.pdf')
    expect(receiptProps('r-ab12cd', 't9')).toEqual({ lsApp: 'receipt', lsId: 'r-ab12cd', lsTx: 't9' })
  })

  it('only photos and PDFs up to 20 MB', () => {
    expect(checkReceipt('image/jpeg', 10)).toBeNull()
    expect(checkReceipt('application/pdf', 10)).toBeNull()
    expect(checkReceipt('text/html', 10)).toMatch(/photo/)
    expect(checkReceipt('image/png', 21 * 1024 * 1024)).toMatch(/20 MB/)
  })

  it('planReceiptSync: adopt what Drive has (no second upload), upload the rest, count what waits', () => {
    const index = ix({ 'r-done01': e({ driveId: 'd' }), 'r-wait01': e(), 'r-wait02': e(), 'r-else01': e(), 'r-gone01': e({ gone: 3 }) })
    const p = planReceiptSync(index, [{ id: 'r-done01', hasFile: true }, { id: 'r-wait01', hasFile: true }, { id: 'r-wait02', hasFile: true }, { id: 'r-gone01', hasFile: true }], { 'r-wait02': 'd2' })
    expect(p.uploads).toEqual(['r-wait01'])
    expect(p.adopt).toEqual([{ id: 'r-wait02', driveId: 'd2' }])
    expect(p.notInDrive).toBe(2)
  })
})
