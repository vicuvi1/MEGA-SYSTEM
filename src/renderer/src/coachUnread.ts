// Live presence: messages the coach sends on its own (check-ins, plans,
// reviews, nudges) show up while you're elsewhere in the app: a toast with
// its face, a soft chime, and a count on Coach until you open it.
import { useCallback, useEffect, useRef, useState } from 'react'
import { MOOD_FACE, type Mood } from '@core/coachKit'
import { life } from './bridge'
import { useLive } from './live'
import { soundSystemOracle } from './sound'
import { useToast } from './ui'

const SEEN = 'ls.coachSeen'
const read = () => {
  try {
    return Number(localStorage.getItem(SEEN) || 0)
  } catch {
    return 0
  }
}
const write = (t: number) => {
  try {
    localStorage.setItem(SEEN, String(t))
  } catch {
    /* private window: the count just resets */
  }
}

export function useCoachUnread(onCoachPage: boolean, sound = true): number {
  const toast = useToast()
  const [n, setN] = useState(0)
  const last = useRef<string | null>(null)
  const check = useCallback(async () => {
    if (!life.coach) return
    const log = await life.coach.log().catch(() => null)
    if (!log) return
    let seen = read()
    if (!seen || onCoachPage) {
      seen = Date.now()
      write(seen)
    }
    const fresh = log.filter((e) => e.role === 'coach' && e.via !== 'app' && e.via !== 'mcp' && Date.parse(e.at) > seen)
    setN(onCoachPage ? 0 : fresh.length)
    const newest = fresh[fresh.length - 1]
    if (newest && newest.at !== last.current && !onCoachPage) {
      // The badge only (N1): the bell's notification is the one alert for it
      // (it was a second card and a second sound, ignoring quiet hours).
      last.current = newest.at
    } else if (last.current === null) last.current = newest?.at ?? ''
  }, [onCoachPage, toast, sound])
  useEffect(() => {
    void check()
    const t = setInterval(() => void check(), 45_000)
    return () => clearInterval(t)
  }, [check])
  useLive(() => void check())
  return n
}
