import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { xpToNext } from '@core/levels'
import { openDb, type DB } from './db'
import { Wallet } from './wallet'
import { Shop } from './shop'
import { FocusService } from './focus'
import { UnifiedEconomyService } from './unifiedEconomy'

let dir: string
let db: DB
let wallet: Wallet
let shop: Shop

/** Gives coins (and XP) without going through rule limits. */
function grant(coins: number, xp = 0, now = new Date('2026-10-25T10:00:00Z')) {
  db.transaction(() => wallet.append({ ts: now.toISOString(), day: '2026-10-25', module: 'test', kind: 'earn', coins, xp }))()
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'life-shop-'))
  db = openDb(join(dir, 'life.db'))
  wallet = new Wallet(db, 'UTC')
  shop = new Shop(db, wallet, 'UTC', () => 0.5)
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const now = new Date('2026-10-25T12:00:00Z')
const cream = () => shop.state(now).rewards.find((r) => r.title === 'Face cream')!

describe('shop service', () => {
  it('seeds starter rewards with one pinned target', () => {
    const s = shop.state(now)
    expect(s.rewards.map((r) => r.title)).toContain('Kaaba trip fund')
    expect(s.rewards.filter((r) => r.pinned)).toHaveLength(1)
    expect(s.currency).toBe('MDL')
  })

  it('redeems, records real cost and refunds on undo', () => {
    grant(400)
    const ledgerId = shop.redeem(cream().id, now)
    let s = shop.state(now)
    expect(s.balance).toBe(100)
    expect(s.monthSpent).toBe(30)
    expect(s.recent[0]).toMatchObject({ title: 'Face cream', undone: false })
    expect(() => shop.redeem(cream().id, now)).toThrow('200 more points')

    wallet.undo(ledgerId, 'bought by mistake', now)
    s = shop.state(now)
    expect(s.balance).toBe(400)
    expect(s.monthSpent).toBe(0)
    expect(s.recent[0].undone).toBe(true)
  })

  it('the old reward budget became the fun budget: it warns, "buy anyway" still works (RL3)', () => {
    grant(2000)
    db.prepare("INSERT INTO settings (key, value) VALUES ('reward_budget', '50') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run()
    expect(shop.value({}, now).funBudgetLei).toBe(50)
    shop.redeem(cream().id, now)
    // Moved once: the old key is cleared.
    expect(db.prepare("SELECT value FROM settings WHERE key = 'fun_budget'").get()).toMatchObject({ value: '{"lei":50,"source":"manual"}' })
    expect(shop.value({}, now)).toMatchObject({ funSpentLei: 30, funLeftLei: 20 })
    expect(() => shop.redeem(cream().id, now)).toThrow(/FUN_EMPTY: Face cream costs 30 lei and only 20 lei is left/)
    expect(() => shop.redeem(cream().id, now, { force: true })).not.toThrow()
    // A new month starts fresh
    expect(() => shop.redeem(cream().id, new Date('2026-11-02T12:00:00Z'))).not.toThrow()
    expect(() => shop.setBudget(-1)).toThrow()
  })

  it('records what you actually paid, in the reward currency (RL4)', () => {
    grant(2000)
    shop.setFunBudget({ lei: 1000, source: 'manual' })
    shop.redeem(cream().id, now, { paid: 45 })
    expect(shop.state(now).recent[0].realCost).toBe(45)
    shop.save({ title: 'Game', price: 300, tier: 'bronze', realCost: 10, currency: 'USD', pinned: false, note: null })
    const game = shop.state(now).rewards.find((r) => r.title === 'Game')!
    shop.redeem(game.id, now, { finance: { rates: { usd: { USD: 1, MDL: 18 } } } })
    expect(shop.value({ finance: { rates: { usd: { USD: 1, MDL: 18 } } } }, now).funSpentLei).toBe(45 + 180)
  })

  it('tells what a point is worth (RL1)', () => {
    const v = shop.value({ hourlyLei: 62.5 }, now)
    expect(v).toMatchObject({ funBudgetLei: null, funSpentLei: 0, funLeftLei: null, hourlyLei: 62.5 })
    expect(v.value.source).toBe('default')
    for (const day of ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']) db.transaction(() => wallet.append({ ts: `${day}T10:00:00Z`, day, module: 'test', kind: 'earn', coins: 100, xp: 0 }))()
    shop.setFunBudget({ lei: 600, source: 'manual' })
    expect(shop.value({}, now).value).toMatchObject({ source: 'budget', leiPerPoint: 0.2 })
  })

  it('has no level locks: any reward you can afford is yours', () => {
    grant(5000)
    const shaver = shop.state(now).rewards.find((r) => r.tier === 'silver')!
    expect(() => shop.redeem(shaver.id, now)).not.toThrow()
  })

  it('adds, edits, pins and archives rewards', () => {
    shop.save({ title: 'Kebab night', price: 150, tier: 'bronze', realCost: 120, pinned: true, note: null })
    let s = shop.state(now)
    const kebab = s.rewards.find((r) => r.title === 'Kebab night')!
    expect(s.rewards.filter((r) => r.pinned).map((r) => r.id)).toEqual([kebab.id])
    shop.save({ ...kebab, price: 180 })
    expect(shop.state(now).rewards.find((r) => r.id === kebab.id)!.price).toBe(180)
    shop.archive(kebab.id)
    s = shop.state(now)
    expect(s.rewards.some((r) => r.id === kebab.id)).toBe(false)
    expect(() => shop.save({ title: '', price: 1, tier: 'bronze', realCost: 0, pinned: false, note: null })).toThrow('name')
  })

  it('opens one chest per level, and the prize is final', () => {
    expect(shop.state(now).chests).toEqual([])
    grant(0, xpToNext(1) + xpToNext(2)) // reach level 3
    expect(shop.state(now).chests).toEqual([2, 3])
    const coins = shop.openChest(2, now)
    expect(coins).toBe(rollMid(2))
    expect(shop.state(now).chests).toEqual([3])
    expect(() => shop.openChest(2, now)).toThrow('No chest')
    const chestEntry = wallet.history(1)[0]
    expect(() => wallet.undo(chestEntry.id, 'reroll please', now)).toThrow('final')
  })

  it('saves image_url and currency on rewards and switches active currency', () => {
    shop.save({
      title: 'AirPods Pro',
      price: 2000,
      tier: 'silver',
      realCost: 200,
      currency: 'USD',
      imageUrl: 'https://example.com/airpods.jpg',
      productUrl: 'https://shop.example.com/earbuds',
      pinned: false,
      note: 'Spatial audio'
    })
    const s = shop.state(now)
    const airpods = s.rewards.find((r) => r.title === 'AirPods Pro')!
    expect(airpods.imageUrl).toBe('https://example.com/airpods.jpg')
    expect(airpods.productUrl).toBe('https://shop.example.com/earbuds')
    expect(airpods.currency).toBe('USD')

    shop.setCurrency('USD')
    expect(shop.state(now).currency).toBe('USD')
  })
})

describe('rewards page (Night 11)', () => {
  const add = (p: Record<string, unknown> = {}) => {
    shop.save({ title: 'Game night', price: 100, tier: 'bronze', realCost: 0, pinned: false, note: null, ...p } as any)
    return shop.state(now).rewards.find((r) => r.title === (p.title ?? 'Game night'))!
  }

  it('FX4: editing keeps the photo, link, currency and tier', () => {
    shop.save({ title: 'Camera', price: 900, tier: 'gold', realCost: 90, currency: 'EUR', imageUrl: 'https://example.com/cam.jpg', productUrl: 'https://example.com/cam', pinned: false, note: 'black', emoji: '📷', category: 'gear' })
    const cam = shop.state(now).rewards.find((r) => r.title === 'Camera')!
    // The page sends only what its form edits
    shop.save({ id: cam.id, title: 'Camera 2', price: 950 } as any)
    const after = shop.state(now).rewards.find((r) => r.id === cam.id)!
    expect(after).toMatchObject({ title: 'Camera 2', price: 950, tier: 'gold', realCost: 90, currency: 'EUR', imageUrl: 'https://example.com/cam.jpg', productUrl: 'https://example.com/cam', note: 'black', emoji: '📷', category: 'gear' })
    // Clearing on purpose still works
    shop.save({ id: cam.id, title: 'Camera 2', imageUrl: null } as any)
    expect(shop.state(now).rewards.find((r) => r.id === cam.id)!.imageUrl).toBeNull()
  })

  it('pinning one save clears the other pin', () => {
    const a = add({ title: 'A' })
    const b = add({ title: 'B' })
    shop.save({ id: a.id, title: 'A', pinned: true } as any)
    shop.save({ id: b.id, title: 'B', pinned: true } as any)
    const pins = shop.state(now).rewards.filter((r) => r.pinned)
    expect(pins.map((r) => r.id)).toEqual([b.id])
  })

  it('keeps up to 3 goals in order; the first is the pinned one', () => {
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((t) => add({ title: t }))
    shop.setGoals([c.id, a.id, b.id, d.id])
    const s = shop.state(now).rewards
    const rank = (id: number) => s.find((r) => r.id === id)!.goalRank
    expect([rank(c.id), rank(a.id), rank(b.id), rank(d.id)]).toEqual([1, 2, 3, 0])
    expect(s.filter((r) => r.pinned).map((r) => r.id)).toEqual([c.id])
  })

  it('reorders by your own order', () => {
    const [a, b] = ['A', 'B'].map((t) => add({ title: t, price: 50 }))
    const ids = shop.state(now).rewards.map((r) => r.id)
    shop.reorder([b.id, a.id, ...ids.filter((x) => x !== a.id && x !== b.id)])
    expect(shop.state(now).rewards.slice(0, 2).map((r) => r.id)).toEqual([b.id, a.id])
  })

  it('enforces cooldowns, archives one-time rewards, and undo buy brings both back', () => {
    grant(1000)
    const pizza = add({ title: 'Pizza', price: 100, cooldownDays: 3 })
    shop.redeem(pizza.id, now)
    expect(() => shop.redeem(pizza.id, now)).toThrow('again in 3 days')
    expect(() => shop.redeem(pizza.id, new Date('2026-10-28T12:00:00Z'))).not.toThrow()

    const watch = add({ title: 'Watch', price: 200, oneTime: true })
    const ledgerId = shop.redeem(watch.id, now)
    expect(shop.state(now).rewards.some((r) => r.id === watch.id)).toBe(false)
    const before = shop.state(now).balance
    shop.undoBuy(ledgerId, now)
    const s = shop.state(now)
    expect(s.balance).toBe(before + 200)
    expect(s.rewards.some((r) => r.id === watch.id)).toBe(true)
    expect(s.recent.find((r) => r.ledgerId === ledgerId)!.undone).toBe(true)
  })

  it('savings jar: points set aside count toward the price and are not earnings', () => {
    grant(300)
    const eco = new UnifiedEconomyService(db, wallet, {} as any, {} as any, {} as any)
    const trip = add({ title: 'Trip', price: 500 })
    shop.jarAdd(trip.id, 200, eco, now)
    let s = shop.state(now)
    expect(s.balance).toBe(100)
    expect(s.rewards.find((r) => r.id === trip.id)!.jar).toBe(200)
    shop.jarTake(trip.id, 50, now)
    s = shop.state(now)
    expect(s.balance).toBe(150)
    expect(s.rewards.find((r) => r.id === trip.id)!.jar).toBe(150)
    expect(shop.insights(now).earnings.earned).toBe(300)
    grant(200)
    // 350 in the wallet + 150 in the jar = 500
    const id = shop.redeem(trip.id, now)
    s = shop.state(now)
    expect(s.balance).toBe(0)
    expect(s.rewards.find((r) => r.id === trip.id)!.jar).toBe(0)
    shop.undoBuy(id, now)
    s = shop.state(now)
    expect(s.balance).toBe(350)
    expect(s.rewards.find((r) => r.id === trip.id)!.jar).toBe(150)
  })

  it('weekly challenge pays once, only for real logged actions', () => {
    expect(() => shop.claimChallenge(now)).toThrow('Not done yet')
    const c = shop.insights(now).challenge
    for (let i = 0; i < c.goal; i++) {
      db.transaction(() => wallet.append({ ts: now.toISOString(), day: '2026-10-25', module: c.area === 'tasks' ? 'tasks' : c.area === 'mustdo' ? 'plan' : c.area === 'focus' ? 'focus' : 'sleep', kind: 'earn', coins: 5, xp: 0, ruleId: { focus: 'focus.session', mustdo: 'plan.item_done', tasks: 'tasks.todoist_done', habits: 'sleep.up_on_time' }[c.area], ref: `t:${i}` }))()
    }
    const sunday = new Date('2026-10-25T12:00:00Z')
    expect(shop.claimChallenge(sunday)).toBe(40)
    expect(() => shop.claimChallenge(sunday)).toThrow('Already paid')
  })

  it('remembers "Ready!" moments', () => {
    shop.markReady(['3:0', '3:0', '4:1'])
    expect(shop.insights(now).readySeen).toEqual(['3:0', '4:1'])
  })
})

describe('honest extras on real actions', () => {
  it('a lucky gift comes with a finished must-do, is capped, and goes when the must-do is undone', () => {
    const focus = new FocusService(db, wallet, () => 0)
    focus.setPlan(['Read', 'Write', 'Run'], now)
    const r1 = focus.togglePlan(0, now)
    expect(r1.coins).toBe(15) // 10 + lucky 5
    focus.togglePlan(1, now)
    const r3 = focus.togglePlan(2, now)
    expect(r3.coins).toBe(10) // daily cap of 2 lucky gifts
    const must = wallet.entries().find((e) => e.ruleId === 'plan.item_done')!
    const bal = wallet.summary(now).balance
    wallet.undo(must.id, 'not done', now)
    expect(wallet.summary(now).balance).toBe(bal - 15)
  })

  it('a 7-day focus streak adds +10% to a real session', () => {
    const focus = new FocusService(db, wallet, () => 1)
    for (let d = 6; d >= 1; d--) {
      const day = new Date(now.getTime() - d * 864e5)
      db.transaction(() => wallet.append({ ts: day.toISOString(), day: day.toISOString().slice(0, 10), module: 'focus', kind: 'earn', coins: 15, xp: 50, ruleId: 'focus.session', ref: `f:${d}` }))()
    }
    focus.add('Math', 50, undefined, now) // a session without the timer pays nothing: no bonus either
    expect(wallet.entries().some((e) => e.ref?.endsWith(':streak'))).toBe(false)
    focus.start('Math', 50, now)
    focus.stop(new Date(now.getTime() + 50 * 60000))
    const bonus = wallet.entries().find((e) => e.ref?.endsWith(':streak'))!
    expect(bonus.coins).toBe(2)
  })
})

function rollMid(level: number) {
  return Math.round(10 + level * 2 + 0.5 * (40 + level * 5 - (10 + level * 2)))
}
