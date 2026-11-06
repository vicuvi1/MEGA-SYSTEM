// MU: the island feels the music. While SoundCloud plays, the opened panel's
// background glows in the artwork's colour and pulses with the beat, the
// pill's equalizer and cover ring pulse with it, and a small "now playing"
// card with the cover shows on the pill when the track changes (with a soft
// bell; Music → Options can turn it off).
//
// Honest note: the "beat" is simulated. SoundCloud's audio plays inside its
// own cross-origin frame, so the page can't analyse it; the tempo comes from
// pseudoBeat() (a calm 70–118 per minute picked from the track's name) and
// everything is driven by the play state alone. Motion is transform and
// opacity only, and stops while paused, hidden, or with reduce motion.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { bigArt, NOW_TOAST_MS, shouldToastTrack } from '@core/music'
import { getState, subscribe, type ScState } from './engine'
import { tintStyle, useTint } from './MusicUi'
import { play as islandSound } from '../islandSounds'
import './islandFx.css'

const useSc = () => useSyncExternalStore(subscribe, getState, getState)

/** The panel's glow (put it first inside the opened panel). */
export function IslandBeatGlow() {
  const s = useSc()
  const tint = useTint(s, '#d4ff3f')
  if (!s.loaded || !s.station) return null
  return <i className={`di-beat-glow ${s.playing ? 'on' : ''}`} style={tintStyle(tint.rgb, s)} aria-hidden />
}

export interface TrackToast { url: string; title: string; artist: string; artwork: string }

/** The card to show now (for NOW_TOAST_MS after a new track starts), or null. */
export function useTrackToast(s: ScState, on: boolean): TrackToast | null {
  const last = useRef<string | null>(null)
  const [toast, setToast] = useState<TrackToast | null>(null)
  const timer = useRef(0)
  useEffect(() => {
    if (!shouldToastTrack(last.current, s, on)) return
    last.current = s.url
    setToast({ url: s.url, title: s.title, artist: s.artist, artwork: s.artwork })
    islandSound('notify')
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), NOW_TOAST_MS)
  }, [s.url, s.title, s.playing, on])
  useEffect(() => () => clearTimeout(timer.current), [])
  return toast
}

/** The "now playing" card on the pill. */
export function NowPlayingToast({ t }: { t: TrackToast }) {
  const art = bigArt(t.artwork) || t.artwork
  return (
    <span key={t.url} className="di-np-toast" role="status" aria-label={`Now playing ${t.title}${t.artist ? ` by ${t.artist}` : ''}`}>
      {art ? <img src={art} alt="" referrerPolicy="no-referrer" /> : <i aria-hidden>♫</i>}
      <span className="di-np-t">
        <small>Now playing</small>
        <b>{t.title}</b>
      </span>
    </span>
  )
}
