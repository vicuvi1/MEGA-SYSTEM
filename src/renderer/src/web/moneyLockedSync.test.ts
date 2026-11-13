// Money locked with its PIN syncs as a sealed copy (2026-11-13): the server
// never sees the PIN or the plain data, a device that is not locked asks for
// the PIN once, a wrong or different PIN changes nothing, and nothing is lost.
// Also the sync history in Settings → Data safety. Made-up data only.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from './fakeTurso'
import { Mirror, type MirrorStore } from './mirror'
import { TursoHttp } from './tursoHttp'
import { addAppSyncEvent, appSyncEventLine, appSyncEventText, appSyncHistory, createAppSync, HISTORY_KEY, HISTORY_PER_APP } from './appSync'
import { DIFFERENT_PIN, FINANCE, moneyPinState, NEED_PIN, SEALED_SETTING, setMoneyPin, WRONG_CLOUD_PIN, WRONG_PIN } from './financeSync'
// @ts-ignore plain JS module from the embedded app
import { normalizeState } from '../../public/apps/finance/js/model.js'
// @ts-ignore plain JS module from the embedded app
import { deriveKey, newSalt, openWithPin, seal } from '../../public/apps/finance/js/cipher.js'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  setMoneyPin(null)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setMoneyPin(null)
})

const KEY = 'finance-helper.state'
const ENC = 'finance-helper.enc'
const HEAD = 'finance-helper.head'
const ITER = 1000 // a fast key for tests (the app uses 310000; the box says which)
const rec = (id: string, extra: any = {}) => ({ id, type: 'expense', amount: 1000, currency: 'MDL', rate: 1, base: 1000, date: '2026-11-01', category: 'food', account: 'wallet', note: `Made-up ${id}`, createdAt: 1, updatedAt: 1, ...extra })
const fin = (tx: any[], deleted: Record<string, number> = {}) =>
  normalizeState({ version: 9, settings: { currency: 'MDL', updatedAt: 1, accounts: [{ id: 'wallet', name: 'Wallet', updatedAt: 1 }], categories: [{ id: 'food', type: 'expense', name: 'Food', updatedAt: 1 }] }, tx, people: [], deleted, meta: {} })

function memStore(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0
  } as unknown as Storage
}

function cloud() {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const json = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
  })
  let n = 0
  const raw = (key: string): string | null => {
    const v = remote.exec('SELECT value FROM settings WHERE key = ?', [key])[0]?.values[0]?.[0]
    return v == null ? null : String(v)
  }
  const write = (key: string, v: any) => {
    remote.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(v)])
    remote.run("INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [`other-${++n}`])
  }
  /** Every value the server holds, as one text (to prove what it never sees). */
  const everything = () => JSON.stringify(remote.exec('SELECT key, value FROM settings'))
  /** The sealed copy opened with a PIN (what a device with the PIN would see). */
  const opened = async (p: string) => JSON.parse(await openWithPin(JSON.parse(raw(SEALED_SETTING)!).box, p))
  return { remote, raw, write, everything, opened }
}

async function desktop(store: Storage) {
  let bytes: Uint8Array | null = null
  const disk: MirrorStore = { load: async () => bytes, save: async (b) => void (bytes = b.slice()) }
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), disk, true)
  await mirror.ready
  return { mirror, app: createAppSync(mirror, FINANCE, store) }
}
async function web(store: Storage) {
  const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
  await mirror.ready
  return { mirror, app: createAppSync(mirror, FINANCE, store) }
}

/** Finance Helper's "Encrypt my data" on a device: only the sealed box and its header are kept. */
async function lock(store: Storage, state: any, p: string) {
  const salt = newSalt()
  const key = await deriveKey(p, salt, ITER)
  store.setItem(ENC, JSON.stringify(await seal(JSON.stringify(state), key, salt, ITER)))
  store.setItem(HEAD, JSON.stringify({ v: 1, enc: { salt, iter: ITER }, theme: '', meta: {} }))
  store.removeItem(KEY)
}
const lockedIds = async (store: Storage, p: string) => JSON.parse(await openWithPin(JSON.parse(store.getItem(ENC)!), p)).tx.map((t: any) => t.id).sort()
const plainIds = (s: Storage) => (JSON.parse(s.getItem(KEY) || 'null')?.tx ?? []).map((t: any) => t.id).sort()

describe('Money locked with its PIN: a sealed copy travels', () => {
  it('a locked desktop sends its sealed data without the PIN; the server never sees the PIN or a record', async () => {
    const net = cloud()
    const pc = memStore()
    await lock(pc, fin([rec('lunch'), rec('taxi')]), '4821')
    const d = await desktop(pc)
    const r = await d.app.sync({ check: true })
    expect(r).toMatchObject({ ok: true, changes: 1, confirmed: true, locked: true })
    expect(d.app.status()).toMatchObject({ state: 'ok' })
    expect(appSyncEventText(r)).toBe('sent the locked copy · cloud up to date')
    expect(net.raw(SEALED_SETTING)).toContain('"fh":"enc1"')
    expect(net.raw('app_sync_finance')).toBeNull()
    const all = net.everything()
    for (const secret of ['Made-up lunch', 'Made-up taxi', '"lunch"', '4821']) expect(all).not.toContain(secret)
    // ...and only a device with the PIN can read it.
    expect((await net.opened('4821')).tx.map((t: any) => t.id).sort()).toEqual(['lunch', 'taxi'])
  })

  it('the website asks for the PIN once, a wrong PIN changes nothing, the right one merges both ways', async () => {
    const net = cloud()
    const pc = memStore()
    await lock(pc, fin([rec('lunch'), rec('taxi', { amount: 2500, updatedAt: 9 })]), '4821')
    await (await desktop(pc)).app.sync({ check: true })
    const sealedBefore = net.raw(SEALED_SETTING)

    // The website (not locked) has its own records, and an older edit of one.
    const phone = memStore()
    phone.setItem(KEY, JSON.stringify(fin([rec('web-coffee'), rec('taxi', { amount: 1800, updatedAt: 3 })])))
    const w = await web(phone)
    const before = phone.getItem(KEY)

    // No PIN yet: nothing is written anywhere, and the panel asks for it.
    const r0 = await w.app.sync({ check: true })
    expect(r0.skipped).toBe(NEED_PIN)
    expect(moneyPinState()).toEqual({ wanted: true, held: false })
    expect(phone.getItem(KEY)).toBe(before)
    expect(net.raw(SEALED_SETTING)).toBe(sealedBefore)

    // A wrong PIN: the error says so, and neither side changes.
    setMoneyPin('0000')
    const r1 = await w.app.sync({ check: true, full: true })
    expect(r1).toMatchObject({ ok: false, error: WRONG_CLOUD_PIN })
    expect(phone.getItem(KEY)).toBe(before)
    expect(net.raw(SEALED_SETTING)).toBe(sealedBefore)
    expect(moneyPinState().held).toBe(false)

    // The right PIN: the website gets the desktop's records, the newer edit wins, and its own go up sealed.
    setMoneyPin('4821')
    const r2 = await w.app.sync({ check: true, full: true })
    expect(r2).toMatchObject({ ok: true, confirmed: true, got: 2, sent: 1, locked: true })
    expect(plainIds(phone)).toEqual(['lunch', 'taxi', 'web-coffee'])
    expect(JSON.parse(phone.getItem(KEY)!).tx.find((t: any) => t.id === 'taxi').amount).toBe(2500)
    expect((await net.opened('4821')).tx.map((t: any) => t.id).sort()).toEqual(['lunch', 'taxi', 'web-coffee'])
    expect(net.everything()).not.toContain('Made-up web-coffee')
    expect(appSyncEventText(r2)).toBe('sent 1 record (locked) · got 2 records from the locked copy · cloud up to date')

    // The desktop, given its PIN in Data safety, takes the website's record into its locked data.
    setMoneyPin('4821')
    const d2 = await desktop(pc)
    const r3 = await d2.app.sync({ check: true })
    expect(r3).toMatchObject({ ok: true, got: 1, confirmed: true })
    expect(await lockedIds(pc, '4821')).toEqual(['lunch', 'taxi', 'web-coffee'])
    expect(pc.getItem(KEY)).toBeNull() // still only sealed on the desktop
  })

  it('a deletion travels only as a tombstone, through the sealed copy', async () => {
    const net = cloud()
    const pc = memStore()
    await lock(pc, fin([rec('a'), rec('b')]), '4821')
    await (await desktop(pc)).app.sync({ check: true })
    const phone = memStore()
    phone.setItem(KEY, JSON.stringify(fin([rec('a'), rec('b')])))
    setMoneyPin('4821')
    const w = await web(phone)
    await w.app.sync({ check: true })
    // Deleted on the website (Finance Helper keeps a tombstone).
    phone.setItem(KEY, JSON.stringify(fin([rec('a')], { b: 50 })))
    await w.app.sync({ check: true })
    expect((await net.opened('4821')).tx.map((t: any) => t.id)).toEqual(['a'])
    await (await desktop(pc)).app.sync({ check: true })
    expect(await lockedIds(pc, '4821')).toEqual(['a'])
  })

  it('a locked desktop without the PIN never replaces a sealed copy another device changed', async () => {
    const net = cloud()
    const pc = memStore()
    await lock(pc, fin([rec('a')]), '4821')
    const d = await desktop(pc)
    await d.app.sync({ check: true })
    // The website adds a record (with the PIN) and seals the copy again.
    const phone = memStore()
    phone.setItem(KEY, JSON.stringify(fin([rec('web')])))
    setMoneyPin('4821')
    await (await web(phone)).app.sync({ check: true })
    const fromWeb = net.raw(SEALED_SETTING)
    // Meanwhile the desktop's own data changed, and its window has no PIN.
    setMoneyPin(null)
    await lock(pc, fin([rec('a'), rec('pc-new')]), '4821')
    const r = await d.app.sync({ check: true })
    expect(r.skipped).toBe(NEED_PIN)
    expect(net.raw(SEALED_SETTING)).toBe(fromWeb)
    // With the PIN, nothing is lost on either side.
    setMoneyPin('4821')
    await d.app.sync({ check: true })
    expect(await lockedIds(pc, '4821')).toEqual(['a', 'pc-new', 'web'])
    expect((await net.opened('4821')).tx.map((t: any) => t.id).sort()).toEqual(['a', 'pc-new', 'web'])
  })

  it('two devices locked with different PINs: a clear message, and neither side is overwritten', async () => {
    const net = cloud()
    const pcA = memStore()
    await lock(pcA, fin([rec('a')]), '1111')
    await (await desktop(pcA)).app.sync({ check: true })
    const sealedA = net.raw(SEALED_SETTING)
    const pcB = memStore()
    await lock(pcB, fin([rec('b')]), '2222')
    const encB = pcB.getItem(ENC)
    const b = await desktop(pcB)
    // Without a PIN: it would replace another device's copy, so it waits.
    expect((await b.app.sync({ check: true })).skipped).toBe(NEED_PIN)
    // With its own PIN: the cloud copy can't be opened.
    setMoneyPin('2222')
    const r = await b.app.sync({ check: true, full: true })
    expect(r).toMatchObject({ ok: false, error: DIFFERENT_PIN })
    expect(b.app.status()).toMatchObject({ state: 'error', error: DIFFERENT_PIN })
    expect(net.raw(SEALED_SETTING)).toBe(sealedA)
    expect(pcB.getItem(ENC)).toBe(encB)
    // The PIN of this device's own data was right, so it is kept for the next try.
    expect(moneyPinState().held).toBe(true)
    // A wrong PIN for this device's own data is forgotten.
    setMoneyPin('9999')
    expect((await b.app.sync({ check: true })).error).toBe(WRONG_PIN)
    expect(moneyPinState().held).toBe(false)
    expect(pcB.getItem(ENC)).toBe(encB)
  })

  it('a record a bot added to the plain copy reaches the locked desktop once its PIN is given', async () => {
    const net = cloud()
    const pc = memStore()
    await lock(pc, fin([rec('a')]), '4821')
    const d = await desktop(pc)
    await d.app.sync({ check: true })
    net.write('app_sync_finance', { savedAt: 5, editedAt: 5, data: FINANCE.share!(fin([rec('tg', { updatedAt: 5 })])) })
    expect((await d.app.sync({ check: true })).skipped).toBe(NEED_PIN)
    setMoneyPin('4821')
    await d.app.sync({ check: true })
    expect(await lockedIds(pc, '4821')).toEqual(['a', 'tg'])
    expect((await net.opened('4821')).tx.map((t: any) => t.id).sort()).toEqual(['a', 'tg'])
    // The plain copy is never rewritten from locked data.
    expect(net.raw('app_sync_finance')).not.toContain('"a"')
  })
})

describe('Sync history (Settings → Data safety)', () => {
  it('records real runs, newest first, in plain words', async () => {
    cloud()
    const phone = memStore()
    phone.setItem(KEY, JSON.stringify(fin([rec('a'), rec('b')])))
    const w = await web(phone)
    await w.app.sync({ check: true })
    await w.app.sync({ check: true, full: true })
    const list = appSyncHistory(phone)
    expect(list.map((e) => e.text)).toEqual(['nothing to send · cloud up to date', 'sent 1 change · cloud up to date'])
    expect(list[0]).toMatchObject({ setting: 'app_sync_finance', label: 'Money' })
  })

  it('reads as a line with the day and time', () => {
    const at = new Date(2026, 10, 13, 21, 40).getTime()
    expect(appSyncEventLine({ at, setting: 'app_sync_finance', label: 'Money', text: 'sent 37 records · cloud up to date' })).toBe('13 Nov 21:40 · Money · sent 37 records · cloud up to date')
    expect(appSyncEventLine({ at, setting: 'app_sync_finance', label: 'Money', text: 'skipped (Money locked)', times: 3 })).toBe('13 Nov 21:40 · Money · skipped (Money locked) (3 times)')
    expect(appSyncEventText({ ok: false, error: 'Failed to fetch. Tried again later.', sent: 0, changes: 0, confirmed: false })).toBe('failed: Failed to fetch')
    expect(appSyncEventText({ ok: true, sent: 0, changes: 0, confirmed: true })).toBeNull()
  })

  it('keeps at most 20 per app, counts a repeated skip once, and a full storage never breaks it', () => {
    const s = memStore()
    for (let i = 0; i < 30; i++) addAppSyncEvent(s, { at: 1000 + i, setting: 'app_sync_finance', label: 'Money', text: `sent ${i + 1} records · cloud up to date` })
    for (let i = 0; i < 3; i++) addAppSyncEvent(s, { at: 2000 + i, setting: 'app_sync_sport', label: 'Sport Track', text: 'skipped (offline)' })
    const list = appSyncHistory(s)
    expect(list.filter((e) => e.setting === 'app_sync_finance')).toHaveLength(HISTORY_PER_APP)
    expect(list.filter((e) => e.setting === 'app_sync_finance')[0].text).toBe('sent 30 records · cloud up to date')
    expect(list.filter((e) => e.setting === 'app_sync_sport')).toEqual([{ at: 2002, setting: 'app_sync_sport', label: 'Sport Track', text: 'skipped (offline)', times: 3 }])
    // Storage full: fewer events are kept, nothing throws.
    const full = memStore()
    const setItem = full.setItem.bind(full)
    full.setItem = (k: string, v: string) => {
      if (k === HISTORY_KEY && v.length > 400) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' })
      setItem(k, v)
    }
    for (let i = 0; i < 25; i++) expect(() => addAppSyncEvent(full, { at: i, setting: 'app_sync_finance', label: 'Money', text: `sent ${i + 1} records · cloud up to date` })).not.toThrow()
    expect(appSyncHistory(full).length).toBeGreaterThan(0)
    expect(appSyncHistory(full)[0].text).toBe('sent 25 records · cloud up to date')
  })
})
