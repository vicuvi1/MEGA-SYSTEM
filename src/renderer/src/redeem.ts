// Buying a reward (M1, RL3, RL4). A buy with points is NOT real spending: by
// default nothing goes to Finance Helper (points-only fix, 2026-11-08). A
// reward with a real cost shows a sheet with an "I paid real money" switch,
// off at first; only when you turn it on and type what you paid does that go
// into Money as Fun (and undoing the buy takes it back out). Over Finance
// Helper's Safe to spend or past your fun budget (real money only), a sheet
// says why; "Buy anyway" is a separate, explicit tap.
import type { ShopState } from '@shared/api'
import { life } from './bridge'
import { askConfirm, askSwitch } from './confirmSheet'

/** "−600 points" or "−600 points · −150 lei added to Money as Fun" (or the fallback). */
export const buyToast = (s: ShopState | undefined, fallback: string) => s?.lastBuy?.toast ?? fallback

/** What the buy sheet's answer means: null = cancelled, 0 = points only, n = real money paid. */
export function paidFrom(answer: { on: boolean; text: string } | null): number | null {
  if (!answer) return null
  if (!answer.on) return 0
  const n = Number(String(answer.text).replace(',', '.').trim())
  if (!Number.isFinite(n) || n < 0) throw new Error('Type the amount you paid, like 150')
  return Math.round(n)
}

export async function redeemReward(id: number, opts: { paid?: number } = {}): Promise<ShopState> {
  let paid = opts.paid
  if (paid == null) {
    const reward = (await life.shop.state()).rewards.find((r) => r.id === id)
    if (reward && reward.realCost > 0) {
      const cur = (reward.currency || 'MDL').toUpperCase()
      const unit = cur === 'MDL' ? 'lei' : cur
      const got = paidFrom(
        await askSwitch(`Get ${reward.title} for ${reward.price.toLocaleString('en-US')} points?`, `I paid real money (${unit})`, String(reward.realCost), {
          ok: 'Get it',
          hint: 'Points only: nothing goes into Money.'
        })
      )
      if (got == null) throw new Error('Not bought: your points stay')
      paid = got
    }
  }
  const real = paid != null && paid > 0 ? { paid } : {}
  try {
    return await life.shop.redeem(id, real)
  } catch (e) {
    const msg = (e as Error).message || ''
    const tag = ['OVER_SAFE:', 'FUN_EMPTY:'].find((t) => msg.includes(t))
    if (!tag) throw e
    const why = msg.slice(msg.indexOf(tag) + tag.length).trim()
    const ok = await askConfirm(`${why} Buy it anyway? The money goes into Money as Fun.`, { ok: 'Buy anyway', danger: false })
    if (!ok) throw new Error('Not bought: your points stay')
    return life.shop.redeem(id, { ...real, force: true })
  }
}
