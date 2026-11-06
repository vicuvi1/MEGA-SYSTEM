// Rewards that unlock with a goal or a streak (pure, FT21): "Headphones
// unlock when the Rust goal is done". Points are still earned the honest way;
// the lock only decides when you may spend them on this reward.
export const REWARD_UNLOCKS = 'reward_unlocks'

export type StreakId = 'workout' | 'focus' | 'clean' | 'wake'
/** "Unlock by doing": a count of real logged things in a window (this week, or the last 7 nights). */
export type DeedId = 'focusHours' | 'codeHours' | 'workouts' | 'sleepNights' | 'waterDays'
export type Unlock = { kind: 'goal'; goalId: number; title: string } | { kind: 'streak'; streak: StreakId; days: number } | { kind: 'deed'; deed: DeedId; target: number }

/** How each deed reads: "10 h of focus this week". `unit` follows the number. */
export const DEED_LABEL: Record<DeedId, { label: string; unit: string; window: string; max: number }> = {
  focusHours: { label: 'focus', unit: 'h', window: 'this week', max: 80 },
  codeHours: { label: 'coding or security practice', unit: 'h', window: 'this week', max: 80 },
  workouts: { label: 'workouts', unit: '', window: 'this week', max: 7 },
  sleepNights: { label: 'nights on time', unit: '', window: 'in the last 7', max: 7 },
  waterDays: { label: 'days at your water goal', unit: '', window: 'in the last 7', max: 7 }
}
const DEEDS = Object.keys(DEED_LABEL) as DeedId[]
const deedText = (d: DeedId, n: number) => {
  const l = DEED_LABEL[d]
  return l.unit ? `${n} ${l.unit} of ${l.label}` : `${n} ${l.label}`
}
/** "10 h of focus this week", "5 nights on time in the last 7". */
export const deedGoalText = (d: DeedId, target: number) => `${deedText(d, target)} ${DEED_LABEL[d].window}`

export const STREAK_LABEL: Record<StreakId, string> = { workout: 'training', focus: 'focus', clean: 'clean', wake: 'up-on-time' }
const STREAKS = Object.keys(STREAK_LABEL) as StreakId[]

export function cleanUnlocks(v: any): Record<string, Unlock> {
  const out: Record<string, Unlock> = {}
  if (!v || typeof v !== 'object') return out
  for (const [id, u] of Object.entries<any>(v)) {
    if (!/^\d+$/.test(id) || !u) continue
    if (u.kind === 'goal' && Number(u.goalId) > 0) out[id] = { kind: 'goal', goalId: Number(u.goalId), title: String(u.title ?? 'goal').slice(0, 80) }
    else if (u.kind === 'streak' && STREAKS.includes(u.streak) && Number(u.days) >= 1) out[id] = { kind: 'streak', streak: u.streak, days: Math.min(365, Math.round(Number(u.days))) }
    else if (u.kind === 'deed' && DEEDS.includes(u.deed) && Number(u.target) > 0) out[id] = { kind: 'deed', deed: u.deed, target: Math.min(DEED_LABEL[u.deed as DeedId].max, Math.round(Number(u.target) * 2) / 2) }
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
  /** Counts for "unlock by doing" (hours for the hour deeds), from logged rows only. */
  deeds?: Partial<Record<DeedId, number>>
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
  if (u.kind === 'deed') {
    const raw = Math.max(0, f.deeds?.[u.deed] ?? 0)
    const now = Math.floor(raw * 10) / 10
    const l = DEED_LABEL[u.deed]
    return now >= u.target
      ? { met: true, text: `Unlocked: ${deedText(u.deed, now)} ${l.window}`, progress: 1 }
      : { met: false, text: `Unlocks at ${deedGoalText(u.deed, u.target)} (now ${now}${l.unit ? ` ${l.unit}` : ''})`, progress: now / u.target }
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
