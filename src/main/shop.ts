import type { UnifiedEconomyService } from './unifiedEconomy'
import { earnPerDay } from '@core/shop'
import { dayKey, monthKey } from '@core/dates'
import { balance, LedgerError, totalXp } from '@core/ledger'
import { levelInfo } from '@core/levels'
import { chestRef, planRedeem, rollChest, unopenedChests, validateReward, type Reward, type Tier } from '@core/shop'
import type { RewardInput, ShopState, ShopValue } from '@shared/api'
import { pointValue } from '@core/pointValue'
import { funBudgetLei, funSpentLei, migrateRewardBudget, parseFunBudget, toLei, type FunBudgetSetting } from '@core/funBudget'
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

  /** The old monthly reward cap: merged into the fun budget (RL3), so no longer a hard cap here. */
  private budget(): number {
    return 0
  }

  /** RL3: the fun budget setting (the old `reward_budget` is read until the first save moves it). */
  funSetting(): FunBudgetSetting | null {
    const raw = getSetting(this.db, 'fun_budget')
    return parseFunBudget(raw) ?? migrateRewardBudget(raw, getSetting(this.db, 'reward_budget'))
  }

  /** Moves the old `reward_budget` into `fun_budget` once (call inside a write). */
  migrateFunBudget(): void {
    const moved = migrateRewardBudget(getSetting(this.db, 'fun_budget'), getSetting(this.db, 'reward_budget'))
    if (!moved) return
    setSetting(this.db, 'fun_budget', JSON.stringify(moved))
    setSetting(this.db, 'reward_budget', '0')
  }

  /** Set the monthly fun budget by hand, or take it from Finance Helper (lei = its limit now, the fallback). */
  setFunBudget(b: FunBudgetSetting | null): void {
    if (b == null) {
      setSetting(this.db, 'fun_budget', 'null')
      setSetting(this.db, 'reward_budget', '0')
      return
    }
    const lei = Math.round(Number(b.lei))
    if (!Number.isFinite(lei) || lei < 0) throw new LedgerError('The fun budget must be 0 or more lei')
    setSetting(this.db, 'fun_budget', JSON.stringify({ lei, source: b.source === 'finance' ? 'finance' : 'manual' }))
    setSetting(this.db, 'reward_budget', '0')
  }

  /** Rewards bought this month (not undone): what you paid, in lei. */
  monthBuysLei(day: string, rates?: any): number[] {
    const undone = this.undoneIds()
    const rows = this.db
      .prepare('SELECT d.ledger_id AS ledger_id, d.real_cost AS real_cost, r.currency AS currency FROM redemptions d LEFT JOIN rewards r ON r.id = d.reward_id WHERE substr(d.day, 1, 7) = ?')
      .all(monthKey(day)) as { ledger_id: number; real_cost: number; currency: string | null }[]
    return rows.filter((r) => !undone.has(r.ledger_id) && r.real_cost > 0).map((r) => toLei(r.real_cost, r.currency, rates) ?? 0)
  }

  /**
   * RL1: what one point is worth, and your fun budget this month.
   * `finance`: Finance Helper's data (for a Fun/Entertainment limit, its spending and rates);
   * `hourlyLei`: your hour of work (Finance Helper), null when unknown.
   */
  value(opts: { finance?: any; hourlyLei?: number | null } = {}, now = new Date()): ShopValue {
    const day = dayKey(now, this.timeZone)
    const setting = this.funSetting()
    const budgetLei = funBudgetLei(setting, opts.finance)
    const value = pointValue({ funBudgetLei: budgetLei, earnPerDay: earnPerDay(this.wallet.entries() as any, day) })
    const spent = funSpentLei({ month: monthKey(day), rewardBuysLei: this.monthBuysLei(day, opts.finance?.rates), finance: opts.finance, setting })
    const hourly = Number(opts.hourlyLei) > 0 ? Math.round(Number(opts.hourlyLei) * 100) / 100 : null
    return {
      value,
      funBudgetLei: budgetLei,
      funSpentLei: spent,
      funLeftLei: budgetLei == null ? null : Math.round((budgetLei - spent) * 100) / 100,
      hourlyLei: hourly,
      funSource: budgetLei == null ? null : setting?.source ?? 'manual'
    }
  }

  /** Real money spent on rewards this month, ignoring undone purchases. */
  private monthSpent(day: string, undoneIds: Set<number>): number {
    const rows = this.db.prepare('SELECT ledger_id, real_cost FROM redemptions WHERE substr(day, 1, 7) = ?').all(monthKey(day)) as { ledger_id: number; real_cost: number }[]
    return rows.filter((r) => !undoneIds.has(r.ledger_id)).reduce((s, r) => s + r.real_cost, 0)
  }

  private undoneIds(all = this.wallet.entries(), liveRows = this.wallet.effective()): Set<number> {
    const live = new Set(liveRows.map((e) => e.id))
    return new Set(all.filter((e) => e.kind !== 'undo' && !live.has(e.id)).map((e) => e.id))
  }

  state(now = new Date()): ShopState {
    const all = this.wallet.entries()
    const liveRows = this.wallet.effective()
    const day = dayKey(now, this.timeZone)
    const undone = this.undoneIds(all, liveRows)
    const level = levelInfo(totalXp(all)).level
    const openedRefs = liveRows.map((e) => e.ref ?? '').filter((r) => r.startsWith('chest:'))
    const recent = this.db.prepare('SELECT ledger_id, title, real_cost, day FROM redemptions ORDER BY id DESC LIMIT 8').all() as { ledger_id: number; title: string; real_cost: number; day: string }[]
    return {
      rewards: this.rewards(),
      balance: balance(all),
      level,
      // No hard cap any more: the fun budget (shop.value()) warns, and you can buy anyway.
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

  /**
   * RL3: why the fun budget stops this buy (null = fine). `paid` is what it
   * really costs, in the reward's currency.
   */
  funBlocker(id: number, paid: number, finance?: any, now = new Date()): string | null {
    const reward = this.reward(id)
    if (!(paid > 0)) return null
    const v = this.value({ finance }, now)
    if (v.funLeftLei == null) return null
    const lei = toLei(paid, reward.currency, finance?.rates) ?? paid
    if (lei <= v.funLeftLei) return null
    const left = Math.max(0, Math.floor(v.funLeftLei))
    return left <= 0
      ? `Your fun budget is empty this month (${v.funBudgetLei} lei, ${Math.round(v.funSpentLei)} lei spent).`
      : `${reward.title} costs ${Math.round(lei)} lei and only ${left} lei is left in your fun budget this month.`
  }

  /**
   * Buys a reward: the points go, and what you paid is recorded (RL4).
   * `paid`: what you really paid (the reward's currency; default its real cost).
   * `force`: buy even though the fun budget is empty (the explicit second tap).
   */
  redeem(id: number, now = new Date(), opts: { paid?: number; force?: boolean; finance?: any } = {}): number {
    return this.db.transaction(() => {
      this.migrateFunBudget()
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
      const paid = opts.paid != null && Number.isFinite(Number(opts.paid)) ? Math.max(0, Math.round(Number(opts.paid))) : reward.realCost
      if (!opts.force) {
        const why = this.funBlocker(id, paid, opts.finance, now)
        if (why) throw new LedgerError(`FUN_EMPTY: ${why}`)
      }
      const ledgerId = this.wallet.append({ ts: now.toISOString(), day, module: 'shop', kind: 'spend', coins: -reward.price, xp: 0, ref: `reward:${id}`, note: reward.title })
      this.db.prepare('INSERT INTO redemptions (ledger_id, reward_id, title, real_cost, day) VALUES (?, ?, ?, ?, ?)').run(ledgerId, id, reward.title, paid, day)
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

  /** The old reward budget: now the monthly fun budget, typed by hand (RL3). 0 = none. */
  setBudget(amount: number): void {
    if (!Number.isInteger(amount) || amount < 0) throw new LedgerError('Budget must be a whole number, 0 or more')
    this.setFunBudget(amount > 0 ? { lei: amount, source: 'manual' } : null)
  }

  setCurrency(cur: string): void {
    const code = cur?.trim().toUpperCase() || 'MDL'
    setSetting(this.db, 'currency', code)
    setSetting(this.db, 'money_currency', code)
  }
}
