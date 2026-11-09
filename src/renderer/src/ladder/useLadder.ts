// The goal ladder's screen data (life.saga.ladder.view), reloaded when the
// ladder, the goals, the week plan or any log changes.
import { useCallback, useEffect, useState } from 'react'
import { life } from '../bridge'
import { useLive } from '../live'
import type { LadderScreen } from '../web/ladderApi'

const EVENTS = ['life-saga-changed', 'life-goals-changed', 'life-week-changed', 'life-body-changed', 'life-focus-changed', 'life-wallet-changed']

export function useLadder(): { v: LadderScreen | null; reload: () => void; error: string | null } {
  const [v, setV] = useState<LadderScreen | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(() => {
    const api = life.saga?.ladder
    if (!api) {
      setError('The goal ladder needs the web app')
      return
    }
    api
      .view()
      .then((x) => {
        setV(x)
        setError(null)
      })
      .catch((e) => setError((e as Error).message))
  }, [])
  useEffect(reload, [reload])
  useLive(reload)
  useEffect(() => {
    const on = () => reload()
    for (const n of EVENTS) window.addEventListener(n, on)
    return () => {
      for (const n of EVENTS) window.removeEventListener(n, on)
    }
  }, [reload])
  return { v, reload, error }
}
