// The desktop's waiting changes (mirror.ts writeDesktop / flushDesktop):
// a newer save of the same setting replaces the one still waiting (nothing is
// lost: the latest value holds everything), the whole database is exported once
// per change (not twice), and a change no request can carry is set aside,
// loudly, instead of blocking every change after it. Made-up data only.
import { createRequire } from 'node:module'
import { beforeAll, afterEach, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from './fakeTurso'
import { Mirror, type MirrorStore } from './mirror'
import { TursoHttp } from './tursoHttp'
import { decodePending } from './desktopSync'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => { SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) }) })
afterEach(() => {
  vi.unstubAllGlobals()
  Mirror.MAX_REQUEST = 4_000_000
})

function setup() {
  const remote = new SQL.Database()
  MIGRATIONS.forEach((migration) => remote.exec(migration))
  let online = true
  let bytes: Uint8Array | null = null
  let saves = 0
  const requests: number[] = []
  let refuse: ((body: string) => number | null) | null = null
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    if (!online) throw new TypeError('Offline')
    requests.push(init.body.length)
    const status = refuse?.(init.body)
    if (status) return { ok: false, status, statusText: 'Request Entity Too Large', text: async () => 'Request Entity Too Large', json: async () => ({}) }
    const body = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => body }
  })
  const store: MirrorStore = { load: async () => bytes, save: async (value) => { saves++; bytes = value.slice() } }
  const http = new TursoHttp('https://fake.turso.io', 'fake')
  const open = () => new Mirror(SQL, http, store, true)
  return { remote, store, http, open, requests, saves: () => saves, offline: () => { online = false }, online: () => { online = true }, refuse: (fn: typeof refuse) => { refuse = fn } }
}

const set = (mirror: Mirror, key: string, value: string) =>
  mirror.write((db) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value))
// A change of one setting keeps that setting's "before" beside the row (bval / bhas), not inside `data`.
const outbox = (mirror: Mirror) =>
  mirror.read((db) =>
    (db.prepare('SELECT id, data, skeys, base, bval, bhas FROM desktop_outbox ORDER BY id').all() as any[]).map((r) => {
      const write = decodePending(String(r.data))
      if (r.bhas != null && write.rows?.length === 1) write.rows[0].before = r.bhas ? { ...write.rows[0].key, value: r.bval } : null
      return { ...r, write }
    })
  )
const remoteValue = (env: ReturnType<typeof setup>, key: string) => env.remote.exec('SELECT value FROM settings WHERE key = ?', [key])[0]?.values[0]?.[0] ?? null
const money = (n: number, note = '') => JSON.stringify({ savedAt: n, editedAt: n, data: { tx: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, amount: 100 + i, note })) } })

it('offline for days: many saves of Money wait as one change, and the newest one is what arrives', async () => {
  const env = setup()
  const mirror = env.open()
  await mirror.ready
  await set(mirror, 'app_sync_finance', money(1))
  await mirror.read(() => 0)
  env.offline()
  for (let n = 2; n <= 40; n++) await set(mirror, 'app_sync_finance', money(n))
  const waiting = await outbox(mirror)
  expect(waiting).toHaveLength(1)
  // The one waiting change still starts from the copy the server has (so a merge is right).
  expect(String(waiting[0].write.rows![0].before!.value)).toBe(money(1))
  expect(String(waiting[0].write.rows![0].after!.value)).toBe(money(40))
  env.online()
  await mirror.refresh()
  expect(remoteValue(env, 'app_sync_finance')).toBe(money(40))
  expect(await outbox(mirror)).toHaveLength(0)
  // Sent as it is (no merge needed): the server took it on the version it followed.
  expect(mirror.health().error).toBeNull()
})

it('a waiting change of another table keeps its place; only the same setting is replaced', async () => {
  const env = setup()
  const mirror = env.open()
  await mirror.ready
  env.offline()
  await set(mirror, 'app_sync_finance', money(1))
  const base0 = (await outbox(mirror))[0].write.base
  await mirror.write((db) => db.prepare("INSERT INTO ledger (ts, day, module, kind, coins, xp, note) VALUES ('t','2026-11-04','body','earn',5,0,'made-up')").run())
  await set(mirror, 'app_sync_waky', '{"savedAt":1,"data":{"mornings":[]}}')
  await set(mirror, 'app_sync_finance', money(2))
  await set(mirror, 'app_sync_finance', money(3))
  const waiting = await outbox(mirror)
  expect(waiting.map((w) => w.skeys)).toEqual([null, '["app_sync_waky"]', '["app_sync_finance"]'])
  // The ledger change now follows the version the replaced Money save followed.
  expect(waiting[0].base).toBe(base0)
  expect(waiting[2].write.rows![0].before).toBeNull()
  env.online()
  await mirror.refresh()
  await mirror.refresh()
  expect(remoteValue(env, 'app_sync_finance')).toBe(money(3))
  expect(remoteValue(env, 'app_sync_waky')).toBe('{"savedAt":1,"data":{"mornings":[]}}')
  expect(env.remote.exec("SELECT note FROM ledger")[0].values).toEqual([['made-up']])
  expect(await outbox(mirror)).toHaveLength(0)
  // Nothing had to be merged: no "done by merge" rows with renumbered ids.
  expect(env.remote.exec('SELECT COUNT(*) FROM desktop_sync_done')[0].values[0][0]).toBe(3)
})

it('a replaced save still merges with what another device wrote meanwhile', async () => {
  const env = setup()
  const mirror = env.open()
  await mirror.ready
  const start = { savedAt: 1, data: { exercises: [{ id: 'ex_pushups', doneToday: 10 }], waterMl: 500 } }
  await set(mirror, 'sport_tracker_json', JSON.stringify(start))
  await mirror.read(() => 0)
  env.offline()
  await set(mirror, 'sport_tracker_json', JSON.stringify({ savedAt: 4, data: { exercises: [{ id: 'ex_pushups', doneToday: 20 }], waterMl: 500 } }))
  await set(mirror, 'sport_tracker_json', JSON.stringify({ savedAt: 5, data: { exercises: [{ id: 'ex_pushups', doneToday: 35 }], waterMl: 500 } }))
  expect(await outbox(mirror)).toHaveLength(1)
  env.remote.run("UPDATE settings SET value=? WHERE key='sport_tracker_json'", [JSON.stringify({ savedAt: 3, data: { exercises: [{ id: 'ex_pushups', doneToday: 10 }], waterMl: 750 } })])
  env.remote.run("UPDATE settings SET value='sporty' WHERE key='data_version'")
  env.online()
  await mirror.refresh()
  // Both sides' changes counted from the copy both started with (10 reps, 500 ml).
  expect(JSON.parse(String(remoteValue(env, 'sport_tracker_json')))).toEqual({ savedAt: 5, data: { exercises: [{ id: 'ex_pushups', doneToday: 35 }], waterMl: 750 } })
})

it('the whole database is written out once per change, not twice', async () => {
  const env = setup()
  const mirror = env.open()
  await mirror.ready
  env.offline()
  const exportSpy = vi.spyOn(mirror.current.raw, 'export')
  await set(mirror, 'test_note', 'one')
  await set(mirror, 'test_note', 'two')
  expect(exportSpy).toHaveBeenCalledTimes(2)
})

it('a failed disk save takes the change back, and puts a replaced waiting change back in line', async () => {
  const env = setup()
  const mirror = env.open()
  await mirror.ready
  env.offline()
  await set(mirror, 'app_sync_finance', money(1))
  await set(mirror, 'other_note', 'kept')
  const before = await outbox(mirror)
  const save = env.store.save
  env.store.save = async () => { throw new Error('Disk full') }
  await expect(set(mirror, 'app_sync_finance', money(2))).rejects.toThrow('Disk full')
  env.store.save = save
  expect(await mirror.read((db) => db.prepare("SELECT value FROM settings WHERE key = 'app_sync_finance'").get()?.value)).toBe(money(1))
  const after = await outbox(mirror)
  expect(after.map((w) => [w.id, w.skeys, w.base, w.write.id])).toEqual(before.map((w) => [w.id, w.skeys, w.base, w.write.id]))
  // And the next save works as if nothing happened.
  await set(mirror, 'app_sync_finance', money(3))
  env.online()
  await mirror.refresh()
  await mirror.refresh()
  expect(remoteValue(env, 'app_sync_finance')).toBe(money(3))
  expect(remoteValue(env, 'other_note')).toBe('kept')
})

it('a change too big for one request is set aside and said out loud; later changes still go out', async () => {
  const env = setup()
  const mirror = env.open()
  await mirror.ready
  env.offline()
  Mirror.MAX_REQUEST = 20_000
  await set(mirror, 'big_note', 'x'.repeat(50_000))
  await set(mirror, 'small_note', 'after the big one')
  env.online()
  await mirror.refresh()
  await mirror.refresh()
  expect(remoteValue(env, 'small_note')).toBe('after the big one')
  expect(remoteValue(env, 'big_note')).toBeNull()
  const h = mirror.health()
  expect(h.desktopPending).toBe(0)
  expect(h.stuck).toHaveLength(1)
  expect(h.stuck[0].tables).toEqual(['settings'])
  expect(h.stuck[0].bytes).toBeGreaterThan(50_000)
  expect(h.error).toMatch(/too big to send/)
  // It is still on this PC, whole, after a restart.
  const again = env.open()
  await again.ready
  expect(again.health().stuck).toHaveLength(1)
  // Room is made (here: the limit raised): "Try again" sends it, merged into the server's rows.
  Mirror.MAX_REQUEST = 4_000_000
  await again.retryStuck()
  await again.refresh()
  expect(String(remoteValue(env, 'big_note'))).toHaveLength(50_000)
  expect(again.health().stuck).toHaveLength(0)
})

it('a request the server refuses for its size (413) is set aside the same way', async () => {
  const env = setup()
  const mirror = env.open()
  await mirror.ready
  env.offline()
  await set(mirror, 'big_note', 'y'.repeat(30_000))
  await set(mirror, 'small_note', 'still sent')
  env.refuse((body) => (body.length > 25_000 ? 413 : null))
  env.online()
  await mirror.refresh()
  await mirror.refresh()
  expect(remoteValue(env, 'small_note')).toBe('still sent')
  expect(mirror.health().stuck).toHaveLength(1)
  expect(mirror.health().stuck[0].error).toMatch(/413/)
})
