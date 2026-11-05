// Makes the key pair for push notifications (N11). Run once:
//   node scripts/vapid-keys.mjs
// then add both lines to Vercel → mega-system → Settings → Environment Variables.
import { generateKeyPairSync } from 'node:crypto'
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const pub = publicKey.export({ format: 'jwk' })
const priv = privateKey.export({ format: 'jwk' })
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]).toString('base64url')
console.log(`VAPID_PUBLIC_KEY=${raw}`)
console.log(`VAPID_PRIVATE_KEY=${priv.d}`)
