import type { UnifiedEconomyService } from './unifiedEconomy'
import { earnPerDay, isRewardCategory } from '@core/shop'
import { addDays, dayKey, monthKey } from '@core/dates'
import { balance, effective, LedgerError, totalXp, type LedgerEntry } from '@core/ledger'
import { levelInfo } from '@core/levels'
import { chestRef, planRedeem, unopenedChests, validateReward, type Reward, type Tier } from '@core/shop'
import type { RewardInput, ShopState, ShopValue } from '@shared/api'
import { pointValue } from '@core/pointValue'
import { funBudgetLei, funSpentLei, migrateRewardBudget, parseFunBudget, toLei, type FunBudgetSetting } from '@core/funBudget'
import { badgeStats, badges, challengeRef, challengeState, dayStreak, earnings, flameLevel, mondayOf, pickChallenge, type Badge, type ChallengeState, type Earnings } from '@core/rewardsKit'
import { cleanRules, guardBlocker, REWARD_RULES, setRules, todayDeeds, type RewardRules } from '@core/rewardGuard'
import { cleanCoupons, couponFor, mysteryState, openCoupons, prizeCoupon, REWARD_COUPONS, rollChestPrize, rollMystery, smallTreats, type ChestPrize, type Coupon, type MysteryState } from '@core/rewardSurprise'
import { starterByKey, starterReward, SUGGEST_HIDDEN } from '@core/rewardSuggest'
import { cleanUnlocks, REWARD_UNLOCKS, setUnlock } from '@core/unlocks'
import type { DB } from './db'
import { payOnce } from './points'
import { getSetting, readSetting, setSetting, writeSetting } from './settings'
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
  emoji?: string | null
  category?: string | null
  cooldown_days?: number | null
  month_limit?: number | null
  one_time?: number | null
  sort?: number | null
  goal_rank?: number | null
  bundle?: string | null
  jar_goal_id?: number | null
  price_locked?: number | null
  jar?: number | null
}

function parseBundle(raw: string | null | undefined): number[] | null {
  if (!raw) return null
  try {
    const a = JSON.parse(raw)
    return Array.isArray(a) ? a.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 12) : null
  } catch {
    return null
  }
}

const toReward = (r: RewardRow): Reward => ({
  id: r.id, title: r.title, price: r.price, tier: r.tier, realCost: r.real_cost,
  pinned: !!r.pinned, archived: !!r.archived, note: r.note,
  imageUrl: r.image_url ?? null, productUrl: r.product_url ?? null, currency: r.currency ?? 'MDL',
  emoji: r.emoji ?? null,
  category: isRewardCategory(r.category) ? r.category : null,
  cooldownDays: r.cooldown_days ?? 0,
  monthLimit: r.month_limit ?? 0,
  oneTime: !!r.one_time,
  sort: r.sort ?? 0,
  // Before goals had ranks, the one pinned reward was the goal.
  goalRank: r.goal_rank || (r.pinned ? 1 : 0),
  bundle: parseBundle(r.bundle),
  jar: Math.max(0, r.jar ?? 0),
  jarGoalId: r.jar_goal_id ?? null,
  priceLocked: r.price_locked == null ? true : !!r.price_locked
})

const SELECT_REWARDS = `SELECT rewards.*, COALESCE(g.allocated_coins, 0) AS jar FROM rewards LEFT JOIN wishlist_goals g ON g.id = rewards.jar_goal_id`

/** The Rewards page's extra numbers (RG2–RG8, RW8): graph, streak, challenge, badges. */
export interface RewardsInsights {
  today: string
  earnings: Earnings
  focusStreak: number
  flame: 0 | 1 | 2 | 3
  challenge: ChallengeState
  badges: Badge[]
  /** "Ready!" moments already shown (RW6). */
  readySeen: string[]
}

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
    const rows = this.db.prepare(`${SELECT_REWARDS} WHERE rewards.archived = 0 ORDER BY rewards.sort, rewards.pinned DESC, rewards.price`).all() as RewardRow[]
    return rows.map(toReward)
  }

  private reward(id: number): Reward {
    const row = this.db.prepare(`${SELECT_REWARDS} WHERE rewards.id = ?`).get(id) as RewardRow | undefined
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

  /** RL7: this month's move of leftover money to savings, if it stands (not undone). */
  savedMove(month: string): { lei: number; ledgerId: number; kind: 'fun' | 'month'; goal: string } | null {
    let all: Record<string, any> = {}
    try {
      all = JSON.parse(getSetting(this.db, 'fun_moves') || '{}') ?? {}
    } catch {
      all = {}
    }
    const m = all[month]
    if (!m || !Number(m.ledgerId)) return null
    if (!this.wallet.effective().some((e) => e.id === Number(m.ledgerId))) return null
    return { lei: Number(m.lei) || 0, ledgerId: Number(m.ledgerId), kind: m.kind === 'month' ? 'month' : 'fun', goal: String(m.goal ?? '') }
  }

  /** RL7: remembers a move to savings (the ledger entry is its log and its undo). */
  recordMove(month: string, move: { lei: number; ledgerId: number; kind: 'fun' | 'month'; goal: string }): void {
    let all: Record<string, any> = {}
    try {
      all = JSON.parse(getSetting(this.db, 'fun_moves') || '{}') ?? {}
    } catch {
      all = {}
    }
    all[month] = move
    const keep = Object.fromEntries(Object.entries(all).sort(([a], [b]) => (a < b ? -1 : 1)).slice(-24))
    setSetting(this.db, 'fun_moves', JSON.stringify(keep))
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
    // Fun money you already moved to savings this month is not there to spend any more (RL7).
    const move = this.savedMove(monthKey(day))
    const moved = move?.kind === 'fun' ? move.lei : 0
    const spent = funSpentLei({ month: monthKey(day), rewardBuysLei: this.monthBuysLei(day, opts.finance?.rates), finance: opts.finance, setting })
    const hourly = Number(opts.hourlyLei) > 0 ? Math.round(Number(opts.hourlyLei) * 100) / 100 : null
    return {
      value,
      funBudgetLei: budgetLei,
      funSpentLei: spent,
      funLeftLei: budgetLei == null ? null : Math.round((budgetLei - spent - moved) * 100) / 100,
      hourlyLei: hourly,
      funSource: budgetLei == null ? null : setting?.source ?? 'manual'
    }
  }

  /**
   * Points-only fix (2026-11-08): buys whose real money was taken back out of
   * Finance Helper (the owner's "Remove reward entries") count as points only.
   */
  clearPaid(ledgerIds: number[]): number {
    return this.db.transaction(() => {
      let n = 0
      for (const id of ledgerIds) {
        const row = this.db.prepare('SELECT real_cost FROM redemptions WHERE ledger_id = ?').get(id) as { real_cost: number } | undefined
        if (!row || !(row.real_cost > 0)) continue
        this.db.prepare('UPDATE redemptions SET real_cost = 0 WHERE ledger_id = ?').run(id)
        n++
      }
      return n
    })()
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

  /** Days of each reward's buys that still count (for cooldowns and monthly limits). */
  private buys(undone: Set<number>): Record<number, string[]> {
    const out: Record<number, string[]> = {}
    for (const r of this.db.prepare('SELECT ledger_id, reward_id, day FROM redemptions').all() as { ledger_id: number; reward_id: number; day: string }[]) {
      if (!undone.has(r.ledger_id)) (out[r.reward_id] ??= []).push(r.day)
    }
    return out
  }

  state(now = new Date()): ShopState {
    const all = this.wallet.entries()
    const liveRows = this.wallet.effective()
    const day = dayKey(now, this.timeZone)
    const undone = this.undoneIds(all, liveRows)
    const level = levelInfo(totalXp(all)).level
    const openedRefs = liveRows.map((e) => e.ref ?? '').filter((r) => r.startsWith('chest:'))
    const recent = this.db
      .prepare('SELECT r.ledger_id, r.reward_id, r.title, r.real_cost, r.day, r.jar_used, w.emoji, w.category, w.image_url FROM redemptions r LEFT JOIN rewards w ON w.id = r.reward_id ORDER BY r.id DESC LIMIT 40')
      .all() as { ledger_id: number; reward_id: number; title: string; real_cost: number; day: string; jar_used: number | null; emoji: string | null; category: string | null; image_url: string | null }[]
    const coinsOf = new Map(all.map((e) => [e.id, e.coins]))
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
      recent: recent.map((r) => ({
        title: r.title,
        realCost: r.real_cost,
        day: r.day,
        undone: undone.has(r.ledger_id),
        ledgerId: r.ledger_id,
        rewardId: r.reward_id,
        coins: -(coinsOf.get(r.ledger_id) ?? 0) + (r.jar_used ?? 0),
        emoji: r.emoji,
        category: isRewardCategory(r.category) ? r.category : null,
        imageUrl: r.image_url
      })),
      buys: this.buys(undone),
      today: day,
      economy: this.economy?.getEconomySummary(now),
      rules: this.rules(),
      guards: this.guards(day, undone, all),
      coupons: openCoupons(this.coupons(), day, new Set(liveRows.map((e) => e.id)))
    }
  }

  // ---------- Healthy limits (a most-per-day, "pair it") ----------

  rules(): Record<string, RewardRules> {
    return cleanRules(this.json(REWARD_RULES))
  }

  setRules(rewardId: number, r: RewardRules | null): void {
    this.reward(rewardId)
    setSetting(this.db, REWARD_RULES, JSON.stringify(setRules(this.rules(), rewardId, r)))
  }

  /** Why each reward with rules can't be bought now (null = fine), from today's logged rows. */
  private guards(day: string, undone: Set<number>, all = this.wallet.entries()): Record<number, string | null> {
    const rules = this.rules()
    const ids = Object.keys(rules)
    if (!ids.length) return {}
    const did = todayDeeds(all, day)
    const buys = this.buys(undone)
    return Object.fromEntries(ids.map((id) => [Number(id), guardBlocker(rules[id], (buys[Number(id)] ?? []).filter((d) => d === day).length, did)]))
  }

  private json(key: string): any {
    try {
      return JSON.parse(getSetting(this.db, key) || 'null')
    } catch {
      return null
    }
  }

  // ---------- Coupons (chests and the weekly mystery reward) ----------

  /** Every coupon (used and expired ones too, the last 40). */
  coupons(): Coupon[] {
    return cleanCoupons(this.json(REWARD_COUPONS))
  }

  private saveCoupons(list: Coupon[]): void {
    setSetting(this.db, REWARD_COUPONS, JSON.stringify(cleanCoupons(list)))
  }

  private addCoupon(c: Coupon): void {
    this.saveCoupons([...this.coupons(), c])
  }

  /** The weekly mystery reward: open once all of this week's top 3 are done. */
  mystery(plan: { week: string; big3: { done: boolean }[] } | null, now = new Date()): MysteryState {
    return mysteryState(plan, mondayOf(dayKey(now, this.timeZone)), this.coupons())
  }

  /** Opens the mystery reward: a coupon (a free small treat from your list, or 30% off). Never points. */
  claimMystery(plan: { week: string; big3: { done: boolean }[] } | null, now = new Date()): ChestPrize {
    return this.db.transaction(() => {
      const m = this.mystery(plan, now)
      if (m.claimed) throw new LedgerError('Already opened this week')
      if (!m.ready) throw new LedgerError(m.total >= 3 ? `Finish your top 3 first (${m.done} of ${m.total} done)` : 'Pick your top 3 for the week first')
      const day = dayKey(now, this.timeZone)
      const prize = rollMystery(this.rand(), this.rand(), smallTreats(this.rewards()))
      this.addCoupon(prizeCoupon(prize, `mystery:${m.week}`, day, `m${m.week}`)!)
      return prize
    })()
  }

  // ---------- Suggestions ----------

  hiddenSuggestions(): string[] {
    const v = this.json(SUGGEST_HIDDEN)
    return Array.isArray(v) ? v.map(String).slice(-200) : []
  }

  hideSuggestion(key: string): void {
    setSetting(this.db, SUGGEST_HIDDEN, JSON.stringify([...new Set([...this.hiddenSuggestions(), String(key).slice(0, 40)])].slice(-200)))
  }

  /** "Add to my rewards": the starter reward, with its healthy limits and its "unlock by doing" lock. Returns the new id. */
  addStarter(key: string): number {
    const st = starterByKey(key)
    if (!st) throw new LedgerError('That suggestion is gone')
    return this.db.transaction(() => {
      this.save(starterReward(st))
      const id = (this.db.prepare('SELECT MAX(id) AS id FROM rewards').get() as { id: number }).id
      if (st.rules) this.setRules(id, st.rules)
      if (st.unlock) setSetting(this.db, REWARD_UNLOCKS, JSON.stringify(setUnlock(cleanUnlocks(this.json(REWARD_UNLOCKS)), id, st.unlock)))
      return id
    })()
  }

  /**
   * Adds or edits a reward. On an edit, fields the caller leaves out keep
   * their saved value (FX4: editing never wipes the photo, link, currency or
   * tier). Only one reward is pinned (the goal shown on Today).
   */
  save(input: RewardInput): void {
    const cur = input.id ? this.reward(input.id) : null
    const keep = <K extends keyof Reward>(k: K, fallback: Reward[K]): Reward[K] => (input[k as keyof RewardInput] !== undefined ? (input[k as keyof RewardInput] as Reward[K]) : cur ? cur[k] : fallback)
    const str = (v: string | null | undefined) => (typeof v === 'string' ? v.trim() || null : null)
    const r: Omit<Reward, 'id'> = {
      title: (input.title ?? cur?.title ?? '').trim(),
      price: keep('price', 0),
      tier: keep('tier', 'bronze'),
      realCost: keep('realCost', 0),
      pinned: keep('pinned', false),
      archived: false,
      note: str(keep('note', null)),
      imageUrl: str(keep('imageUrl', null)),
      productUrl: str(keep('productUrl', null)),
      currency: str(keep('currency', 'MDL'))?.toUpperCase() || 'MDL',
      emoji: str(keep('emoji', null))?.slice(0, 16) ?? null,
      category: keep('category', null) || null,
      cooldownDays: keep('cooldownDays', 0) ?? 0,
      monthLimit: keep('monthLimit', 0) ?? 0,
      oneTime: !!keep('oneTime', false),
      bundle: keep('bundle', null),
      priceLocked: keep('priceLocked', true) !== false
    }
    validateReward(r)
    this.db.transaction(() => {
      if (r.pinned) this.db.prepare('UPDATE rewards SET pinned = 0, goal_rank = CASE WHEN goal_rank = 1 THEN 0 ELSE goal_rank END').run()
      const params = {
        title: r.title,
        price: r.price,
        tier: r.tier,
        realCost: r.realCost,
        pinned: r.pinned ? 1 : 0,
        note: r.note,
        imageUrl: r.imageUrl,
        productUrl: r.productUrl,
        currency: r.currency,
        emoji: r.emoji,
        category: r.category,
        cooldown: r.cooldownDays ?? 0,
        monthLimit: r.monthLimit ?? 0,
        oneTime: r.oneTime ? 1 : 0,
        bundle: r.bundle?.length ? JSON.stringify(r.bundle) : null,
        priceLocked: r.priceLocked ? 1 : 0
      }
      const cols = 'title = @title, price = @price, tier = @tier, real_cost = @realCost, pinned = @pinned, note = @note, image_url = @imageUrl, product_url = @productUrl, currency = @currency, emoji = @emoji, category = @category, cooldown_days = @cooldown, month_limit = @monthLimit, one_time = @oneTime, bundle = @bundle, price_locked = @priceLocked'
      if (input.id) {
        this.db.prepare(`UPDATE rewards SET ${cols}${r.pinned ? ', goal_rank = 1' : ''} WHERE id = @id`).run({ ...params, id: input.id })
        if (cur?.jarGoalId) this.db.prepare('UPDATE wishlist_goals SET title = ?, target_coins = ? WHERE id = ?').run(r.title, r.price, cur.jarGoalId)
      } else {
        const sort = (this.db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM rewards').get() as { n: number }).n
        this.db
          .prepare(
            'INSERT INTO rewards (title, price, tier, real_cost, pinned, note, image_url, product_url, currency, emoji, category, cooldown_days, month_limit, one_time, bundle, price_locked, sort, goal_rank) VALUES (@title, @price, @tier, @realCost, @pinned, @note, @imageUrl, @productUrl, @currency, @emoji, @category, @cooldown, @monthLimit, @oneTime, @bundle, @priceLocked, @sort, @goalRank)'
          )
          .run({ ...params, sort, goalRank: r.pinned ? 1 : 0 })
      }
    })()
  }

  archive(id: number): void {
    this.reward(id)
    this.db.prepare('UPDATE rewards SET archived = 1, pinned = 0, goal_rank = 0 WHERE id = ?').run(id)
  }

  /** Puts a removed reward back (the 5-second undo after Remove). */
  restore(id: number): void {
    this.reward(id)
    this.db.prepare('UPDATE rewards SET archived = 0 WHERE id = ?').run(id)
  }

  /** Your "saving for" goals, in order (RF3): up to 3; the first shows on Today. */
  setGoals(ids: number[]): void {
    const list = [...new Set(ids)].slice(0, 3)
    this.db.transaction(() => {
      for (const id of list) this.reward(id)
      this.db.prepare('UPDATE rewards SET goal_rank = 0, pinned = 0').run()
      list.forEach((id, i) => this.db.prepare('UPDATE rewards SET goal_rank = ?, pinned = ? WHERE id = ?').run(i + 1, i === 0 ? 1 : 0, id))
    })()
  }

  /** Your own order of the rewards (drag to reorder). */
  reorder(ids: number[]): void {
    this.db.transaction(() => {
      ids.forEach((id, i) => this.db.prepare('UPDATE rewards SET sort = ? WHERE id = ?').run(i + 1, id))
    })()
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
   * `paid`: real money you really paid (the reward's currency). Default 0: a buy
   * with points is not real spending (the reward's real cost is only its price guide).
   * `force`: buy even though the fun budget is empty (the explicit second tap).
   */
  redeem(id: number, now = new Date(), opts: { paid?: number; force?: boolean; finance?: any; noCoupon?: boolean } = {}): number {
    return this.db.transaction(() => {
      this.migrateFunBudget()
      const listed = this.reward(id)
      const all = this.wallet.entries()
      const day = dayKey(now, this.timeZone)
      const undone = this.undoneIds()
      const guard = this.guards(day, undone, all)[id]
      if (guard) throw new LedgerError(guard)
      // A coupon (a chest or the mystery reward) makes it cheaper or free; it never adds points.
      const live = new Set(this.wallet.effective().map((e) => e.id))
      const deal = opts.noCoupon ? { coupon: null, price: listed.price } : couponFor(listed, openCoupons(this.coupons(), day, live))
      const reward = { ...listed, price: deal.price }
      planRedeem({
        reward,
        balance: balance(all),
        level: levelInfo(totalXp(all)).level,
        monthSpent: this.monthSpent(day, undone),
        budget: this.budget(),
        buys: this.buys(undone)[id] ?? [],
        today: day
      })
      const paid = opts.paid != null && Number.isFinite(Number(opts.paid)) ? Math.max(0, Math.round(Number(opts.paid))) : 0
      if (!opts.force) {
        const why = this.funBlocker(id, paid, opts.finance, now)
        if (why) throw new LedgerError(`FUN_EMPTY: ${why}`)
      }
      // Points already in its jar pay first; the wallet pays the rest.
      const fromJar = Math.min(reward.jar ?? 0, reward.price)
      const ledgerId = this.wallet.append({ ts: now.toISOString(), day, module: 'shop', kind: 'spend', coins: -(reward.price - fromJar), xp: 0, ref: `reward:${id}`, note: deal.coupon ? `${reward.title} (coupon: ${deal.coupon.kind === 'free' ? 'free' : `${deal.coupon.pct}% off`})` : reward.title })
      if (deal.coupon) this.saveCoupons(this.coupons().map((c) => (c.id === deal.coupon!.id ? { ...c, usedBy: ledgerId } : c)))
      this.db.prepare('INSERT INTO redemptions (ledger_id, reward_id, title, real_cost, day, jar_used) VALUES (?, ?, ?, ?, ?, ?)').run(ledgerId, id, reward.title, paid, day, fromJar)
      if (fromJar && reward.jarGoalId) this.db.prepare('UPDATE wishlist_goals SET allocated_coins = allocated_coins - ?, completed = 0, completed_at = NULL WHERE id = ?').run(fromJar, reward.jarGoalId)
      // Bought once and gone (RF2).
      if (reward.oneTime) this.db.prepare('UPDATE rewards SET archived = 1, pinned = 0, goal_rank = 0 WHERE id = ?').run(id)
      return ledgerId
    }).immediate()
  }

  /**
   * "Undo buy" in History (RF5): the points come back through the ledger's
   * undo (an honest new row), the jar gets its points back, and a one-time
   * reward comes back to the page.
   */
  undoBuy(ledgerId: number, now = new Date()): void {
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT reward_id, jar_used FROM redemptions WHERE ledger_id = ?').get(ledgerId) as { reward_id: number; jar_used: number | null } | undefined
      if (!row) throw new LedgerError('That buy was not found')
      this.wallet.undo(ledgerId, 'Undo buy', now)
      const r = this.db.prepare('SELECT one_time, jar_goal_id FROM rewards WHERE id = ?').get(row.reward_id) as { one_time: number; jar_goal_id: number | null } | undefined
      if (r?.one_time) this.db.prepare('UPDATE rewards SET archived = 0 WHERE id = ?').run(row.reward_id)
      if (row.jar_used && r?.jar_goal_id) this.db.prepare('UPDATE wishlist_goals SET allocated_coins = allocated_coins + ? WHERE id = ?').run(row.jar_used, r.jar_goal_id)
    })()
  }

  /**
   * Sets points aside in a reward's savings jar (RF4). The jar is a wishlist
   * goal, filled by the economy's depositCoinsToGoal (a ledger row with a
   * `goal:` ref, so it is neither earning nor spending, and can't be undone
   * by accident: take points back out with jarTake).
   */
  jarAdd(rewardId: number, amount: number, eco: UnifiedEconomyService, now = new Date()): void {
    const r = this.reward(rewardId)
    const n = Math.floor(amount)
    if (!(n > 0)) throw new LedgerError('Put at least 1 point in the jar')
    if ((r.jar ?? 0) + n > r.price) throw new LedgerError(`The jar only needs ${r.price - (r.jar ?? 0)} more`)
    let goalId = r.jarGoalId
    if (!goalId || !this.db.prepare('SELECT 1 FROM wishlist_goals WHERE id = ?').get(goalId)) {
      goalId = eco.saveGoal({ title: r.title, targetCoins: r.price, targetRealCost: 0, category: 'gear', note: 'Savings jar for a reward' }).id
      this.db.prepare('UPDATE rewards SET jar_goal_id = ? WHERE id = ?').run(goalId, rewardId)
    }
    this.db.prepare('UPDATE wishlist_goals SET completed = 0, completed_at = NULL, target_coins = ? WHERE id = ?').run(r.price, goalId)
    eco.depositCoinsToGoal(goalId, n, now)
  }

  /** Takes points back out of a jar into your balance (not earning: an `adjust` row). */
  jarTake(rewardId: number, amount: number, now = new Date()): void {
    this.db.transaction(() => {
      const r = this.reward(rewardId)
      const n = Math.min(Math.floor(amount), r.jar ?? 0)
      if (!(n > 0) || !r.jarGoalId) throw new LedgerError('The jar is empty')
      this.wallet.append({ ts: now.toISOString(), day: dayKey(now, this.timeZone), module: 'shop', kind: 'adjust', coins: n, xp: 0, ref: `goal:${r.jarGoalId}:back`, note: `Out of the jar: ${r.title}` })
      this.db.prepare('UPDATE wishlist_goals SET allocated_coins = allocated_coins - ?, completed = 0, completed_at = NULL WHERE id = ?').run(n, r.jarGoalId)
    })()
  }

  /** Opens a level chest: its coins (0 when the prize is a coupon). */
  openChest(level: number, now = new Date()): number {
    const p = this.openChestPrize(level, now)
    return p.kind === 'coins' ? p.coins : 0
  }

  /**
   * A level chest (one per level reached through real XP): the small coin
   * bonus chests always gave, or a coupon for a free small treat from your
   * own list or 25% off one reward. The chest's ledger row marks it opened.
   */
  openChestPrize(level: number, now = new Date()): ChestPrize {
    return this.db.transaction(() => {
      const s = this.state(now)
      if (!s.chests.includes(level)) throw new LedgerError('No chest waiting for that level')
      const day = dayKey(now, this.timeZone)
      const prize = rollChestPrize(level, this.rand(), this.rand(), smallTreats(s.rewards))
      const coins = prize.kind === 'coins' ? prize.coins : 0
      const note = prize.kind === 'coins' ? `Level ${level} chest` : `Level ${level} chest: ${prize.kind === 'free' ? `free ${prize.title}` : `${prize.pct}% off a reward`}`
      const ledgerId = this.wallet.append({ ts: now.toISOString(), day, module: 'shop', kind: 'earn', coins, xp: 0, ref: chestRef(level), note })
      const c = prizeCoupon(prize, chestRef(level), day, `c${ledgerId}`)
      if (c) this.addCoupon(c)
      return prize
    }).immediate()
  }

  /** Days with a paid focus session (the flame and the streak bonus). */
  private focusDays(live: LedgerEntry[]): string[] {
    return [...new Set(live.filter((e) => e.ruleId === 'focus.session' && e.coins > 0).map((e) => e.day))]
  }

  insights(now = new Date()): RewardsInsights {
    const all = this.wallet.entries()
    const live = effective(all)
    const today = dayKey(now, this.timeZone)
    const week = mondayOf(today)
    const lastWeek = all.filter((e) => e.day >= addDays(week, -7) && e.day < week)
    const days = this.focusDays(live)
    const streak = dayStreak(days, today)
    const liveIds = new Set(live.map((e) => e.id))
    const bought = (this.db.prepare('SELECT ledger_id FROM redemptions').all() as { ledger_id: number }[]).filter((r) => liveIds.has(r.ledger_id)).length
    return {
      today,
      earnings: earnings(all, today),
      focusStreak: streak,
      flame: flameLevel(streak),
      challenge: challengeState(pickChallenge(lastWeek), week, all, today),
      badges: badges(badgeStats(all, bought, days)),
      readySeen: readSetting(this.db, 'reward_ready_seen')
    }
  }

  /** Pays the weekly challenge bonus once (RG5), only when real logged actions reached the goal. */
  claimChallenge(now = new Date()): number {
    return this.db.transaction(() => {
      const c = this.insights(now).challenge
      if (!c.done) throw new LedgerError(`Not done yet: ${c.progress} of ${c.goal}`)
      if (!payOnce(this.wallet, challengeRef(c.week), c.bonus, `Weekly challenge: ${c.title}`, now)) throw new LedgerError('Already paid this week')
      return c.bonus
    })()
  }

  /** Remembers the "Ready!" moments already shown (RW6). */
  markReady(keys: string[]): void {
    const cur = readSetting(this.db, 'reward_ready_seen')
    const next = [...new Set([...cur, ...keys.map(String)])].slice(-200)
    writeSetting(this.db, 'reward_ready_seen', next)
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
