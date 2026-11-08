// Your planner limits and the week plan on this page (synced settings
// plan_limits and plan_week): one copy for the Coach editor, the Week card and
// the plan card, read once and kept fresh after a save.
import { useEffect, useState } from 'react'
import { NO_LIMITS, type PlanLimits } from '@core/planLimits'
import { EMPTY_WEEK, type WeekShape } from '@core/planWeek'
import { life } from '../bridge'

export type PlanSetup = { limits: PlanLimits; week: WeekShape }

let cache: PlanSetup | null = null
let loading: Promise<PlanSetup | null> | null = null
const subs = new Set<(s: PlanSetup) => void>()
const tell = (s: PlanSetup) => {
  cache = s
  for (const f of subs) f(s)
}

export function loadSetup(force = false): Promise<PlanSetup | null> {
  if (cache && !force) return Promise.resolve(cache)
  if (!life.coach?.planSetup) return Promise.resolve(null)
  if (!loading || force)
    loading = life.coach
      .planSetup()
      .then((s) => (tell(s), s))
      .catch(() => null)
      .finally(() => (loading = null))
  return loading
}

/** Saves a change and tells every card on screen. */
export async function saveSetup(patch: { limits?: Partial<PlanLimits>; week?: WeekShape }): Promise<PlanSetup | null> {
  if (!life.coach?.planSetup) return null
  const s = await life.coach.planSetup(patch)
  tell(s)
  return s
}

/** The limits and week plan (null until read; the defaults when this app has no store for them). */
export function useSetup(): PlanSetup | null {
  const [s, set] = useState<PlanSetup | null>(cache ?? (life.coach?.planSetup ? null : { limits: NO_LIMITS, week: EMPTY_WEEK }))
  useEffect(() => {
    subs.add(set)
    void loadSetup()
    const again = () => void loadSetup(true)
    window.addEventListener('life-external-changed', again)
    return () => {
      subs.delete(set)
      window.removeEventListener('life-external-changed', again)
    }
  }, [])
  return s
}
