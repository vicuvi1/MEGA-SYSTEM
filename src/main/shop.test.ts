import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { xpToNext } from '@core/levels'
import { openDb, type DB } from './db'
import { Wallet } from './wallet'
import { Shop } from './shop'

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
    expect(() => shop.redeem(cream().id, now)).toThrow('200 more coins')

    wallet.undo(ledgerId, 'bought by mistake', now)
    s = shop.state(now)
    expect(s.balance).toBe(400)
    expect(s.monthSpent).toBe(0)
    expect(s.recent[0].undone).toBe(true)
  })

  it('enforces the monthly real-money budget', () => {
    grant(2000)
    shop.setBudget(50)
    shop.redeem(cream().id, now)
    expect(() => shop.redeem(cream().id, now)).toThrow(/budget \(20 left\)/)
    // A new month starts fresh
    expect(() => shop.redeem(cream().id, new Date('2026-11-02T12:00:00Z'))).not.toThrow()
    expect(() => shop.setBudget(-1)).toThrow()
  })

  it('locks higher tiers until the level is reached', () => {
    grant(5000)
    const shaver = shop.state(now).rewards.find((r) => r.tier === 'silver')!
    expect(() => shop.redeem(shaver.id, now)).toThrow('level 5')
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
      productUrl: 'https://darwin.md/apple-airpods-pro-2',
      pinned: false,
      note: 'Spatial audio'
    })
    const s = shop.state(now)
    const airpods = s.rewards.find((r) => r.title === 'AirPods Pro')!
    expect(airpods.imageUrl).toBe('https://example.com/airpods.jpg')
    expect(airpods.productUrl).toBe('https://darwin.md/apple-airpods-pro-2')
    expect(airpods.currency).toBe('USD')

    shop.setCurrency('USD')
    expect(shop.state(now).currency).toBe('USD')
  })
})

function rollMid(level: number) {
  return Math.round(10 + level * 2 + 0.5 * (40 + level * 5 - (10 + level * 2)))
}
