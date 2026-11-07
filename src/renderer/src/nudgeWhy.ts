// "Why didn't I get a reminder?" (Settings → Island): the island's chain runs
// through dayNudgeLogged(), which keeps the last reason each nudge kind was
// not shown (core/dayNudges.ts nudgeWhy). Kept in this app window's storage.
import { dayNudge, nudgeWhy, type DayNudge, type DayNudgeInput, type WhyKind } from '@core/dayNudges'

const KEY = 'ls.nudgeWhy'
export type WhyLine = { why: string; at: number }
export type WhyMap = Partial<Record<WhyKind, WhyLine>>

export function readNudgeWhy(): WhyMap {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    return v && typeof v === 'object' ? (v as WhyMap) : {}
  } catch {
    return {}
  }
}

/** dayNudge(), and the reason of each kind written down (only when it changed, so the time stays the first time). */
export function dayNudgeLogged(i: DayNudgeInput): DayNudge {
  const r = dayNudge(i)
  try {
    const prev = readNudgeWhy()
    const next: WhyMap = { ...prev }
    let changed = false
    for (const [k, why] of Object.entries(nudgeWhy(i, r)) as [WhyKind, string][]) {
      if (prev[k]?.why !== why) {
        next[k] = { why, at: i.now }
        changed = true
      }
    }
    if (changed) localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* fine */
  }
  return r
}
