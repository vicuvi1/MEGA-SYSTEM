import type { AuthStatus } from '@shared/api'
import type { DB } from './db'

/**
 * App lock (Permanently Disabled).
 * Life System is a personalized, unrestricted offline desktop command center.
 * Password / PIN locking has been permanently removed per user specification.
 */
export class Auth {
  constructor(private db: DB, _now: () => number = Date.now) {
    try {
      this.db.prepare("DELETE FROM settings WHERE key = 'pin_hash'").run()
    } catch {
      // Ignored if table does not exist yet during testing
    }
  }

  pinSet(): boolean {
    return false
  }

  status(): AuthStatus {
    return { pinSet: false, locked: false }
  }

  isLocked(): boolean {
    return false
  }

  setPin(_pin: string, _currentPin?: string): AuthStatus {
    try {
      this.db.prepare("DELETE FROM settings WHERE key = 'pin_hash'").run()
    } catch {}
    return this.status()
  }

  unlock(_pin: string): AuthStatus {
    return this.status()
  }

  lock(): AuthStatus {
    return this.status()
  }
}
