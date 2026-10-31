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
