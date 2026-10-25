import type { LedgerEntry } from '@core/ledger'
import type { LevelInfo } from '@core/levels'
import type { Rule } from '@core/rules'

export type { LedgerEntry, LevelInfo, Rule }

export interface Summary {
  balance: number
  totalXp: number
  level: LevelInfo
  today: string
  todayCoins: number
  todayXp: number
  recent: LedgerEntry[]
}

export interface AuthStatus {
  pinSet: boolean
  locked: boolean
}

export interface BackupStatus {
  dir: string
  driveAvailable: boolean
  passphraseSet: boolean
  last: { name: string; at: string } | null
  pending: number
  count: number
  lastError: string | null
}

export interface VerifyResult {
  ok: boolean
  name: string | null
  detail: string
}

/** The bridge the renderer sees as `window.life`. Every call is async. */
export interface LifeApi {
  auth: {
    status(): Promise<AuthStatus>
    setPin(pin: string, currentPin?: string): Promise<AuthStatus>
    unlock(pin: string): Promise<AuthStatus>
    lock(): Promise<AuthStatus>
  }
  wallet: {
    summary(): Promise<Summary>
    history(limit?: number): Promise<LedgerEntry[]>
    award(ruleId: string, note?: string): Promise<Summary>
    undo(id: number, note: string): Promise<Summary>
  }
  rules: {
    list(): Promise<Rule[]>
    save(rule: Rule): Promise<Rule[]>
  }
  backup: {
    status(): Promise<BackupStatus>
    setPassphrase(passphrase: string): Promise<BackupStatus>
    runNow(): Promise<BackupStatus>
    list(): Promise<string[]>
    verifyLatest(): Promise<VerifyResult>
    restore(name: string, passphrase: string): Promise<void>
  }
}

/** IPC replies are wrapped so error messages reach the UI cleanly. */
export type IpcReply<T> = { ok: true; data: T } | { ok: false; error: string }
