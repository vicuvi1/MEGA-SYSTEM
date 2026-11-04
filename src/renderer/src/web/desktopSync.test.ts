import { createRequire } from 'node:module'
import { beforeAll, afterEach, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { handlePipeline } from './fakeTurso'
import { Mirror, type MirrorStore } from './mirror'
import { TursoHttp } from './tursoHttp'
import { decodePending, sendPending } from './desktopSync'

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

it('preserves both copies when the server changes while offline', async () => {
  const env = setup()
  const mirror = env.open()
  await mirror.ready
  env.offline()
  await mirror.write((db) => db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('test_note', 'Local note'))
  env.remote.run("INSERT INTO settings (key,value) VALUES ('server_note','Other device')")
  env.remote.run("UPDATE settings SET value='other-device-version' WHERE key='data_version'")
  env.online()
  await expect(mirror.refresh()).rejects.toThrow('Sync conflict')
  expect(await mirror.read((db) => db.prepare("SELECT value FROM settings WHERE key='test_note'").get()?.value)).toBe('Local note')
  expect(env.remote.exec("SELECT value FROM settings WHERE key='test_note'")).toHaveLength(0)
  expect(env.remote.exec("SELECT value FROM settings WHERE key='server_note'")[0].values).toEqual([['Other device']])
  expect(await mirror.read((db) => db.prepare('SELECT COUNT(*) AS n FROM desktop_outbox').get()?.n)).toBe(1)
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
  expect(env.remote.exec('SELECT COUNT(*) FROM desktop_sync_receipts')[0].values[0][0]).toBe(1)
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
