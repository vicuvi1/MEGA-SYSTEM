// No size ceiling for the cloud backup (2026-11-12): a backup far over the
// 4.2 MB one request may carry is saved in parts and comes back whole.
import { beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
// @ts-expect-error plain JS module without types
import { newestSnapshot, newestSnapshotInfo, saveSnapshot, saveSnapshotPart, snapshotPart, snapshotProblem } from '../../api/_snapshots.mjs'
// @ts-expect-error plain JS module without types
import { pipelineProblem } from '../../api/_sqlguard.mjs'
// @ts-expect-error plain JS module without types
import { config } from '../../api/_lib.mjs'
import { CHUNK_MAX, CHUNK_WARN, biggestChunk, isManifest, joinParts, manifestText, packParts, readManifest } from '@core/backupPack'
import { handlePipeline } from '../renderer/src/web/fakeTurso'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})

const now = Date.parse('2026-11-12T10:00:00Z')
const day = '2026-11-12'
/** A made-up backup that does not shrink much when gzipped (random notes), about `mb` MB packed. */
function bigBackup(mb: number): string {
  const notes = Array.from({ length: Math.ceil((mb * 1_000_000) / 3000) }, (_, i) => ({ id: i + 1, body: randomBytes(2250).toString('base64') }))
  return JSON.stringify({ version: 2, exportedAt: '2026-11-12T10:00:00Z', tables: { notes } })
}

describe('a cloud backup over 4.2 MB', () => {
  it('is saved in parts and comes back byte for byte', async () => {
    const db = new SQL.Database()
    const fetchImpl = (async (_url: string, init: { body: string }) => ({ status: 200, text: async () => JSON.stringify(handlePipeline(db, JSON.parse(init.body))) })) as unknown as typeof fetch
    const cfg = config({ TURSO_URL: 'https://fake.turso.io', TURSO_TOKEN: 't' })
    const json = bigBackup(6)
    const gz = gzipSync(Buffer.from(json))
    expect(gz.length).toBeGreaterThan(4_200_000)
    const { manifest, parts } = await packParts(new Uint8Array(gz), json.length)
    expect(manifest.parts).toBeGreaterThanOrEqual(3)
    // Every part fits one request and stays under the warning size.
    for (const p of parts) expect(p.length).toBeLessThan(CHUNK_WARN)
    expect(biggestChunk(manifestText(manifest))).toBeLessThan(CHUNK_WARN)

    // The old way refuses it (never silently: the app shows the answer).
    expect(snapshotProblem({ day, data: `gz:${gz.toString('base64')}` }, now)).toMatch(/too big for one piece/)

    // The manifest before its parts: refused, nothing saved.
    const early = await saveSnapshot(cfg, { day, data: manifestText(manifest) }, now, fetchImpl)
    expect(early.status).toBe(409)

    // A part with a wrong checksum is refused.
    expect((await saveSnapshotPart(cfg, { day, part: 0, data: parts[1], sha: manifest.shas[0] }, now, fetchImpl)).status).toBe(400)
    for (let i = 0; i < parts.length; i++) {
      const r = await saveSnapshotPart(cfg, { day, part: i, data: parts[i], sha: manifest.shas[i] }, now, fetchImpl)
      expect(r.body).toEqual({ ok: true, saved: true })
    }
    const done = await saveSnapshot(cfg, { day, data: manifestText(manifest) }, now, fetchImpl)
    expect(done.body).toEqual({ ok: true, saved: true })

    // Complete: never changed again (a part can't be replaced, a second manifest is ignored).
    expect((await saveSnapshotPart(cfg, { day, part: 0, data: parts[0], sha: manifest.shas[0] }, now, fetchImpl)).body).toEqual({ ok: true, saved: false })
    expect((await saveSnapshot(cfg, { day, data: '{"tables":{}}' }, now, fetchImpl)).body).toEqual({ ok: true, saved: false })

    // The off-site copy: the list, then each part; joined they are the same gzip.
    const info = await newestSnapshotInfo(cfg, fetchImpl)
    expect(info).toMatchObject({ day, parts: manifest.parts, bytes: gz.length, sha: manifest.sha })
    const fetched: Buffer[] = []
    for (let i = 0; i < info.parts; i++) fetched.push(await snapshotPart(cfg, day, i, fetchImpl))
    expect(Buffer.concat(fetched).equals(gz)).toBe(true)
    const whole = await newestSnapshot(cfg, fetchImpl)
    expect(gunzipSync(whole.gz).toString()).toBe(json)

    // The app reads it the same way (manifest + parts).
    const row = db.exec('SELECT data, size_bytes FROM cloud_snapshots WHERE day = ?', [day])[0].values[0]
    expect(isManifest(row[0])).toBe(true)
    expect(Number(row[1])).toBe(parts.reduce((n, p) => n + p.length, 0))
    const m = readManifest(String(row[0]))!
    const stored = db.exec('SELECT data FROM cloud_snapshot_parts WHERE day = ? ORDER BY part', [day])[0].values.map((v) => String(v[0]))
    expect(gunzipSync(await joinParts(m, stored)).toString()).toBe(json)
    await expect(joinParts(m, stored.slice(1))).rejects.toThrow(/missing parts/)
    await expect(joinParts(m, [stored[1], stored[0], ...stored.slice(2)])).rejects.toThrow(/checksum/)
  }, 60_000)

  it('the parts are read-only from a page like the backups', () => {
    const ex = (sql: string) => ({ requests: [{ type: 'execute', stmt: { sql, args: [] } }, { type: 'close' }] })
    expect(pipelineProblem(ex("SELECT part, data FROM cloud_snapshot_parts WHERE day = '2026-11-12'"))).toBeNull()
    for (const sql of ['DELETE FROM cloud_snapshot_parts', "UPDATE cloud_snapshot_parts SET data = 'x'", 'DROP TABLE cloud_snapshot_parts']) expect(pipelineProblem(ex(sql))).toMatch(/can only be read/)
  })

  it('the warning size and the hard size are what the self-check uses', () => {
    expect(CHUNK_WARN).toBe(2_500_000)
    expect(CHUNK_MAX).toBeLessThan(4_500_000)
    expect(biggestChunk('gz:' + 'A'.repeat(3_000_000))).toBe(3_000_003)
  })
})
