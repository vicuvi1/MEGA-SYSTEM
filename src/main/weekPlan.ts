// The week plan, kept in settings (synced to every device through Turso).
import { LedgerError } from '@core/ledger'
import { activePlan, cleanPlan, type WeekPlan } from '@core/weekPlan'
import type { DB } from './db'
import { getSetting, setSetting } from './settings'
import type { Wallet } from './wallet'
import { BIG3_POINTS, payOnce } from './points'

const KEY = 'week_plan'

export class WeekPlanService {
  constructor(private db: DB, private wallet: Wallet) {}

  /** The last plan saved (may be for an earlier week). */
  saved(): WeekPlan | null {
    try {
      return JSON.parse(getSetting(this.db, KEY) || 'null')
    } catch {
      return null
    }
  }

  /** The plan for the week today is in, if one was made. */
  active(now = new Date()): WeekPlan | null {
    return activePlan(this.saved(), this.wallet.today(now))
  }

  save(p: Partial<WeekPlan>, now = new Date()): WeekPlan {
    const plan = cleanPlan(p, this.wallet.today(now), now)
    if (!plan.big3.length) throw new LedgerError('Add at least one big task for the week')
    setSetting(this.db, KEY, JSON.stringify(plan))
    return plan
  }

  /** Ticks (or unticks) one of the big 3. */
  toggle(i: number, now = new Date()): WeekPlan {
    const plan = this.active(now)
    if (!plan || !plan.big3[i]) throw new LedgerError('No such task in this week’s plan')
    plan.big3[i].done = !plan.big3[i].done
    setSetting(this.db, KEY, JSON.stringify(plan))
    // A big task done pays once (unticking keeps it: no flip-flop farming).
    if (plan.big3[i].done) payOnce(this.wallet, `week:${plan.week}:big${i}`, BIG3_POINTS, `Week goal done: ${plan.big3[i].text}`, now)
    return plan
  }
}
