// Study Time's timer notices in the app window: a pomodoro done, a break
// over, the planned time reached, one over-time nudge (src/core/studyNotify.ts,
// once each). On the desktop the island shows them with their buttons and
// sound; here a short note shows, and without an island this window plays
// your chosen sound itself.
// The 2-second check runs only while a study block is running: with nothing
// running it was a timer firing all day for nothing (and the soak test's
// busiest hour went over its server-call limit with it on).
import { useEffect, useRef } from 'react'
import { dayKey } from '@core/dates'
import { studyNotice } from '@core/studyNotify'
import { cleanStore, type StudyStore } from '@core/studyTime'
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
    let store: StudyStore | null = null
    const said = new Set<string>()
    const tick = () => {
      if (!run?.blockId || !store) return
      const now = Date.now()
      const n = studyNotice({ run, now, today: dayKey(new Date(now)), store, sessions: [], done: (id) => said.has(id), meeting: false, dayOf: (d) => dayKey(d) })
      if (!n || !n.timer || n.kind === 'forgot') return
      said.add(n.id)
      toastRef.current(`${n.title} · ${n.text}`, 'good')
      // The island rings on the desktop; here only when there is none.
      if (!window.desktop) play(n.sound, { ownSwitch: true })
    }
    const follow = () => {
      const on = !!run?.blockId
      if (on && !timer) timer = setInterval(tick, 2000)
      if (!on && timer) (clearInterval(timer), (timer = null))
    }
    const load = () => {
      void life.focus
        .state()
        .then((s) => {
          if (!alive) return
          run = (s.running as Running) ?? null
          follow()
        })
        .catch(() => {})
      void life.study
        ?.blocks()
        .then((b) => {
          if (alive) store = b ? cleanStore(b) : null
        })
        .catch(() => {})
    }
    load()
    const evs = ['life-focus-changed', 'life-study-changed', 'life-external-changed']
    for (const e of evs) window.addEventListener(e, load)
    return () => {
      alive = false
      if (timer) clearInterval(timer)
      for (const e of evs) window.removeEventListener(e, load)
    }
  }, [])
  return null
}
