import { describe, expect, it } from 'vitest'
import { MAX_SHIELDS, planBuyShield, SHIELD_COST } from './shields'

describe('shields core', () => {
  it('allows purchase when balance is sufficient and under cap', () => {
    const res = planBuyShield(100, 1)
    expect(res.coins).toBe(SHIELD_COST)
    expect(res.shields).toBe(2)
  })

  it('rejects purchase when balance is insufficient', () => {
    expect(() => planBuyShield(30, 0)).toThrow('Need 50 coins')
  })

  it('rejects purchase when inventory is full', () => {
    expect(() => planBuyShield(200, MAX_SHIELDS)).toThrow('Shield inventory full')
  })
})
