import { describe, expect, it } from 'vitest'
import { rollChest } from './shop'
import { cleanCoupons, couponFor, couponText, mysteryState, openCoupons, prizeCoupon, rollChestPrize, rollMystery, smallTreats, type Coupon } from './rewardSurprise'

const treats = [
  { id: 4, title: 'Bubble tea' },
  { id: 9, title: '30 min of gaming' }
]
const free = (over: Partial<Coupon> = {}): Coupon => ({ id: 'a', kind: 'free', rewardId: 4, title: 'Bubble tea', from: 'chest:L3', made: '2026-11-01', expires: '2026-11-15', usedBy: null, ...over })

describe('chest prizes', () => {
  it('are coins, a free treat from your list or a discount', () => {
    expect(rollChestPrize(3, 0.1, 0.9, treats)).toEqual({ kind: 'free', rewardId: 9, title: '30 min of gaming' })
    expect(rollChestPrize(3, 0.1, 0.9, [])).toEqual({ kind: 'off', pct: 25 })
    expect(rollChestPrize(3, 0.4, 0.2, treats)).toEqual({ kind: 'off', pct: 25 })
    expect(rollChestPrize(3, 0.7, 0.5, treats)).toEqual({ kind: 'coins', coins: rollChest(3, 0.5) })
  })
  it('only small, repeatable rewards can be free', () => {
    const rs = [{ id: 1, price: 90 }, { id: 2, price: 150 }, { id: 3, price: 151 }, { id: 4, price: 60, oneTime: true }, { id: 5, price: 50, archived: true }]
    expect(smallTreats(rs).map((r) => r.id)).toEqual([1, 2])
  })
  it('the mystery reward never gives points', () => {
    for (const a of [0, 0.3, 0.59, 0.6, 0.99]) expect(rollMystery(a, 0.5, treats).kind).not.toBe('coins')
    expect(rollMystery(0.1, 0, [])).toEqual({ kind: 'off', pct: 30 })
  })
})

describe('coupons', () => {
  it('are made for a prize, never for coins', () => {
    expect(prizeCoupon({ kind: 'coins', coins: 20 }, 'chest:L2', '2026-11-01', 'x')).toBeNull()
    expect(prizeCoupon({ kind: 'off', pct: 25 }, 'chest:L2', '2026-11-01', 'x')).toMatchObject({ kind: 'off', pct: 25, expires: '2026-11-15' })
  })
  it('a used coupon comes back when its buy is undone; old ones expire', () => {
    const all = [free(), free({ id: 'b', usedBy: 77 }), free({ id: 'c', expires: '2026-11-02' })]
    expect(openCoupons(all, '2026-11-05', new Set([77])).map((c) => c.id)).toEqual(['a'])
    expect(openCoupons(all, '2026-11-05', new Set()).map((c) => c.id)).toEqual(['a', 'b'])
  })
  it('picks the free one for that reward first, then the biggest discount', () => {
    const off: Coupon = { id: 'o', kind: 'off', pct: 25, from: 'chest:L4', made: '2026-11-01', expires: '2026-11-15' }
    expect(couponFor({ id: 4, price: 90 }, [off, free()])).toMatchObject({ price: 0, coupon: { id: 'a' } })
    expect(couponFor({ id: 5, price: 600 }, [off, free()])).toMatchObject({ price: 450, coupon: { id: 'o' } })
    expect(couponFor({ id: 5, price: 600 }, [])).toEqual({ coupon: null, price: 600 })
    expect(couponText(off, '2026-11-14')).toEqual({ title: '25% off one reward', left: '1 day left' })
  })
  it('cleans what it reads', () => {
    expect(cleanCoupons([free(), { id: 'z', kind: 'off', pct: 90, made: '2026-11-01', expires: '2026-11-02' }, { kind: 'free' }, null])).toEqual([free(), { id: 'z', kind: 'off', pct: 50, from: '', made: '2026-11-01', expires: '2026-11-02', usedBy: null }])
  })
})

describe('the weekly mystery reward', () => {
  const plan = (done: boolean[]) => ({ week: '2026-11-02', big3: done.map((d) => ({ done: d })) })
  it('opens once all of the top 3 are done, once a week', () => {
    expect(mysteryState(plan([true, true, false]), '2026-11-02', [])).toMatchObject({ done: 2, total: 3, ready: false })
    expect(mysteryState(plan([true, true, true]), '2026-11-02', [])).toMatchObject({ ready: true, claimed: false })
    expect(mysteryState(plan([true, true, true]), '2026-11-02', [free({ from: 'mystery:2026-11-02' })])).toMatchObject({ ready: false, claimed: true })
    expect(mysteryState(plan([true, true, true]), '2026-11-09', [])).toMatchObject({ week: null, ready: false })
    expect(mysteryState(null, '2026-11-02', [])).toMatchObject({ total: 0, ready: false })
  })
})
