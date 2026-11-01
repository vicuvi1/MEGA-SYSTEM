// Points without the game: focus, finished tasks and must-dos and week goals
// earn most; habits earn a little. A one-time update brings the saved point
// values down to that (only rules still at their old default, so your own
// changes stay), plus the week-goal bonuses.
import type { DB } from './db'
import { getSetting, setSetting } from './settings'
import type { Wallet } from './wallet'

/** rule id → [old default, new value]. */
export const HABIT_POINTS: Record<string, [number, number]> = {
  'sleep.up_on_time': [10, 3],
  'sleep.bed_on_time': [5, 2],
  'discipline.clean_day': [20, 3],
  'discipline.urge_resisted': [10, 2],
  'discipline.oath': [3, 1],
  'discipline.reset': [-20, -5],
  'body.workout_done': [10, 3],
  'face.routine_done': [5, 2],
  'money.under_budget': [5, 2],
  'money.logged': [3, 1],
  'grand_slam.all_four': [50, 5]
}

const FLAG = 'points_v2'

/** Runs once per database; true when it changed something. */
export function applyPointsV2(db: DB): boolean {
  if (getSetting(db, FLAG)) return false
  const upd = db.prepare('UPDATE rules SET coins = ? WHERE id = ? AND coins = ?')
  let n = 0
  for (const [id, [from, to]] of Object.entries(HABIT_POINTS)) n += Number(upd.run(to, id, from).changes ?? 0)
  setSetting(db, FLAG, new Date().toISOString())
  return n > 0
}

/**
 * Five clear rules (points v3): focus +3 per 10 min · must-do +10 ·
 * Todoist task +5 · habit +2 each · week big task +25. Fun costs 1 a minute.
 * Rules still at an earlier default move to these; your own values stay.
 */
export const POINT_RULES = [
  { id: 'focus', label: 'Focus', value: '+3 per 10 min', hint: '50 minutes = +15' },
  { id: 'mustdo', label: 'Must-do done', value: '+10', hint: 'Your 1–3 starred tasks of the day' },
  { id: 'task', label: 'Todoist task done', value: '+5', hint: 'Any task you complete in Todoist' },
  { id: 'habit', label: 'Habit', value: '+2 each', hint: 'Oath, clean day, workout, skincare, spending logged, on-time wake-up' },
  { id: 'big', label: 'Week big task', value: '+25', hint: 'One of your 3 big tasks of the week' }
] as const
export const HABIT_V3 = ['sleep.up_on_time', 'sleep.bed_on_time', 'discipline.clean_day', 'discipline.oath', 'body.workout_done', 'face.routine_done', 'money.logged', 'money.under_budget', 'discipline.urge_resisted']
const FLAG3 = 'points_v3'
/** old defaults (v1 or v2) that move to the v3 values. */
export function applyPointsV3(db: DB): boolean {
  if (getSetting(db, FLAG3)) return false
  let n = 0
  const upd = db.prepare('UPDATE rules SET coins = ? WHERE id = ? AND coins = ?')
  for (const id of HABIT_V3) {
    const olds = [HABIT_POINTS[id]?.[0], HABIT_POINTS[id]?.[1]].filter((v): v is number => typeof v === 'number' && v !== 2)
    for (const old of olds) n += Number(upd.run(2, id, old).changes ?? 0)
  }
  n += Number(upd.run(5, 'tasks.todoist_done', 8).changes ?? 0)
  setSetting(db, FLAG3, new Date().toISOString())
  return n > 0
}

/** Each of the week's big 3 done pays this once. */
export const BIG3_POINTS = 25
/** Reaching the week's chosen focus (a good week in that area) pays this once. */
export const WEEK_FOCUS_POINTS = 50

/** Pays a one-time bonus (ref keeps it once); false when it was already paid. */
export function payOnce(wallet: Wallet, ref: string, coins: number, note: string, now = new Date()): boolean {
  if (wallet.entries().some((e) => e.ref === ref && e.kind !== 'undo')) return false
  wallet.append({ ts: now.toISOString(), day: wallet.today(now), module: 'goals', kind: 'earn', coins, xp: 0, ref, note } as any)
  return true
}
