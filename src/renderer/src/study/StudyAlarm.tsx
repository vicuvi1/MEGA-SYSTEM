// Study Time's reminder in the app window: when a planned block reaches its
// length or a break with a length ends, a short note shows (once each). On
// the desktop the island rings for both (its "time is up" and "Break's
// over" cards); without an island this window plays the sound itself.
import { useEffect, useRef } from 'react'
import { alarmDue } from '@core/studyTime'
import { life } from '../bridge'
import { play } from '../soundKit'
import { useToast } from '../ui'
import type { Running } from './studyData'

export function StudyAlarm() {
  const toast = useToast()
  const said = useRef(new Set<string>())
  const run = useRef<Running | null>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      life.focus
        .state()
        .then((s) => {
          if (alive) run.current = (s.running as Running) ?? null
        })
        .catch(() => {})
    void load()
    const evs = ['life-focus-changed', 'life-external-changed']
    for (const e of evs) window.addEventListener(e, load)
    const t = setInterval(() => {
      const due = alarmDue(run.current, Date.now(), said.current)
      if (!due) return
      said.current.add(due.key)
      toast(due.text, 'good')
      // The island rings on the desktop; here only when there is none.
      if (!window.desktop) play('focusEnd', { ownSwitch: true })
    }, 2000)
    return () => {
      alive = false
      clearInterval(t)
      for (const e of evs) window.removeEventListener(e, load)
    }
  }, [toast])
  return null
}
