import { dayKey } from '@core/dates'
import { MAX_SHIELDS, planBuyShield } from '@core/shields'
import type { DB } from './db'
import { getSetting, setSetting } from './settings'
import type { Wallet } from './wallet'

export class ShieldService {
  constructor(private db: DB, private wallet: Wallet, private timeZone = 'UTC') {}

  count(): number {
    const val = getSetting(this.db, 'streak_shields')
    return val ? parseInt(val, 10) : 0
  }

  buy(now = new Date()): { shields: number; balance: number } {
    return this.db.transaction(() => this.buyNow(now))()
  }

  private buyNow(now: Date): { shields: number; balance: number } {
    const summary = this.wallet.summary(now)
    const current = this.count()
    const plan = planBuyShield(summary.balance, current)
    const day = dayKey(now, this.timeZone)

    this.wallet.append({
      ts: now.toISOString(),
      day,
      module: 'shop',
      kind: 'spend',
      coins: -plan.coins,
      xp: 0,
      ref: 'shield:buy',
      note: 'Purchased Streak Shield'
    })
    setSetting(this.db, 'streak_shields', String(plan.shields))

    return {
      shields: plan.shields,
      balance: this.wallet.summary(now).balance
    }
  }

  awardFreeShield(reason = 'Bonus'): number {
    const current = this.count()
    const next = Math.min(MAX_SHIELDS, current + 1)
    setSetting(this.db, 'streak_shields', String(next))
    return next
  }

  consume(): boolean {
    const current = this.count()
    if (current <= 0) return false
    setSetting(this.db, 'streak_shields', String(current - 1))
    return true
  }
}
