// Rewards 2, the app side: what you did (read from the logged rows on the
// browser's copy of the database), the suggestions built from it, where this
// week's points came from, the "unlock by doing" numbers, the weekly mystery
// reward and Ben's gentle note on fun spending. Pure logic lives in
// core/rewardActivity, rewardSuggest, rewardGuard and rewardSurprise.
import { addDays } from '@core/dates'
import { activity, type Activity } from '@core/rewardActivity'
import { suggest, type Suggestion } from '@core/rewardSuggest'
import { funPace, type FunPace } from '@core/rewardGuard'
import type { MysteryState } from '@core/rewardSurprise'
import type { DeedId } from '@core/unlocks'
import type { ShopValue } from '@shared/api'
import { totalsOf, WATER_KIND } from '@core/bodyLog'
import { cleanKit } from '@core/islandTiles'
import { readSetting } from '../../../main/settings'
import { bodyEvents } from '../../../main/bodyLog'
import type { Services } from './webServices'

const rows = <T>(db: any, sql: string, ...args: unknown[]): T[] => {
  try {
    return db.prepare(sql).all(...args) as T[]
  } catch {
    return []
  }
}

/** What you did lately, from logged rows only. */
export function activityOf(s: Services, now = new Date()): Activity {
  const today = s.wallet.today(now)
  const from = addDays(today, -21)
  const focus = rows<{ day: string; subject: string; minutes: number }>(s.db, 'SELECT day, subject, minutes FROM focus_sessions WHERE day >= ?', from)
  const workoutDays = rows<{ day: string }>(s.db, 'SELECT DISTINCT day FROM workouts WHERE day >= ?', addDays(today, -60)).map((r) => r.day)
  const sleep = rows<{ day: string; on_time: number; bed_on_time: number | null }>(s.db, 'SELECT day, on_time, bed_on_time FROM sleep_logs WHERE day >= ?', from).map((r) => ({ day: r.day, onTime: !!r.on_time, bedOnTime: r.bed_on_time == null ? null : !!r.bed_on_time }))
  const events = bodyEvents(s.db, addDays(today, -7), today)
  const water: Record<string, number> = {}
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, -i)
    water[d] = totalsOf(events, d)[WATER_KIND] ?? 0
  }
  let musicSaved = 0
  try {
    const kit = cleanKit(readSetting(s.db, 'island_kit'))
    musicSaved = kit.music.favs.length + kit.music.stations.length
  } catch {
    musicSaved = 0
  }
  let workoutStreak: number | undefined
  try {
    workoutStreak = s.body.state(now).streak
  } catch {
    workoutStreak = undefined
  }
  const funRewardIds = rows<{ id: number }>(s.db, "SELECT id FROM rewards WHERE category = 'fun'").map((r) => r.id)
  return activity({ today, ledger: s.wallet.entries(), focus, workoutDays, sleep, water, musicSaved, workoutStreak, funRewardIds })
}

/** The numbers "unlock by doing" reads. */
export const deedsOf = (a: Activity): Record<DeedId, number> => ({
  focusHours: a.focusMinWeek / 60,
  codeHours: (a.focusByKind.code + a.focusByKind.security) / 60,
  workouts: a.workoutsWeek,
  sleepNights: a.sleepNights7,
  waterDays: a.waterDays7
})

export interface RewardsMore {
  activity: Activity
  suggestions: Suggestion[]
  /** Starter rewards you unlock by doing (a streak or a week's work), ranked the same way. */
  unlockIdeas: Suggestion[]
  pace: FunPace
  mystery: MysteryState
}

export function rewardsMore(s: Services, value: ShopValue | null, now = new Date()): RewardsMore {
  const a = activityOf(s, now)
  const st = s.shop.state(now)
  const live = st.rewards.filter((r) => !r.archived)
  const today = a.today
  const dim = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate()
  const pace = funPace({ earnedWeek: a.earnedWeek, funSpentWeek: a.funSpentWeek, funBudgetLei: value?.funBudgetLei ?? null, funLeftLei: value?.funLeftLei ?? null, dayOfMonth: Number(today.slice(8, 10)), daysInMonth: dim })
  const input = {
    activity: a,
    balance: st.balance,
    perDay: st.earnPerDay ?? 0,
    have: live.map((r) => r.title),
    hidden: s.shop.hiddenSuggestions(),
    hasGoal: live.some((r) => r.goalRank),
    funOver: pace.level === 'over'
  }
  const suggestions = suggest(input)
  const shown = new Set(suggestions.map((x) => x.starter.key))
  const unlockIdeas = suggest({ ...input, limit: 6, only: (x) => !!x.unlock && !shown.has(x.key) })
  let plan = null
  try {
    plan = s.weekPlan.active(now)
  } catch {
    plan = null
  }
  return { activity: a, suggestions, unlockIdeas, pace, mystery: s.shop.mystery(plan, now) }
}
