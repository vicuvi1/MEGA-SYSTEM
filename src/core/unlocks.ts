// Rewards that unlock with a goal or a streak (pure, FT21): "Headphones
// unlock when the Rust goal is done". Points are still earned the honest way;
// the lock only decides when you may spend them on this reward.
export const REWARD_UNLOCKS = 'reward_unlocks'

export type StreakId = 'workout' | 'focus' | 'clean' | 'wake'
export type Unlock = { kind: 'goal'; goalId: number; title: string } | { kind: 'streak'; streak: StreakId; days: number }

export const STREAK_LABEL: Record<StreakId, string> = { workout: 'training', focus: 'focus', clean: 'clean', wake: 'up-on-time' }
const STREAKS = Object.keys(STREAK_LABEL) as StreakId[]

export function cleanUnlocks(v: any): Record<string, Unlock> {
  const out: Record<string, Unlock> = {}
  if (!v || typeof v !== 'object') return out
  for (const [id, u] of Object.entries<any>(v)) {
    if (!/^\d+$/.test(id) || !u) continue
    if (u.kind === 'goal' && Number(u.goalId) > 0) out[id] = { kind: 'goal', goalId: Number(u.goalId), title: String(u.title ?? 'goal').slice(0, 80) }
    else if (u.kind === 'streak' && STREAKS.includes(u.streak) && Number(u.days) >= 1) out[id] = { kind: 'streak', streak: u.streak, days: Math.min(365, Math.round(Number(u.days))) }
  }
  return out
}

export function setUnlock(all: Record<string, Unlock>, rewardId: number, u: Unlock | null): Record<string, Unlock> {
  const next = { ...all }
  if (u) next[String(rewardId)] = u
  else delete next[String(rewardId)]
  return cleanUnlocks(next)
}

export interface UnlockFacts {
  /** Your goals with deadlines: done = no hours left. */
  goals: { id: number; title: string; done: boolean }[]
  /** Current streaks in days. */
  streaks: Partial<Record<StreakId, number>>
}

export interface UnlockState {
  met: boolean
  /** "Unlocks when Rust book is done" / "Unlocked: Rust book done". */
  text: string
  /** 0..1 for a small bar. */
  progress: number
}

export function unlockState(u: Unlock, f: UnlockFacts): UnlockState {
  if (u.kind === 'goal') {
    const g = f.goals.find((x) => x.id === u.goalId)
    if (!g) return { met: false, text: `Unlocks with the goal "${u.title}" (that goal is no longer on your list: pick another lock)`, progress: 0 }
    return g.done ? { met: true, text: `Unlocked: ${g.title} is done`, progress: 1 } : { met: false, text: `Unlocks when "${g.title}" is done`, progress: 0 }
  }
  const cur = Math.max(0, f.streaks[u.streak] ?? 0)
  const label = STREAK_LABEL[u.streak]
  return cur >= u.days ? { met: true, text: `Unlocked: ${cur}-day ${label} streak`, progress: 1 } : { met: false, text: `Unlocks at a ${u.days}-day ${label} streak (now ${cur})`, progress: cur / u.days }
}

/** The reason a reward can't be bought yet because of its lock, or null. */
export function unlockBlocker(u: Unlock | undefined | null, f: UnlockFacts): string | null {
  if (!u) return null
  const s = unlockState(u, f)
  return s.met ? null : s.text
}
