// Redeeming a reward (M1): one with a real cost is checked against Finance
// Helper's Safe to spend; over it, a sheet asks first. The cost then goes
// into Finance Helper as an expense ("Reward: …").
import type { ShopState } from '@shared/api'
import { life } from './bridge'
import { askConfirm } from './confirmSheet'

export async function redeemReward(id: number): Promise<ShopState> {
  try {
    return await life.shop.redeem(id)
  } catch (e) {
    const msg = (e as Error).message || ''
    const at = msg.indexOf('OVER_SAFE:')
    if (at < 0) throw e
    const ok = await askConfirm(`${msg.slice(at + 10).trim()} Redeem it anyway? It goes into Finance Helper as spending.`, { ok: 'Redeem anyway', danger: false })
    if (!ok) throw new Error('Not redeemed: your points stay')
    return life.shop.redeem(id, { force: true })
  }
}
