import type { LedgerEntry } from '@core/ledger'
import type { LevelInfo } from '@core/levels'
import type { Rule } from '@core/rules'
import type { Reward, Tier } from '@core/shop'

export type { LedgerEntry, LevelInfo, Rule, Reward, Tier }

export interface ShopState {
  rewards: Reward[]
  balance: number
  level: number
  /** Monthly real-money cap for rewards, 0 = no cap. */
  budget: number
  monthSpent: number
  currency: string
  /** Levels whose chest is waiting to be opened. */
  chests: number[]
  recent: { title: string; realCost: number; day: string; undone: boolean }[]
}

export type RewardInput = Omit<Reward, 'id' | 'archived'> & { id?: number }

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
  shop: {
    state(): Promise<ShopState>
    save(reward: RewardInput): Promise<ShopState>
    archive(id: number): Promise<ShopState>
    redeem(id: number): Promise<ShopState>
    openChest(level: number): Promise<{ coins: number; state: ShopState }>
    setBudget(amount: number): Promise<ShopState>
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
