import { dayKey } from '@core/dates'
import { balance, LedgerError } from '@core/ledger'
import {
  coinsToMoneyValue,
  computeActiveMultiplier,
  rollEnhancedChest,
  type ChestLootDrop,
  type MultiplierInfo,
  type WishlistCategory,
  type WishlistGoal
} from '@core/unifiedEconomy'
import { chestRef, unopenedChests } from '@core/shop'
import { levelInfo } from '@core/levels'
import { totalXp } from '@core/ledger'
import { getSetting, setSetting, type DB } from './db'
import type { Discipline } from './discipline'
import type { MoneyService } from './money'
import type { ShieldService } from './shields'
import type { Wallet } from './wallet'

export interface WishlistGoalInput {
  id?: number
  title: string
  targetCoins: number
  targetRealCost: number
  category?: WishlistCategory
  pinned?: boolean
  note?: string
  imageUrl?: string | null
  currency?: string | null
}

export interface VaultLedgerEntry {
  id: number
  ts: string
  day: string
  kind: 'surplus_credit' | 'manual_deposit' | 'goal_allocation' | 'reward_payout' | 'chest_bonus'
  amount: number
  ref: string | null
  note: string
}

export interface EconomySummary {
  coinsBalance: number
  coinsRealValue: number
  exchangeRate: number
  vaultBalance: number
  currency: string
  monthlyBudget: number
  monthSpent: number
  multiplier: MultiplierInfo
  pinnedGoal: WishlistGoal | null
  goals: WishlistGoal[]
  recentVaultEntries: VaultLedgerEntry[]
}

interface GoalRow {
  id: number
  title: string
  target_coins: number
  target_real_cost: number
  allocated_coins: number
  allocated_real_cost: number
  category: WishlistCategory
  pinned: number
  completed: number
  completed_at: string | null
  note: string | null
  created_at: string
  image_url?: string | null
  currency?: string | null
}

const toGoal = (r: GoalRow): WishlistGoal => ({
  id: r.id,
  title: r.title,
  targetCoins: r.target_coins,
  targetRealCost: r.target_real_cost,
  allocatedCoins: r.allocated_coins,
  allocatedRealCost: r.allocated_real_cost,
  category: r.category,
  pinned: !!r.pinned,
  completed: !!r.completed,
  completedAt: r.completed_at,
  note: r.note,
  createdAt: r.created_at,
  imageUrl: r.image_url ?? null,
  currency: r.currency ?? 'MDL'
})

export class UnifiedEconomyService {
  constructor(
    private db: DB,
    private wallet: Wallet,
    private discipline?: Discipline,
    private money?: MoneyService,
    private shields?: ShieldService,
    private timeZone?: string
  ) {
    this.seedInitialGoals()
  }

  private seedInitialGoals(): void {
    try {
      const count = this.db.prepare('SELECT COUNT(*) as c FROM wishlist_goals').get() as { c: number }
      if (count && count.c === 0) {
        const now = new Date().toISOString()
        const insert = this.db.prepare(
          `INSERT INTO wishlist_goals (title, target_coins, target_real_cost, allocated_coins, allocated_real_cost, category, pinned, completed, note, created_at, image_url, currency)
           VALUES (?, ?, ?, 0, 0, ?, ?, 0, ?, ?, ?, ?)`
        )
        this.db.transaction(() => {
          insert.run('Kaaba Pilgrimage Fund', 20000, 15000, 'trip', 1, 'The supreme spiritual milestone. Keep stacking.', now, 'https://images.unsplash.com/photo-1591604129939-f1efa4d9f7fa?w=800&auto=format&fit=crop&q=80', 'MDL')
          insert.run('MacBook / Pro Warrior Setup', 12000, 8000, 'tech', 0, 'High-performance battle workstation.', now, 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800&auto=format&fit=crop&q=80', 'MDL')
          insert.run('Luxury Recovery & Spa Retreat', 3500, 1500, 'luxury', 0, 'Deep restorative rest and rejuvenation.', now, 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=800&auto=format&fit=crop&q=80', 'MDL')
        })()
      }
    } catch {
      // ignore
    }
  }

  getExchangeRate(): number {
    return Number(getSetting(this.db, 'coin_exchange_rate') ?? 10)
  }

  setExchangeRate(rate: number): void {
    if (rate <= 0) throw new LedgerError('Exchange rate must be greater than zero')
    setSetting(this.db, 'coin_exchange_rate', String(rate))
  }

  getCurrency(): string {
    return getSetting(this.db, 'currency') ?? getSetting(this.db, 'money_currency') ?? 'MDL'
  }

  setCurrency(cur: string): void {
    const code = cur?.trim().toUpperCase() || 'MDL'
    setSetting(this.db, 'currency', code)
    setSetting(this.db, 'money_currency', code)
  }

  getVaultBalance(): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM reward_vault_ledger').get() as {
      total: number
    }
    return row?.total ?? 0
  }

  getVaultHistory(limit = 25): VaultLedgerEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM reward_vault_ledger ORDER BY id DESC LIMIT ?')
      .all(limit) as any[]
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts,
      day: r.day,
      kind: r.kind,
      amount: r.amount,
      ref: r.ref,
      note: r.note
    }))
  }

  creditVault(
    kind: 'surplus_credit' | 'manual_deposit' | 'chest_bonus',
    amount: number,
    note: string,
    ref: string | null = null,
    now = new Date()
  ): number {
    if (amount <= 0) return this.getVaultBalance()
    const day = dayKey(now, this.timeZone)
    this.db
      .prepare(
        'INSERT INTO reward_vault_ledger (ts, day, kind, amount, ref, note) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(now.toISOString(), day, kind, amount, ref, note)
    return this.getVaultBalance()
  }

  debitVault(
    kind: 'goal_allocation' | 'reward_payout',
    amount: number,
    note: string,
    ref: string | null = null,
    now = new Date()
  ): number {
    if (amount <= 0) return this.getVaultBalance()
    const balance = this.getVaultBalance()
    if (balance < amount) {
      throw new LedgerError(`Insufficient Reward Vault funds (${balance} available, requested ${amount})`)
    }
    const day = dayKey(now, this.timeZone)
    this.db
      .prepare(
        'INSERT INTO reward_vault_ledger (ts, day, kind, amount, ref, note) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(now.toISOString(), day, kind, -amount, ref, note)
    return this.getVaultBalance()
  }

  // --- Wishlist Goals ---

  goals(): WishlistGoal[] {
    const rows = this.db
      .prepare('SELECT * FROM wishlist_goals ORDER BY completed ASC, pinned DESC, id ASC')
      .all() as GoalRow[]
    return rows.map(toGoal)
  }

  pinnedGoal(): WishlistGoal | null {
    const row = this.db
      .prepare('SELECT * FROM wishlist_goals WHERE pinned = 1 AND completed = 0 LIMIT 1')
      .get() as GoalRow | undefined
    return row ? toGoal(row) : null
  }

  saveGoal(input: WishlistGoalInput): WishlistGoal {
    if (!input.title || !input.title.trim()) throw new LedgerError('Goal title is required')
    if (input.targetCoins <= 0 && input.targetRealCost <= 0) {
      throw new LedgerError('Goal must have a target in coins or real money')
    }

    const title = input.title.trim()
    const targetCoins = Math.max(0, Math.round(input.targetCoins || 0))
    const targetRealCost = Math.max(0, Math.round(input.targetRealCost || 0))
    const category = input.category || 'gear'
    const note = input.note?.trim() || null
    const imageUrl = input.imageUrl?.trim() || null
    const currency = input.currency?.trim() || 'MDL'
    const pinned = input.pinned ? 1 : 0
    const now = new Date().toISOString()

    return this.db.transaction(() => {
      if (pinned) {
        this.db.prepare('UPDATE wishlist_goals SET pinned = 0').run()
      }

      if (input.id) {
        this.db
          .prepare(
            `UPDATE wishlist_goals
             SET title = ?, target_coins = ?, target_real_cost = ?, category = ?, pinned = ?, note = ?, image_url = ?, currency = ?
             WHERE id = ?`
          )
          .run(title, targetCoins, targetRealCost, category, pinned, note, imageUrl, currency, input.id)
        const row = this.db.prepare('SELECT * FROM wishlist_goals WHERE id = ?').get(input.id) as GoalRow
        return toGoal(row)
      } else {
        const info = this.db
          .prepare(
            `INSERT INTO wishlist_goals (title, target_coins, target_real_cost, allocated_coins, allocated_real_cost, category, pinned, completed, note, created_at, image_url, currency)
             VALUES (?, ?, ?, 0, 0, ?, ?, 0, ?, ?, ?, ?)`
          )
          .run(title, targetCoins, targetRealCost, category, pinned, note, now, imageUrl, currency)
        const row = this.db.prepare('SELECT * FROM wishlist_goals WHERE id = ?').get(info.lastInsertRowid) as GoalRow
        return toGoal(row)
      }
    })()
  }

  pinGoal(id: number): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE wishlist_goals SET pinned = 0').run()
      this.db.prepare('UPDATE wishlist_goals SET pinned = 1 WHERE id = ?').run(id)
    })()
  }

  deleteGoal(id: number): void {
    this.db.prepare('DELETE FROM wishlist_goals WHERE id = ?').run(id)
  }

  depositCoinsToGoal(goalId: number, amount: number, now = new Date()): { goal: WishlistGoal; balance: number } {
    if (amount <= 0) throw new LedgerError('Deposit amount must be greater than zero')
    const currentBalance = balance(this.wallet.entries())
    if (currentBalance < amount) {
      throw new LedgerError(`Insufficient coins balance (${currentBalance} available)`)
    }

    const row = this.db.prepare('SELECT * FROM wishlist_goals WHERE id = ?').get(goalId) as GoalRow | undefined
    if (!row) throw new LedgerError('Goal not found')
    if (row.completed) throw new LedgerError('Goal is already completed')

    const day = dayKey(now, this.timeZone)
    return this.db.transaction(() => {
      // Deduct coins from wallet with transparent reason
      this.wallet.append({
        ts: now.toISOString(),
        day,
        module: 'shop',
        kind: 'spend',
        coins: -amount,
        xp: 0,
        ref: `goal:${goalId}`,
        note: `Wishlist Allocation: ${row.title}`
      })

      const newAllocated = row.allocated_coins + amount
      const isCompleted = newAllocated >= row.target_coins && row.allocated_real_cost >= row.target_real_cost
      const completedAt = isCompleted ? now.toISOString() : null

      this.db
        .prepare('UPDATE wishlist_goals SET allocated_coins = ?, completed = ?, completed_at = ? WHERE id = ?')
        .run(newAllocated, isCompleted ? 1 : 0, completedAt, goalId)

      const updated = this.db.prepare('SELECT * FROM wishlist_goals WHERE id = ?').get(goalId) as GoalRow
      return {
        goal: toGoal(updated),
        balance: balance(this.wallet.entries())
      }
    })()
  }

  depositVaultCashToGoal(goalId: number, amount: number, now = new Date()): { goal: WishlistGoal; vaultBalance: number } {
    if (amount <= 0) throw new LedgerError('Deposit amount must be greater than zero')
    const vaultBal = this.getVaultBalance()
    if (vaultBal < amount) {
      throw new LedgerError(`Insufficient Reward Vault funds (${vaultBal} available)`)
    }

    const row = this.db.prepare('SELECT * FROM wishlist_goals WHERE id = ?').get(goalId) as GoalRow | undefined
    if (!row) throw new LedgerError('Goal not found')
    if (row.completed) throw new LedgerError('Goal is already completed')

    return this.db.transaction(() => {
      this.debitVault('goal_allocation', amount, `Allocated to ${row.title}`, `goal:${goalId}`, now)
      const newAllocated = row.allocated_real_cost + amount
      const isCompleted = row.allocated_coins >= row.target_coins && newAllocated >= row.target_real_cost
      const completedAt = isCompleted ? now.toISOString() : null

      this.db
        .prepare('UPDATE wishlist_goals SET allocated_real_cost = ?, completed = ?, completed_at = ? WHERE id = ?')
        .run(newAllocated, isCompleted ? 1 : 0, completedAt, goalId)

      const updated = this.db.prepare('SELECT * FROM wishlist_goals WHERE id = ?').get(goalId) as GoalRow
      return {
        goal: toGoal(updated),
        vaultBalance: this.getVaultBalance()
      }
    })()
  }

  claimGoal(goalId: number, now = new Date()): WishlistGoal {
    const row = this.db.prepare('SELECT * FROM wishlist_goals WHERE id = ?').get(goalId) as GoalRow | undefined
    if (!row) throw new LedgerError('Goal not found')
    const completedAt = now.toISOString()
    this.db.prepare('UPDATE wishlist_goals SET completed = 1, completed_at = ? WHERE id = ?').run(completedAt, goalId)
    const updated = this.db.prepare('SELECT * FROM wishlist_goals WHERE id = ?').get(goalId) as GoalRow
    return toGoal(updated)
  }

  // --- Enhanced Mystery Chest Opener ---

  openEnhancedChest(
    level: number,
    now = new Date()
  ): { drop: ChestLootDrop; coins: number; balance: number; chests: number[] } {
    const all = this.wallet.entries()
    const lvl = levelInfo(totalXp(all)).level
    const openedRefs = all.filter((e) => e.kind !== 'undo').map((e) => e.ref ?? '').filter((r) => r.startsWith('chest:'))
    const waiting = unopenedChests(lvl, openedRefs)

    if (!waiting.includes(level)) {
      throw new LedgerError('No chest waiting for that level')
    }

    return this.db.transaction(() => {
      const drop = rollEnhancedChest(level)
      let coinsAwarded = 0
      const day = dayKey(now, this.timeZone)

      switch (drop.type) {
        case 'coins': {
          coinsAwarded = drop.value
          this.wallet.append({
            ts: now.toISOString(),
            day,
            module: 'shop',
            kind: 'earn',
            coins: coinsAwarded,
            xp: 0,
            ref: chestRef(level),
            note: `Level ${level} Chest: Coins Jackpot (+${coinsAwarded})`
          })
          break
        }

        case 'shield': {
          // Add shield directly to inventory
          if (this.shields) {
            this.shields.awardFreeShield(`Level ${level} Mystery Chest drop`)
          }
          // Also append 0-coin entry to mark chest opened
          this.wallet.append({
            ts: now.toISOString(),
            day,
            module: 'shop',
            kind: 'earn',
            coins: 0,
            xp: 0,
            ref: chestRef(level),
            note: `Level ${level} Chest: Streak Shield Awarded`
          })
          break
        }

        case 'vault_boost': {
          this.creditVault('chest_bonus', drop.value, `Level ${level} Chest Bonus`, chestRef(level), now)
          this.wallet.append({
            ts: now.toISOString(),
            day,
            module: 'shop',
            kind: 'earn',
            coins: 0,
            xp: 0,
            ref: chestRef(level),
            note: `Level ${level} Chest: +${drop.value} Vault Cash Bonus`
          })
          break
        }

        case 'multiplier_24h': {
          coinsAwarded = 25
          this.wallet.append({
            ts: now.toISOString(),
            day,
            module: 'shop',
            kind: 'earn',
            coins: coinsAwarded,
            xp: 0,
            ref: chestRef(level),
            note: `Level ${level} Chest: 2x Multiplier Shard (+25 coins)`
          })
          break
        }
      }

      // Record drop in chest_loot_drops table
      this.db
        .prepare(
          'INSERT INTO chest_loot_drops (level, loot_type, loot_value, loot_label, ts) VALUES (?, ?, ?, ?, ?)'
        )
        .run(level, drop.type, drop.value, drop.label, now.toISOString())

      const nextAll = this.wallet.entries()
      const nextOpened = nextAll
        .filter((e) => e.kind !== 'undo')
        .map((e) => e.ref ?? '')
        .filter((r) => r.startsWith('chest:'))
      const remainingChests = unopenedChests(lvl, nextOpened)

      return {
        drop,
        coins: coinsAwarded,
        balance: balance(nextAll),
        chests: remainingChests
      }
    })()
  }

  getEconomySummary(now = new Date()): EconomySummary {
    const all = this.wallet.entries()
    const coinsBalance = balance(all)
    const rate = this.getExchangeRate()
    const coinsRealValue = coinsToMoneyValue(coinsBalance, rate)
    const vaultBalance = this.getVaultBalance()
    const currency = this.getCurrency()

    const monthlyBudget = Number(getSetting(this.db, 'reward_budget') ?? 0)
    const day = dayKey(now, this.timeZone)
    const month = day.slice(0, 7)

    const spentRow = this.db
      .prepare('SELECT COALESCE(SUM(real_cost), 0) as total FROM redemptions WHERE substr(day, 1, 7) = ?')
      .get(month) as { total: number }
    const monthSpent = spentRow?.total ?? 0

    const cleanStreak = this.discipline?.state().current ?? 0
    // Check if money service has budget streak
    const budgetStreak = this.money?.state().today.underBudget ? 3 : 0
    const multiplier = computeActiveMultiplier(cleanStreak, budgetStreak)

    const goals = this.goals()
    const pinnedGoal = goals.find((g) => g.pinned && !g.completed) ?? null
    const recentVaultEntries = this.getVaultHistory(10)

    return {
      coinsBalance,
      coinsRealValue,
      exchangeRate: rate,
      vaultBalance,
      currency,
      monthlyBudget,
      monthSpent,
      multiplier,
      pinnedGoal,
      goals,
      recentVaultEntries
    }
  }
}
