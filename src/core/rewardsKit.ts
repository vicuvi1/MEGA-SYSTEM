// Night 11: the Rewards page's logic (pure, tested). When a goal is ready at
// your pace, what you can afford soon, the earnings graph, the weekly
// challenge, the honest streak bonus and lucky gift, badges, and Ben's one
// line. Points only ever come from things you really did and logged: every
// bonus here is a small, capped extra on top of a real action, and undoing
// that action undoes its extra too (see Wallet.undo and `extraRef`).
import { addDays, dayLabel, daysBetween } from './dates'
import { effective, type LedgerEntry } from './ledger'
import { focusCoins } from './focus'

// ---------- When will I have it (RG1, RG4) ----------

/** Points one full 50-minute focus block pays. */
export const FOCUS_BLOCK_POINTS = focusCoins(50)

/** Days until `left` points at `perDay` a day (0 = already there; null = no pace yet). */
export function etaDays(left: number, perDay: number): number | null {
  if (left <= 0) return 0
  if (!(perDay > 0)) return null
  return Math.ceil(left / perDay)
}

/** The day you'll reach it at your pace, or null with too little history. */
export function etaDay(today: string, left: number, perDay: number): string | null {
  const d = etaDays(left, perDay)
  return d == null ? null : addDays(today, d)
}

/** "today", "tomorrow", "by Thursday" (this week), "by 12 Nov". */
export function etaLabel(today: string, day: string): string {
  const d = daysBetween(today, day)
  if (d <= 0) return 'today'
  if (d === 1) return 'tomorrow'
  if (d < 7) return `by ${new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })}`
  return `by ${dayLabel(day, false)}`
}

/** "Ready by Thursday" / "Ready today" / null (no pace yet). */
export function readyLine(today: string, left: number, perDay: number): string | null {
  if (left <= 0) return 'Ready now'
  const day = etaDay(today, left, perDay)
  return day ? `Ready ${etaLabel(today, day)}` : null
}

/**
 * How many days sooner `blocksPerDay` extra focus blocks a day would get you
 * there (RG1: "2 focus blocks a day → 3 days sooner"). 0 when it makes no
 * difference; without a pace, the days the blocks alone would take.
 */
export function soonerWith(left: number, perDay: number, blocksPerDay = 2): { blocks: number; days: number; alone: number } {
  const extra = blocksPerDay * FOCUS_BLOCK_POINTS
  const alone = left > 0 ? Math.ceil(left / extra) : 0
  const now = etaDays(left, perDay)
  const faster = etaDays(left, Math.max(0, perDay) + extra) ?? alone
  return { blocks: blocksPerDay, days: now == null ? 0 : Math.max(0, now - faster), alone }
}

/** Focus blocks that cover `left` points ("Two focus blocks and it's yours"). */
export const blocksFor = (left: number) => (left > 0 ? Math.ceil(left / FOCUS_BLOCK_POINTS) : 0)

export interface Priced {
  id: number
  price: number
  jar?: number
}

/** What you can afford with your balance now and after `days` at your pace (RG4). */
export function affordableIn<T extends Priced>(rewards: T[], balance: number, perDay: number, days: number): T[] {
  const will = balance + Math.max(0, perDay) * Math.max(0, days)
  return rewards.filter((r) => r.price - Math.max(0, r.jar ?? 0) <= will)
}

/** The three chips: now, in 3 days, next month (each new ones only adds to the count). */
export function affordChips<T extends Priced>(rewards: T[], balance: number, perDay: number): { id: 'now' | 'd3' | 'month'; label: string; days: number; items: T[] }[] {
  return [
    { id: 'now' as const, label: 'Now', days: 0 },
    { id: 'd3' as const, label: 'In 3 days', days: 3 },
    { id: 'month' as const, label: 'Next month', days: 30 }
  ].map((c) => ({ ...c, items: affordableIn(rewards, balance, perDay, c.days) }))
}

// ---------- Honest extras (RG6, RG7) ----------

/** The ref of a small extra paid on top of one ledger row; undoing the row undoes it too. */
export const extraRef = (ledgerId: number, kind: 'lucky' | 'streak') => `extra:${ledgerId}:${kind}`
export const isExtra = (e: { ref?: string | null }, kind?: 'lucky' | 'streak') => (e.ref ?? '').startsWith('extra:') && (!kind || (e.ref ?? '').endsWith(`:${kind}`))

/** RG7: about 1 in 8 finished must-dos brings a lucky +5, at most twice a day. */
export const LUCKY = { chance: 1 / 8, coins: 5, dailyCap: 2 }

/** The lucky gift for one finished must-do: its coins, or 0. `rand` is 0..1. */
export function luckyRoll(rand: number, luckyToday: number): number {
  if (luckyToday >= LUCKY.dailyCap) return 0
  return rand < LUCKY.chance ? LUCKY.coins : 0
}

/** RG6: +10% on focus points from a 7-day focus streak, at most +3 a session. */
export const STREAK_BONUS = { days: 7, pct: 0.1, max: 3 }

/** Days in a row with focus, ending today (or yesterday, while today has none yet). */
export function dayStreak(days: Iterable<string>, today: string): number {
  const set = new Set(days)
  let d = set.has(today) ? today : addDays(today, -1)
  let n = 0
  while (set.has(d)) {
    n++
    d = addDays(d, -1)
  }
  return n
}

/** The streak extra for a real focus session that paid `coins`. */
export function streakBonus(coins: number, streak: number): number {
  if (!(coins > 0) || streak < STREAK_BONUS.days) return 0
  return Math.max(1, Math.min(STREAK_BONUS.max, Math.round(coins * STREAK_BONUS.pct)))
}

/** The flame in the header grows at 3, 7 and 14 days (0 = no flame). */
export function flameLevel(streak: number): 0 | 1 | 2 | 3 {
  return streak >= 14 ? 3 : streak >= 7 ? 2 : streak >= 3 ? 1 : 0
}

// ---------- Earnings graph (RG3) ----------

export type SourceId = 'focus' | 'mustdo' | 'tasks' | 'habits' | 'bonus'
export const SOURCES: { id: SourceId; label: string; color: string }[] = [
  { id: 'focus', label: 'Focus', color: '#a78bfa' },
  { id: 'mustdo', label: 'Must-dos', color: '#c8f135' },
  { id: 'tasks', label: 'Tasks', color: '#38bdf8' },
  { id: 'habits', label: 'Habits', color: '#34d399' },
  { id: 'bonus', label: 'Bonuses', color: '#fbbf24' }
]

/** Which colour a point belongs to, by the module that paid it. */
export function sourceOf(e: Pick<LedgerEntry, 'module' | 'ref' | 'ruleId'>): SourceId {
  if (e.ref?.startsWith('extra:') || e.ref?.startsWith('quest:') || e.ref?.startsWith('chest:') || e.ref?.startsWith('challenge:')) return 'bonus'
  if (e.module === 'focus' || e.module === 'schedule') return 'focus'
  if (e.module === 'plan') return 'mustdo'
  if (e.module === 'tasks' || e.ref?.startsWith('task:')) return 'tasks'
  if (['sleep', 'discipline', 'body', 'money', 'face', 'habits', 'grand_slam'].includes(e.module)) return 'habits'
  return 'bonus'
}

/** Moving points into or out of a savings jar is not earning or spending. */
const isJarMove = (e: LedgerEntry) => !!e.ref?.startsWith('goal:')

export interface EarnDay {
  day: string
  earned: Record<SourceId, number>
  total: number
  spent: number
}

export interface Earnings {
  days: EarnDay[]
  best: { day: string; total: number } | null
  thisWeek: { earned: number; spent: number }
  /** Last week up to the same weekday as today. */
  lastWeek: { earned: number; spent: number }
  today: number
  earned: number
  spent: number
}

/** Monday of the week `day` is in. */
export function mondayOf(day: string): string {
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay()
  return addDays(day, wd === 0 ? -6 : 1 - wd)
}

/** 30 days of points earned (by source) and spent, best day, this week against last. */
export function earnings(entries: LedgerEntry[], today: string, span = 30): Earnings {
  const start = addDays(today, -(span - 1))
  const mon = mondayOf(today)
  const lastMon = addDays(mon, -7)
  const map = new Map<string, EarnDay>()
  for (let i = 0; i < span; i++) {
    const day = addDays(start, i)
    map.set(day, { day, earned: { focus: 0, mustdo: 0, tasks: 0, habits: 0, bonus: 0 }, total: 0, spent: 0 })
  }
  const thisWeek = { earned: 0, spent: 0 }
  const lastWeek = { earned: 0, spent: 0 }
  for (const e of effective(entries)) {
    if (isJarMove(e) || e.kind === 'adjust') continue
    const earn = e.kind === 'earn' && e.coins > 0 ? e.coins : 0
    const spend = e.coins < 0 ? -e.coins : 0
    // Last week up to the same weekday, so a Thursday compares with last Monday to Thursday.
    const wk = e.day >= mon && e.day <= today ? thisWeek : e.day >= lastMon && e.day <= addDays(today, -7) ? lastWeek : null
    if (wk) {
      wk.earned += earn
      wk.spent += spend
    }
    const d = map.get(e.day)
    if (!d) continue
    if (earn) {
      d.earned[sourceOf(e)] += earn
      d.total += earn
    }
    d.spent += spend
  }
  const days = [...map.values()]
  const top = days.reduce<EarnDay | null>((b, d) => (d.total > (b?.total ?? 0) ? d : b), null)
  return {
    days,
    best: top ? { day: top.day, total: top.total } : null,
    thisWeek,
    lastWeek,
    today: map.get(today)?.total ?? 0,
    earned: days.reduce((s, d) => s + d.total, 0),
    spent: days.reduce((s, d) => s + d.spent, 0)
  }
}

// ---------- Weekly challenge (RG5) ----------

export type ChallengeArea = 'focus' | 'mustdo' | 'tasks' | 'habits'

const HABIT_RULES = new Set(['sleep.up_on_time', 'sleep.bed_on_time', 'discipline.clean_day', 'discipline.oath', 'discipline.urge_resisted', 'body.workout_done', 'face.routine_done', 'money.logged', 'money.under_budget', 'money.no_spend', 'money.cooked_home', 'habit.done'])

/** Only real logged actions count: each challenge counts rows of the rule that pays that action. */
export const CHALLENGES: Record<ChallengeArea, { title: string; goal: number; count: (e: LedgerEntry) => boolean }> = {
  focus: { title: 'Finish 5 focus sessions this week', goal: 5, count: (e) => e.ruleId === 'focus.session' && e.coins > 0 },
  mustdo: { title: 'Tick off 10 must-dos this week', goal: 10, count: (e) => e.ruleId === 'plan.item_done' },
  tasks: { title: 'Complete 12 Todoist tasks this week', goal: 12, count: (e) => e.module === 'tasks' && e.coins > 0 && !isExtra(e) },
  habits: { title: 'Log 15 habits this week', goal: 15, count: (e) => !!e.ruleId && HABIT_RULES.has(e.ruleId) && e.coins > 0 }
}
export const CHALLENGE_BONUS = 40
export const challengeRef = (week: string) => `challenge:${week}`

/** Your weakest area last week (the lowest share of its goal); focus wins a tie. */
export function pickChallenge(lastWeek: LedgerEntry[]): ChallengeArea {
  const live = effective(lastWeek)
  let best: ChallengeArea = 'focus'
  let low = Infinity
  for (const a of Object.keys(CHALLENGES) as ChallengeArea[]) {
    const share = live.filter(CHALLENGES[a].count).length / CHALLENGES[a].goal
    if (share < low) {
      low = share
      best = a
    }
  }
  return best
}

export interface ChallengeState {
  week: string
  area: ChallengeArea
  title: string
  goal: number
  progress: number
  done: boolean
  paid: boolean
  bonus: number
  daysLeft: number
}

export function challengeState(area: ChallengeArea, week: string, entries: LedgerEntry[], today: string): ChallengeState {
  const live = effective(entries)
  const end = addDays(week, 6)
  const c = CHALLENGES[area]
  const progress = Math.min(c.goal, live.filter((e) => e.day >= week && e.day <= end && c.count(e)).length)
  return {
    week,
    area,
    title: c.title,
    goal: c.goal,
    progress,
    done: progress >= c.goal,
    paid: live.some((e) => e.ref === challengeRef(week)),
    bonus: CHALLENGE_BONUS,
    daysLeft: Math.max(0, daysBetween(today, end) + 1)
  }
}

// ---------- Badges (RG8): one-time, visual only, no points ----------

export interface BadgeStats {
  bought: number
  earnedAllTime: number
  bestFocusStreak: number
  questDays: number
  chests: number
  lucky: number
  challenges: number
}

export const BADGES: { id: string; emoji: string; title: string; hint: string; goal: (s: BadgeStats) => [number, number] }[] = [
  { id: 'first_buy', emoji: '🎁', title: 'First reward', hint: 'Buy your first reward', goal: (s) => [s.bought, 1] },
  { id: 'buy10', emoji: '🛍️', title: 'Ten treats', hint: 'Buy 10 rewards', goal: (s) => [s.bought, 10] },
  { id: 'k1', emoji: '💰', title: '1,000 points', hint: 'Earn 1,000 points in all', goal: (s) => [s.earnedAllTime, 1000] },
  { id: 'k10', emoji: '💎', title: '10,000 points', hint: 'Earn 10,000 points in all', goal: (s) => [s.earnedAllTime, 10000] },
  { id: 'streak7', emoji: '🔥', title: 'Week on fire', hint: 'Focus 7 days in a row', goal: (s) => [s.bestFocusStreak, 7] },
  { id: 'streak30', emoji: '🌋', title: '30-day streak', hint: 'Focus 30 days in a row', goal: (s) => [s.bestFocusStreak, 30] },
  { id: 'quests', emoji: '🎯', title: 'Quest master', hint: 'Finish all daily quests on 5 days', goal: (s) => [s.questDays, 5] },
  { id: 'chest', emoji: '🧰', title: 'Treasure', hint: 'Open a level chest', goal: (s) => [s.chests, 1] },
  { id: 'lucky', emoji: '🍀', title: 'Lucky', hint: 'Get a lucky gift for a must-do', goal: (s) => [s.lucky, 1] },
  { id: 'challenge', emoji: '🏆', title: 'Challenger', hint: 'Win a weekly challenge', goal: (s) => [s.challenges, 1] }
]

export interface Badge {
  id: string
  emoji: string
  title: string
  hint: string
  earned: boolean
  progress: number
}

export function badges(s: BadgeStats): Badge[] {
  return BADGES.map((b) => {
    const [have, need] = b.goal(s)
    return { id: b.id, emoji: b.emoji, title: b.title, hint: b.hint, earned: have >= need, progress: Math.max(0, Math.min(1, have / need)) }
  })
}

/** The longest run of consecutive days in a set. */
export function bestStreak(days: Iterable<string>): number {
  const sorted = [...new Set(days)].sort()
  let best = 0
  let run = 0
  for (let i = 0; i < sorted.length; i++) {
    run = i && daysBetween(sorted[i - 1], sorted[i]) === 1 ? run + 1 : 1
    best = Math.max(best, run)
  }
  return best
}

/** Badge numbers from the ledger (live rows) and your buys. */
export function badgeStats(entries: LedgerEntry[], bought: number, focusDays: string[]): BadgeStats {
  const live = effective(entries)
  return {
    bought,
    earnedAllTime: live.filter((e) => e.kind === 'earn' && e.coins > 0).reduce((s, e) => s + e.coins, 0),
    bestFocusStreak: bestStreak(focusDays),
    questDays: live.filter((e) => e.ref?.startsWith('quest:')).length,
    chests: live.filter((e) => e.ref?.startsWith('chest:')).length,
    lucky: live.filter((e) => isExtra(e, 'lucky')).length,
    challenges: live.filter((e) => e.ref?.startsWith('challenge:')).length
  }
}

// ---------- Ben says a word (RW9): templates with live numbers, no AI ----------

export interface BenLineInput {
  goal?: { title: string; left: number } | null
  perDay: number
  today: string
  todayEarned: number
  readyCount: number
  justBought?: string | null
  streak: number
}

const NUM = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
const n = (x: number) => NUM[x] ?? String(x)

export function benRewardLine(i: BenLineInput): string {
  if (i.justBought) return `${i.justBought}: enjoy it. You earned every point. 😎`
  const g = i.goal
  if (g && g.left > 0) {
    const b = blocksFor(g.left)
    if (b <= 3) return `${n(b)} focus block${b > 1 ? 's' : ''} and the ${g.title} is yours.`
  }
  if (i.readyCount > 0) return `${n(i.readyCount)} reward${i.readyCount > 1 ? 's are' : ' is'} ready. You did the work, take one.`
  if (i.todayEarned <= 0) return `Nothing earned yet today. One focus block is +${FOCUS_BLOCK_POINTS}. Start it.`
  if (g && g.left > 0) {
    const r = readyLine(i.today, g.left, i.perDay)
    return `+${i.todayEarned} today. ${g.left.toLocaleString()} to go for the ${g.title}${r ? `: ${r[0].toLowerCase()}${r.slice(1)} at your pace` : ''}.`
  }
  if (i.streak >= 3) return `${i.streak} days of focus in a row. Keep the flame going. 🔥`
  return `+${i.todayEarned} today. Pick something worth saving for.`
}

// ---------- "Ready!" once per reward (RW6) ----------

/** The key that marks a reward's "ready" moment as shown; a new buy makes a new one. */
export const readyKey = (id: number, buys: number) => `${id}:${buys}`
