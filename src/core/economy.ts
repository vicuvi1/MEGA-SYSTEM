/**
 * Core Economy Constants and Conversion Utilities.
 * Standard exchange rate: 10 Coins = 1 MDL (100 Coins = 10 MDL).
 */

export const COINS_PER_MDL = 10

export function coinsToMdl(coins: number): number {
  return (coins || 0) / COINS_PER_MDL
}

export function mdlToCoins(mdl: number): number {
  return Math.round((mdl || 0) * COINS_PER_MDL)
}

export function formatMdl(amount: number, isBani = false): string {
  const mdl = isBani ? amount / 100 : amount
  return `${mdl.toFixed(2)} MDL`
}
