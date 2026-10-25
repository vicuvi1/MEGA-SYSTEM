import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { AuthStatus } from '@shared/api'
import { getSetting, setSetting, type DB } from './db'

const MAX_TRIES = 5
const LOCKOUT_MS = 30_000

function hash(pin: string, salt: Buffer): Buffer {
  return scryptSync(pin, salt, 32)
}

/**
 * App lock. It keeps the screen private (e.g. when someone walks by); it is
 * not encryption of the local database.
 */
export class Auth {
  private locked: boolean
  private failures = 0
  private blockedUntil = 0

  constructor(private db: DB, private now: () => number = Date.now) {
    this.locked = this.pinSet()
  }

  pinSet(): boolean {
    return getSetting(this.db, 'pin_hash') !== null
  }

  status(): AuthStatus {
    return { pinSet: this.pinSet(), locked: this.locked && this.pinSet() }
  }

  isLocked(): boolean {
    return this.status().locked
  }

  private check(pin: string): boolean {
    const stored = getSetting(this.db, 'pin_hash')
    if (!stored) return true
    const [saltHex, hashHex] = stored.split(':')
    return timingSafeEqual(hash(pin, Buffer.from(saltHex, 'hex')), Buffer.from(hashHex, 'hex'))
  }

  setPin(pin: string, currentPin?: string): AuthStatus {
    if (!/^\d{4,12}$/.test(pin)) throw new Error('PIN must be 4 to 12 digits')
    if (this.pinSet() && !this.check(currentPin ?? '')) throw new Error('Current PIN is wrong')
    const salt = randomBytes(16)
    setSetting(this.db, 'pin_hash', `${salt.toString('hex')}:${hash(pin, salt).toString('hex')}`)
    this.locked = false
    return this.status()
  }

  unlock(pin: string): AuthStatus {
    const t = this.now()
    if (t < this.blockedUntil) {
      throw new Error(`Too many tries. Wait ${Math.ceil((this.blockedUntil - t) / 1000)} s`)
    }
    if (this.check(pin)) {
      this.failures = 0
      this.locked = false
    } else if (++this.failures >= MAX_TRIES) {
      this.failures = 0
      this.blockedUntil = t + LOCKOUT_MS
      throw new Error('Too many tries. Wait 30 s')
    } else {
      throw new Error('Wrong PIN')
    }
    return this.status()
  }

  lock(): AuthStatus {
    this.locked = true
    return this.status()
  }
}
