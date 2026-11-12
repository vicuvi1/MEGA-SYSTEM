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
  { id: 'sleep.up_on_time', module: 'sleep', title: 'Up by 06:45', coins: 10, xp: 20, dailyCap: 1, cooldownMin: 0, enabled: true },
  { id: 'sleep.bed_on_time', module: 'sleep', title: 'In bed on time', coins: 5, xp: 10, dailyCap: 1, cooldownMin: 0, enabled: true },
  { id: 'study.block_done', module: 'schedule', title: 'Study block completed', coins: 15, xp: 30, dailyCap: 6, cooldownMin: 20, enabled: true },
  { id: 'study.block_skipped', module: 'schedule', title: 'Study block skipped', coins: -5, xp: 0, dailyCap: 6, cooldownMin: 0, enabled: true },
  { id: 'discipline.clean_day', module: 'discipline', title: 'Clean day', coins: 20, xp: 40, dailyCap: 1, cooldownMin: 0, enabled: true },
  { id: 'discipline.urge_resisted', module: 'discipline', title: 'Urge crushed', coins: 10, xp: 20, dailyCap: 5, cooldownMin: 10, enabled: true },
  { id: 'discipline.oath', module: 'discipline', title: 'Morning oath', coins: 3, xp: 5, dailyCap: 1, cooldownMin: 0, enabled: true },
  { id: 'discipline.reset', module: 'discipline', title: 'Streak reset', coins: -20, xp: 0, dailyCap: 3, cooldownMin: 0, enabled: true },
  { id: 'body.workout_done', module: 'body', title: 'Workout done', coins: 10, xp: 25, dailyCap: 2, cooldownMin: 60, enabled: true },
  { id: 'body.grit_day', module: 'body', title: 'Grit bonus: trained on a hard day', coins: 15, xp: 20, dailyCap: 1, cooldownMin: 0, enabled: true },
  { id: 'face.routine_done', module: 'tasks', title: 'Skincare routine', coins: 5, xp: 10, dailyCap: 2, cooldownMin: 240, enabled: true },
  { id: 'tasks.todoist_done', module: 'tasks', title: 'Todoist task done', coins: 8, xp: 15, dailyCap: 12, cooldownMin: 0, enabled: true },
  { id: 'money.under_budget', module: 'money', title: 'Stayed under budget', coins: 5, xp: 10, dailyCap: 1, cooldownMin: 0, enabled: true },
  { id: 'money.logged', module: 'money', title: 'Logged spending', coins: 3, xp: 5, dailyCap: 1, cooldownMin: 0, enabled: true },
  { id: 'money.no_spend', module: 'money', title: 'No-spend day', coins: 8, xp: 10, dailyCap: 1, cooldownMin: 0, enabled: true },
  { id: 'money.cooked_home', module: 'money', title: 'Cooked at home', coins: 5, xp: 8, dailyCap: 1, cooldownMin: 0, enabled: true },
  { id: 'general.full_house', module: 'general', title: 'Weekly full house', coins: 40, xp: 60, dailyCap: 1, cooldownMin: 0, enabled: true },
  // Your own habits (Today): +2 a tap, paid once per habit and day, at most 6 a day.
  { id: 'habit.own', module: 'tasks', title: 'Your own habit', coins: 2, xp: 5, dailyCap: 6, cooldownMin: 0, enabled: true },
  // Island 2: a confirmed move break (+3, at most 5 a day), an eye break you did (+1, 3 a day),
  // and Ben's daily challenge once complete. Paid only on a real log, undone with it.
  { id: 'body.move_break', module: 'body', title: 'Move break', coins: 3, xp: 5, dailyCap: 5, cooldownMin: 10, enabled: true },
  { id: 'body.eye_break', module: 'body', title: 'Eye break (20-20-20)', coins: 1, xp: 1, dailyCap: 3, cooldownMin: 15, enabled: true },
  { id: 'body.healthy_day', module: 'body', title: 'Healthy day (water, moves, breaks, bed on time)', coins: 5, xp: 10, dailyCap: 1, cooldownMin: 0, enabled: true },
  { id: 'body.challenge_done', module: 'body', title: "Ben's daily challenge", coins: 10, xp: 15, dailyCap: 1, cooldownMin: 0, enabled: true },
  // Goals: a check-in on time (+3, once per goal and check-in period, at most 3 a day) and a
  // milestone you reached (+15, once per milestone). Never for a number that moved by itself.
  { id: 'goal.checkin', module: 'general', title: 'Goal check-in on time', coins: 3, xp: 5, dailyCap: 3, cooldownMin: 0, enabled: true },
  { id: 'goal.milestone', module: 'general', title: 'Goal milestone reached', coins: 15, xp: 30, dailyCap: 3, cooldownMin: 0, enabled: true },
  { id: 'grand_slam.all_four', module: 'general', title: '4-Pillar Grand Slam (Sovereign Day)', coins: 50, xp: 100, dailyCap: 1, cooldownMin: 0, enabled: true }
]

/**
 * Rules paid only through their own section or a connected app (focus timer,
 * check-in, urge crusher, Waky, Finance Helper), never by a quick-log tap, so
 * the proof behind them can't be skipped.
 */
export function isFlowRule(id: string): boolean {
  // tasks.todoist_done pays only for a real Todoist completion, never a tap.
  // habit.own pays only through your habit list (once per habit and day).
  // goal.* pays only through a goal check-in (once per period / milestone).
  return ['discipline.', 'study.', 'sleep.', 'money.', 'tasks.todoist', 'habit.', 'goal.'].some((p) => id.startsWith(p))
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
