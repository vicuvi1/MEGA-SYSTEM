import { describe, expect, it } from 'vitest'
import { findTwin, parseAmount, parsePayNotification, paySource, payTime, TWIN_WINDOW_MS } from './payNotify'
import { FIXTURES, REAL_SHAPES } from './payNotify.fixtures'

const AT = Date.UTC(2026, 10, 13, 12, 0, 0)

describe('payment notifications: every fixture reads as it should', () => {
  for (const f of [...FIXTURES, ...REAL_SHAPES]) {
    it(f.name, () => {
      const r = parsePayNotification(f.n, { at: AT })
      if ('kind' in f.want) {
        expect(r.ok, JSON.stringify(r)).toBe(false)
        if (!r.ok) {
          expect(r.kind).toBe(f.want.kind)
          expect(r.reason.length).toBeGreaterThan(5)
          if (f.want.source) expect(r.source).toBe(f.want.source)
        }
        return
      }
      expect(r.ok, JSON.stringify(r)).toBe(true)
      if (!r.ok) return
      const { amount, currency, merchant, source, last4, refund } = r
      expect({ amount, currency, merchant, source, ...(last4 ? { last4 } : {}), ...(refund ? { refund } : {}) }).toEqual(f.want)
      expect(r.at).toBe(AT)
      expect(r.raw).toContain(String(f.n.text).slice(0, 10))
    })
  }
})

describe('amounts', () => {
  it('decimal commas and thousands separators', () => {
    expect(parseAmount('123,45')).toBe(12345)
    expect(parseAmount('123.45')).toBe(12345)
    expect(parseAmount('12,5')).toBe(1250)
    expect(parseAmount('1 234,56')).toBe(123456)
    expect(parseAmount('1 234,56')).toBe(123456)
    expect(parseAmount('1.234,56')).toBe(123456)
    expect(parseAmount('1,234.56')).toBe(123456)
    expect(parseAmount('1.234.567,89')).toBe(123456789)
    expect(parseAmount('1,234')).toBe(123400)
    expect(parseAmount('1234')).toBe(123400)
    expect(parseAmount('1,23,456')).toBeNull()
    expect(parseAmount('12,3456')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
  })

  it('never guesses: no currency next to the number means no amount', () => {
    const r = parsePayNotification({ app: 'maib', text: 'Plată 120 la PIATA' }, { at: AT })
    expect(r).toMatchObject({ ok: false, kind: 'unreadable' })
  })

  it('a balance or a fee before the amount is skipped; the time is never read as money', () => {
    const r = parsePayNotification({ app: 'maib', text: 'Sold: 3 450,10 MDL. 14:32 Plată 120,00 MDL la PIATA CENTRALA' }, { at: AT })
    expect(r).toMatchObject({ ok: true, amount: 12000, currency: 'MDL' })
    const fee = parsePayNotification({ app: 'maib', text: 'Comision 5,00 MDL; Plată 80,00 MDL la TAXI' }, { at: AT })
    expect(fee).toMatchObject({ ok: true, amount: 8000 })
  })

  it('a minus sign is spending; a plus sign is money back', () => {
    expect(parsePayNotification({ app: 'maib', text: 'Card *4821: -35,00 MDL CAFE' }, { at: AT })).toMatchObject({ ok: true, amount: 3500 })
    expect(parsePayNotification({ app: 'maib', text: 'Card *4821: +35,00 MDL CAFE' }, { at: AT })).toMatchObject({ ok: true, amount: 3500, refund: true })
  })
})

describe('sources', () => {
  it('the app name wins over words in the text', () => {
    expect(paySource({ app: 'Google Wallet', text: 'with maib Visa' })).toBe('gwallet')
    expect(paySource({ app: 'com.revolut.revolut', text: '' })).toBe('revolut')
    expect(paySource({ app: '', title: 'maib', text: '' })).toBe('maib')
    expect(paySource({ app: 'Bank X', text: 'Plată' })).toBe('generic')
  })
})

describe('payTime', () => {
  const now = Date.UTC(2026, 10, 13, 12, 0, 0) // 14:00 in Chisinau (UTC+2 in November)
  it('ms, seconds and ISO', () => {
    expect(payTime(now - 60_000, now)).toBe(now - 60_000)
    expect(payTime(String(Math.floor((now - 60_000) / 1000)), now)).toBe(now - 60_000)
    expect(payTime(new Date(now - 120_000).toISOString(), now)).toBe(now - 120_000)
  })
  it('"HH:MM" is the last time the local clock read that', () => {
    expect(payTime('13:58', now, 'Europe/Chisinau')).toBe(now - 2 * 60_000)
    expect(payTime('14:03', now, 'Europe/Chisinau')).toBe(now + 3 * 60_000)
    // 23:50 is last night, not tonight.
    expect(payTime('23:50', now, 'Europe/Chisinau')).toBe(now - (14 * 60 + 10) * 60_000)
  })
  it('missing, odd, far future or over a week old: now', () => {
    expect(payTime(undefined, now)).toBe(now)
    expect(payTime('', now)).toBe(now)
    expect(payTime('soon', now)).toBe(now)
    expect(payTime('25:00', now)).toBe(now)
    expect(payTime(now + 3600_000, now)).toBe(now)
    expect(payTime(now - 8 * 86400_000, now)).toBe(now)
  })
})

describe('one payment, two notifications (dedup)', () => {
  const p = (over: Partial<{ amount: number; currency: string; at: number; source: string; raw: string }> = {}) => ({ amount: 12345, currency: 'MDL', at: AT, source: 'gwallet', raw: 'Linella\nMDL 123.45', ...over })
  const list = [{ amount: 12345, currency: 'MDL', at: AT - 60_000, sources: ['maib'], raw: ['maib\nPlată: 123,45 MDL la LINELLA'] }]

  it('maib then Google Wallet, same sum within 5 minutes: the same entry', () => {
    expect(findTwin(list, p())).toBe(0)
    expect(findTwin(list, p({ at: AT - 60_000 + TWIN_WINDOW_MS }))).toBe(0)
    expect(findTwin(list, p({ at: AT - 60_000 - TWIN_WINDOW_MS }))).toBe(0)
  })
  it('over 5 minutes apart, another sum or another currency: a new payment', () => {
    expect(findTwin(list, p({ at: AT - 60_000 + TWIN_WINDOW_MS + 1 }))).toBe(-1)
    expect(findTwin(list, p({ amount: 12346 }))).toBe(-1)
    expect(findTwin(list, p({ currency: 'EUR' }))).toBe(-1)
  })
  it('the same app twice: only the very same text merges (two real coffees stay two)', () => {
    expect(findTwin(list, p({ source: 'maib', raw: 'maib\nPlată: 123,45 MDL la LINELLA' }))).toBe(0)
    expect(findTwin(list, p({ source: 'maib', raw: 'maib\nPlată: 123,45 MDL la LINELLA (2)' }))).toBe(-1)
  })
  it('a removed entry never takes a twin; the closest one wins', () => {
    expect(findTwin([{ ...list[0], remove: true }], p())).toBe(-1)
    const two = [{ ...list[0], at: AT - 240_000 }, { ...list[0], at: AT - 30_000 }]
    expect(findTwin(two, p())).toBe(1)
  })
})
