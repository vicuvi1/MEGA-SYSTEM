// Big app copies travel to the server in pieces (web/chunkedTurso.ts,
// core/settingParts.ts). The fake server here refuses any request or answer
// over 4.5 MB, like the real one. Covered: the round trip between two devices
// with a copy far bigger than one request, a small edit sending little, a write
// cut off half-way (a reader sees the old value, never half), a damaged or
// missing piece (refused, this device's copy untouched), an old whole value too
// big for one answer, the desktop's path, and the rule that keeps an older app
// version from writing. Made-up data only.
import { createRequire } from 'node:module'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { MIGRATIONS } from '@core/schema'
import { looksLikeManifest, parseManifest, WHOLE_UP_TO } from '@core/settingParts'
import { handlePipeline } from './fakeTurso'
import { Mirror, type MirrorStore } from './mirror'
import { TursoHttp } from './tursoHttp'
import { ChunkedTurso } from './chunkedTurso'
import { getSetting, setSetting } from '../../../main/settings'
// @ts-ignore plain JS modules shared with the server
import { SCHEMA_VERSION, schemaTooOld } from '../../../../api/_schema.mjs'
// @ts-ignore
import { pipelineProblem, pipelineWrites } from '../../../../api/_sqlguard.mjs'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const CAP = 4.5 * 1024 * 1024
const KEY = 'app_sync_finance'
const record = (i: number, note = 'made-up shop') => ({ id: `t${i}`, type: 'expense', amount: 1000 + (i % 977), currency: 'MDL', rate: 1, base: 1000, date: `20${16 + (i % 11)}-0${1 + (i % 9)}-1${i % 9}`, category: 'food', account: 'wallet', note: `${note} ${i} "quoted" ţară`, createdAt: 1, updatedAt: 1_700_000_000_000 + i })
const copy = (n: number, savedAt: number, edit?: (tx: any[]) => void) => {
  const tx = Array.from({ length: n }, (_, i) => record(i))
  edit?.(tx)
  return JSON.stringify({ savedAt, editedAt: savedAt, data: { settings: { currency: 'MDL' }, tx, deleted: {} } })
}

function server() {
  const remote = new SQL.Database()
  for (const m of MIGRATIONS) remote.exec(m)
  const sizes: number[] = []
  let fail: ((body: any) => boolean) | null = null
  let guard = true
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const bytes = new TextEncoder().encode(init.body).length
    sizes.push(bytes)
    if (bytes > CAP) return { ok: false, status: 413, statusText: 'Request Entity Too Large', text: async () => 'Request Entity Too Large', json: async () => ({}) }
    const body = JSON.parse(init.body)
    // Every statement must pass what /api/db lets a page send.
    if (guard && pipelineProblem(body)) return { ok: false, status: 403, statusText: 'Forbidden', text: async () => String(pipelineProblem(body)), json: async () => ({}) }
    if (fail?.(body)) throw new TypeError('Failed to fetch')
    const json = handlePipeline(remote, body)
    const text = JSON.stringify(json)
    if (new TextEncoder().encode(text).length > CAP) return { ok: false, status: 500, statusText: 'Too big', text: async () => 'FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE', json: async () => ({}) }
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text }
  })
  const stored = (key = KEY) => {
    const v = remote.exec('SELECT value FROM settings WHERE key = ?', [key])[0]?.values[0]?.[0]
    return v == null ? null : String(v)
  }
  const parts = (key = KEY) => (remote.exec('SELECT id, data, at FROM setting_parts WHERE key = ? ORDER BY id', [key])[0]?.values ?? []).map((r) => ({ id: String(r[0]), data: String(r[1]), at: Number(r[2]) }))
  const bump = () => remote.run("INSERT INTO settings (key, value) VALUES ('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [`other-${Math.random()}`])
  return { remote, sizes, stored, parts, bump, failWhen: (fn: typeof fail) => (fail = fn), biggest: () => Math.max(0, ...sizes) }
}
const web = async () => {
  const m = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), null)
  await m.ready
  return m
}
const read = (m: Mirror, key = KEY) => m.read((db) => getSetting(db as any, key))
const isCommit = (body: any) => JSON.stringify(body).includes('INSERT INTO settings (key, value)')

describe('a copy far bigger than one request', () => {
  it('goes up in pieces, comes back whole on another device, and no request or answer is near the limit', async () => {
    const s = server()
    const a = await web()
    const big = copy(40_000, 1_800_000_000_000)
    expect(new TextEncoder().encode(big).length).toBeGreaterThan(1.5 * CAP)
    await a.write((db) => setSetting(db as any, KEY, big))
    // The server holds a short manifest and the pieces; this device still holds the whole text.
    expect(looksLikeManifest(s.stored())).toBe(true)
    expect(s.stored()!.length).toBeLessThan(20_000)
    expect(parseManifest(s.stored())!.len).toBe(big.length)
    expect(await read(a)).toBe(big)
    expect(s.biggest()).toBeLessThan(1_500_000)
    // A second device (or the bots' copy on the server) reads it whole.
    s.sizes.length = 0
    const b = await web()
    expect(await read(b)).toBe(big)
    expect(await b.serverSetting(KEY)).toBe(big)
    expect(await b.serverSetting(KEY, big)).toBe(big)
  })

  it('a small edit sends a small part of it, and the other device downloads only that', async () => {
    const s = server()
    const a = await web()
    const b = await web()
    const v1 = copy(40_000, 1_800_000_000_000)
    await a.write((db) => setSetting(db as any, KEY, v1))
    await b.refresh()
    expect(await read(b)).toBe(v1)
    const up0 = a.transport.bytesUp
    const down0 = b.transport.charsDown
    const v2 = copy(40_000, 1_800_000_000_500, (tx) => {
      tx[20_000].note = 'a made-up dinner, edited'
      tx.push(record(40_000, 'new'))
    })
    await a.write((db) => setSetting(db as any, KEY, v2))
    expect(a.transport.bytesUp - up0).toBeLessThan(v2.length / 20)
    await b.refresh()
    expect(await read(b)).toBe(v2)
    expect(b.transport.charsDown - down0).toBeLessThan(v2.length / 20)
    // Old pieces are only cleaned up once they are old enough that nobody is still reading them.
    expect(s.parts().length).toBeGreaterThan(parseManifest(s.stored())!.p.length)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + ChunkedTurso.GRACE_MS + 60_000)
    const v3 = copy(40_000, 1_800_000_001_000, (tx) => (tx[5].note = 'again'))
    await a.write((db) => setSetting(db as any, KEY, v3))
    expect(new Set(s.parts().map((p) => p.id))).toEqual(new Set(parseManifest(s.stored())!.p))
  })

  it('"is the server\'s value still what I read?" works on pieces: a write made on an older copy is redone on the new one', async () => {
    const s = server()
    const a = await web()
    const b = await web()
    const v1 = copy(12_000, 100)
    await a.write((db) => setSetting(db as any, KEY, v1))
    await b.refresh()
    // a writes again; b, still on v1, appends a marker to whatever it reads.
    const v2 = copy(12_000, 200, (tx) => tx.push(record(99_999, 'from a')))
    await a.write((db) => setSetting(db as any, KEY, v2))
    let runs = 0
    await b.write((db) => {
      runs++
      const cur = JSON.parse(getSetting(db as any, KEY)!)
      cur.data.tx.push(record(88_888, 'from b'))
      cur.savedAt = 300
      setSetting(db as any, KEY, JSON.stringify(cur))
    })
    expect(runs).toBe(2)
    const end = JSON.parse((await b.serverSetting(KEY))!)
    expect(end.data.tx.slice(-2).map((t: any) => t.id)).toEqual(['t99999', 't88888'])
    expect(looksLikeManifest(s.stored())).toBe(true)
  })
})

describe('a write that is cut off, a piece that is wrong', () => {
  it('pieces uploaded but the switch never made: readers still get the old value, whole', async () => {
    const s = server()
    const a = await web()
    const v1 = copy(12_000, 100)
    await a.write((db) => setSetting(db as any, KEY, v1))
    const before = s.stored()
    // The connection dies at the last step (the transaction that switches the manifest).
    s.failWhen(isCommit)
    const v2 = copy(12_000, 200, (tx) => tx.forEach((t) => (t.note = `rewritten ${t.id}`)))
    await a.write((db) => setSetting(db as any, KEY, v2)).catch(() => {})
    expect(s.stored()).toBe(before)
    expect(s.parts().length).toBeGreaterThan(parseManifest(before)!.p.length)
    s.failWhen(null)
    const b = await web()
    expect(await read(b)).toBe(v1)
  })

  it('a damaged piece is refused: the read fails and this device keeps its own copy', async () => {
    const s = server()
    const a = await web()
    const v1 = copy(12_000, 100)
    await a.write((db) => setSetting(db as any, KEY, v1))
    const b = await web()
    expect(await read(b)).toBe(v1)
    // Another device writes v2, and one of v2's new pieces is damaged on the server.
    const v2 = copy(12_000, 200, (tx) => tx.forEach((t) => (t.note = `rewritten ${t.id}`)))
    await a.write((db) => setSetting(db as any, KEY, v2))
    const m = parseManifest(s.stored())!
    s.remote.run('UPDATE setting_parts SET data = substr(data, 1, length(data) - 1) || ? WHERE key = ? AND id = ?', ['#', KEY, m.p[3]])
    await expect(b.refresh()).rejects.toThrow()
    expect(await read(b)).toBe(v1)
    await expect(b.serverSetting(KEY)).rejects.toThrow(/missing|damaged|pieces/)
    // The writer still has it whole, and its next write repairs the server.
    s.remote.run('DELETE FROM setting_parts WHERE key = ? AND id = ?', [KEY, m.p[3]])
    const v3 = copy(12_000, 300, (tx) => tx.forEach((t) => (t.note = `rewritten ${t.id}`)))
    await a.write((db) => setSetting(db as any, KEY, v3))
    await b.refresh()
    expect(await read(b)).toBe(v3)
  })

  it('"Sync now" on a device that has the value whole sends a piece the server lost', async () => {
    const s = server()
    const a = await web()
    const v1 = copy(12_000, 100)
    await a.write((db) => setSetting(db as any, KEY, v1))
    const m = parseManifest(s.stored())!
    s.remote.run('DELETE FROM setting_parts WHERE key = ? AND id IN (?, ?)', [KEY, m.p[2], m.p[5]])
    await expect((await web().catch((e) => e)) instanceof Error).toBe(true)
    // The full compare reads the server's value (pieces from this device's own copy) and repairs it.
    expect(await a.serverSetting(KEY)).toBe(v1)
    expect(await read(await web())).toBe(v1)
  })

  it('a piece cleaned up between the upload and the switch is sent again (two writers at once)', async () => {
    const s = server()
    const a = await web()
    const v1 = copy(12_000, 100)
    await a.write((db) => setSetting(db as any, KEY, v1))
    let dropped = false
    s.failWhen((body) => {
      // Just before a's switch, every piece vanishes (another writer's clean-up).
      if (!dropped && isCommit(body)) {
        dropped = true
        s.remote.run('DELETE FROM setting_parts')
      }
      return false
    })
    const v2 = copy(12_000, 200, (tx) => (tx[7].note = 'edited'))
    await a.write((db) => setSetting(db as any, KEY, v2))
    const b = await web()
    expect(await read(b)).toBe(v2)
  })
})

describe('values from before pieces existed', () => {
  it('an old whole value too big for one answer is still read (in slices), with every other setting', async () => {
    const s = server()
    const old = copy(40_000, 50)
    s.remote.run('INSERT INTO settings (key, value) VALUES (?, ?)', [KEY, old])
    s.remote.run("INSERT INTO settings (key, value) VALUES ('app_sync_waky', ?)", [JSON.stringify({ savedAt: 1, data: { mornings: ['made-up'] } })])
    for (let i = 0; i < 40; i++) s.remote.run('INSERT INTO settings (key, value) VALUES (?, ?)', [`coach_note_${i}`, 'x'.repeat(90_000)])
    const a = await web()
    expect(await read(a)).toBe(old)
    expect(await read(a, 'coach_note_39')).toHaveLength(90_000)
    expect(await a.serverSetting(KEY)).toBe(old)
    expect(await a.serverSetting(KEY, old)).toBe(old)
    // The next write turns it into pieces; the check "still what I read" passes on the whole old value.
    const next = copy(40_000, 60, (tx) => tx.push(record(77_777)))
    let runs = 0
    await a.write((db) => {
      runs++
      setSetting(db as any, KEY, next)
    })
    expect(runs).toBe(1)
    expect(looksLikeManifest(s.stored())).toBe(true)
    expect(await (await web()).read((db) => getSetting(db as any, KEY))).toBe(next)
  })

  it('a small copy stays one plain value, as it always was', async () => {
    const s = server()
    const a = await web()
    const small = copy(100, 1)
    expect(small.length).toBeLessThan(WHOLE_UP_TO)
    await a.write((db) => setSetting(db as any, KEY, small))
    expect(s.stored()).toBe(small)
    expect(s.parts()).toHaveLength(0)
  })

  it('a restore puts a whole value back over pieces: it is read as it is', async () => {
    const s = server()
    const a = await web()
    await a.write((db) => setSetting(db as any, KEY, copy(12_000, 100)))
    const restored = copy(11_000, 90)
    s.remote.run('UPDATE settings SET value = ? WHERE key = ?', [restored, KEY])
    s.bump()
    await a.refresh()
    expect(await read(a)).toBe(restored)
  })
})

describe('the desktop', () => {
  it('a big Money save made offline goes up in pieces when the connection is back', async () => {
    const s = server()
    let bytes: Uint8Array | null = null
    const disk: MirrorStore = { load: async () => bytes, save: async (b) => void (bytes = b.slice()) }
    const pc = new Mirror(SQL, new TursoHttp('https://fake.turso.io', 't'), disk, true)
    await pc.ready
    s.failWhen(() => true)
    const v1 = copy(40_000, 100)
    await pc.write((db) => setSetting(db as any, KEY, v1))
    const v2 = copy(40_000, 200, (tx) => tx.push(record(50_000)))
    await pc.write((db) => setSetting(db as any, KEY, v2))
    expect(pc.health().desktopPending).toBe(1)
    s.failWhen(null)
    await pc.refresh()
    expect(pc.health().desktopPending).toBe(0)
    expect(pc.health().stuck).toHaveLength(0)
    expect(s.biggest()).toBeLessThan(1_500_000)
    expect(await (await web()).read((db) => getSetting(db as any, KEY))).toBe(v2)
  }, 30_000) // two 40,000-record copies: over 5 s on the slower Windows runner
})

describe('an older app version can never put a whole copy over the pieces', () => {
  it('the server refuses writes from a page built before the pieces (schema 24), and still lets it read', () => {
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length)
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(25)
    const write = { requests: [{ type: 'execute', stmt: { sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', args: [] } }] }
    const readOnly = { requests: [{ type: 'execute', stmt: { sql: 'SELECT value FROM settings WHERE key = ?', args: [] } }] }
    // api/db.mjs: schemaTooOld(header) && pipelineWrites(body) → 409 "A new version is out".
    expect(schemaTooOld('24') && pipelineWrites(write)).toBe(true)
    expect(schemaTooOld('24') && pipelineWrites(readOnly)).toBe(false)
    expect(schemaTooOld(String(SCHEMA_VERSION))).toBe(false)
  })
})
