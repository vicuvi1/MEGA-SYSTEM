import { describe, expect, it } from 'vitest'
import { COINS_PER_MDL, coinsToMdl, mdlToCoins, formatMdl } from './economy'

describe('Economy Core Unit Tests', () => {
  it('defines standard 10 Coins = 1 MDL rate', () => {
    expect(COINS_PER_MDL).toBe(10)
  })

  it('converts coins to MDL accurately', () => {
    expect(coinsToMdl(100)).toBe(10)
    expect(coinsToMdl(350)).toBe(35)
    expect(coinsToMdl(0)).toBe(0)
    expect(coinsToMdl(15)).toBe(1.5)
  })

  it('converts MDL to coins accurately', () => {
    expect(mdlToCoins(10)).toBe(100)
    expect(mdlToCoins(35)).toBe(350)
    expect(mdlToCoins(0)).toBe(0)
    expect(mdlToCoins(1.5)).toBe(15)
  })

  it('formats MDL amounts for display', () => {
    expect(formatMdl(35)).toBe('35.00 MDL')
    expect(formatMdl(3500, true)).toBe('35.00 MDL')
    expect(formatMdl(120.5)).toBe('120.50 MDL')
  })
})
