import { LedgerError } from './ledger'

export const SHIELD_COST = 50
export const MAX_SHIELDS = 5

export function planBuyShield(balance: number, currentShields: number, maxShields = MAX_SHIELDS): { coins: number; shields: number } {
  if (balance < SHIELD_COST) {
    throw new LedgerError(`Need ${SHIELD_COST} coins to buy a Streak Shield (you have ${balance})`)
  }
  if (currentShields >= maxShields) {
    throw new LedgerError(`Shield inventory full (maximum ${maxShields} shields)`)
  }
  return {
    coins: SHIELD_COST,
    shields: currentShields + 1
  }
}
