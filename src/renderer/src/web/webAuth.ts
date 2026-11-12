// The app lock on the web and the desktop. The server checks the PIN
// (sys_auth). For unlocking offline, each device keeps its OWN copy of the
// hash ("saltHex:scryptHex", Node's scrypt defaults: N=16384, r=8, p=1, 32
// bytes) in local storage, saved after the server accepted the PIN; it is
// never synced, so no other session can read it (the shared settings.pin_hash
// copy was crackable by any signed-in page and is gone). A device with no
// local copy must be online once to unlock. Only the dev/test direct-Turso
// mode still keeps the PIN in settings (no server there). 2007 only opens the
// app when no PIN was ever set (direct mode).
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

/** Where a device keeps its offline PIN check. */
export interface PinStore {
  read(): Promise<string | null>
  write(value: string): Promise<void>
}

/** This device's own offline copy, in local storage (never synced; a blocked storage just means "online only"). */
export function localPinStore(key = 'life-offline-pin', storage: () => Storage | undefined = () => (typeof localStorage === 'undefined' ? undefined : localStorage)): PinStore {
  return {
    read: async () => {
      try {
        return storage()?.getItem(key) ?? null
      } catch {
        return null
      }
    },
    write: async (value) => {
      try {
        storage()?.setItem(key, value)
      } catch {
        /* private window: unlocking needs the internet */
      }
    }
  }
}

export const OFFLINE_NO_COPY = 'No internet: connect once to unlock with your PIN on this device'

/**
 * `local`: the device's own offline copy (website and installed app, where the
 * server checks the PIN). Without it (direct Turso, dev and tests only) the
 * PIN is read from and saved to settings as before.
 */
export function createWebAuth(mirror: Mirror, local?: PinStore) {
  let locked = true
  let failures = 0
  let blockedUntil = 0
  const stored = () => (local ? local.read() : mirror.read((db) => getSetting(db as any, 'pin_hash')))
  const save = (value: string) => (local ? local.write(value) : mirror.write((db) => setSetting(db as any, 'pin_hash', value)))
  const status = (): AuthStatus => ({ pinSet: true, locked })

  return {
    status: async (): Promise<AuthStatus> => status(),
    /** `checked`: the server already checked this PIN (this copy may be older). */
    unlock: async (pin: string, checked = false): Promise<AuthStatus> => {
      const now = Date.now()
      if (!checked && now < blockedUntil) throw new Error(`Too many tries. Wait ${Math.ceil((blockedUntil - now) / 1000)} s`)
      const s = await stored()
      // Offline with no copy of our own: never fall back to 2007.
      if (!checked && local && !s) throw new Error(OFFLINE_NO_COPY)
      if (!checked && !(await pinMatches(s, pin))) {
        if (++failures >= MAX_TRIES) {
          failures = 0
          blockedUntil = now + LOCKOUT_MS
          throw new Error('Too many tries. Wait 30 s')
        }
        throw new Error('Wrong PIN')
      }
      failures = 0
      locked = false
      // The server accepted it: this device's offline copy follows (a new PIN, a first unlock).
      if (local && checked && !(s && s.includes(':') && (await pinMatches(s, pin)))) await hashPin(pin).then(save).catch(() => {})
      // Direct mode: upgrade an old plain-text PIN so the desktop can read it again.
      else if (!local && s && !s.includes(':') && (await pinMatches(s, pin))) void hashPin(pin).then(save).catch(() => {})
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
