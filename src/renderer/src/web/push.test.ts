// Push notifications (N11): the VAPID header verifies with the public key; addresses are checked.
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module without types
import { validEndpoint, vapidAuth } from '../../../../api/_push.mjs'

describe('web push (N11)', () => {
  it('signs a VAPID token the push service can check', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const pub = publicKey.export({ format: 'jwk' }) as any
    const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url')
    const env = { VAPID_PUBLIC_KEY: raw, VAPID_PRIVATE_KEY: (privateKey.export({ format: 'jwk' }) as any).d, APP_URL: 'https://example.app' }
    const h = vapidAuth('https://fcm.googleapis.com/fcm/send/abc', env, 1_800_000_000_000)
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!
    expect(m[4]).toBe(raw)
    const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString())
    expect(claims).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'https://example.app' })
    const ok = verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: createPublicKey({ key: pub, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'))
    expect(ok).toBe(true)
  })
  it('only https push addresses', () => {
    expect(validEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true)
    expect(validEndpoint('http://evil.example/x')).toBe(false)
    expect(validEndpoint(42)).toBe(false)
  })
})
