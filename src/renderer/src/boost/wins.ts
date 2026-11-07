// LF20: the victory clip on a big win, through the one SoundCloud player.
// core/winMoments.ts decides (opt-in, a track picked, not in a meeting or
// quiet hours, not over your own music, one per 10 minutes); this plays it
// and pauses it again after the clip's seconds. A small toast says which win.
import { winClip, winTitle, type WinKind } from '@core/winMoments'
import { inQuiet } from '@core/benPushes'
import { playCheck } from '../soundKit'
import { boostNow, loadBoost, musicCmd, musicPlaying, playUrl, WIN_EVENT } from './boostBus'

let lastAt: number | null = null
let stopTimer = 0
const listeners = new Set<(w: { kind: WinKind; title: string; track: string }) => void>()
/** The host shows a small "victory" card while the clip plays. */
export const onWinClip = (f: (w: { kind: WinKind; title: string; track: string }) => void) => (listeners.add(f), () => void listeners.delete(f))

export async function playWin(kind: WinKind, now = Date.now()): Promise<string | null> {
  const prefs = (await loadBoost().catch(() => boostNow())).wins
  const pc = playCheck()
  const d = winClip({ prefs, kind, now, meeting: pc.meeting, quiet: inQuiet(now, pc.quiet.on ? pc.quiet : null), musicPlaying: musicPlaying(), lastAt })
  if (!d.play) return d.why
  if (!playUrl(d.track.url, d.track.name)) return 'that track can’t play'
  lastAt = now
  listeners.forEach((f) => f({ kind, title: winTitle(kind), track: d.track.name }))
  clearTimeout(stopTimer)
  stopTimer = window.setTimeout(() => musicCmd({ op: 'pause' }), d.ms)
  return null
}

let installed = false
/** Listens for `life-win` (once per page). */
export function installWins(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener(WIN_EVENT, (e) => {
    const k = (e as CustomEvent<{ kind?: WinKind }>).detail?.kind
    if (k) void playWin(k).catch(() => {})
  })
}
