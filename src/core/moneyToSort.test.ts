import { describe, expect, it } from 'vitest'
import { addCapture, captureTxId, dismissItem, keepToSort, lastReceived, markSorted, mergeToSort, readToSort, toSortWarning, waitingToSort, type ToSortItem } from './moneyToSort'
import { liveLog, logMoment } from './moneyDays'

const AT = Date.UTC(2026, 10, 13, 10, 0, 0)
const DAY = 86400_000
const item = (over: Partial<ToSortItem> = {}): ToSortItem => ({ id: 'a1', at: AT, day: '2026-11-13', source: 'maib', sources: ['maib'], amount: 12345, currency: 'MDL', merchant: 'LINELLA 23', raw: 'maib\nPlată: 123,45 MDL la LINELLA 23', kind: 'debit', state: 'new', updatedAt: AT, ...over })

describe('money_tosort: adding captures', () => {
  it('same payment from maib and Google Wallet = one item with both sources', () => {
    const one = addCapture({ items: [] }, item(), AT)
    expect(one.status).toBe('saved')
    const two = addCapture(one.list, item({ id: 'b2', source: 'gwallet', sources: ['gwallet'], at: AT + 90_000, merchant: 'Linella', raw: 'Linella\nMDL 123.45', last4: '4821' }), AT + 90_000)
    expect(two.status).toBe('merged')
    expect(two.list.items).toHaveLength(1)
    expect(two.list.items[0]).toMatchObject({ id: 'a1', sources: ['maib', 'gwallet'], merchant: 'LINELLA 23', last4: '4821' })
  })

  it('the same notification again is a duplicate (same id, or the same text a minute later)', () => {
    const one = addCapture({ items: [] }, item(), AT)
    expect(addCapture(one.list, item(), AT).status).toBe('duplicate')
    expect(addCapture(one.list, item({ id: 'later', at: AT + 60_000 }), AT).status).toBe('duplicate')
  })

  it('two real payments of the same sum from one app (different texts) stay two; over 5 minutes apart stays two', () => {
    const one = addCapture({ items: [] }, item(), AT)
    expect(addCapture(one.list, item({ id: 'c3', raw: 'maib\nPlată: 123,45 MDL la LINELLA 7' }), AT).list.items).toHaveLength(2)
    expect(addCapture(one.list, item({ id: 'd4', source: 'gwallet', sources: ['gwallet'], at: AT + 5 * 60_000 + 1, raw: 'x' }), AT).list.items).toHaveLength(2)
  })

  it('a refund never merges with a payment of the same sum', () => {
    const one = addCapture({ items: [] }, item(), AT)
    expect(addCapture(one.list, item({ id: 'r', kind: 'refund', source: 'gwallet', sources: ['gwallet'], raw: 'r' }), AT).status).toBe('saved')
  })

  it('unreadable notices are kept to sort by hand; declined ones are kept as dismissed: nothing dropped silently', () => {
    const un = addCapture({ items: [] }, item({ id: 'u', kind: 'ignore', amount: 0, currency: '', reason: 'No amount with a currency in it', state: 'new' }), AT)
    expect(un.status).toBe('unparsed')
    const dec = addCapture(un.list, item({ id: 'v', kind: 'ignore', amount: 0, currency: '', reason: 'A declined payment', state: 'dismissed' }), AT)
    expect(dec.status).toBe('ignored')
    expect(dec.list.items.map((x) => x.id)).toEqual(['u', 'v'])
  })

  it('raw text is cut to 200 characters; at most 50 skipped notices are kept, payments are never capped', () => {
    expect(addCapture({ items: [] }, item({ raw: 'x'.repeat(500) }), AT).list.items[0].raw).toHaveLength(200)
    let list = { items: [item({ id: 'pay' })] }
    for (let i = 0; i < 60; i++) list = addCapture(list, item({ id: `ig${i}`, at: AT + i, kind: 'ignore', state: 'dismissed', amount: 0, currency: '' }), AT).list
    expect(list.items.filter((x) => x.kind === 'ignore')).toHaveLength(50)
    expect(list.items.some((x) => x.id === 'pay')).toBe(true)
    expect(list.items.some((x) => x.id === 'ig0')).toBe(false)
  })
})

describe('money_tosort: sync and clean-up', () => {
  it('merges by id; the state only moves forward; inside a state the later edit wins', () => {
    const a = { items: [item({ state: 'sorted', txId: 'cap-a1', updatedAt: AT + 10 })] }
    const b = { items: [item({ state: 'new', updatedAt: AT + 99 }), item({ id: 'z', at: AT - 1 })] }
    const m = mergeToSort(a, b)
    expect(m.items.map((x) => x.id)).toEqual(['z', 'a1'])
    expect(m.items[1]).toMatchObject({ state: 'sorted', txId: 'cap-a1' })
    expect(mergeToSort({ items: [item({ merchant: 'old', updatedAt: 1 })] }, { items: [item({ merchant: 'new', updatedAt: 2 })] }).items[0].merchant).toBe('new')
  })

  it('new items are never dropped; sorted ones go after 30 days once Finance has the record; warning from day 50', () => {
    const old = AT - 70 * DAY
    const list = { items: [item({ id: 'n', at: old, updatedAt: old }), item({ id: 's', at: old, updatedAt: old, state: 'sorted', txId: 'cap-s' }), item({ id: 's2', at: old, updatedAt: old, state: 'sorted', txId: 'cap-s2' }), item({ id: 'd', at: old, updatedAt: old, state: 'dismissed' })] }
    const kept = keepToSort(list, { tx: [{ id: 'cap-s' }] }, AT)
    expect(kept.items.map((x) => x.id)).toEqual(['n', 's2'])
    expect(toSortWarning(list, AT)).toEqual({ count: 1, oldestDays: 70 })
    expect(toSortWarning({ items: [item({ at: AT - 10 * DAY })] }, AT)).toBeNull()
    expect(toSortWarning({ items: [item({ at: old, test: true })] }, AT)).toBeNull()
  })

  it('sorting or dismissing clears the raw text; two devices sorting make one record id', () => {
    const list = { items: [item(), item({ id: 'b' })] }
    const s = markSorted(list, 'a1', captureTxId('a1'), AT + 5)
    expect(s.items[0]).toMatchObject({ state: 'sorted', txId: 'cap-a1', updatedAt: AT + 5 })
    expect(s.items[0].raw).toBeUndefined()
    expect(dismissItem(s, 'b', AT + 6).items[1]).toMatchObject({ state: 'dismissed', raw: undefined })
    expect(waitingToSort(s).map((x) => x.id)).toEqual(['b'])
    expect(captureTxId('a1')).toBe(captureTxId('a1'))
  })

  it('reads anything odd as empty; the last 5 received are newest first', () => {
    expect(readToSort('nope')).toEqual({ items: [] })
    expect(readToSort('{"items":[{"id":"x"},null,3]}').items).toHaveLength(1)
    const many = { items: Array.from({ length: 8 }, (_, i) => item({ id: `i${i}`, at: AT + i })) }
    expect(lastReceived(many).map((x) => x.id)).toEqual(['i7', 'i6', 'i5', 'i4', 'i3'])
  })
})

describe('honest points for captured payments (moneyDays.logMoment)', () => {
  const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  it('capture sorted the same day counts as live; next day does not; unsorted counts as imported', () => {
    const t = { id: 'cap-1', source: 'capture', date: '2026-11-13', createdAt: AT }
    const same = logMoment({ ...t, confirmedAt: AT + 3600_000 })
    expect(liveLog(t.date, same.at, dayOf, same.imported)).toBe(true)
    const next = logMoment({ ...t, confirmedAt: AT + 30 * 3600_000 })
    expect(liveLog(t.date, next.at, dayOf, next.imported)).toBe(false)
    const none = logMoment(t)
    expect(none.imported).toBe(true)
    expect(liveLog(t.date, none.at, dayOf, none.imported)).toBe(false)
  })
  it('a hand-made record keeps its createdAt rule', () => {
    expect(logMoment({ id: 'x', createdAt: AT })).toEqual({ at: AT, imported: false })
    expect(logMoment({ id: 'imp-1', createdAt: AT }).imported).toBe(true)
  })
})
