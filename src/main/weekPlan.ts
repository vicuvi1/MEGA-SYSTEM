// The week plan, kept in settings (synced to every device through Turso).
import { LedgerError } from '@core/ledger'
import { activePlan, cleanPlan, currentWeek, type WeekPlan } from '@core/weekPlan'
import type { DB } from './db'
import { getSetting, setSetting } from './settings'
import type { Wallet } from './wallet'
import { BIG3_POINTS, payOnce } from './points'

const KEY = 'week_plan'
/** One plan per week (Monday → plan), the last 26 weeks. */
const ALL = 'week_plans'

export class WeekPlanService {
  constructor(private db: DB, private wallet: Wallet) {}

  private read(key: string): any {
    try {
      return JSON.parse(getSetting(this.db, key) || 'null')
    } catch {
      return null
    }
  }

  /** Every saved week (older single-plan copies included). */
  all(): Record<string, WeekPlan> {
    const map: Record<string, WeekPlan> = { ...(this.read(ALL) ?? {}) }
    const legacy = this.read(KEY) as WeekPlan | null
    if (legacy?.week && !map[legacy.week]) map[legacy.week] = legacy
    return map
  }

  private write(map: Record<string, WeekPlan>, latest: WeekPlan): void {
    const keep = Object.keys(map).sort().slice(-26)
    setSetting(this.db, ALL, JSON.stringify(Object.fromEntries(keep.map((k) => [k, map[k]]))))
    setSetting(this.db, KEY, JSON.stringify(latest))
  }

  /** The last plan saved (may be for next week on Sunday, or an earlier week). */
  saved(): WeekPlan | null {
    const plans = Object.values(this.all())
    return plans.sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt))).pop() ?? null
  }

  /** The plan for the week today is in (planning next week on Sunday never replaces it). */
  active(now = new Date()): WeekPlan | null {
    const today = this.wallet.today(now)
    return activePlan(this.all()[currentWeek(today)] ?? null, today)
  }

  /** Past weeks, newest first (for the weekly review). */
  history(): WeekPlan[] {
    return Object.values(this.all()).sort((a, b) => b.week.localeCompare(a.week))
  }

  save(p: Partial<WeekPlan>, now = new Date()): WeekPlan {
    const plan = cleanPlan(p, this.wallet.today(now), now)
    if (!plan.big3.length) throw new LedgerError('Add at least one big task for the week')
    this.write({ ...this.all(), [plan.week]: plan }, plan)
    return plan
  }

  /** Ticks (or unticks) one of the big 3. */
  toggle(i: number, now = new Date()): WeekPlan {
    const plan = this.active(now)
    if (!plan || !plan.big3[i]) throw new LedgerError('No such task in this week’s plan')
    plan.big3[i].done = !plan.big3[i].done
    this.write({ ...this.all(), [plan.week]: plan }, plan)
    // A big task done pays once (unticking keeps it: no flip-flop farming).
    if (plan.big3[i].done) payOnce(this.wallet, `week:${plan.week}:big${i}`, BIG3_POINTS, `Week goal done: ${plan.big3[i].text}`, now)
    return plan
  }
}
