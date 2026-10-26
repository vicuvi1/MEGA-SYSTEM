// Daily quests: three goals picked from a pool for each day (same three all
// day), checked against that day's wallet entries. All three done = a bonus.
import { effective, type LedgerEntry } from './ledger'

export interface QuestDef {
  id: string
  title: string
  goal: number
  count: (day: LedgerEntry[]) => number
}

const rule = (id: string) => (day: LedgerEntry[]) => day.filter((e) => e.ruleId === id).length

export const QUEST_POOL: QuestDef[] = [
  { id: 'study2', title: 'Finish 2 study blocks', goal: 2, count: rule('study.block_done') },
  { id: 'wake', title: 'Wake up on time', goal: 1, count: rule('sleep.up_on_time') },
  { id: 'bed', title: 'Be in bed on time', goal: 1, count: rule('sleep.bed_on_time') },
  { id: 'money', title: 'Log your spending', goal: 1, count: rule('money.logged') },
  { id: 'tasks3', title: 'Complete 3 tasks', goal: 3, count: (d) => d.filter((e) => e.ref?.startsWith('task:')).length },
  { id: 'clean', title: 'Check in clean', goal: 1, count: rule('discipline.clean_day') },
  { id: 'workout', title: 'Work out', goal: 1, count: rule('body.workout_done') },
  { id: 'face', title: 'Do your skincare', goal: 1, count: rule('face.routine_done') },
  { id: 'earn60', title: 'Earn 60 coins', goal: 60, count: (d) => d.reduce((s, e) => s + Math.max(0, e.coins), 0) }
]

export const QUEST_BONUS = { coins: 30, xp: 50 }

function hash(s: string): number {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

/** The day's three quests, always the same for the same day. */
export function questsFor(day: string): QuestDef[] {
  return QUEST_POOL.map((q) => ({ q, k: hash(`${day}:${q.id}`) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, 3)
    .map((x) => x.q)
}

export const questRef = (day: string) => `quest:${day}`

export interface QuestState {
  day: string
  quests: { id: string; title: string; goal: number; progress: number; done: boolean }[]
  allDone: boolean
  claimed: boolean
  bonus: typeof QUEST_BONUS
}

export function questState(day: string, entries: LedgerEntry[]): QuestState {
  const live = effective(entries)
  // Quest bonuses themselves don't count toward "earn 60 coins".
  const today = live.filter((e) => e.day === day && !e.ref?.startsWith('quest:'))
  const quests = questsFor(day).map((q) => {
    const progress = Math.min(q.goal, q.count(today))
    return { id: q.id, title: q.title, goal: q.goal, progress, done: progress >= q.goal }
  })
  return { day, quests, allDone: quests.every((q) => q.done), claimed: live.some((e) => e.ref === questRef(day)), bonus: QUEST_BONUS }
}
