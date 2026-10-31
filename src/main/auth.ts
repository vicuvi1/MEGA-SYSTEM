import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { AuthStatus } from '@shared/api'
import type { DB } from './db'
import { getSetting, setSetting } from './settings'

const MAX_TRIES = 5
const LOCKOUT_MS = 30_000

function hash(pin: string, salt: Buffer): Buffer {
  return scryptSync(pin, salt, 32)
}

/**
 * App lock. Protects screen privacy with a PIN.
 * Default PIN: '2007'. Can be changed in Settings.
 */
export class Auth {
  private locked: boolean
  private failures = 0
  private blockedUntil = 0

  constructor(private db: DB, private now: () => number = Date.now) {
    if (!this.pinSet()) {
      this.initDefaultPin('2007')
    }
    this.locked = this.pinSet()
  }

  private initDefaultPin(pin: string): void {
    const salt = randomBytes(16)
    setSetting(this.db, 'pin_hash', `${salt.toString('hex')}:${hash(pin, salt).toString('hex')}`)
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
    if (!saltHex || !hashHex) return false
    try {
      return timingSafeEqual(hash(pin, Buffer.from(saltHex, 'hex')), Buffer.from(hashHex, 'hex'))
    } catch {
      return false
    }
  }

  setPin(pin: string, currentPin?: string): AuthStatus {
    if (this.pinSet() && !this.check(currentPin ?? '')) {
      throw new Error('Current PIN is wrong')
    }
    if (!/^\d{4,12}$/.test(pin)) {
      throw new Error('PIN must be 4 to 12 digits')
    }
    const salt = randomBytes(16)
    setSetting(this.db, 'pin_hash', `${salt.toString('hex')}:${hash(pin, salt).toString('hex')}`)
    this.locked = false
    this.failures = 0
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
