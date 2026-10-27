import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from './db'
import { ShieldService } from './shields'
import { UnifiedEconomyService } from './unifiedEconomy'
import { Wallet } from './wallet'

let dir: string
let db: DB
let wallet: Wallet
let shields: ShieldService
let economy: UnifiedEconomyService

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-economy-test-'))
  db = openDb(join(dir, 'life.db'))
  wallet = new Wallet(db, 'UTC')
  shields = new ShieldService(db, wallet, 'UTC')
  economy = new UnifiedEconomyService(db, wallet, undefined, undefined, shields, 'UTC')
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('UnifiedEconomyService Backend', () => {
  it('initializes default seeded wishlist goals', () => {
    const goals = economy.goals()
    expect(goals.length).toBeGreaterThanOrEqual(3)
    const kaaba = goals.find((g) => g.title.includes('Kaaba'))
    expect(kaaba).toBeDefined()
    expect(kaaba?.pinned).toBe(true)
  })

  it('manages real-money reward vault credit and debit', () => {
    expect(economy.getVaultBalance()).toBe(0)

    // Credit surplus savings
    const bal1 = economy.creditVault('surplus_credit', 150, 'Day under budget surplus')
    expect(bal1).toBe(150)
    expect(economy.getVaultBalance()).toBe(150)

    // Credit manual bonus
    const bal2 = economy.creditVault('manual_deposit', 50, 'Extra savings deposit')
    expect(bal2).toBe(200)

    // Debit for goal allocation
    const bal3 = economy.debitVault('goal_allocation', 80, 'Allocated to gear')
    expect(bal3).toBe(120)

    const history = economy.getVaultHistory()
    expect(history.length).toBe(3)
  })

  it('creates, saves, and pins wishlist goals', () => {
    const goal = economy.saveGoal({
      title: 'Ergonomic Standing Desk',
      targetCoins: 4000,
      targetRealCost: 2500,
      category: 'gear',
      pinned: true,
      note: 'Dual motor standing desk'
    })

    expect(goal.id).toBeDefined()
    expect(goal.title).toBe('Ergonomic Standing Desk')
    expect(goal.pinned).toBe(true)

    const pinned = economy.pinnedGoal()
    expect(pinned?.id).toBe(goal.id)
  })

  it('deposits coins and vault cash to a goal and marks completion', () => {
    const now = new Date('2026-10-27T12:00:00Z')
    // Award 500 coins to wallet
    wallet.award('discipline.clean_day', '', now) // +20
    wallet.award('body.workout_done', '', now) // +10
    wallet.award('sleep.up_on_time', '', now) // +10
    // Give 1000 coins via direct ledger
    wallet.append({
      ts: now.toISOString(),
      day: '2026-10-27',
      module: 'quests',
      kind: 'earn',
      coins: 460,
      xp: 0,
      note: 'Direct test bonus'
    })
    expect(wallet.summary(now).balance).toBe(500)

    // Credit 300 to vault
    economy.creditVault('manual_deposit', 300, 'Initial savings')

    const goal = economy.saveGoal({
      title: 'Audio-Technica Headphones',
      targetCoins: 500,
      targetRealCost: 300,
      category: 'tech'
    })

    // Deposit coins
    const resCoin = economy.depositCoinsToGoal(goal.id, 500, now)
    expect(resCoin.goal.allocatedCoins).toBe(500)
    expect(resCoin.balance).toBe(0) // 500 - 500 = 0

    // Deposit vault cash
    const resCash = economy.depositVaultCashToGoal(goal.id, 300, now)
    expect(resCash.goal.allocatedRealCost).toBe(300)
    expect(resCash.goal.completed).toBe(true)
    expect(resCash.goal.completedAt).toBeDefined()
    expect(resCash.vaultBalance).toBe(0)
  })

  it('returns full economy summary with valuation and multipliers', () => {
    const now = new Date('2026-10-27T12:00:00Z')
    wallet.award('discipline.clean_day', '', now)
    economy.creditVault('surplus_credit', 80, 'Savings')

    const summary = economy.getEconomySummary(now)
    expect(summary.coinsBalance).toBe(20)
    expect(summary.exchangeRate).toBe(10)
    expect(summary.coinsRealValue).toBe(2) // 20 coins * 0.10 = 2 MDL
    expect(summary.vaultBalance).toBe(80)
    expect(summary.multiplier).toBeDefined()
    expect(summary.goals.length).toBeGreaterThan(0)
  })

  it('supports photo image_url and currency on wishlist goals', () => {
    const goal = economy.saveGoal({
      title: 'Sony Alpha Camera',
      targetCoins: 15000,
      targetRealCost: 1200,
      category: 'tech',
      imageUrl: 'https://images.unsplash.com/photo-sony-camera.jpg',
      currency: 'USD',
      note: 'Cinematic video creator rig'
    })
    expect(goal.imageUrl).toBe('https://images.unsplash.com/photo-sony-camera.jpg')
    expect(goal.currency).toBe('USD')

    economy.setCurrency('USD')
    expect(economy.getCurrency()).toBe('USD')
  })
})
