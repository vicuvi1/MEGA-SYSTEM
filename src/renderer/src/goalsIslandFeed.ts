// The app window's side of goals on the island: the top goals for the
// snapshot (fetched at most once a minute, at once after a change), the
// check-in peek when one is due, and the island's check-in taps.
import { life } from './bridge'
import { calendarDay } from '@core/dates'
import { goalPeek, islandGoals, type IslandGoal } from '@core/goalsIsland'
import type { IslandAction, IslandAlert } from '@core/islandModel'
import { answerValue } from '@core/goalsBen'

let cache: { at: number; list: IslandGoal[]; values: Record<number, number> } = { at: 0, list: [], values: {} }
if (typeof window !== 'undefined') window.addEventListener('life-goals-changed', () => (cache = { ...cache, at: 0 }))

/** The top goals (rings and quick check-ins) for the island snapshot. */
export async function goalsForIsland(now: number): Promise<IslandGoal[]> {
  if (now - cache.at < 60_000 || !life.extras?.goals) return cache.list
  cache.at = now
  const v = await life.extras.goals([]).catch(() => null)
  if (v) cache = { at: now, list: islandGoals(v.measures), values: Object.fromEntries(v.measures.map((c) => [c.goal.id, c.value])) }
  return cache.list
}

/** "Profit: 3,200 of 5,000 lei · what's the number now?" when a check-in is due (never while busy). */
export function goalAlert(now: number, busy: boolean, dismissed: Record<string, number>): IslandAlert | null {
  return goalPeek(cache.list, { today: calendarDay(new Date(now)), hour: new Date(now).getHours(), busy, dismissed, now }) as IslandAlert | null
}

/** A check-in tap from the island: logs it (or the skip) and says what happened. */
export async function goalAct(a: Extract<IslandAction, { kind: 'goal' }>): Promise<string> {
  const ex = life.extras
  if (!ex?.goalCheckIn) throw new Error('Goals need the web app')
  if (a.op === 'k') {
    await ex.goalSkip(a.goalId)
    cache = { ...cache, at: 0 }
    return '⏭ Skipped this time'
  }
  const cur = cache.values[a.goalId]
  const value = answerValue({ value: cur ?? 0 }, a.op)
  if (value == null || cur == null) throw new Error('Open Goals to type the number')
  const r = await ex.goalCheckIn(a.goalId, value)
  cache = { ...cache, at: 0 }
  return `✅ ${r.card.goal.title}: ${r.card.pct}%${r.done ? ' · goal reached 🏆' : r.milestones.length ? ' · milestone 🎉' : ''}${r.paid ? ` · +${r.paid}` : ''}`
}
