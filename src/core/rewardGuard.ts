// Healthy guardrails for fun rewards (pure, tested): a limit per day, "pair
// it" (temptation bundling: a podcast or an album only on a day you trained
// or focused), and Ben's gentle note when fun spending runs ahead of earning
// this week or the fun budget in lei is running out early. Everything reads
// logged rows; nothing here pays or takes points.
import { effective, type LedgerEntry } from './ledger'

export const REWARD_RULES = 'reward_rules'

export type PairId = 'workout' | 'move' | 'focus'

export const PAIRS: Record<PairId, { label: string; need: string; tag: string }> = {
  workout: { label: 'a workout', need: 'Log a workout today first', tag: 'With a workout' },
  move: { label: 'moving (a workout or a move break)', need: 'Move first today: a workout or a move break', tag: 'After you move' },
  focus: { label: 'a focus session', need: 'Finish a focus session today first', tag: 'After focus' }
}
const PAIR_IDS = Object.keys(PAIRS) as PairId[]

export interface RewardRules {
  /** At most this many a day (0 / missing = no limit). */
  perDay?: number
  /** Only on a day you did this (temptation bundling). */
  pair?: PairId | null
}

export function cleanRules(v: any): Record<string, RewardRules> {
  const out: Record<string, RewardRules> = {}
  if (!v || typeof v !== 'object') return out
  for (const [id, r] of Object.entries<any>(v)) {
    if (!/^\d+$/.test(id) || !r || typeof r !== 'object') continue
    const perDay = Math.max(0, Math.min(20, Math.round(Number(r.perDay) || 0)))
    const pair = PAIR_IDS.includes(r.pair) ? (r.pair as PairId) : null
    if (perDay || pair) out[id] = { ...(perDay ? { perDay } : {}), ...(pair ? { pair } : {}) }
  }
  return out
}

export function setRules(all: Record<string, RewardRules>, rewardId: number, r: RewardRules | null): Record<string, RewardRules> {
  const next = { ...all }
  if (r) next[String(rewardId)] = r
  else delete next[String(rewardId)]
  return cleanRules(next)
}

/** What you did today, from the ledger's live rows. */
export interface TodayDeeds {
  workout: boolean
  move: boolean
  focus: boolean
}

export function todayDeeds(entries: LedgerEntry[], today: string): TodayDeeds {
  const t = effective(entries).filter((e) => e.day === today && e.kind === 'earn' && e.coins > 0)
  const workout = t.some((e) => e.ruleId === 'body.workout_done')
  return {
    workout,
    move: workout || t.some((e) => e.module === 'body'),
    focus: t.some((e) => e.ruleId === 'focus.session')
  }
}

/** Why the rules stop a buy now, or null. `buysToday`: buys of this reward today that still count. */
export function guardBlocker(r: RewardRules | undefined | null, buysToday: number, did: TodayDeeds): string | null {
  if (!r) return null
  if (r.perDay && buysToday >= r.perDay) return r.perDay === 1 ? 'Once a day: again tomorrow' : `${r.perDay} a day: again tomorrow`
  if (r.pair && !did[r.pair]) return PAIRS[r.pair].need
  return null
}

/** Short tags for a card: "2 a day", "With a workout". */
export function ruleTags(r: RewardRules | undefined | null): string[] {
  if (!r) return []
  const out: string[] = []
  if (r.perDay) out.push(r.perDay === 1 ? 'Once a day' : `${r.perDay} a day`)
  if (r.pair) out.push(PAIRS[r.pair].tag)
  return out
}

// ---------- Is fun outrunning earning? ----------

export interface FunPaceInput {
  earnedWeek: number
  /** Fun time and fun-category rewards bought this week, in points. */
  funSpentWeek: number
  /** The month's fun budget in lei and what's left (null = no budget). */
  funBudgetLei: number | null
  funLeftLei: number | null
  /** Day of the month (1–31) and the month's length. */
  dayOfMonth: number
  daysInMonth: number
}

export interface FunPace {
  level: 'ok' | 'watch' | 'over'
  /** Ben's gentle line, or null when all is fine. */
  line: string | null
}

/**
 * "watch": fun took more than 60% of what you earned this week (and at least
 * 60 points), or the budget is down to its last 20% before the month's last
 * week. "over": fun took more than you earned, or the budget is gone early.
 */
export function funPace(i: FunPaceInput): FunPace {
  const fun = Math.max(0, i.funSpentWeek)
  const earned = Math.max(0, i.earnedWeek)
  const lateMonth = i.dayOfMonth > i.daysInMonth - 7
  if (fun >= 60 && fun > earned) return { level: 'over', line: `Fun is ahead of earning this week: ${fun} points spent, ${earned} earned. One focus block before the next treat?` }
  if (i.funBudgetLei != null && i.funBudgetLei > 0 && i.funLeftLei != null) {
    if (i.funLeftLei <= 0 && !lateMonth) return { level: 'over', line: `Your fun budget for the month is used up and there are ${i.daysInMonth - i.dayOfMonth} days to go. Free fun for a bit: a walk, music, friends.` }
    if (i.funLeftLei < i.funBudgetLei * 0.2 && !lateMonth) return { level: 'watch', line: `Only ${Math.round(i.funLeftLei)} lei of fun budget left this month. Pick the treat that counts most.` }
  }
  if (fun >= 60 && fun > earned * 0.6) return { level: 'watch', line: `Fun took ${Math.round((fun / Math.max(1, earned)) * 100)}% of what you earned this week. Fine, just keep it planned.` }
  return { level: 'ok', line: null }
}
