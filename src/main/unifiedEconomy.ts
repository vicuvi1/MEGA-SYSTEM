import { dayKey } from '@core/dates'
import { balance, LedgerError } from '@core/ledger'
import {
  coinsToMoneyValue,
  computeActiveMultiplier,
  rollEnhancedChest,
  type ChestLootDrop,
  type MultiplierInfo,
  type WishlistCategory,
  type WishlistGoal,
  type BankState,
  computeMaxStakingCap,
  computeDailyInterestRate,
  calculateAccruedInterest,
  type ActiveBuff,
  type ConsumableItem,
  CONSUMABLE_CATALOG,
  type EconomyConfig,
  type EconomyPreset,
  ECONOMY_PRESETS
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
  productUrl?: string | null
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
  bank: BankState
  activeBuffs: ActiveBuff[]
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
  product_url?: string | null
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
  productUrl: r.product_url ?? null,
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
          `INSERT INTO wishlist_goals (title, target_coins, target_real_cost, allocated_coins, allocated_real_cost, category, pinned, completed, note, created_at, image_url, product_url, currency)
           VALUES (?, ?, ?, 0, 0, ?, ?, 0, ?, ?, ?, ?, ?)`
        )
        this.db.transaction(() => {
          insert.run('Kaaba Pilgrimage Fund', 20000, 15000, 'trip', 1, 'The supreme spiritual milestone. Keep stacking.', now, 'https://images.unsplash.com/photo-1591604129939-f1efa4d9f7fa?w=800&auto=format&fit=crop&q=80', 'https://www.visitsaudi.com/en/umrah', 'MDL')
          insert.run('MacBook / Pro Warrior Setup', 12000, 8000, 'tech', 0, 'High-performance battle workstation.', now, 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800&auto=format&fit=crop&q=80', 'https://darwin.md/apple-macbook-pro', 'MDL')
          insert.run('Luxury Recovery & Spa Retreat', 3500, 1500, 'luxury', 0, 'Deep restorative rest and rejuvenation.', now, 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=800&auto=format&fit=crop&q=80', 'https://aquaterra.md/spa', 'MDL')
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
    const productUrl = input.productUrl?.trim() || null
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
             SET title = ?, target_coins = ?, target_real_cost = ?, category = ?, pinned = ?, note = ?, image_url = ?, product_url = ?, currency = ?
             WHERE id = ?`
          )
          .run(title, targetCoins, targetRealCost, category, pinned, note, imageUrl, productUrl, currency, input.id)
        const row = this.db.prepare('SELECT * FROM wishlist_goals WHERE id = ?').get(input.id) as GoalRow
        return toGoal(row)
      } else {
        const info = this.db
          .prepare(
            `INSERT INTO wishlist_goals (title, target_coins, target_real_cost, allocated_coins, allocated_real_cost, category, pinned, completed, note, created_at, image_url, product_url, currency)
             VALUES (?, ?, ?, 0, 0, ?, ?, 0, ?, ?, ?, ?, ?)`
          )
          .run(title, targetCoins, targetRealCost, category, pinned, note, now, imageUrl, productUrl, currency)
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

    const bank = this.getBankState(now);
    const activeBuffs = this.getActiveBuffs(now);

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
      recentVaultEntries,
      bank,
      activeBuffs
    }
  }

  // --- SHADOW ECONOMY 2.0: THE IRON BANK ---

  getBankState(now = new Date()): BankState {
    const stakedCoins = Number(getSetting(this.db, 'bank_staked_coins') ?? 0);
    const totalInterestEarned = Number(getSetting(this.db, 'bank_total_interest_earned') ?? 0);
    const lastClaimDay = getSetting(this.db, 'bank_last_interest_day');

    const all = this.wallet.entries();
    const lvl = levelInfo(totalXp(all)).level;
    const maxStakingCap = computeMaxStakingCap(lvl);

    const cleanStreak = this.discipline?.state(now).current ?? 0;
    const rateInfo = computeDailyInterestRate(cleanStreak);
    const currentDay = dayKey(now, this.timeZone);

    const { pendingInterest } = calculateAccruedInterest(
      stakedCoins,
      lastClaimDay,
      currentDay,
      cleanStreak
    );

    return {
      stakedCoins,
      maxStakingCap,
      dailyRatePercent: rateInfo.percent,
      pendingInterest,
      totalInterestEarned,
      lastClaimDay,
      streakBonusActive: rateInfo.streakBonusActive,
      cleanStreak
    };
  }

  stakeCoins(amount: number, now = new Date()): BankState {
    if (amount <= 0) throw new LedgerError('Staking amount must be greater than zero');
    const currentBalance = balance(this.wallet.entries());
    if (currentBalance < amount) {
      throw new LedgerError(`Insufficient coins in wallet (${currentBalance} available, ${amount} requested)`);
    }

    const state = this.getBankState(now);
    if (state.stakedCoins + amount > state.maxStakingCap) {
      throw new LedgerError(`Staking would exceed your Rank limit of ${state.maxStakingCap} coins. Level up to increase cap!`);
    }

    const currentDay = dayKey(now, this.timeZone);

    return this.db.transaction(() => {
      // If there is pending interest, claim it as well during new stake so yield starts fresh
      if (state.pendingInterest > 0) {
        this.wallet.append({
          ts: now.toISOString(),
          day: currentDay,
          module: 'shop',
          kind: 'earn',
          coins: state.pendingInterest,
          xp: 0,
          ref: 'bank:interest',
          note: 'Iron Bank Auto-Accrued Dividend on Deposit'
        });
        setSetting(this.db, 'bank_total_interest_earned', String(state.totalInterestEarned + state.pendingInterest));
      }

      this.wallet.append({
        ts: now.toISOString(),
        day: currentDay,
        module: 'shop',
        kind: 'spend',
        coins: -amount,
        xp: 0,
        ref: 'bank:stake',
        note: `Iron Bank Vault Deposit: ${amount} coins staked`
      });

      const nextStaked = state.stakedCoins + amount;
      setSetting(this.db, 'bank_staked_coins', String(nextStaked));
      setSetting(this.db, 'bank_last_interest_day', currentDay);

      return this.getBankState(now);
    })();
  }

  withdrawCoins(amount: number, now = new Date()): BankState {
    if (amount <= 0) throw new LedgerError('Withdrawal amount must be greater than zero');
    const state = this.getBankState(now);
    if (state.stakedCoins < amount) {
      throw new LedgerError(`Insufficient staked coins (${state.stakedCoins} staked, requested ${amount})`);
    }

    const currentDay = dayKey(now, this.timeZone);

    return this.db.transaction(() => {
      // Claim accrued interest before principal changes
      if (state.pendingInterest > 0) {
        this.wallet.append({
          ts: now.toISOString(),
          day: currentDay,
          module: 'shop',
          kind: 'earn',
          coins: state.pendingInterest,
          xp: 0,
          ref: 'bank:interest',
          note: 'Iron Bank Accrued Dividend on Withdrawal'
        });
        setSetting(this.db, 'bank_total_interest_earned', String(state.totalInterestEarned + state.pendingInterest));
      }

      this.wallet.append({
        ts: now.toISOString(),
        day: currentDay,
        module: 'shop',
        kind: 'earn',
        coins: amount,
        xp: 0,
        ref: 'bank:withdraw',
        note: `Iron Bank Vault Withdrawal: ${amount} coins released`
      });

      const nextStaked = state.stakedCoins - amount;
      setSetting(this.db, 'bank_staked_coins', String(nextStaked));
      setSetting(this.db, 'bank_last_interest_day', currentDay);

      return this.getBankState(now);
    })();
  }

  claimInterest(now = new Date()): { bank: BankState; claimedCoins: number } {
    const state = this.getBankState(now);
    if (state.pendingInterest <= 0) {
      throw new LedgerError('No dividend yield available to claim yet today');
    }

    const currentDay = dayKey(now, this.timeZone);
    const claimed = state.pendingInterest;

    return this.db.transaction(() => {
      this.wallet.append({
        ts: now.toISOString(),
        day: currentDay,
        module: 'shop',
        kind: 'earn',
        coins: claimed,
        xp: 0,
        ref: 'bank:interest',
        note: `Iron Bank Daily Dividend Yield: +${claimed} coins`
      });

      setSetting(this.db, 'bank_last_interest_day', currentDay);
      setSetting(this.db, 'bank_total_interest_earned', String(state.totalInterestEarned + claimed));

      return {
        bank: this.getBankState(now),
        claimedCoins: claimed
      };
    })();
  }

  // --- SHADOW ECONOMY 2.0: HUNTER CONSUMABLES & BUFFS ---

  getActiveBuffs(now = new Date()): ActiveBuff[] {
    const nowIso = now.toISOString();
    try {
      this.db.prepare('DELETE FROM active_buffs WHERE expires_at <= ?').run(nowIso);
      const rows = this.db.prepare('SELECT * FROM active_buffs WHERE expires_at > ?').all(nowIso) as any[];
      return rows.map((r) => {
        const remainingSeconds = Math.max(0, Math.floor((Date.parse(r.expires_at) - now.getTime()) / 1000));
        return {
          id: r.id,
          itemId: r.item_id,
          title: r.title,
          expiresAt: r.expires_at,
          effectKind: r.effect_kind,
          effectVal: r.effect_val,
          icon: r.icon,
          remainingSeconds
        };
      });
    } catch {
      return [];
    }
  }

  isBuffActive(effectKind: string, now = new Date()): boolean {
    try {
      const nowIso = now.toISOString();
      const row = this.db
        .prepare('SELECT COUNT(*) as c FROM active_buffs WHERE effect_kind = ? AND expires_at > ?')
        .get(effectKind, nowIso) as { c: number } | undefined;
      return (row?.c ?? 0) > 0;
    } catch {
      return false;
    }
  }

  getBuffMultiplier(effectKind: string, now = new Date()): number {
    try {
      const nowIso = now.toISOString();
      const row = this.db
        .prepare('SELECT MAX(effect_val) as val FROM active_buffs WHERE effect_kind = ? AND expires_at > ?')
        .get(effectKind, nowIso) as { val: number | null } | undefined;
      return row?.val ?? 1.0;
    } catch {
      return 1.0;
    }
  }

  buyConsumable(itemId: string, now = new Date()): { buff?: ActiveBuff; balance: number; message: string } {
    const defaultItem = CONSUMABLE_CATALOG.find((c) => c.id === itemId);
    if (!defaultItem) throw new LedgerError(`Unknown consumable item: "${itemId}"`);
    const customCost = Number(getSetting(this.db, `price_${itemId}`)) || defaultItem.costCoins;
    const item = { ...defaultItem, costCoins: customCost };

    const currentBalance = balance(this.wallet.entries());
    if (currentBalance < item.costCoins) {
      throw new LedgerError(`Insufficient coins (${currentBalance} available, ${item.costCoins} required)`);
    }

    const currentDay = dayKey(now, this.timeZone);

    return this.db.transaction(() => {
      this.wallet.append({
        ts: now.toISOString(),
        day: currentDay,
        module: 'shop',
        kind: 'spend',
        coins: -item.costCoins,
        xp: 0,
        ref: `consumable:${item.id}`,
        note: `Purchased ${item.name}`
      });

      const nextBalance = balance(this.wallet.entries());

      if (item.effectKind === 'streak_shield') {
        this.shields?.awardFreeShield('Purchased from Hunter Tactical Store');
        return {
          balance: nextBalance,
          message: '🛡️ Streak Aegis Shield added to your tactical inventory!'
        };
      }

      if (item.effectKind === 'workout_cap_reset') {
        return {
          balance: nextBalance,
          message: '💊 System Fatigue Cleansed! Workout muscle limits reset.'
        };
      }

      // Timed buff (Focus Elixir or XP Booster)
      const existing = this.db.prepare('SELECT * FROM active_buffs WHERE item_id = ? AND expires_at > ?').get(item.id, now.toISOString()) as any;
      const durationMs = item.durationHours * 3600 * 1000;
      let newExpiresAt: string;

      if (existing) {
        newExpiresAt = new Date(Date.parse(existing.expires_at) + durationMs).toISOString();
        this.db.prepare('UPDATE active_buffs SET expires_at = ? WHERE id = ?').run(newExpiresAt, existing.id);
      } else {
        newExpiresAt = new Date(now.getTime() + durationMs).toISOString();
        const buffId = `buff_${item.id}_${Date.now()}`;
        this.db.prepare('INSERT INTO active_buffs (id, item_id, title, expires_at, effect_kind, effect_val, icon) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(buffId, item.id, item.title, newExpiresAt, item.effectKind, item.effectValue, item.icon);
      }

      const activeList = this.getActiveBuffs(now);
      const buff = activeList.find((b) => b.itemId === item.id);

      return {
        buff,
        balance: nextBalance,
        message: `${item.icon} ${item.title} Activated! Active for ${item.durationHours} hours.`
      };
    })();
  }


  // --- MASTER ECONOMY CONFIGURATION & PRESET TUNING ---

  getEconomyConfig(): EconomyConfig {
    const exchangeRate = this.getExchangeRate();
    const currency = this.getCurrency();
    const monthlyBudget = Number(getSetting(this.db, 'reward_budget') ?? 0);
    const bankBaseRate = Number(getSetting(this.db, 'bank_base_rate') ?? 0.5);
    const bankCapPerLevel = Number(getSetting(this.db, 'bank_cap_per_level') ?? 250);

    const consumablePrices = {
      focus_elixir: Number(getSetting(this.db, 'price_focus_elixir') ?? 20),
      xp_booster: Number(getSetting(this.db, 'price_xp_booster') ?? 25),
      streak_shield: Number(getSetting(this.db, 'price_streak_shield') ?? 50),
      fatigue_neutralizer: Number(getSetting(this.db, 'price_fatigue_neutralizer') ?? 15)
    };

    return {
      exchangeRate,
      currency,
      monthlyBudget,
      bankBaseRate,
      bankCapPerLevel,
      consumablePrices
    };
  }

  saveEconomyConfig(patch: Partial<EconomyConfig>): EconomyConfig {
    if (patch.exchangeRate !== undefined && patch.exchangeRate > 0) {
      this.setExchangeRate(patch.exchangeRate);
    }
    if (patch.currency !== undefined && patch.currency.trim()) {
      this.setCurrency(patch.currency);
    }
    if (patch.monthlyBudget !== undefined && patch.monthlyBudget >= 0) {
      setSetting(this.db, 'reward_budget', String(patch.monthlyBudget));
    }
    if (patch.bankBaseRate !== undefined && patch.bankBaseRate > 0) {
      setSetting(this.db, 'bank_base_rate', String(patch.bankBaseRate));
    }
    if (patch.bankCapPerLevel !== undefined && patch.bankCapPerLevel > 0) {
      setSetting(this.db, 'bank_cap_per_level', String(patch.bankCapPerLevel));
    }
    if (patch.consumablePrices) {
      for (const [k, v] of Object.entries(patch.consumablePrices)) {
        if (typeof v === 'number' && v > 0) {
          setSetting(this.db, `price_${k}`, String(v));
        }
      }
    }
    return this.getEconomyConfig();
  }

  applyEconomyPreset(presetId: 'balanced' | 'spartan' | 'turbo'): EconomyConfig {
    const preset = ECONOMY_PRESETS[presetId];
    if (!preset) throw new LedgerError(`Unknown preset: "${presetId}"`);

    setSetting(this.db, 'bank_base_rate', String(preset.bankBaseRate));
    setSetting(this.db, 'bank_cap_per_level', String(preset.bankCapPerLevel));
    for (const [k, v] of Object.entries(preset.consumablePrices)) {
      setSetting(this.db, `price_${k}`, String(v));
    }

    const allRules = this.wallet.rules();
    for (const [ruleId, override] of Object.entries(preset.ruleOverrides)) {
      const existing = allRules.find((r) => r.id === ruleId);
      if (existing) {
        this.wallet.saveRule({
          ...existing,
          coins: override.coins,
          xp: override.xp,
          dailyCap: override.dailyCap ?? existing.dailyCap
        });
      }
    }

    return this.getEconomyConfig();
  }

}
