// The coach card's data (life.coach.today.view), reloaded when food, body,
// Sport Track or the coach change. The day's line is asked once after the
// first view (the AI once a morning, kept; a template otherwise), and again
// when the plan changes (a workout logged, a session moved).
import { useCallback, useEffect, useRef, useState } from 'react'
import { life } from '../bridge'
import { useLive } from '../live'
import { readSport } from '../sportTrack'
import { planKey } from '@core/coachText'
import type { CoachView } from './coachApi'

const EVENTS = ['life-coach-changed', 'life-body-changed', 'life-sport-changed', 'life-food-changed']

export const sportNow = () => {
  try {
    return readSport() ?? undefined
  } catch {
    return undefined
  }
}

export function useCoach(): { v: CoachView | null; reload: () => void; set: (v: CoachView) => void } {
  const [v, setV] = useState<CoachView | null>(null)
  const asked = useRef('')
  const reload = useCallback(() => {
    const api = life.coach?.today
    if (!api) return
    api
      .view(sportNow())
      .then((x) => {
        setV(x)
        // The line: once per day and plan (the API keeps it; the AI is asked at most a few times a day).
        const key = `${x.today}|${planKey(x.plan)}`
        if (asked.current !== key) {
          asked.current = key
          void api
            .line(sportNow())
            .then((l) => l && setV((cur) => (cur && cur.today === x.today ? { ...cur, line: l } : cur)))
            .catch(() => {})
        }
      })
      .catch(() => {})
  }, [])
  useEffect(reload, [reload])
  useLive(reload)
  useEffect(() => {
    const on = (e: Event) => {
      // Sport Track's own sums coming back change nothing here.
      if ((e as CustomEvent).detail?.echo) return
      reload()
    }
    for (const n of EVENTS) window.addEventListener(n, on)
    return () => {
      for (const n of EVENTS) window.removeEventListener(n, on)
    }
  }, [reload])
  return { v, reload, set: setV }
}
