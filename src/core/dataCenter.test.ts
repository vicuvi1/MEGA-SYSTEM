import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DAY_MS,
  LOCAL_CHARS,
  REQUEST_CAP,
  SYNC_RED,
  SYNC_WARN,
  addSample,
  agoText,
  dataNotice,
  dataWarnings,
  forecast,
  historyPrunePlan,
  levelOf,
  localMeter,
  localUsage,
  moneyRecords,
  overviewLine,
  prunableTombstones,
  recordRate,
  requestBytes,
  sampleRate,
  soonest,
  spanText,
  storageEntries,
  syncMeter,
  usedText,
  utf8Bytes,
  type Sample
} from './dataCenter'

// A made-up Wednesday; every test that looks at "now" uses it.
const NOW = Date.parse('2026-11-18T10:00:00Z')
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

describe('size measurement', () => {
  it('counts UTF-8 bytes, and a value as it travels in a request (quotes and backslashes double)', () => {
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('ș€')).toBe(5)
    const value = JSON.stringify({ note: 'made-up "coffee"', n: 1 })
    // The value is sent as a JSON string: 2 for the outer quotes, 1 more per quote and backslash inside.
    expect(requestBytes(value)).toBe(utf8Bytes(JSON.stringify(value)))
    expect(requestBytes(value)).toBeGreaterThan(utf8Bytes(value) + 2)
  })

  it('sizes localStorage by key (key + value characters), biggest first, with plain names', () => {
    const u = localUsage([
      ['finance-helper.state', 'x'.repeat(1000)],
      ['life_sync_app_sync_finance', 'y'.repeat(900)],
      ['life_sync_app_sync_finance_before_restore', 'z'.repeat(2000)],
      ['ls.theme', 'dark']
    ])
    expect(u.chars).toBe(20 + 1000 + 26 + 900 + 41 + 2000 + 8 + 4)
    expect(u.keys.map((k) => k.label)).toEqual(['Copy from before a restore', 'Money: your records', 'Money: last synced copy', 'ls.theme'])
  })

  it('reads a Storage', () => {
    const data: Record<string, string> = { a: '1', bb: '22' }
    const store = { length: 2, key: (i: number) => Object.keys(data)[i] ?? null, getItem: (k: string) => data[k] ?? null }
    expect(storageEntries(store)).toEqual([['a', '1'], ['bb', '22']])
  })
})

describe('warning thresholds', () => {
  it('a synced copy warns at 2.5 MB and is red at 3.5 MB of the 4.5 MB one request may carry', () => {
    expect(syncMeter('m', 'Money', 2_499_999).level).toBe('ok')
    expect(syncMeter('m', 'Money', SYNC_WARN).level).toBe('warn')
    expect(syncMeter('m', 'Money', 3_499_999).level).toBe('warn')
    expect(syncMeter('m', 'Money', SYNC_RED).level).toBe('red')
    expect(syncMeter('m', 'Money', 1).limit).toBe(REQUEST_CAP)
  })

  it('app storage warns at 60% and is red at 80% of about 5 million characters', () => {
    expect(localMeter(LOCAL_CHARS * 0.59).level).toBe('ok')
    expect(localMeter(LOCAL_CHARS * 0.6).level).toBe('warn')
    expect(localMeter(LOCAL_CHARS * 0.8).level).toBe('red')
    expect(usedText(localMeter(2_500_000))).toBe('2.5 M characters of 5.0 M characters')
  })

  it('no level without a limit', () => {
    expect(levelOf(1e12, null, null)).toBe('ok')
  })

  it('lists what needs a look, worst first, and writes one notification', () => {
    const ok = syncMeter('a', 'Waky: synced copy', 10)
    const warn = syncMeter('b', 'Money: synced copy', 2_600_000)
    const red = localMeter(4_500_000)
    expect(dataWarnings([ok, warn, red]).map((m) => m.id)).toEqual(['local', 'b'])
    expect(dataNotice([], [ok])).toBeNull()
    expect(dataNotice([], [warn])).toEqual({ title: 'Life System: your data is filling up', body: 'Money: synced copy is at 2.6 MB of 4.5 MB (58%). Open the Data center.' })
    expect(dataNotice([], [warn, red])?.title).toBe('Life System: your data is nearly out of room')
    // A red backup comes first.
    expect(dataNotice(['Cloud backup'], [red])).toEqual({ title: 'Life System: a backup needs a look', body: 'Cloud backup. Open the Data center.' })
  })
})

describe('growth forecast', () => {
  const day = (n: number) => NOW - n * DAY_MS

  it('reads Money records with their dates and sizes', () => {
    const state = {
      tx: [
        { id: 't1', amount: 40, note: 'made-up lunch', createdAt: day(3) },
        { id: 't2', amount: 12, note: 'made-up bus', date: '2026-11-01' },
        { id: 't3', amount: 5 }
      ],
      goals: [{ id: 'g1', name: 'made-up bike', updatedAt: day(200) }],
      settings: { theme: 'dark' }
    }
    const r = moneyRecords(state)
    expect(r).toHaveLength(3)
    expect(r[0]).toEqual({ at: day(3), bytes: utf8Bytes(JSON.stringify(state.tx[0])) + 1 })
    expect(r[1].at).toBe(Date.parse('2026-11-01'))
    expect(moneyRecords(null)).toEqual([])
  })

  it('bytes per day from the records of the last 90 days; a short history is not spread over the whole window', () => {
    // 3 records of 300 bytes a day for 400 days.
    const steady = Array.from({ length: 1200 }, (_, i) => ({ at: day(i / 3), bytes: 300 }))
    expect(recordRate(steady, NOW, 90)).toBeCloseTo(900, -1)
    expect(recordRate(steady, NOW, 365)).toBeCloseTo(900, -1)
    // Only 10 days of data: 900 a day, not 100.
    const fresh = Array.from({ length: 30 }, (_, i) => ({ at: day(i / 3), bytes: 300 }))
    expect(recordRate(fresh, NOW, 90)).toBeGreaterThan(850)
    expect(recordRate([], NOW, 90)).toBe(0)
  })

  it('the sentence: "At your pace (…), Money\x27s synced copy reaches its limit in about 2 years 3 months (Mar 2029)"', () => {
    // 1.0 MB used of 4.5 MB, growing 4,120 bytes a day: 3.5 MB / 4,120 = 849.5 days.
    const m = syncMeter('sync:app_sync_finance', "Money's synced copy", 1_000_000)
    const f = forecast(m, [{ perDay: 4120, from: 'made-up records' }], NOW)
    expect(Math.round(f.days!)).toBe(850)
    expect(f.when).toBe('Mar 2029')
    expect(f.text).toBe("At your pace (125 KB a month), Money's synced copy reaches its limit in about 2 years 3 months (Mar 2029).")
    expect(f.assumption).toBe('made-up records')
  })

  it('uses the fastest growth it knows (the earliest date), and rounds the time down', () => {
    const m = syncMeter('m', 'Money', 2_000_000)
    const slow = forecast(m, [{ perDay: 1000, from: 'samples' }], NOW)
    const both = forecast(m, [{ perDay: 1000, from: 'samples' }, { perDay: 5000, from: 'last 90 days' }, { perDay: null, from: 'unknown' }], NOW)
    expect(both.days!).toBeLessThan(slow.days!)
    expect(both.perDay).toBe(5000)
    expect(both.assumption).toBe('last 90 days')
    expect(spanText(729)).toBe('about 1 year 11 months')
    expect(spanText(59)).toBe('about 8 weeks')
    expect(spanText(13.9)).toBe('about 13 days')
    expect(spanText(0.4)).toBe('less than a day')
  })

  it('says so when there is no history, no growth, more than 30 years, or no room left', () => {
    const m = syncMeter('m', 'Waky', 50_000)
    expect(forecast(m, [{ perDay: null, from: 'x' }], NOW)).toMatchObject({ days: null, when: null })
    expect(forecast(m, [{ perDay: null, from: 'x' }], NOW).text).toMatch(/not enough history yet/)
    expect(forecast(m, [{ perDay: -20, from: 'x' }], NOW).text).toMatch(/not growing/)
    expect(forecast(m, [{ perDay: 10, from: 'x' }], NOW).text).toMatch(/more than 30 years/)
    expect(forecast(syncMeter('m', 'Money', REQUEST_CAP + 1), [{ perDay: 10, from: 'x' }], NOW)).toMatchObject({ days: 0, level: 'red' })
  })

  it('a limit less than a year away is amber, less than 90 days red; the soonest one leads the overview', () => {
    const far = forecast(syncMeter('a', 'A', 1_000_000), [{ perDay: 1000, from: 'x' }], NOW)
    const year = forecast(syncMeter('b', 'B', 1_000_000), [{ perDay: 3_500_000 / 200, from: 'x' }], NOW)
    const soon = forecast(syncMeter('c', 'C', 1_000_000), [{ perDay: 3_500_000 / 30, from: 'x' }], NOW)
    expect([far.level, year.level, soon.level]).toEqual(['ok', 'warn', 'red'])
    expect(soonest([far, year, soon])?.id).toBe('c')
    expect(soonest([forecast(syncMeter('d', 'D', 1), [], NOW)])).toBeNull()
  })

  it('daily samples: one per day, every day for 60 days, then one a month, and the growth between them', () => {
    let h: Sample[] = []
    for (let i = 199; i >= 0; i--) {
      const d = new Date(NOW - i * DAY_MS).toISOString().slice(0, 10)
      h = addSample(h, { day: d, sizes: { money: 1_000_000 + (199 - i) * 2000 } })
    }
    // 61 daily ones plus the first of each older month.
    expect(h.length).toBeGreaterThan(61)
    expect(h.length).toBeLessThan(61 + 6)
    expect(h[h.length - 1]).toEqual({ day: '2026-11-18', sizes: { money: 1_398_000 } })
    // The same day again only updates it, and keeps the other sizes of that day.
    const again = addSample(h, { day: '2026-11-18', sizes: { sport: 5 } })
    expect(again).toHaveLength(h.length)
    expect(again[again.length - 1].sizes).toEqual({ money: 1_398_000, sport: 5 })
    expect(sampleRate(h, 'money', '2026-11-18')).toBeCloseTo(2000, 0)
    // Under two weeks of samples says nothing.
    expect(sampleRate(h.slice(-10), 'money', '2026-11-18')).toBeNull()
    expect(sampleRate(h, 'waky', '2026-11-18')).toBeNull()
  })
})

describe('clean-up plans never lose data', () => {
  it('change history: only entries older than the chosen days go; entries without a time stay', () => {
    const entries = [{ id: 1, at: NOW - 5 * DAY_MS }, { id: 2, at: NOW - 31 * DAY_MS }, { id: 3, at: NOW - 80 * DAY_MS }, { id: 4 }, { id: 5, at: 'not a date' }]
    const p = historyPrunePlan(entries, 30, NOW)
    expect(p.drop.map((e) => e.id)).toEqual([2, 3])
    expect(p.keep.map((e) => e.id)).toEqual([1, 4, 5])
    expect(p.freed).toBe(utf8Bytes(JSON.stringify(p.drop)))
    expect(historyPrunePlan(entries, 365, NOW)).toMatchObject({ drop: [], freed: 0 })
  })

  const deleted = { old1: NOW - 200 * DAY_MS, old2: NOW - 100 * DAY_MS, recent: NOW - 20 * DAY_MS }

  it('deletion marks: nothing is dropped without a list of devices', () => {
    const p = prunableTombstones(deleted, [], NOW)
    expect(p.drop).toEqual([])
    expect(p.keep).toBe(3)
    expect(p.reason).toMatch(/no list of your devices/)
  })

  it('deletion marks: nothing is dropped while a device has never confirmed a sync', () => {
    const p = prunableTombstones(deleted, [{ id: 'pc', name: 'Desktop app', syncedAt: NOW - DAY_MS }, { id: 'ph', name: 'Phone browser', syncedAt: null }], NOW)
    expect(p.drop).toEqual([])
    expect(p.reason).toBe('Kept: Phone browser has not confirmed a sync yet.')
  })

  it('deletion marks: a mark a device has not seen is never dropped', () => {
    // The phone last synced 150 days ago: it has seen old1 (200 days) but not old2 (100 days).
    const p = prunableTombstones(deleted, [{ id: 'pc', syncedAt: NOW - DAY_MS }, { id: 'ph', syncedAt: NOW - 150 * DAY_MS }], NOW)
    expect(p.drop).toEqual(['old1'])
    expect(p.keep).toBe(2)
    expect(p.reason).toMatch(/1 kept: not every device has synced/)
  })

  it('deletion marks: only ones older than 90 days, even when every device synced a minute ago', () => {
    const p = prunableTombstones(deleted, [{ id: 'pc', syncedAt: NOW - 60_000 }, { id: 'ph', syncedAt: NOW - 60_000 }], NOW)
    expect(p.drop.sort()).toEqual(['old1', 'old2'])
    expect(p.drop).not.toContain('recent')
    expect(prunableTombstones({ recent: NOW - 20 * DAY_MS }, [{ id: 'pc', syncedAt: NOW }], NOW)).toMatchObject({ drop: [], keep: 1 })
    expect(prunableTombstones(null, [{ id: 'pc', syncedAt: NOW }], NOW)).toMatchObject({ drop: [], keep: 0 })
  })
})

describe('the overview line', () => {
  const base = { now: NOW, backupRed: [], lastBackupAt: NOW - 2 * 3600_000, syncedAt: NOW - 3 * 60_000, syncTrouble: null, warnings: [] }

  it('"All safe · last backup 2 h ago · synced 3 min ago"', () => {
    expect(overviewLine(base)).toEqual({ level: 'ok', text: 'All safe · last backup 2 h ago · synced 3 min ago' })
  })

  it('a red backup, a nearly full store, sync trouble and a warning each say so', () => {
    expect(overviewLine({ ...base, backupRed: ['Cloud backup'] })).toMatchObject({ level: 'red', text: expect.stringMatching(/^Needs a look: Cloud backup · /) })
    expect(overviewLine({ ...base, warnings: [localMeter(4_900_000)] })).toMatchObject({ level: 'red', text: expect.stringMatching(/^Nearly full: App storage on this device/) })
    expect(overviewLine({ ...base, syncTrouble: 'Money did not sync' })).toMatchObject({ level: 'warn' })
    expect(overviewLine({ ...base, warnings: [syncMeter('m', 'Money: synced copy', 2_600_000)] })).toMatchObject({ level: 'warn', text: expect.stringMatching(/^Filling up: Money: synced copy/) })
  })

  it('times in plain words', () => {
    expect(agoText(NOW - 30_000, NOW)).toBe('just now')
    expect(agoText(NOW - 26 * 3600_000, NOW)).toBe('26 h ago')
    expect(agoText(NOW - 5 * DAY_MS, NOW)).toBe('5 days ago')
    expect(agoText(null, NOW)).toBe('never')
  })
})
