import { createRequire } from 'node:module'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { handlePipeline } from './fakeTurso'
// @ts-expect-error plain JS module without types
import { config } from '../../../../api/_lib.mjs'
// @ts-expect-error plain JS module without types
import { passkeyLogin, passkeyOptions, passkeyRegister } from '../../../../api/_passkey.mjs'

const require = createRequire(import.meta.url)
let SQL: SqlJsStatic
beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (f: string) => require.resolve(`sql.js/dist/${f}`) })
})
const cfg = config({ TURSO_URL: 'libsql://fake.turso.io', TURSO_TOKEN: 'k', SESSION_SECRET: 'test-secret', APP_PIN: '123456' })
const site = { rpId: 'life.example', origin: 'https://life.example' }
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest()

function authData(rpId: string, flags: number, counter: number) {
  const c = Buffer.alloc(4)
  c.writeUInt32BE(counter)
  return Buffer.concat([sha(rpId), Buffer.from([flags]), c])
}

describe('passkey unlock (M7)', () => {
  it('register, then unlock; every check is enforced', async () => {
    const db = new SQL.Database()
    db.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)')
    const fetchImpl = (async (_u: string, init: { body: string }) => ({ status: 200, text: async () => JSON.stringify(handlePipeline(db, JSON.parse(init.body))) })) as unknown as typeof fetch
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
    const t = Date.now()

    // Register (the session check happens in login.mjs, before this).
    const reg = await passkeyOptions(cfg, 'register', t, fetchImpl)
    const cdReg = b64u(JSON.stringify({ type: 'webauthn.create', challenge: reg.challenge, origin: site.origin }))
    await passkeyRegister(cfg, { clientDataJSON: cdReg, publicKey: b64u(spki), alg: -7, credentialId: b64u('credential-123456789'), authenticatorData: b64u(authData(site.rpId, 0x45, 0)) }, site, t, fetchImpl)
    // The same challenge can't be used twice.
    await expect(passkeyRegister(cfg, { clientDataJSON: cdReg, publicKey: b64u(spki), alg: -7, credentialId: b64u('credential-123456789'), authenticatorData: b64u(authData(site.rpId, 0x45, 0)) }, site, t, fetchImpl)).rejects.toThrow(/expired/)

    const unlock = async (o: { origin?: string; rpId?: string; flags?: number; counter?: number; tamper?: boolean }) => {
      const opt = await passkeyOptions(cfg, 'login', t, fetchImpl)
      const cd = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: opt.challenge, origin: o.origin ?? site.origin }))
      const ad = authData(o.rpId ?? site.rpId, o.flags ?? 0x05, o.counter ?? 1)
      let sig = sign('sha256', Buffer.concat([ad, sha(cd)]), privateKey)
      if (o.tamper) sig = Buffer.from(sig.map((x, i) => (i === 10 ? x ^ 1 : x)))
      return passkeyLogin(cfg, { credentialId: b64u('credential-123456789'), clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(sig) }, site, t, fetchImpl)
    }
    expect((await unlock({ counter: 1 })).session).toBeTruthy()
    await expect(unlock({ counter: 2, origin: 'https://evil.example' })).rejects.toThrow(/another site/)
    await expect(unlock({ counter: 2, rpId: 'evil.example' })).rejects.toThrow(/another site/)
    await expect(unlock({ counter: 2, flags: 0x01 })).rejects.toThrow(/not checked/)
    await expect(unlock({ counter: 2, tamper: true })).rejects.toThrow(/signature/)
    await expect(unlock({ counter: 1 })).rejects.toThrow(/copied/) // counter went backwards
    expect((await unlock({ counter: 5 })).session).toBeTruthy()
  })
})
