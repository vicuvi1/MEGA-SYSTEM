// Ben remembers your goals and checks in (pure). Which goal to ask about
// now (once per goal and period, inside the day's caps), the words he uses
// ("Profit goal: you're at 3,200 of 5,000 lei, 41 days left, need +44/day.
// What's the number now?"), the quick answers, the report for goals that
// count themselves, one concrete move when you're behind, the Sunday lines
// and the short "Goals now" part of his prompt.
import { addDays } from './dates'
import { fmtDelta, fmtPair, fmtValue, periodKey, shortDay, sortCards, STATUS_TEXT, type CheckIn, type GoalCard } from './goals'

/** The goal check-ins Ben may send on his own in a day (they also count in his overall daily cap). */
export const GOAL_ASKS_PER_DAY = 2
/** He asks between these hours (local), never at night or first thing. */
export const ASK_FROM_HOUR = 10
export const ASK_TO_HOUR = 21

export interface AskState {
  day: string
  n: number
  /** goal id → the period he last asked (or reported) in. */
  asked: Record<string, string>
  /** goal id → the number in the last report (auto goals). */
  seen: Record<string, number>
}

export const emptyAsks = (day: string): AskState => ({ day, n: 0, asked: {}, seen: {} })

export function cleanAsks(raw: unknown, today: string): AskState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AskState>
  const asked = r.asked && typeof r.asked === 'object' ? Object.fromEntries(Object.entries(r.asked).filter(([, v]) => typeof v === 'string').slice(-60)) : {}
  const seen = r.seen && typeof r.seen === 'object' ? Object.fromEntries(Object.entries(r.seen).filter(([, v]) => Number.isFinite(v)).slice(-60)) : {}
  return { day: today, n: r.day === today ? Math.max(0, Number(r.n) || 0) : 0, asked, seen: seen as Record<string, number> }
}

export type GoalPing = { kind: 'ask'; card: GoalCard } | { kind: 'report'; card: GoalCard; before: number }

/**
 * What to send now (at most one per tick): a manual goal whose check-in is
 * due and not asked this period, else an auto goal whose number moved since
 * the last report (once per period). Nothing outside the hours or past the cap.
 */
export function pickPing(cards: GoalCard[], st: AskState, hour: number): GoalPing | null {
  if (hour < ASK_FROM_HOUR || hour >= ASK_TO_HOUR || st.n >= GOAL_ASKS_PER_DAY) return null
  const today = st.day
  for (const c of sortCards(cards)) {
    const g = c.goal
    const key = periodKey(g.cadence, today, g.startDay)
    if (st.asked[g.id] === key) continue
    if (!c.auto && c.due) return { kind: 'ask', card: c }
    if (c.auto && c.status !== 'done' && today > g.startDay) {
      const before = st.seen[g.id]
      if (before != null && Math.abs(before - c.value) > 1e-9) return { kind: 'report', card: c, before }
    }
  }
  return null
}

/** The state after sending a ping (or seeing an auto goal's number for the first time). */
export function markPing(st: AskState, p: GoalPing): AskState {
  const g = p.card.goal
  return { ...st, n: st.n + 1, asked: { ...st.asked, [g.id]: periodKey(g.cadence, st.day, g.startDay) }, seen: { ...st.seen, [g.id]: p.card.value } }
}

/** Auto goals seen for the first time: remember their number quietly (no message). */
export function seedSeen(st: AskState, cards: GoalCard[]): AskState {
  const fresh = cards.filter((c) => c.auto && st.seen[c.goal.id] == null)
  return fresh.length ? { ...st, seen: { ...st.seen, ...Object.fromEntries(fresh.map((c) => [c.goal.id, c.value])) } } : st
}

const nice = (n: number) => {
  if (n <= 0) return 0
  const p = 10 ** Math.floor(Math.log10(n))
  const k = n / p
  return (k < 1.5 ? 1 : k < 3.5 ? 2 : k < 7.5 ? 5 : 10) * p
}
const PERIOD_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 } as const

/** One tap's step for "+" and "−": about one period's worth of what it takes, rounded nicely. */
export function quickStep(c: GoalCard): number {
  const g = c.goal
  const per = Math.abs(c.perDayNeeded) * PERIOD_DAYS[g.cadence]
  const span = Math.abs(g.target - g.start)
  const raw = per || span / 10
  const step = nice(raw)
  const floor = g.unit === 'kg' || g.unit === 'km' ? 0.1 : 1
  return Math.max(floor, g.unit === 'kg' ? Math.round(step * 10) / 10 : step)
}

/** The quick answers under a check-in: −step, same, +step, skip. `op`: "+50", "-0.5", "s" (same), "k" (skip). */
export function quickAnswers(c: GoalCard): { label: string; op: string }[] {
  const g = c.goal
  const s = quickStep(c)
  const up = g.target >= g.start
  const plus = { label: fmtDelta(g.unit, up ? s : -s, g.unitLabel), op: `${up ? '+' : '-'}${s}` }
  const minus = { label: fmtDelta(g.unit, up ? -s : s, g.unitLabel), op: `${up ? '-' : '+'}${s}` }
  return [minus, { label: 'Same as before', op: 's' }, plus, { label: 'Skip', op: 'k' }]
}

/** The value an answer means ("+50" on 3,200 → 3,250; "=3400" → 3,400; "s" → the same). null for skip. */
export function answerValue(c: Pick<GoalCard, 'value'>, op: string): number | null {
  const o = String(op ?? '').trim()
  if (o === 'k') return null
  if (o === 's') return c.value
  const m = /^([+=-])(\d+(?:\.\d+)?)$/.exec(o)
  if (!m) return null
  const n = Number(m[2])
  return Math.round((m[1] === '=' ? n : m[1] === '+' ? c.value + n : c.value - n) * 100) / 100
}

/** One concrete move when you're behind: what to do, and a button that does it (you still tap). */
export function behindMove(c: GoalCard): { text: string; do: string } | null {
  if (c.status !== 'behind' && c.status !== 'at risk') return null
  const g = c.goal
  const s = g.source
  const subject = (s.kind === 'focus.hours' && s.arg ? s.arg : g.title).slice(0, 28)
  if (s.kind === 'focus.hours') return { text: `Book 50 min on ${subject} today and you're back on the line sooner.`, do: `focus:50:${subject}` }
  if (s.kind === 'body.workouts' || s.kind === 'sport.reps') return { text: 'One short workout today closes part of the gap.', do: 'workout' }
  if (s.kind === 'body.weight') return { text: 'Today: cook at home, no sugary drinks, a 30 min walk.', do: `focus:30:Walk` }
  if (s.kind.startsWith('money.') || g.unit === 'lei' || g.unit === 'eur' || g.unit === 'usd') return { text: `One money move today: 25 min on what brings money in (send the invoice, the offer, the post).`, do: "focus:25:Money move" }
  return { text: `25 min on "${subject}" today moves the number.`, do: `focus:25:${subject}` }
}

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/** "Profit goal: you're at 3,200 of 5,000 lei, 41 days left, need +44 lei/day. What's the number now?" */
export function askText(c: GoalCard): string {
  const g = c.goal
  const v = (n: number) => fmtValue(g.unit, n, g.unitLabel)
  const behind = c.status === 'behind' || c.status === 'at risk'
  const gap = behind ? ` You're ${fmtValue(g.unit, Math.abs(c.expected - c.value), g.unitLabel)} behind the line.` : c.status === 'ahead' ? ' Ahead of the line 😎' : ''
  return `🎯 ${g.title}: you're at ${fmtPair(g.unit, c.value, g.target, g.unitLabel)}, ${days(c.daysLeft)} left${c.need ? `, need ${c.need}` : ''}.${gap} What's the number now?`
}

/** For goals that count themselves: "📈 Profit: 3,450 of 5,000 lei (+250 since last time). On track · 41 days left · need +44 lei/day." */
export function reportText(c: GoalCard, before: number): string {
  const g = c.goal
  const v = (n: number) => fmtValue(g.unit, n, g.unitLabel)
  const change = c.value - before
  const good = g.target >= g.start ? change > 0 : change < 0
  return `${good ? '📈' : '📉'} ${g.title}: ${fmtPair(g.unit, c.value, g.target, g.unitLabel)} (${fmtDelta(g.unit, change, g.unitLabel)} since last time). ${STATUS_TEXT[c.status]} · ${days(c.daysLeft)} left${c.need ? ` · need ${c.need}` : ''}.`
}

/** The goal's number about a week ago (for the Sunday lines). */
export function valueOn(c: GoalCard, day: string): number {
  const before = c.series.filter((p) => p.day <= day)
  return before.length ? before[before.length - 1].value : c.goal.start
}

/** The Sunday review: one line per open goal, this week's change and where it stands. */
export function weeklyGoalLines(cards: GoalCard[], today: string): string[] {
  return sortCards(cards)
    .filter((c) => c.status !== 'missed')
    .slice(0, 5)
    .map((c) => {
      const g = c.goal
      const was = valueOn(c, addDays(today, -7))
      const change = c.value - was
      return `🎯 ${g.title}: ${fmtPair(g.unit, c.value, g.target, g.unitLabel)}${change ? ` (${fmtDelta(g.unit, change, g.unitLabel)} this week)` : ' (no change this week)'} · ${STATUS_TEXT[c.status].toLowerCase()}${c.status === 'done' ? '' : ` · ${days(c.daysLeft)} left`}${c.streak > 1 ? ` · ${c.streak} check-ins in a row` : ''}`
    })
}

/** G1, G2…: the refs Ben uses in "goalcheck: G1 | 3400". */
export const goalRef = (i: number) => `G${i + 1}`

/**
 * The short "Goals now" part of Ben's prompt: the top 3 with their status,
 * and the two lines he needs to act on them. Kept small on purpose.
 */
export function goalsNowText(cards: GoalCard[]): string {
  const open = sortCards(cards).filter((c) => c.status !== 'done' && c.status !== 'missed').slice(0, 3)
  if (!open.length) return 'Measurable goals: none yet. When he names a clear target with a number ("profit 5k by December"), offer it as a goal: "goal: <his words>" (he confirms with a tap).'
  const lines = open.map((c, i) => {
    const g = c.goal
    const v = (n: number) => fmtValue(g.unit, n, g.unitLabel)
    return `- ${goalRef(i)} ${g.title}: ${fmtPair(g.unit, c.value, g.target, g.unitLabel)} by ${shortDay(g.deadline)} (${c.pct}%, line says ${v(c.expected)}), ${STATUS_TEXT[c.status].toLowerCase()}, ${days(c.daysLeft)} left${c.need ? `, need ${c.need}` : ''}${c.auto ? ', counts itself' : c.due ? ', CHECK-IN DUE' : ''}${g.why ? `. Why: ${g.why.slice(0, 60)}` : ''}`
  })
  return [
    'Goals now (measurable; tie today to these, push the one behind):',
    ...lines,
    'When he tells you a goal\'s new number, add "goalcheck: G1 | 3400". A new clear goal from his words: "goal: raise profit to 5000 lei by 31 Dec" (he confirms with a tap).'
  ].join('\n')
}

/** Which goal "G2" or a title means. */
export function findGoal<T extends { goal: { id: number; title: string } }>(cards: T[], ref: string, order: T[] = cards): T | null {
  const r = String(ref ?? '').trim()
  const m = /^G(\d{1,2})$/i.exec(r)
  if (m) return order[Number(m[1]) - 1] ?? null
  const want = r.toLowerCase()
  if (!want) return null
  return cards.find((c) => c.goal.title.toLowerCase() === want) ?? cards.find((c) => c.goal.title.toLowerCase().includes(want) || want.includes(c.goal.title.toLowerCase())) ?? null
}

/** Points for check-ins: honest and small (rules goal.checkin and goal.milestone). */
export const CHECKIN_RULE = 'goal.checkin'
export const MILESTONE_RULE = 'goal.milestone'
export const checkinRef = (goalId: number, period: string) => `goalci:${goalId}:${period}`
export const milestoneRef = (goalId: number, index: number | 'done') => `goalms:${goalId}:${index}`

/** The check-ins of the last 7 days, newest first (the weekly line and the island). */
export const recentCheckins = (list: CheckIn[], today: string) => list.filter((c) => c.day > addDays(today, -7)).sort((a, b) => b.at.localeCompare(a.at))
