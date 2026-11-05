// A focus timer's sounds, wherever the timer is shown (the app's focus island
// on the website, the desktop island on Windows: one place at a time).
// SO2: a low swell when it starts, a gong when time is up. SO6: your
// background sound fades in and out with it. SO7: a very quiet tick in each
// of the last 10 seconds. SO5: the island's sounds lean toward its side.
import { useEffect, useRef } from 'react'
import { lastTenSecond, panFor } from '@core/sounds'
import { play, setInMeeting, setPan, soundPrefs, startBed, stopBed } from './soundKit'

export interface FocusRun { startedAt: number; endsAt: number }

export function useFocusSound(run: FocusRun | null, chime = true): void {
  const key = run ? `${run.startedAt}` : null
  const prev = useRef<string | null | undefined>(undefined)
  const ended = useRef<string | null>(null)
  const endsAt = run?.endsAt ?? 0
  // Started / stopped.
  useEffect(() => {
    const was = prev.current
    prev.current = key
    if (key && key !== was) {
      // Already running when the page opened: just the background, no swell.
      if (was !== undefined) play('focusStart')
      if (Date.now() < endsAt) startBed()
    } else if (!key && was) stopBed()
  }, [key, endsAt])
  useEffect(() => () => stopBed(), [])
  // The last 10 seconds, then the gong.
  useEffect(() => {
    if (!key) return
    let lastSec: number | null = null
    let t: ReturnType<typeof setTimeout> | null = null
    const step = () => {
      const left = endsAt - Date.now()
      if (left <= 0) {
        if (ended.current !== key) {
          ended.current = key
          stopBed()
          // Only a timer that ran out now (not one long over when the page opened).
          if (chime && left > -5000) play('focusEnd')
        }
        return
      }
      const sec = lastTenSecond(left)
      if (sec !== null && sec !== lastSec) {
        lastSec = sec
        if (soundPrefs().lastTen) play('lastTick')
      }
      // Sleep until the last 10 seconds, then wake each quarter second.
      t = setTimeout(step, left > 11_000 ? Math.min(left - 10_500, 60_000) : 250)
    }
    step()
    return () => {
      if (t) clearTimeout(t)
    }
  }, [key, endsAt, chime])
}

/** The desktop island: its side of the screen, its calls and its timer. */
export function useIslandSounds(place: string, inCall: boolean, run: FocusRun | null): void {
  useEffect(() => setPan(panFor(place)), [place])
  useEffect(() => setInMeeting(inCall), [inCall])
  useFocusSound(run)
}
