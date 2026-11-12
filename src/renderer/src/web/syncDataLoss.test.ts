// Data-loss bugs found in the sync merges (bug hunt, 2026-11-12). Each test
// failed before the fix. Made-up data only.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from './fakeTurso'
import { Mirror } from './mirror'
import { TursoHttp } from './tursoHttp'
import { merge3, mergeRow } from './desktopSync'
import { SPORT, mergeSport } from './sportSync'
import { createAppSync, mergeWaky, pruneDeleted, type AppSyncSpec } from './appSync'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function storage(): Storage {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage
}

describe('Sport Track: exercises and past days from both devices', () => {
  const base = { lastDate: '2026-11-10', exercises: [{ id: 'pu', name: 'Push-ups', doneToday: 0 }], history: [] }

  it('keeps an exercise added on the older device, with its sets', () => {
    const older = { ...base, exercises: [...base.exercises, { id: 'sq', name: 'Squats', doneToday: 0 }], sets: { '2026-11-10': { sq: [{ id: 's1', reps: 12, at: 1 }] } } }
    const newer = { ...base, xp: 5 }
    for (const [a, b, aNewer] of [[older, newer, false], [newer, older, true]] as const) {
      const m = pruneDeleted(SPORT, mergeSport(a, b, aNewer), base, a, b)
      expect(m.exercises.map((e: any) => e.id)).toEqual(['pu', 'sq'])
      expect(m.sets['2026-11-10'].sq).toEqual([{ id: 's1', reps: 12, at: 1 }])
    }
  })

  it('an exercise deleted on either device stays deleted', () => {
    const start = { ...base, exercises: [...base.exercises, { id: 'sq', name: 'Squats', doneToday: 0 }] }
    const deletedHere = { ...start, exercises: [start.exercises[0]] }
    const other = { ...start, xp: 9 }
    for (const aNewer of [true, false]) {
      const m = pruneDeleted(SPORT, mergeSport(deletedHere, other, aNewer), start, deletedHere, other)
      expect(m.exercises.map((e: any) => e.id)).toEqual(['pu'])
    }
  })

  it('a past day edited on both devices keeps both sides', () => {
    const a = { lastDate: '2026-11-10', exercises: [], days: { '2026-11-08': { pu: 30 } } }
    const b = { lastDate: '2026-11-10', exercises: [], days: { '2026-11-08': { sq: 20 } } }
    expect(mergeSport(a, b, false).days['2026-11-08']).toEqual({ pu: 30, sq: 20 })
    expect(mergeSport(a, b, true).days['2026-11-08']).toEqual({ pu: 30, sq: 20 })
  })
})

describe('desktop offline merge: only real counters add up', () => {
  it('a weight, a start time and a position are never added up', () => {
    expect(merge3('weight_kg', 70, 72, 71)).toBe(72)
    expect(merge3('started', 1000, 1500, 1200)).toBe(1500)
    expect(merge3('sort', 2, 0, 5)).toBe(0)
  })

  it('the later updated_at wins a clash, else this desktop', () => {
    const b = { id: 1, title: 'Old', sort: 1, updated_at: '2026-11-10T08:00:00Z' }
    const mine = { id: 1, title: 'Mine', sort: 2, updated_at: '2026-11-10T09:00:00Z' }
    const theirs = { id: 1, title: 'Theirs', sort: 3, updated_at: '2026-11-10T10:00:00Z' }
    expect(mergeRow(b, mine, theirs)).toEqual({ id: 1, title: 'Theirs', sort: 3, updated_at: '2026-11-10T10:00:00Z' })
    expect(mergeRow(b, theirs, mine)).toEqual({ id: 1, title: 'Theirs', sort: 3, updated_at: '2026-11-10T10:00:00Z' })
    const noTime = mergeRow({ id: 1, sort: 1 }, { id: 1, sort: 2 }, { id: 1, sort: 3 })
    expect(noTime.sort).toBe(2)
  })

  it('real counters still add both changes', () => {
    expect(merge3('allocated_coins', 100, 130, 150)).toBe(180)
    expect(merge3('doneToday', 10, 35, 20)).toBe(45)
  })
})

describe('Waky: a day, night or chest changed on both devices', () => {
  it('keeps the fields from both sides', () => {
    const a = { days: { '2026-11-10': { time: '06:40', target: '06:45' } }, nights: { '2026-11-09': { time: '23:10' } }, opened: { c1: { prize: 'gem' } } }
    const b = { days: { '2026-11-10': { mood: 4 } }, nights: { '2026-11-09': { onTime: true } }, opened: { c1: { openedOn: '2026-11-10' } } }
    for (const aNewer of [true, false]) {
      const m = mergeWaky(a, b, aNewer)
      expect(m.days['2026-11-10']).toEqual({ time: '06:40', target: '06:45', mood: 4 })
      expect(m.nights['2026-11-09']).toEqual({ time: '23:10', onTime: true })
      expect(m.opened.c1).toEqual({ prize: 'gem', openedOn: '2026-11-10' })
    }
  })

  it('a field set on both: the entry with the later time wins, else the newer copy', () => {
    const a = { days: { d: { time: '06:40', at: 200 } } }
    const b = { days: { d: { time: '06:10', at: 100 } } }
    expect(mergeWaky(a, b, false).days.d.time).toBe('06:40')
    expect(mergeWaky({ days: { d: { time: '06:40' } } }, { days: { d: { time: '06:10' } } }, false).days.d.time).toBe('06:10')
  })
})

describe('app sync: which edit is newer', () => {
  // Newer side wins each field it has.
  const SPEC: AppSyncSpec = { localKey: 'test_app', setting: 'app_sync_test', event: 'test-changed', merge: (m, t, mineNewer) => (mineNewer ? { ...t, ...m } : { ...m, ...t }) }
  function setup() {
    const remote = new SQL.Database()
    for (const m of MIGRATIONS) remote.exec(m)
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const json = handlePipeline(remote, JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    })
    const readRemote = () => JSON.parse(String(remote.exec("SELECT value FROM settings WHERE key = 'app_sync_test'")[0].values[0][0]))
    let version = 0
    const writeRemote = (v: any) => {
      remote.run("UPDATE settings SET value = ? WHERE key = 'app_sync_test'", [JSON.stringify(v)])
      remote.run("INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [`other-${++version}`])
    }
    return { readRemote, writeRemote }
  }
  async function device(store: Storage) {
    const mirror = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
    await mirror.ready
    const sync = createAppSync(mirror, SPEC, store)
    return { soon: sync.soon, sync: async () => { await mirror.refresh(); await sync.sync() } }
  }
  const T = 1_800_000_000_000

  it("an edit made after seeing the other device's copy wins, even with this clock behind", async () => {
    const env = setup()
    const now = vi.spyOn(Date, 'now')
    const a = storage()
    a.setItem('test_app', JSON.stringify({ x: 'start', y: 'start' }))
    now.mockReturnValue(T)
    const sa = await device(a)
    await sa.sync()
    // The other device (clock right) edits at T + 10 min; this one pulls it.
    env.writeRemote({ savedAt: T + 600_000, editedAt: T + 600_000, data: { x: 'start', y: 'other' } })
    await sa.sync()
    expect(JSON.parse(a.getItem('test_app')!).y).toBe('other')
    // A rewrite that is not an edit (the log's numbers) keeps editedAt.
    env.writeRemote({ savedAt: T + 700_000, editedAt: T + 600_000, data: { x: 'start', y: 'other', n: 1 } })
    // This device's clock is an hour behind; you edit x after seeing that copy.
    now.mockReturnValue(T - 3_600_000)
    a.setItem('test_app', JSON.stringify({ x: 'mine', y: 'other' }))
    sa.soon()
    await sa.sync()
    expect(env.readRemote().data.x).toBe('mine')
    expect(env.readRemote().editedAt).toBeGreaterThan(T + 600_000)
  })

  it('an old edit marker does not make a later edit lose', async () => {
    const env = setup()
    const now = vi.spyOn(Date, 'now')
    const a = storage()
    a.setItem('test_app', JSON.stringify({ x: 'start' }))
    now.mockReturnValue(T)
    const sa = await device(a)
    await sa.sync()
    now.mockReturnValue(T + 1000)
    a.setItem('test_app', JSON.stringify({ x: 'first' }))
    sa.soon()
    await sa.sync()
    expect(a.getItem('life_sync_app_sync_test_edited')).toBeNull()
    // The other device edits at T + 5 s.
    env.writeRemote({ savedAt: T + 5000, editedAt: T + 5000, data: { x: 'other' } })
    // At T + 9 s the app saves straight to storage and a timed sync runs.
    now.mockReturnValue(T + 9000)
    a.setItem('test_app', JSON.stringify({ x: 'latest' }))
    await sa.sync()
    expect(env.readRemote().data.x).toBe('latest')
  })
})

describe('offline queue (web)', () => {
  function setupWeb(mem: Map<string, string>) {
    const remote = new SQL.Database()
    for (const m of MIGRATIONS) remote.exec(m)
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const json = handlePipeline(remote, JSON.parse(init.body))
      return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) }
    })
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size } })
    vi.stubGlobal('window', { addEventListener: () => {}, dispatchEvent: () => true })
    vi.stubGlobal('navigator', { onLine: true })
  }

  it('an unreadable queue is backed up and never overwritten', async () => {
    const mem = new Map<string, string>([['life_offline_writes', '[[{"sql":"INSERT INTO settings']])
    setupWeb(mem)
    const m = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await m.ready
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await m.write((db) => db.prepare("INSERT INTO settings (key, value) VALUES ('q_test', 'yes') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run())
    expect(m.pendingOffline).toBe(1)
    const backups = [...mem.entries()].filter(([k]) => k.startsWith('life_offline_writes_unreadable'))
    expect(backups.map(([, v]) => v)).toEqual(['[[{"sql":"INSERT INTO settings'])
  })

  it('when the backup cannot be stored, the unreadable queue is left as it is', async () => {
    const mem = new Map<string, string>([['life_offline_writes', '{broken']])
    setupWeb(mem)
    const ls = globalThis.localStorage
    vi.stubGlobal('localStorage', { ...ls, getItem: ls.getItem, removeItem: ls.removeItem, key: ls.key, setItem: (k: string, v: string) => { if (k.startsWith('life_offline_writes_unreadable')) throw new Error('QuotaExceededError'); mem.set(k, v) } })
    const m = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'))
    await m.ready
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await m.write((db) => db.prepare("INSERT INTO settings (key, value) VALUES ('q_test', 'yes') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run())
    expect(mem.get('life_offline_writes')).toBe('{broken')
    expect(m.pendingOffline).toBe(1)
  })
})
