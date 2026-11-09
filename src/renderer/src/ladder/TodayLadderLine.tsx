// One line on Today → Now: the quarter goal that needs you most this week,
// with its actions so far ("Quarter goal: Gain about 4 kg lean · this week
// 3/5 workouts, 5/6 protein days"). A tap opens Goals → This quarter.
import { useCallback, useEffect, useState } from 'react'
import { life } from '../bridge'
import { useLive } from '../live'
import type { Light } from '@core/goalLadder'
import './ladder.css'

export function TodayLadderLine({ onOpen }: { onOpen?: () => void }) {
  const [line, setLine] = useState<{ text: string; light: Light; fix: string | null } | null>(null)
  const load = useCallback(() => {
    life.saga?.ladder
      ?.line()
      .then(setLine)
      .catch(() => setLine(null))
  }, [])
  useEffect(load, [load])
  useLive(load)
  useEffect(() => {
    const names = ['life-saga-changed', 'life-body-changed', 'life-focus-changed', 'life-week-changed']
    for (const n of names) window.addEventListener(n, load)
    return () => {
      for (const n of names) window.removeEventListener(n, load)
    }
  }, [load])
  if (!line?.text) return null
  return (
    <button type="button" className={`ql-today l-${line.light}`} onClick={onOpen} title={line.fix ?? 'Open Goals → This quarter'}>
      <i aria-hidden />
      <span>{line.text}</span>
    </button>
  )
}
