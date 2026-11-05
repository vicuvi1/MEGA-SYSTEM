// Buying a reward (M1, RL3, RL4). A reward with a real cost first asks what
// you actually paid. Over Finance Helper's Safe to spend or past your fun
// budget, a sheet says why; "Buy anyway" is a separate, explicit tap. What you
// paid goes into Money as Fun, and undoing the buy takes it back out.
import type { ShopState } from '@shared/api'
import { life } from './bridge'
import { askConfirm, askText } from './confirmSheet'

/** "−600 points · −150 lei added to Money as Fun" (or the fallback). */
export const buyToast = (s: ShopState | undefined, fallback: string) => s?.lastBuy?.toast ?? fallback

export async function redeemReward(id: number, opts: { paid?: number } = {}): Promise<ShopState> {
  let paid = opts.paid
  if (paid == null) {
    const reward = (await life.shop.state()).rewards.find((r) => r.id === id)
    if (reward && reward.realCost > 0) {
      const cur = (reward.currency || 'MDL').toUpperCase()
      const typed = await askText(`What did you actually pay for ${reward.title}? (${cur === 'MDL' ? 'lei' : cur})`, String(reward.realCost), { ok: 'Buy it' })
      if (typed == null) throw new Error('Not bought: your points stay')
      const n = Number(String(typed).replace(',', '.'))
      if (!Number.isFinite(n) || n < 0) throw new Error('Type the amount you paid, like 150')
      paid = Math.round(n)
    }
  }
  try {
    return await life.shop.redeem(id, paid != null ? { paid } : {})
  } catch (e) {
    const msg = (e as Error).message || ''
    const tag = ['OVER_SAFE:', 'FUN_EMPTY:'].find((t) => msg.includes(t))
    if (!tag) throw e
    const why = msg.slice(msg.indexOf(tag) + tag.length).trim()
    const ok = await askConfirm(`${why} Buy it anyway? It goes into Money as Fun.`, { ok: 'Buy anyway', danger: false })
    if (!ok) throw new Error('Not bought: your points stay')
    return life.shop.redeem(id, { ...(paid != null ? { paid } : {}), force: true })
  }
}
