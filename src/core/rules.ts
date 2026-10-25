import { balance, clampPenalty, effective, LedgerError, type LedgerEntry, type NewEntry } from './ledger'

export interface Rule {
  id: string
  module: string
  title: string
  coins: number // negative = penalty
  xp: number
  dailyCap: number // max times per day, 0 = unlimited
  cooldownMin: number
  enabled: boolean
}

export const DEFAULT_RULES: Rule[] = [
  { id: 'sleep.up_on_time', module: 'sleep', title: 'Up by 07:00', coins: 10, xp: 20, dailyCap: 1, cooldownMin: 0, enabled: true },
  { id: 'sleep.bed_on_time', module: 'sleep', title: 'In bed on time', coins: 5, xp: 10, dailyCap: 1, cooldownMin: 0, enabled: true },
  { id: 'study.block_done', module: 'schedule', title: 'Study block completed', coins: 15, xp: 30, dailyCap: 6, cooldownMin: 20, enabled: true },
  { id: 'study.block_skipped', module: 'schedule', title: 'Study block skipped', coins: -5, xp: 0, dailyCap: 6, cooldownMin: 0, enabled: true },
  { id: 'discipline.clean_day', module: 'discipline', title: 'Clean day', coins: 20, xp: 40, dailyCap: 1, cooldownMin: 0, enabled: true },
  { id: 'discipline.urge_resisted', module: 'discipline', title: 'Urge crushed', coins: 10, xp: 20, dailyCap: 5, cooldownMin: 10, enabled: true },
  { id: 'discipline.oath', module: 'discipline', title: 'Morning oath', coins: 3, xp: 5, dailyCap: 1, cooldownMin: 0, enabled: true },
  { id: 'discipline.reset', module: 'discipline', title: 'Streak reset', coins: -20, xp: 0, dailyCap: 3, cooldownMin: 0, enabled: true },
  { id: 'body.workout_done', module: 'body', title: 'Workout done', coins: 10, xp: 25, dailyCap: 2, cooldownMin: 60, enabled: true },
  { id: 'face.routine_done', module: 'tasks', title: 'Skincare routine', coins: 5, xp: 10, dailyCap: 2, cooldownMin: 240, enabled: true },
  { id: 'money.under_budget', module: 'money', title: 'Stayed under budget', coins: 5, xp: 10, dailyCap: 1, cooldownMin: 0, enabled: true }
]

/**
 * Rules paid only through their own section (focus timer, check-in, urge
 * crusher), never by a quick-log tap, so the timer and the honest streak
 * can't be skipped.
 */
export function isFlowRule(id: string): boolean {
  return id.startsWith('discipline.') || id.startsWith('study.')
}

/** Checks caps and cooldowns and returns the row to insert for this rule. */
export function planAward(rule: Rule, entries: LedgerEntry[], now: Date, day: string, note?: string): NewEntry {
  if (!rule.enabled) throw new LedgerError(`"${rule.title}" is turned off`)
  const mine = effective(entries).filter((e) => e.ruleId === rule.id)
  if (rule.dailyCap > 0 && mine.filter((e) => e.day === day).length >= rule.dailyCap) {
    throw new LedgerError(`Daily limit reached for "${rule.title}"`)
  }
  if (rule.cooldownMin > 0 && mine.length) {
    const last = Math.max(...mine.map((e) => Date.parse(e.ts)))
    const waitMs = last + rule.cooldownMin * 60_000 - now.getTime()
    if (waitMs > 0) throw new LedgerError(`Wait ${Math.ceil(waitMs / 60_000)} min before "${rule.title}" again`)
  }
  return {
    ts: now.toISOString(),
    day,
    module: rule.module,
    kind: rule.coins < 0 ? 'adjust' : 'earn',
    coins: clampPenalty(balance(entries), rule.coins),
    xp: Math.max(0, rule.xp),
    ruleId: rule.id,
    ref: null,
    note: note ?? null,
    undoOf: null
  }
}
