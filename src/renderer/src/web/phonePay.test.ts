// Phone payments: the capture into money_tosort (never into Finance Helper's
// data), the currency rate, the pasted-to-the-bot path, and job=pay's door
// (keys, limits, 401 / 503, no echo).
import { createRequire } from 'node:module'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { BrowserDb } from './browserDb'
import { handlePipeline } from './fakeTurso'
import { capturePayment, pastedNotice, pastedReply, readToSortDb } from './phonePay'
// @ts-expect-error plain JS module without types
import { config } from '../../../../api/_lib.mjs'
// @ts-expect-error plain JS module without types
import { cleanPay, forgetRates, newHealthKey, newPayKey, payKeyOk, payRequest, PAY_MAX_BYTES, readPayBody, healthKeyOk } from '../../../../api/_health.mjs'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})

const AT = Date.UTC(2026, 10, 13, 10, 0, 0)
const FINANCE = { settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'card', name: 'Card', updatedAt: 1 }] }, rates: { usd: { MDL: 17.5, EUR: 0.875 } }, tx: [], people: [], deleted: {} }

function db(finance: any = FINANCE) {
  const raw = new SQL.Database()
  raw.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const d = new BrowserDb(raw) as any
  if (finance) d.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('app_sync_finance', JSON.stringify({ savedAt: 1, data: finance }))
  return d
}
const setting = (d: any, key: string) => (d.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any)?.value ?? null
const opts = { at: AT, day: '2026-11-13', now: AT }

describe('capture into money_tosort', () => {
  it('a maib payment waits to sort; Finance Helper and the Telegram inbox are untouched', () => {
    const d = db()
    const before = setting(d, 'app_sync_finance')
    const r = capturePayment(d, { app: 'maib', title: 'maib', text: 'Plată: 123,45 MDL la LINELLA 23 CHISINAU MD. Card *4821' }, opts)
    expect(r).toMatchObject({ status: 'saved', amount: 12345, currency: 'MDL', merchant: 'LINELLA 23', source: 'maib' })
    const items = readToSortDb(d).items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: r.id, state: 'new', kind: 'debit', rate: 1, day: '2026-11-13', via: 'phone', last4: '4821', sources: ['maib'] })
    expect(items[0].raw).toContain('Plată: 123,45 MDL')
    expect(setting(d, 'app_sync_finance')).toBe(before)
    expect(setting(d, 'finance_inbox_json')).toBeNull()
  })

  it('a euro payment keeps its own currency with the rate through USD (17.5 / 0.875 = 20 MDL per EUR)', () => {
    const d = db()
    capturePayment(d, { app: 'Revolut', text: 'You paid €12.50 at Corner Bakery' }, opts)
    expect(readToSortDb(d).items[0]).toMatchObject({ amount: 1250, currency: 'EUR', rate: 20, kind: 'debit' })
    // No rates at all: the rate stays unknown (null), never 1.
    const bare = db({ ...FINANCE, rates: {} })
    capturePayment(bare, { app: 'Revolut', text: 'You paid €12.50 at Corner Bakery' }, opts)
    expect(readToSortDb(bare).items[0].rate).toBeNull()
  })

  it('maib then Google Wallet a minute later: one item, both sources', () => {
    const d = db()
    capturePayment(d, { app: 'maib', text: 'Plată: 123,45 MDL la LINELLA 23. Card *4821' }, opts)
    const r = capturePayment(d, { app: 'Google Wallet', title: 'Linella', text: 'MDL 123.45 with Visa •••• 4821' }, { ...opts, at: AT + 60_000 })
    expect(r.status).toBe('merged')
    expect(readToSortDb(d).items).toHaveLength(1)
    expect(readToSortDb(d).items[0].sources).toEqual(['maib', 'gwallet'])
  })

  it('declined and unreadable notices are kept with a reason, never dropped', () => {
    const d = db()
    expect(capturePayment(d, { app: 'maib', text: 'Tranzacție respinsă: 310,00 MDL la SHOE PLANET' }, opts)).toMatchObject({ status: 'ignored', reason: expect.stringMatching(/declined/i) })
    expect(capturePayment(d, { app: 'maib', text: 'Ceva nou de la bancă' }, { ...opts, at: AT + 1 })).toMatchObject({ status: 'unparsed' })
    expect(readToSortDb(d).items.map((x) => [x.kind, x.state])).toEqual([['ignore', 'dismissed'], ['ignore', 'new']])
  })

  it('works before Finance Helper ever synced (main currency MDL)', () => {
    const d = db(null)
    expect(capturePayment(d, { app: 'maib', text: 'Plată: 10,00 MDL la X SHOP' }, opts).status).toBe('saved')
  })
})

describe('a notification pasted to the finance bot', () => {
  it('is read by the same parser; plain money messages are left alone', () => {
    expect(pastedNotice('Plată: 123,45 MDL la LINELLA 23. Card *4821')).not.toBeNull()
    expect(pastedNotice('You paid €12.50 at Corner Bakery')).not.toBeNull()
    expect(pastedNotice('Linella MDL 123.45 with Visa •••• 4821')).not.toBeNull()
    expect(pastedNotice('taxi 45 maib')).toBeNull()
    expect(pastedNotice('coffee 35 lei')).toBeNull()
    expect(pastedNotice('/money 45')).toBeNull()
    const d = db()
    const r = capturePayment(d, pastedNotice('Plată: 123,45 MDL la LINELLA 23. Card *4821')!, { ...opts, via: 'telegram' })
    expect(readToSortDb(d).items[0].via).toBe('telegram')
    expect(pastedReply(r)).toMatch(/Saved 123,45 MDL at LINELLA 23 to sort/)
    expect(pastedReply(r)).not.toMatch(/points?\b.*\+/)
  })
})

// ---- the door: POST /api/cron?job=pay -----------------------------------------
const cfg = config({ TURSO_URL: 'libsql://fake.turso.io', TURSO_TOKEN: 'k', SESSION_SECRET: 'test-secret' })
function fakeFetch(raw: any) {
  return (async (_u: string, init: { body: string }) => {
    const out = handlePipeline(raw, JSON.parse(init.body))
    return { ok: true, status: 200, text: async () => JSON.stringify(out), json: async () => out }
  }) as unknown as typeof fetch
}

describe('job=pay: keys, limits and answers', () => {
  let raw: any
  let fetchImpl: typeof fetch
  let captured: any[]
  const capture = async (input: any) => (captured.push(input), { status: 'saved', id: 'x', amount: 100, currency: 'MDL' })
  const call = (over: Record<string, unknown> = {}) => payRequest({ cfg, method: 'POST', token: '', ip: '10.0.0.1', size: 50, raw: JSON.stringify({ app: 'maib', title: 'maib', text: 'Plată: 1,00 MDL la X' }), capture, now: AT, fetchImpl, isSession: async (t: string) => t === 'session-ok', ...over })
  beforeEach(() => {
    raw = new SQL.Database()
    fetchImpl = fakeFetch(raw)
    captured = []
    forgetRates()
  })

  it('401 without a key, with a wrong key, or with a health key (its own kind)', async () => {
    expect((await call())[0]).toBe(401)
    expect((await call({ token: 'pk_' + 'a'.repeat(32) }))[0]).toBe(401)
    const hk = await newHealthKey(cfg, 'Phone', AT, fetchImpl)
    expect((await call({ token: hk.key }))[0]).toBe(401)
    const pk = await newPayKey(cfg, 'Phone', AT, fetchImpl)
    expect(await healthKeyOk(cfg, pk.key, AT, fetchImpl)).toBe(false)
    expect(captured).toHaveLength(0)
  })

  it('a payment key saves; the answer never echoes the key or the text; last used is noted', async () => {
    const pk = await newPayKey(cfg, 'Pixel <b>', AT, fetchImpl)
    expect(pk.key).toMatch(/^pk_[\w-]{32}$/)
    expect(pk.label).toBe('Pixel b')
    const [status, body] = await call({ token: pk.key })
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, status: 'saved', amount: 100 })
    expect(JSON.stringify(body)).not.toContain(pk.key)
    expect(JSON.stringify(body)).not.toContain('Plată')
    expect(captured[0]).toEqual({ app: 'maib', title: 'maib', text: 'Plată: 1,00 MDL la X', time: '' })
    expect(await payKeyOk(cfg, pk.key, AT + 5, fetchImpl)).toEqual({ id: pk.id, label: 'Pixel b' })
    expect(String(raw.exec('SELECT hash FROM sys_pay_keys')[0].values[0][0])).not.toContain(pk.key)
  })

  it('size, method, empty body and bad fields are refused', async () => {
    const pk = await newPayKey(cfg, 'P', AT, fetchImpl)
    expect((await call({ token: pk.key, size: PAY_MAX_BYTES + 1 }))[0]).toBe(413)
    expect((await call({ token: pk.key, method: 'GET' }))[0]).toBe(405)
    expect((await call({ token: pk.key, raw: '' }))[0]).toBe(400)
    expect((await call({ token: pk.key, raw: JSON.stringify({ text: { evil: 1 } }) }))[0]).toBe(400)
    expect((await call({ token: pk.key, raw: JSON.stringify({ app: 'maib', text: '  ' }) }))[0]).toBe(400)
    expect(captured).toHaveLength(0)
  })

  it('rate-limited per IP and per key', async () => {
    const pk = await newPayKey(cfg, 'P', AT, fetchImpl)
    const codes: number[] = []
    for (let i = 0; i < 32; i++) codes.push((await call({ token: pk.key, ip: `10.0.0.${i % 5}` }))[0])
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true)
    expect(codes[30]).toBe(429)
    forgetRates()
    const ips: number[] = []
    for (let i = 0; i < 31; i++) ips.push((await call({ ip: '10.9.9.9' }))[0])
    expect(ips[30]).toBe(429)
  })

  it('a database hiccup is a 503 (never a 401 or a silent drop)', async () => {
    const pk = await newPayKey(cfg, 'P', AT, fetchImpl)
    const r = await call({ token: pk.key, capture: async () => Promise.reject(new Error('Turso down')) })
    expect(r).toEqual([503, { error: 'Database not reachable: try again in a moment' }])
    const down = (async () => Promise.reject(new Error('down'))) as unknown as typeof fetch
    expect((await call({ token: pk.key, fetchImpl: down }))[0]).toBe(503)
  })

  it('the signed-in ops: list, make, drop, test; refused without a session', async () => {
    expect((await call({ raw: JSON.stringify({ op: 'list' }) }))[0]).toBe(401)
    const [, made] = await call({ token: 'session-ok', raw: JSON.stringify({ op: 'new', label: 'Phone' }) })
    expect(made.key).toMatch(/^pk_/)
    const [, listed] = await call({ token: 'session-ok', raw: JSON.stringify({ op: 'list' }) })
    expect(listed.keys).toEqual([{ id: made.id, label: 'Phone', created: AT, lastUsed: null }])
    const [, tested] = await call({ token: 'session-ok', raw: JSON.stringify({ op: 'test' }) })
    expect(tested).toMatchObject({ ok: true, status: 'saved' })
    expect(captured[0]).toMatchObject({ test: true })
    const [, dropped] = await call({ token: 'session-ok', raw: JSON.stringify({ op: 'drop', id: made.id }) })
    expect(dropped.keys).toEqual([])
    expect((await call({ token: made.key }))[0]).toBe(401)
  })

  it("MacroDroid's body is read even when a quote or a line break in the notification breaks the JSON", () => {
    expect(readPayBody('{"app":"maib","title":"maib","text":"Plată 5,00 MDL la "LA PLACINTE"","time":"14:02"}')).toEqual({ app: 'maib', title: 'maib', text: 'Plată 5,00 MDL la "LA PLACINTE"', time: '14:02' })
    expect(readPayBody('{"app":"maib","text":"Plată 5,00 MDL\nla X"}')).toEqual({ app: 'maib', text: 'Plată 5,00 MDL\nla X' })
    expect(readPayBody('Plată 5,00 MDL la X')).toEqual({ text: 'Plată 5,00 MDL la X' })
    expect(readPayBody('')).toBeNull()
    expect(cleanPay({ app: 'maib', text: 'x'.repeat(5000), time: 1700000000 }).input).toMatchObject({ time: '1700000000' })
    expect(cleanPay({ app: 'maib', text: 'x'.repeat(5000) }).input.text).toHaveLength(1500)
  })
})
