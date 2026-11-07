// DX12: the island player's rule for "only during workout / boring tasks"
// music (core/musicOnly.ts). Marked music that starts at another time pauses
// at once with a short why; when a matching timer starts and nothing plays,
// the first marked station starts by itself. Used by ScHost (IslandMusic.tsx),
// which lives in the island window on the desktop.
import { useEffect, useRef } from 'react'
import type { MusicKit } from '@core/music'
import { mayPlay, pausedWhy, stationFor, timerMode } from '@core/musicOnly'
import { getState, playStation, sc, set, subscribe } from '../music/engine'

export function useOnlyDuring(o: { music?: MusicKit; running: boolean; subject?: string | null; call: boolean }): void {
  const only = o.music?.onlyDuring
  const mode = timerMode(o.running ? o.subject ?? null : null)
  const ref = useRef({ only, mode })
  ref.current = { only, mode }
  // Marked music outside its timer: paused, with the reason on the player.
  useEffect(
    () =>
      subscribe(() => {
        const s = getState()
        const { only: on, mode: m } = ref.current
        if (!on || !s.playing) return
        const url = s.station?.url
        if (url && !mayPlay(url, on, m)) {
          sc.pause()
          set({ error: pausedWhy(on[url]) })
        }
      }),
    []
  )
  // A workout or boring-task timer starts: its music, when nothing else plays.
  const was = useRef<string | null>(null)
  useEffect(() => {
    const key = o.running ? `${mode}` : null
    const started = key && key !== was.current
    was.current = key
    if (!started || !only || o.call) return
    const st = stationFor(o.music?.stations ?? [], only, mode)
    const now = getState()
    if (st && !now.playing) playStation(st)
    // Timer over: marked music stops with it.
  }, [o.running, mode, only, o.call, o.music?.stations])
  useEffect(() => {
    const s = getState()
    if (!o.running && only && s.playing && s.station?.url && only[s.station.url]) sc.pause()
  }, [o.running, only])
}
