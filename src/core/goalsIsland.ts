// Goals on the desktop island (pure): the small rows the Goals page and the
// tile show (a ring, the number, "need +44/day"), and the check-in peek that
// drops down when one is due ("Profit: 3,200 of 5,000 lei · what's the
// number now?" with −, Same as before, + and Skip). The app window builds
// these from the goal cards; the island only draws them and sends taps.
import { fmtPair, shortDay, sortCards, STATUS_TEXT, type GoalCard, type GoalStatus } from './goals'
import { quickAnswers } from './goalsBen'

export interface IslandGoal {
  id: number
  title: string
  pct: number
  expectedPct: number
  status: GoalStatus
  statusText: string
  /** "3,200 of 5,000 lei" */
  value: string
  need: string
  daysLeft: number
  due: boolean
  auto: boolean
  /** −step, Same, +step, Skip (manual goals only). */
  quick: { label: string; op: string }[]
}

export function islandGoals(cards: GoalCard[], max = 4): IslandGoal[] {
  return sortCards(cards)
    .filter((c) => c.status !== 'missed')
    .slice(0, max)
    .map((c) => ({
      id: c.goal.id,
      title: c.goal.title,
      pct: c.pct,
      expectedPct: c.expectedPct,
      status: c.status,
      statusText: STATUS_TEXT[c.status],
      value: fmtPair(c.goal.unit, c.value, c.goal.target, c.goal.unitLabel),
      need: c.need,
      daysLeft: c.daysLeft,
      due: c.due,
      auto: c.auto,
      quick: c.auto || c.status === 'done' ? [] : quickAnswers(c)
    }))
}

/** The id a goal's check-in peek has in a period (dismissing it hides it for that period). */
export const goalAlertId = (g: IslandGoal, today: string) => `goal:${g.id}:${today}`

/**
 * The check-in peek: the first goal that's due, not dismissed, only while
 * you're not busy (no timer, no call) and in the day hours.
 */
export function goalPeek(goals: IslandGoal[], o: { today: string; hour: number; busy: boolean; dismissed: Record<string, number>; now: number }) {
  if (o.busy || o.hour < 10 || o.hour >= 21) return null
  const g = goals.find((x) => x.due && !x.auto && (o.dismissed[goalAlertId(x, o.today)] ?? 0) <= o.now)
  if (!g) return null
  const id = goalAlertId(g, o.today)
  const [minus, same, plus, skip] = g.quick
  return {
    id,
    kind: 'goal' as const,
    title: g.title,
    face: '🎯',
    text: `${g.value} · ${g.daysLeft} day${g.daysLeft === 1 ? '' : 's'} left${g.need ? ` · need ${g.need}` : ''}. What's the number now?`,
    actions: [plus, same, minus, skip]
      .filter(Boolean)
      .slice(0, 3)
      .map((q, i) => ({ label: q.label, primary: i === 0, action: { kind: 'goal' as const, goalId: g.id, op: q.op, alertId: id } }))
  }
}

/** "by 31 Dec" for small places. */
export const byDay = (deadline: string) => `by ${shortDay(deadline)}`
