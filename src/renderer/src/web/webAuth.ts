// The app lock on the web, compatible with the desktop: the PIN is stored as
// "saltHex:scryptHex" in settings.pin_hash (Node's scrypt defaults: N=16384,
// r=8, p=1, 32 bytes). An older web version stored the PIN in plain text
// there, which locked the desktop out; such a PIN still works once and is
// then saved hashed. 2007 only opens the app when no PIN was ever set.
import { scrypt } from 'scrypt-js'
import type { AuthStatus } from '@shared/api'
import { getSetting, setSetting } from '../../../main/settings'
import type { Mirror } from './mirror'

const MAX_TRIES = 5
const LOCKOUT_MS = 30_000
const DEFAULT_PIN = '2007'

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16))

export async function hashPin(pin: string, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<string> {
  const key = await scrypt(new TextEncoder().encode(pin), salt, 16384, 8, 1, 32)
  return `${hex(salt)}:${hex(key)}`
}

export async function pinMatches(stored: string | null, pin: string): Promise<boolean> {
  if (!stored) return pin === DEFAULT_PIN
  const [saltHex, hashHex] = stored.split(':')
  if (saltHex && hashHex) {
    const key = await scrypt(new TextEncoder().encode(pin), unhex(saltHex), 16384, 8, 1, 32)
    const want = unhex(hashHex)
    let diff = key.length ^ want.length
    for (let i = 0; i < Math.min(key.length, want.length); i++) diff |= key[i] ^ want[i]
    return diff === 0
  }
  return /^\d{4,12}$/.test(stored) && stored === pin // the old plain-text web PIN
}

export function createWebAuth(mirror: Mirror) {
  let locked = true
  let failures = 0
  let blockedUntil = 0
  const stored = () => mirror.read((db) => getSetting(db as any, 'pin_hash'))
  const save = (value: string) => mirror.write((db) => setSetting(db as any, 'pin_hash', value))
  const status = (): AuthStatus => ({ pinSet: true, locked })

  return {
    status: async (): Promise<AuthStatus> => status(),
    unlock: async (pin: string): Promise<AuthStatus> => {
      const now = Date.now()
      if (now < blockedUntil) throw new Error(`Too many tries. Wait ${Math.ceil((blockedUntil - now) / 1000)} s`)
      const s = await stored()
      if (!(await pinMatches(s, pin))) {
        if (++failures >= MAX_TRIES) {
          failures = 0
          blockedUntil = now + LOCKOUT_MS
          throw new Error('Too many tries. Wait 30 s')
        }
        throw new Error('Wrong PIN')
      }
      failures = 0
      locked = false
      // Upgrade an old plain-text PIN so the desktop can read it again.
      if (s && !s.includes(':')) save(await hashPin(pin)).catch(() => {})
      return status()
    },
    setPin: async (pin: string, currentPin?: string): Promise<AuthStatus> => {
      if (!/^\d{4,12}$/.test(pin)) throw new Error('PIN must be 4 to 12 digits')
      const s = await stored()
      if (s && !(await pinMatches(s, currentPin ?? ''))) throw new Error('Current PIN is wrong')
      await save(await hashPin(pin))
      locked = false
      return status()
    },
    lock: async (): Promise<AuthStatus> => {
      locked = true
      return status()
    }
  }
}
