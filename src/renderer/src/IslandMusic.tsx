// IN-SC / MU: SoundCloud on the island. Your stations (pasted track, playlist
// or likes addresses) play through SoundCloud's own free embed player and its
// Widget API (w.soundcloud.com): no key, no login. The player (music/engine.ts)
// lives hidden in the island window (ScHost, outside the panel), so it keeps
// playing when the panel closes, and the app's Music page drives this same
// player (music/remote.ts): one player, not two. Nothing loads until you press
// play; it pauses by itself in a call, when the PC locks, and when a focus
// timer starts (with "Pause music during focus" on), or plays your focus mix.
// The media keys drive it while it is loaded. The full player is the Music
// tab (IslandMusicTab.tsx); here are the host, the pill and peek bits, and
// the panel's small card.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { onFocusStart, type MusicKit } from '@core/music'
import { shouldPause, widgetSrc } from '@core/soundcloud'
import { tp } from './islandTap'
import { onKitEvent, type KitState } from './IslandTiles'
import { attachFrame, getState, playStation, run, sc, subscribe, uiTick } from './music/engine'
import { serveRemote } from './music/remote'
import { Eq, EqMode, lyricNow, MuIcon, posNow, Scroller, useTint, tintStyle } from './music/MusicUi'
import { useLyrics } from './music/players'
import { useTicker } from './music/hooks'
import { NowPlayingToast, useTrackToast } from './music/IslandMusicFx'
import './music/music.css'

export { playStation, sc } from './music/engine'
export const useSc = () => useSyncExternalStore(subscribe, getState, getState)

const kitOp = (op: string, arg?: unknown) => {
  try {
    return Promise.resolve(window.desktop?.islandKit?.(op, arg)).catch(() => null)
  } catch {
    return Promise.resolve(null)
  }
}

/** Open the island's Music tab (the panel's header button and the music tile listen). */
export const openMusicTab = () => window.dispatchEvent(new Event('life-island-music-tab'))

/** The music tile (island_kit): play / pause; with nothing loaded, the first station, or the Music tab. */
export function musicTile(m: MusicKit) {
  const s = getState()
  if (s.loaded && s.station) return sc.toggle()
  if (m.stations[0]) return playStation(m.stations[0])
  openMusicTab()
}

/**
 * The hidden player, in the island window (outside the panel, so it never
 * reloads), and the rules: a call, the PC locking, a focus timer starting
 * (pause, or your focus mix), the media keys while it is loaded.
 */
export function ScHost({ call, running, pauseInFocus, music }: { call: boolean; running: boolean; pauseInFocus: boolean; music?: MusicKit }) {
  const s = useSc()
  const ref = useRef<HTMLIFrameElement>(null)
  const wasRunning = useRef(running)
  const [locked, setLocked] = useState(false)
  useEffect(() => serveRemote(), [])
  useEffect(
    () =>
      onKitEvent((ev) => {
        if (ev.type === 'lock') setLocked(true)
        // The media keys (registered only while the player is loaded).
        if (ev.type === 'media' && getState().loaded) {
          if (ev.op === 'toggle') sc.toggle()
          if (ev.op === 'next') sc.next()
          if (ev.op === 'prev') sc.prev()
        }
      }),
    []
  )
  useEffect(() => {
    void kitOp('mediaKeys', s.loaded)
  }, [s.loaded])
  useEffect(() => {
    if (!locked) return
    const t = window.setTimeout(() => setLocked(false), 1500)
    return () => clearTimeout(t)
  }, [locked])
  const mix = music?.focusMix ? music.stations.find((x) => x.id === music.focusMix) ?? null : null
  useEffect(() => {
    const focusStarted = running && !wasRunning.current
    wasRunning.current = running
    const now = getState()
    if (shouldPause({ playing: now.playing, call, locked, focusStarted: false, pauseInFocus })) return sc.pause()
    if (!focusStarted || call || locked) return
    const step = onFocusStart({ mix, pauseInFocus, playing: now.playing, playingUrl: now.station?.url ?? null })
    if (step === 'mix' && mix) playStation(mix)
    if (step === 'pause') sc.pause()
  }, [call, locked, running, pauseInFocus])
  const src = s.loaded && s.station ? widgetSrc(s.station.url) : null
  // Bound once per player (a station change loads into the same one).
  const bound = useRef<string | null>(null)
  useEffect(() => {
    if (src && ref.current && !bound.current) {
      bound.current = src
      attachFrame(ref.current)
    }
    if (!src) bound.current = null
  }, [src])
  if (!src) return null
  return <iframe ref={ref} className="di-sc-host" src={bound.current ?? src} title="SoundCloud player" allow="autoplay" aria-hidden tabIndex={-1} />
}

/** The artwork in a progress ring (the pill's and the peek's). */
function RingArt({ size = 24 }: { size?: number }) {
  const s = useSc()
  useTicker(s.playing, 5000)
  const p = s.dur ? Math.min(1, posNow(s) / s.dur) : 0
  const r = size / 2 - 1.5
  const c = 2 * Math.PI * r
  return (
    <span className={`di-mp ${s.playing ? 'playing' : ''}`} style={{ width: size, height: size }}>
      {s.artwork ? <img src={s.artwork} alt="" referrerPolicy="no-referrer" /> : <i className="di-mp-blank">♫</i>}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle className="bg" cx={size / 2} cy={size / 2} r={r} />
        <circle className="fg" cx={size / 2} cy={size / 2} r={r} strokeDasharray={c} strokeDashoffset={c * (1 - p)} />
      </svg>
    </span>
  )
}

/** The pill's now playing: the artwork in its progress ring, a small equalizer, and (if you want) the lyric line. */
export function ScPillBadge({ music }: { music?: MusicKit }) {
  const s = useSc()
  const tint = useTint(s, '#d4ff3f')
  const lines = useLyrics(s.title, s.artist, s.dur, !!music?.lyrics && !!music?.pillLyric && s.loaded)
  useTicker(!!lines && s.playing, 1000)
  const toast = useTrackToast(s, music?.nowToast !== false)
  if (!s.loaded || !s.station) return null
  const lyric = toast ? null : lyricNow(s, lines)
  return (
    <span className={`di-sc-pill mu ${s.playing ? 'playing' : ''}`} style={tintStyle(tint.rgb, s)} title={s.title || s.station.name} aria-label={s.playing ? `Playing ${s.title || s.station.name}` : 'Music paused'}>
      <RingArt />
      <EqMode on={s.playing} mode={music?.eqMode ?? 'beat'} />
      {toast && <NowPlayingToast t={toast} />}
      {lyric && <Scroller key={lyric} className="di-mp-lyric" text={lyric} />}
    </span>
  )
}

/** The peek's mini player: artwork with its ring, the title, the equalizer, play and next. */
export function ScPeekRow() {
  const s = useSc()
  const tint = useTint(s, '#d4ff3f')
  if (!s.loaded || !s.station) return null
  return (
    <div className="di-mu-peek mu" style={tintStyle(tint.rgb, s)} onPointerDown={(e) => e.stopPropagation()}>
      <RingArt size={34} />
      <div className="mid">
        <Scroller text={s.title || s.station.name} className="t" />
        <small>
          <Eq on={s.playing} /> {s.artist || s.station.name}
        </small>
      </div>
      <button className="mu-ic" aria-label={s.playing ? 'Pause' : 'Play'} {...tp('mu:peek:toggle', () => (uiTick(), sc.toggle()))}>
        {s.playing ? <MuIcon d="pause" size={15} /> : <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>}
      </button>
      <button className="mu-ic" aria-label="Next" {...tp('mu:peek:next', () => (uiTick(), sc.next()))}>
        <MuIcon d="next" size={15} fill />
      </button>
    </div>
  )
}

/** The media row's SoundCloud version (IslandMedia shows it while SoundCloud is on). */
export function ScMediaRow() {
  const s = useSc()
  return (
    <div className="di-media" role="group" aria-label="SoundCloud">
      <span className="di-media-t" title={s.title}>{s.playing ? '♪' : '⏸'} {s.title || s.station?.name || 'SoundCloud'}</span>
      <button className="di-icon" {...tp('sc:m:prev', () => sc.prev())} aria-label="Previous" title="Previous">⏮</button>
      <button className="di-icon" {...tp('sc:m:toggle', () => sc.toggle())} aria-label={s.playing ? 'Pause' : 'Play'} title={s.playing ? 'Pause' : 'Play'}>{s.playing ? '⏸' : '▶'}</button>
      <button className="di-icon" {...tp('sc:m:next', () => sc.next())} aria-label="Next" title="Next">⏭</button>
      <button className="di-icon" {...tp('sc:m:tab', openMusicTab)} aria-label="Open the Music tab" title="Music">♫</button>
    </div>
  )
}

/** The panel's small music card: one line that opens the Music tab. */
export function MusicPanel({ k }: { k: KitState }) {
  const s = useSc()
  const n = k.kit.music.stations.length
  return (
    <button className="di-kit-start di-mu-card" {...tp('sc:open-tab', openMusicTab)}>
      ♫ {s.loaded && s.station ? `Music · ${s.title || s.station.name}` : n ? `Music · ${n} station${n === 1 ? '' : 's'}` : 'Music: add a SoundCloud station'}
    </button>
  )
}

/** For the Music tab's run() (one way in for every command). */
export { run as runMusic }
