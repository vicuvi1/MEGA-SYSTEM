import { createRequire } from 'node:module'
import { beforeAll, afterEach, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from './fakeTurso'
import { Mirror, type MirrorStore } from './mirror'
import { TursoHttp } from './tursoHttp'
import { decodePending, merge3, schemaInfo, sendPending } from './desktopSync'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => { SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) }) })
afterEach(() => vi.unstubAllGlobals())

function setup() {
  const remote = new SQL.Database()
  MIGRATIONS.forEach((migration) => remote.exec(migration))
  let online = true
  let bytes: Uint8Array | null = null
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    if (!online) throw new TypeError('Offline')
    const body = handlePipeline(remote, JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => body }
  })
  const store: MirrorStore = { load: async () => bytes, save: async (value) => { bytes = value.slice() } }
  const http = new TursoHttp('https://fake.turso.io', 'fake')
  const open = () => new Mirror(SQL, http, store, true)
  return { remote, store, http, open, offline: () => { online = false }, online: () => { online = true } }
}

it('keeps offline changes across a restart and uploads them once', async () => {
  const env = setup()
  const first = env.open()
  await first.ready
  env.offline()
  await first.write((db) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('test_note', 'Made-up note'))
  const reopened = env.open()
  await reopened.ready
  expect(await reopened.read((db) => db.prepare("SELECT value FROM settings WHERE key='test_note'").get()?.value)).toBe('Made-up note')
  env.online()
  await reopened.refresh()
  await reopened.refresh()
  expect(env.remote.exec("SELECT value FROM settings WHERE key='test_note'")[0].values).toEqual([['Made-up note']])
  expect(await reopened.read((db) => db.prepare('SELECT COUNT(*) AS n FROM desktop_outbox').get()?.n)).toBe(0)
})

it('merges offline changes when the server changed something else meanwhile', async () => {
  const env = setup()
  const mirror = env.open()
  await mirror.ready
  env.offline()
  await mirror.write((db) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('test_note', 'Local note'))
  env.remote.run("INSERT INTO settings (key,value) VALUES ('server_note','Other device')")
  env.remote.run("UPDATE settings SET value='other-device-version' WHERE key='data_version'")
  env.online()
  await mirror.refresh()
  expect(env.remote.exec("SELECT value FROM settings WHERE key='test_note'")[0].values).toEqual([['Local note']])
  expect(env.remote.exec("SELECT value FROM settings WHERE key='server_note'")[0].values).toEqual([['Other device']])
  // The desktop now shows both sides, and nothing waits.
  expect(await mirror.read((db) => db.prepare("SELECT value FROM settings WHERE key='server_note'").get()?.value)).toBe('Other device')
  expect(await mirror.read((db) => db.prepare('SELECT COUNT(*) AS n FROM desktop_outbox').get()?.n)).toBe(0)
})

it('adds up both sides when the same counter changed on both (reps here, water from Sporty)', async () => {
  const env = setup()
  const mirror = env.open()
  await mirror.ready
  const start = { savedAt: 1, data: { exercises: [{ id: 'ex_pushups', doneToday: 10 }], waterMl: 500 } }
  await mirror.write((db) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('sport_tracker_json', JSON.stringify(start)))
  env.offline()
  await mirror.write((db) => db.prepare("UPDATE settings SET value=? WHERE key='sport_tracker_json'").run(JSON.stringify({ savedAt: 5, data: { exercises: [{ id: 'ex_pushups', doneToday: 35 }], waterMl: 500 } })))
  env.remote.run("UPDATE settings SET value=? WHERE key='sport_tracker_json'", [JSON.stringify({ savedAt: 3, data: { exercises: [{ id: 'ex_pushups', doneToday: 10 }], waterMl: 750 } })])
  env.remote.run("UPDATE settings SET value='sporty' WHERE key='data_version'")
  env.online()
  await mirror.refresh()
  const merged = JSON.parse(String(env.remote.exec("SELECT value FROM settings WHERE key='sport_tracker_json'")[0].values[0][0]))
  expect(merged).toEqual({ savedAt: 5, data: { exercises: [{ id: 'ex_pushups', doneToday: 35 }], waterMl: 750 } })
})

it('gives a new number to a row both sides created with the same id, and moves what points at it', async () => {
  const env = setup()
  const mirror = env.open()
  await mirror.ready
  env.offline()
  await mirror.write((db) => {
    const l = db.prepare("INSERT INTO ledger (ts, day, module, kind, coins, xp, note) VALUES ('t','2026-11-04','body','earn',5,0,'desktop')").run()
    db.prepare("INSERT INTO workouts (day, ts, title, items_json, ledger_id) VALUES ('2026-11-04','t','Desk workout','[]',?)").run(l.lastInsertRowid)
  })
  // Second offline change points at the first one's row.
  await mirror.write((db) => {
    const id = db.prepare("SELECT id FROM ledger WHERE note='desktop'").get()!.id
    db.prepare("INSERT INTO ledger (ts, day, module, kind, coins, xp, note, undo_of) VALUES ('t2','2026-11-04','body','undo',-5,0,'desktop undo',?)").run(id)
  })
  env.remote.run("INSERT INTO ledger (ts, day, module, kind, coins, xp, note) VALUES ('s','2026-11-04','coach','earn',3,0,'ben')")
  env.remote.run("UPDATE settings SET value='ben' WHERE key='data_version'")
  env.online()
  await mirror.refresh()
  const rows = env.remote.exec('SELECT id, note, undo_of FROM ledger ORDER BY id')[0].values
  expect(rows.map((r) => r[1])).toEqual(['ben', 'desktop', 'desktop undo'])
  const desk = rows.find((r) => r[1] === 'desktop')!
  expect(rows.find((r) => r[1] === 'desktop undo')![2]).toBe(desk[0])
  expect(env.remote.exec("SELECT ledger_id FROM workouts WHERE title='Desk workout'")[0].values[0][0]).toBe(desk[0])
  expect(await mirror.read((db) => db.prepare('SELECT COUNT(*) AS n FROM ledger').get()?.n)).toBe(3)
})

it('keeps a row the server edited even if the desktop deleted it offline', async () => {
  const env = setup()
  const mirror = env.open()
  await mirror.ready
  await mirror.write((db) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('test_note', 'v1'))
  env.offline()
  await mirror.write((db) => db.prepare("DELETE FROM settings WHERE key='test_note'").run())
  env.remote.run("UPDATE settings SET value='v2 from phone' WHERE key='test_note'")
  env.remote.run("UPDATE settings SET value='phone' WHERE key='data_version'")
  env.online()
  await mirror.refresh()
  expect(env.remote.exec("SELECT value FROM settings WHERE key='test_note'")[0].values).toEqual([['v2 from phone']])
})

it('a change that changes nothing is not queued', async () => {
  const env = setup()
  const mirror = env.open()
  await mirror.ready
  await mirror.write((db) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('test_note', 'same'))
  env.offline()
  await mirror.write((db) => db.prepare("UPDATE settings SET value='same' WHERE key='test_note'").run())
  expect(await mirror.read((db) => db.prepare('SELECT COUNT(*) AS n FROM desktop_outbox').get()?.n)).toBe(0)
})

it('does not repeat a committed operation when its acknowledgement was lost', async () => {
  const env = setup()
  const mirror = env.open()
  await mirror.ready
  env.offline()
  await mirror.write((db) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('test_note', 'One operation'))
  const write = await mirror.read((db) => decodePending(String(db.prepare('SELECT data FROM desktop_outbox').get()?.data)))
  env.online()
  await sendPending(env.http, write)
  await mirror.refresh()
  expect(env.remote.exec('SELECT COUNT(*) FROM desktop_sync_done')[0].values[0][0]).toBe(1)
})

it('rolls back locally if saving the database to disk fails', async () => {
  const env = setup()
  const mirror = env.open()
  await mirror.ready
  env.store.save = async () => { throw new Error('Disk full') }
  await expect(mirror.write((db) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('test_note', 'Unsaved'))).rejects.toThrow('Disk full')
  expect(await mirror.read((db) => db.prepare("SELECT value FROM settings WHERE key='test_note'").get())).toBeUndefined()
  expect(env.remote.exec("SELECT value FROM settings WHERE key='test_note'")).toHaveLength(0)
})

it('a crash right after a merged change reached the server repeats nothing', async () => {
  const env = setup()
  const mirror = env.open()
  await mirror.ready
  env.offline()
  await mirror.write((db) => db.prepare("INSERT INTO ledger (ts, day, module, kind, coins, xp, note) VALUES ('t','2026-11-04','body','earn',5,0,'desktop')").run())
  await mirror.write((db) => db.prepare("INSERT INTO ledger (ts, day, module, kind, coins, xp, note, undo_of) VALUES ('t2','2026-11-04','body','undo',-5,0,'desktop undo',1)").run())
  env.remote.run("INSERT INTO ledger (ts, day, module, kind, coins, xp, note) VALUES ('s','2026-11-04','coach','earn',3,0,'ben')")
  env.remote.run("UPDATE settings SET value='ben' WHERE key='data_version'")
  env.online()
  // The first change reaches the server, then the app dies before noting it.
  const first = await mirror.read((db) => decodePending(String(db.prepare('SELECT data FROM desktop_outbox ORDER BY id').get()?.data)))
  await sendPending(env.http, first, schemaInfo(env.remote))
  await mirror.refresh()
  const rows = env.remote.exec('SELECT id, note, undo_of FROM ledger ORDER BY id')[0].values
  expect(rows.map((r) => r[1])).toEqual(['ben', 'desktop', 'desktop undo'])
  expect(rows[2][2]).toBe(rows[1][0])
})

it('merges lists by their id or time (chat logs, exercises)', () => {
  const base = [{ at: '1', text: 'hi' }]
  const mine = [...base, { at: '3', text: 'from desktop' }]
  const theirs = [...base, { at: '2', text: 'from telegram' }]
  expect(merge3('log', base, mine, theirs)).toEqual([...theirs, { at: '3', text: 'from desktop' }])
  expect(merge3('x', { a: 1, b: 'old' }, { a: 1, b: 'mine' }, { a: 2, b: 'old' })).toEqual({ a: 2, b: 'mine' })
  expect(merge3('updatedAt', 1, 5, 3)).toBe(5)
  expect(merge3('title', 'a', 'mine', 'theirs')).toBe('mine')
})
