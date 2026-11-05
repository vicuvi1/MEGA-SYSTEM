import type { UnifiedEconomyService } from './unifiedEconomy'
import { earnPerDay } from '@core/shop'
import { dayKey, monthKey } from '@core/dates'
import { balance, effective, LedgerError, totalXp } from '@core/ledger'
import { levelInfo } from '@core/levels'
import { chestRef, planRedeem, rollChest, unopenedChests, validateReward, type Reward, type Tier } from '@core/shop'
import type { RewardInput, ShopState } from '@shared/api'
import type { DB } from './db'
import { getSetting, setSetting } from './settings'
import type { Wallet } from './wallet'

interface RewardRow {
  id: number
  title: string
  price: number
  tier: Tier
  real_cost: number
  pinned: number
  archived: number
  note: string | null
  image_url?: string | null
  product_url?: string | null
  currency?: string | null
}

const toReward = (r: RewardRow): Reward => ({
  id: r.id, title: r.title, price: r.price, tier: r.tier, realCost: r.real_cost,
  pinned: !!r.pinned, archived: !!r.archived, note: r.note,
  imageUrl: r.image_url ?? null, productUrl: r.product_url ?? null, currency: r.currency ?? 'MDL'
})

export class Shop {
  constructor(
    private db: DB,
    private wallet: Wallet,
    private timeZone?: string,
    private rand: () => number = Math.random,
    private economy?: UnifiedEconomyService
  ) {}

  setEconomy(eco: UnifiedEconomyService): void {
    this.economy = eco
  }

  private rewards(): Reward[] {
    const rows = this.db.prepare('SELECT * FROM rewards WHERE archived = 0 ORDER BY pinned DESC, price').all() as RewardRow[]
    return rows.map(toReward)
  }

  private reward(id: number): Reward {
    const row = this.db.prepare('SELECT * FROM rewards WHERE id = ?').get(id) as RewardRow | undefined
    if (!row) throw new LedgerError('Reward not found')
    return toReward(row)
  }

  private budget(): number {
    return Number(getSetting(this.db, 'reward_budget') ?? 0)
  }

  /** Real money spent on rewards this month, ignoring undone purchases. */
  private monthSpent(day: string, undoneIds: Set<number>): number {
    const rows = this.db.prepare('SELECT ledger_id, real_cost FROM redemptions WHERE substr(day, 1, 7) = ?').all(monthKey(day)) as { ledger_id: number; real_cost: number }[]
    return rows.filter((r) => !undoneIds.has(r.ledger_id)).reduce((s, r) => s + r.real_cost, 0)
  }

  private undoneIds(): Set<number> {
    const all = this.wallet.entries()
    const live = new Set(effective(all).map((e) => e.id))
    return new Set(all.filter((e) => e.kind !== 'undo' && !live.has(e.id)).map((e) => e.id))
  }

  state(now = new Date()): ShopState {
    const all = this.wallet.entries()
    const day = dayKey(now, this.timeZone)
    const undone = this.undoneIds()
    const level = levelInfo(totalXp(all)).level
    const openedRefs = effective(all).map((e) => e.ref ?? '').filter((r) => r.startsWith('chest:'))
    const recent = this.db.prepare('SELECT ledger_id, title, real_cost, day FROM redemptions ORDER BY id DESC LIMIT 8').all() as { ledger_id: number; title: string; real_cost: number; day: string }[]
    return {
      rewards: this.rewards(),
      balance: balance(all),
      level,
      budget: this.budget(),
      earnPerDay: earnPerDay(all as any, day),
      monthSpent: this.monthSpent(day, undone),
      currency: getSetting(this.db, 'currency') ?? 'MDL',
      chests: unopenedChests(level, openedRefs),
      recent: recent.map((r) => ({ title: r.title, realCost: r.real_cost, day: r.day, undone: undone.has(r.ledger_id) })),
      economy: this.economy?.getEconomySummary(now)
    }
  }

  save(input: RewardInput): void {
    const r = {
      ...input,
      title: input.title.trim(),
      note: input.note?.trim() || null,
      imageUrl: input.imageUrl?.trim() || null,
      productUrl: input.productUrl?.trim() || null,
      currency: input.currency?.trim() || 'MDL',
      archived: false
    }
    validateReward(r)
    this.db.transaction(() => {
      // Only one reward is the "next target" shown on Today.
      if (r.pinned) this.db.prepare('UPDATE rewards SET pinned = 0').run()
      const params = {
        title: r.title,
        price: r.price,
        tier: r.tier,
        realCost: r.realCost,
        pinned: r.pinned ? 1 : 0,
        note: r.note,
        imageUrl: r.imageUrl,
        productUrl: r.productUrl,
        currency: r.currency
      }
      if (input.id) {
        this.reward(input.id)
        this.db.prepare('UPDATE rewards SET title = @title, price = @price, tier = @tier, real_cost = @realCost, pinned = @pinned, note = @note, image_url = @imageUrl, product_url = @productUrl, currency = @currency WHERE id = @id').run({ ...params, id: input.id })
      } else {
        this.db.prepare('INSERT INTO rewards (title, price, tier, real_cost, pinned, note, image_url, product_url, currency) VALUES (@title, @price, @tier, @realCost, @pinned, @note, @imageUrl, @productUrl, @currency)').run(params)
      }
    })()
  }

  archive(id: number): void {
    this.reward(id)
    this.db.prepare('UPDATE rewards SET archived = 1, pinned = 0 WHERE id = ?').run(id)
  }

  redeem(id: number, now = new Date()): number {
    return this.db.transaction(() => {
      const reward = this.reward(id)
      const all = this.wallet.entries()
      const day = dayKey(now, this.timeZone)
      planRedeem({
        reward,
        balance: balance(all),
        level: levelInfo(totalXp(all)).level,
        monthSpent: this.monthSpent(day, this.undoneIds()),
        budget: this.budget()
      })
      const ledgerId = this.wallet.append({ ts: now.toISOString(), day, module: 'shop', kind: 'spend', coins: -reward.price, xp: 0, ref: `reward:${id}`, note: reward.title })
      this.db.prepare('INSERT INTO redemptions (ledger_id, reward_id, title, real_cost, day) VALUES (?, ?, ?, ?, ?)').run(ledgerId, id, reward.title, reward.realCost, day)
      return ledgerId
    }).immediate()
  }

  openChest(level: number, now = new Date()): number {
    return this.db.transaction(() => {
      const s = this.state(now)
      if (!s.chests.includes(level)) throw new LedgerError('No chest waiting for that level')
      const coins = rollChest(level, this.rand())
      this.wallet.append({ ts: now.toISOString(), day: dayKey(now, this.timeZone), module: 'shop', kind: 'earn', coins, xp: 0, ref: chestRef(level), note: `Level ${level} chest` })
      return coins
    }).immediate()
  }

  setBudget(amount: number): void {
    if (!Number.isInteger(amount) || amount < 0) throw new LedgerError('Budget must be a whole number, 0 or more')
    setSetting(this.db, 'reward_budget', String(amount))
  }

  setCurrency(cur: string): void {
    const code = cur?.trim().toUpperCase() || 'MDL'
    setSetting(this.db, 'currency', code)
    setSetting(this.db, 'money_currency', code)
  }
}
