// Study Time's reminder in the app window: when a planned block reaches its
// length or a break with a length ends, a short note shows (once each). On
// the desktop the island rings for both (its "time is up" and "Break's
// over" cards); without an island this window plays the sound itself.
// The 2-second check runs only while a study block is running: with nothing
// running it was a timer firing all day for nothing (and the soak test's
// busiest hour went over its server-call limit with it on).
import { useEffect, useRef } from 'react'
import { alarmDue } from '@core/studyTime'
import { life } from '../bridge'
import { play } from '../soundKit'
import { useToast } from '../ui'
import type { Running } from './studyData'

export function StudyAlarm() {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setInterval> | null = null
    let run: Running | null = null
    const said = new Set<string>()
    const tick = () => {
      const due = alarmDue(run, Date.now(), said)
      if (!due) return
      said.add(due.key)
      toastRef.current(due.text, 'good')
      // The island rings on the desktop; here only when there is none.
      if (!window.desktop) play('focusEnd', { ownSwitch: true })
    }
    const follow = () => {
      const on = !!run?.blockId
      if (on && !timer) timer = setInterval(tick, 2000)
      if (!on && timer) (clearInterval(timer), (timer = null))
    }
    const load = () =>
      life.focus
        .state()
        .then((s) => {
          if (!alive) return
          run = (s.running as Running) ?? null
          follow()
        })
        .catch(() => {})
    void load()
    const evs = ['life-focus-changed', 'life-external-changed']
    for (const e of evs) window.addEventListener(e, load)
    return () => {
      alive = false
      if (timer) clearInterval(timer)
      for (const e of evs) window.removeEventListener(e, load)
    }
  }, [])
  return null
}
