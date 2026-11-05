import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { handlePipeline } from './fakeTurso'
// @ts-expect-error plain JS module without types
import { config, liveEpoch, makeSession, sessionOk, sessionSigned } from '../../../../api/_lib.mjs'
// @ts-expect-error plain JS module without types
import { deviceLabel, forgetRevoked, listDevices, revokeDevice, touchDevice } from '../../../../api/_devices.mjs'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
const cfg = config({ TURSO_URL: 'libsql://fake.turso.io', TURSO_TOKEN: 'k', SESSION_SECRET: 'test-secret', APP_PIN: '123456' })

describe('devices (A6)', () => {
  it('labels browsers readably', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/120 Safari/537')).toBe('Chrome on Windows')
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17) AppleWebKit Version/17 Safari/604')).toBe('Safari on iPhone')
  })

  it('lists devices, signs one out alone, keeps the other', async () => {
    const db = new SQL.Database()
    db.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)')
    const fetchImpl = (async (_u: string, init: { body: string }) => ({ ok: true, status: 200, text: async () => JSON.stringify(handlePipeline(db, JSON.parse(init.body))), json: async () => handlePipeline(db, JSON.parse(init.body)) })) as unknown as typeof fetch
    const t = Date.now()
    const ep = await liveEpoch(cfg, fetchImpl, t)
    const a = makeSession(cfg, t, ep, 'device-a')
    const b = makeSession(cfg, t, ep, 'device-b')
    expect(sessionSigned(cfg, a)?.sid).toBe('device-a')
    await touchDevice(cfg, 'device-a', 'Chrome/1 Windows', t, fetchImpl)
    await touchDevice(cfg, 'device-b', 'Safari/1 iPhone', t + 1, fetchImpl)
    const list = await listDevices(cfg, fetchImpl)
    expect(list.devices.map((d: { sid: string }) => d.sid).sort()).toEqual(['device-a', 'device-b'])
    forgetRevoked()
    await revokeDevice(cfg, 'device-b', fetchImpl)
    expect((await listDevices(cfg, fetchImpl)).devices.map((d: { sid: string }) => d.sid)).toEqual(['device-a'])
    expect(await sessionOk(cfg, b, t + 10, fetchImpl)).toBe(false)
    expect(await sessionOk(cfg, a, t + 10, fetchImpl)).toBe(true)
  })
})
