import { describe, expect, it } from 'vitest'
import { calculateEffortEquivalence, chestRef, planRedeem, redeemBlocker, rollChest, tierUnlocked, unopenedChests, validateReward, type Reward } from './shop'

const cream: Reward = { id: 1, title: 'Face cream', price: 300, tier: 'bronze', realCost: 30, pinned: false, archived: false, note: null }
const base = { reward: cream, balance: 500, level: 3, monthSpent: 0, budget: 0 }

describe('shop', () => {
  it('unlocks tiers by level', () => {
    expect(tierUnlocked('bronze', 1)).toBe(true)
    expect(tierUnlocked('silver', 4)).toBe(false)
    expect(tierUnlocked('silver', 5)).toBe(true)
    expect(tierUnlocked('legendary', 19)).toBe(false)
  })

  it('allows a redeem that fits coins, level and budget', () => {
    expect(redeemBlocker(base)).toBeNull()
    expect(() => planRedeem(base)).not.toThrow()
  })

  it('explains why a redeem is blocked', () => {
    expect(redeemBlocker({ ...base, balance: 120 })).toBe('You need 180 more points')
    expect(redeemBlocker({ ...base, reward: { ...cream, tier: 'gold' } })).toBeNull() // no level locks any more
    expect(redeemBlocker({ ...base, budget: 50, monthSpent: 30 })).toMatch(/budget \(20 left\)/)
    expect(redeemBlocker({ ...base, budget: 70, monthSpent: 30 })).toBeNull()
    expect(redeemBlocker({ ...base, reward: { ...cream, archived: true } })).toMatch(/archived/)
    expect(() => planRedeem({ ...base, balance: 0 })).toThrow('more points')
  })

  it('validates rewards', () => {
    expect(() => validateReward({ ...cream, title: ' ' })).toThrow('name')
    expect(() => validateReward({ ...cream, price: 0 })).toThrow('Price')
    expect(() => validateReward({ ...cream, realCost: -1 })).toThrow('Real cost')
    expect(() => validateReward({ ...cream, tier: 'mythic' as never })).toThrow('tier')
  })

  it('gives one chest per level reached, from level 2', () => {
    expect(unopenedChests(1, [])).toEqual([])
    expect(unopenedChests(4, [chestRef(3)])).toEqual([2, 4])
  })

  it('rolls bigger chests at higher levels', () => {
    expect(rollChest(2, 0)).toBe(14)
    expect(rollChest(2, 1)).toBe(50)
    expect(rollChest(10, 0)).toBeGreaterThan(rollChest(2, 0))
  })

  it('calculates real-life effort equivalence accurately', () => {
    const eq = calculateEffortEquivalence(300)
    expect(eq.coins).toBe(300)
    expect(eq.workouts).toBe(30)
    expect(eq.studyBlocks).toBe(20)
    expect(eq.cleanDays).toBe(15)
    expect(eq.summaryText).toContain('15 clean days')
    expect(eq.summaryText).toContain('30 workouts')
  })
})

import { earnPerDay, priceInDays } from './shop'
describe('reward price in days (M3)', () => {
  it('your usual day of points, and the price in days', () => {
    const e = ['2026-11-01', '2026-11-02', '2026-11-03'].map((day) => ({ day, kind: 'earn', coins: 40 }))
    expect(earnPerDay([...e, { day: '2026-11-03', kind: 'spend', coins: -100 }], '2026-11-05')).toBe(40)
    expect(earnPerDay(e.slice(0, 2), '2026-11-05')).toBe(0) // too little history
    expect(priceInDays(120, 40)).toBe('about 3 days')
    expect(priceInDays(20, 40)).toBe('less than a day')
    expect(priceInDays(120, 0)).toBeNull()
  })
})
