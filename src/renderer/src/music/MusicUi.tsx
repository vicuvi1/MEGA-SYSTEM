// MU: the pieces of the Music tab (island) and the Music page (app): the
// artwork that breathes, the title that scrolls, the real waveform you can
// seek on, the buttons, the up-next list and the stations grid. Motion is
// transform and opacity only (motionBudget.test.ts); the loops run only while
// music plays, and stop in a hidden window (html.doc-hidden) and with
// reduce motion.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { bigArt, hexRgb, isFav, pseudoBeat, rgbText, seekFraction, sleepLeft, SLEEP_CHOICES, upNext, type Fav, type PlayerInfo, type QItem, type Recent, type Rgb } from '@core/music'
import { lineAt, type LyricLine } from '@core/lyrics'
import { STATION_KIND_LABEL, timeText, type Station } from '@core/soundcloud'
import type { ScState } from './engine'
import { uiTick } from './engine'
import type { MusicCtl } from './remote'
import { useArtColor, useStationArt, useTicker, useWave } from './hooks'
import './music.css'

/** How a button fires: the island's release-taps, or a plain click in the app. */
export type Press = (id: string, fn: () => void) => Record<string, unknown>
export const clickPress: Press = (_id, fn) => ({ onClick: fn })

// ---- icons (24×24, stroke) ----
const P = {
  prev: 'M6 5v14M19 6l-9 6 9 6z',
  next: 'M18 5v14M5 6l9 6-9 6z',
  shuffle: 'M3 7h3.5c2 0 3.2 1 4.3 2.6l2.4 4.8C14.3 16 15.5 17 17.5 17H21M3 17h3.5c1.3 0 2.2-.4 3-1.1M14 8.1c.8-.7 1.7-1.1 3.5-1.1H21M18 4l3 3-3 3M18 14l3 3-3 3',
  repeat: 'M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3',
  star: 'M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z',
  vol: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  mute: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4zM16 10l4 4M20 10l-4 4',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  list: 'M4 6h12M4 12h12M4 18h8M19 15v6l-2.5-1.5',
  plus: 'M12 5v14M5 12h14',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  x: 'M6 6l12 12M18 6L6 18',
  pen: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  stop: 'M7 7h10v10H7z',
  pause: 'M8.5 5.5v13M15.5 5.5v13',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z'
}
export function MuIcon({ d, size = 18, fill = false }: { d: keyof typeof P; size?: number; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[d]} />
    </svg>
  )
}

/** The colour the view glows in: the artwork's, or the accent. */
export function useTint(s: ScState, accent: string): { rgb: Rgb; fromArt: boolean } {
  const c = useArtColor(s.artwork)
  return c ? { rgb: c, fromArt: true } : { rgb: hexRgb(accent), fromArt: false }
}
export const tintStyle = (rgb: Rgb, s: ScState): CSSProperties => ({ ['--mu-rgb' as string]: rgbText(rgb), ['--mu-beat' as string]: `${(60 / pseudoBeat(s.url || s.title || 'x')).toFixed(3)}s` })

/** A title that scrolls slowly when it doesn't fit (and stays still when it does). */
export function Scroller({ text, className = '' }: { text: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null)
  const inner = useRef<HTMLSpanElement>(null)
  const [dist, setDist] = useState(0)
  useLayoutEffect(() => {
    const b = box.current
    const i = inner.current
    if (!b || !i) return
    const d = i.scrollWidth - b.clientWidth
    setDist(d > 4 ? d + 24 : 0)
  }, [text])
  return (
    <span ref={box} className={`mu-scroll ${dist ? 'on' : ''} ${className}`} title={text}>
      <span ref={inner} style={dist ? ({ ['--mu-dist' as string]: `-${dist}px`, ['--mu-dur' as string]: `${Math.max(6, dist / 22)}s` } as CSSProperties) : undefined}>{text}</span>
    </span>
  )
}

/** The equalizer: four bars that move only while music plays (made up, not the real sound). */
export function Eq({ on, className = '' }: { on: boolean; className?: string }) {
  return (
    <i className={`mu-eq ${on ? 'on' : ''} ${className}`} aria-hidden>
      <b />
      <b />
      <b />
      <b />
    </i>
  )
}

/** The artwork: slides in with a spring on a new track and "breathes" while it plays. */
export function Artwork({ s, size, className = '' }: { s: ScState; size: number; className?: string }) {
  const art = bigArt(s.artwork) || s.artwork
  const key = s.url || s.title || s.station?.url || 'none'
  return (
    <div className={`mu-art ${s.playing ? 'playing' : ''} ${className}`} style={{ width: size, height: size }}>
      <div key={key} className={`mu-art-in ${s.dir < 0 ? 'back' : 'fwd'}`}>
        <div className="mu-art-breathe">
          {art ? <img src={art} alt="" width={size} height={size} referrerPolicy="no-referrer" draggable={false} /> : <span className="mu-art-blank" aria-hidden>♫</span>}
        </div>
      </div>
      <i className="mu-art-glow" aria-hidden />
    </div>
  )
}

/** The soft background: the artwork, blurred and tinted (drawn once per track). */
export function Ambient({ s }: { s: ScState }) {
  const art = s.artwork
  return (
    <div className="mu-amb" aria-hidden>
      {art && <img key={art} src={art} alt="" referrerPolicy="no-referrer" />}
      <i className="a" />
      <i className="b" />
    </div>
  )
}

/** Where the track is now, moving on from the last reading while it plays. */
export function posNow(s: ScState): number {
  const run = s.playing ? Math.max(0, Date.now() - (s.posAt || Date.now())) : 0
  return Math.min(s.dur || Infinity, s.pos + Math.min(run, 6000))
}

/**
 * The waveform: SoundCloud's own numbers as bars that fill with the
 * progress (one layer slid by transform inside a clipped one). Click or drag
 * to seek.
 */
export function Waveform({ ctl, bars, height, className = '' }: { ctl: MusicCtl; bars: number; height: number; className?: string }) {
  const { s } = ctl
  const w = useWave(s.waveUrl, s.url || s.title, bars)
  const box = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const p = drag ?? (s.dur ? posNow(s) / s.dur : 0)
  const gap = 0.36
  const bw = 1 - gap
  const shape = (
    <svg width="100%" height={height} viewBox={`0 0 ${bars} 1`} preserveAspectRatio="none" aria-hidden>
      {w.bars.map((h, i) => (
        <rect key={i} x={i + gap / 2} y={(1 - h) / 2} width={bw} height={h} rx={0.3} />
      ))}
    </svg>
  )
  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return seekFraction(e.clientX, r.left, r.width)
  }
  return (
    <div
      ref={box}
      className={`mu-wave ${w.real ? 'real' : 'guess'} ${drag != null ? 'drag' : ''} ${s.playing ? 'playing' : ''} ${className}`}
      style={{ height, ['--mu-p' as string]: p.toFixed(4) } as CSSProperties}
      data-noswipe
      role="slider"
      tabIndex={0}
      aria-label="Position in the track"
      aria-valuemin={0}
      aria-valuemax={Math.round(s.dur / 1000)}
      aria-valuenow={Math.round((p * s.dur) / 1000)}
      aria-valuetext={`${timeText(p * s.dur)} of ${timeText(s.dur)}`}
      title={w.real ? undefined : 'The real waveform could not be loaded: this shape is only a stand-in'}
      onPointerDown={(e) => {
        if (!s.dur) return
        e.stopPropagation()
        e.currentTarget.setPointerCapture?.(e.pointerId)
        setDrag(at(e))
      }}
      onPointerMove={(e) => drag != null && setDrag(at(e))}
      onPointerUp={(e) => {
        if (drag == null) return
        e.stopPropagation()
        ctl.run({ op: 'seek', ms: at(e) * s.dur })
        setDrag(null)
      }}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        if (!s.dur) return
        if (e.key === 'ArrowRight') ctl.run({ op: 'seek', ms: posNow(s) + 5000 })
        if (e.key === 'ArrowLeft') ctl.run({ op: 'seek', ms: posNow(s) - 5000 })
      }}
    >
      <div className="mu-wave-base">{shape}</div>
      <div className="mu-wave-clip" style={{ transform: `translateX(${(p - 1) * 100}%)` }}>
        <div className="mu-wave-fill" style={{ transform: `translateX(${(1 - p) * 100}%)` }}>
          {shape}
        </div>
      </div>
      <i className="mu-wave-head" style={{ transform: `translateX(${p * 100}%)` }} aria-hidden />
    </div>
  )
}
export function Times({ s }: { s: ScState }) {
  return (
    <div className="mu-times">
      <span>{timeText(posNow(s))}</span>
      <span>{s.dur ? `-${timeText(Math.max(0, s.dur - posNow(s)))}` : '0:00'}</span>
    </div>
  )
}

/** Play and pause morph into each other (two shapes crossfade and turn). */
export function PlayButton({ ctl, press, size = 56, id = 'mu:toggle' }: { ctl: MusicCtl; press: Press; size?: number; id?: string }) {
  const { s } = ctl
  return (
    <button className={`mu-play ${s.playing ? 'on' : ''}`} style={{ width: size, height: size }} aria-label={s.playing ? 'Pause' : 'Play'} title={s.playing ? 'Pause' : 'Play'} {...press(id, () => (uiTick(), ctl.run({ op: 'toggle' })))}>
      <svg viewBox="0 0 24 24" width={size * 0.42} height={size * 0.42} aria-hidden>
        <g className="mu-play-tri">
          <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
        </g>
        <g className="mu-play-bars">
          <rect x="6.5" y="5" width="4" height="14" rx="1.3" fill="currentColor" />
          <rect x="13.5" y="5" width="4" height="14" rx="1.3" fill="currentColor" />
        </g>
      </svg>
    </button>
  )
}

/** Shuffle, previous, play, next, repeat. */
export function Transport({ ctl, press, size = 56, prefix = 'mu' }: { ctl: MusicCtl; press: Press; size?: number; prefix?: string }) {
  const { s } = ctl
  return (
    <div className="mu-transport">
      <button className={`mu-ic ${s.shuffle ? 'on' : ''}`} aria-pressed={s.shuffle} aria-label="Shuffle" title={s.shuffle ? 'Shuffle is on' : 'Shuffle'} {...press(`${prefix}:shuffle`, () => (uiTick(), ctl.run({ op: 'shuffle' })))}>
        <MuIcon d="shuffle" />
      </button>
      <button className="mu-ic big" aria-label="Previous" title="Previous" {...press(`${prefix}:prev`, () => (uiTick(), ctl.run({ op: 'prev' })))}>
        <MuIcon d="prev" size={22} fill />
      </button>
      <PlayButton ctl={ctl} press={press} size={size} id={`${prefix}:toggle`} />
      <button className="mu-ic big" aria-label="Next" title="Next" {...press(`${prefix}:next`, () => (uiTick(), ctl.run({ op: 'next' })))}>
        <MuIcon d="next" size={22} fill />
      </button>
      <button className={`mu-ic ${s.repeat !== 'off' ? 'on' : ''}`} aria-label={`Repeat: ${s.repeat === 'one' ? 'this track' : s.repeat === 'all' ? 'all' : 'off'}`} title={s.repeat === 'one' ? 'Repeat this track' : s.repeat === 'all' ? 'Repeat all' : 'Repeat'} {...press(`${prefix}:repeat`, () => (uiTick(), ctl.run({ op: 'repeat' })))}>
        <MuIcon d="repeat" />
        {s.repeat === 'one' && <small className="mu-one">1</small>}
      </button>
    </div>
  )
}

export function Volume({ ctl, onFocus }: { ctl: MusicCtl; onFocus?: () => void }) {
  const { s } = ctl
  const before = useRef(70)
  return (
    <div className="mu-vol">
      <button className="mu-ic sm" aria-label={s.vol ? 'Mute' : 'Unmute'} onClick={() => (s.vol ? ((before.current = s.vol), ctl.run({ op: 'volume', v: 0 })) : ctl.run({ op: 'volume', v: before.current || 60 }))}>
        <MuIcon d={s.vol ? 'vol' : 'mute'} size={16} />
      </button>
      <input type="range" min={0} max={100} value={s.vol} aria-label="Volume" style={{ ['--mu-v' as string]: `${s.vol}%` } as CSSProperties} onPointerDown={onFocus} onChange={(e) => ctl.run({ op: 'volume', v: Number(e.target.value) })} />
    </div>
  )
}

export function StarButton({ s, favs, onToggle, press, id = 'mu:star' }: { s: ScState; favs: Fav[]; onToggle: (f: Fav) => void; press: Press; id?: string }) {
  const on = isFav(favs, s.url)
  if (!s.url) return null
  return (
    <button className={`mu-ic mu-star ${on ? 'on' : ''}`} aria-pressed={on} aria-label={on ? 'Remove from favourites' : 'Add to favourites'} title={on ? 'In your favourites' : 'Add to favourites'} {...press(id, () => (uiTick(), onToggle({ url: s.url, title: s.title, artist: s.artist, artwork: s.artwork })))}>
      <MuIcon d="star" fill={on} />
    </button>
  )
}

/** The sleep timer: 15 / 30 / 60 minutes, then it fades out and pauses. */
export function SleepTimer({ ctl, press, prefix = 'mu' }: { ctl: MusicCtl; press: Press; prefix?: string }) {
  const { s } = ctl
  const [open, setOpen] = useState(false)
  const now = useTicker(!!s.sleepAt, 1000)
  return (
    <div className="mu-sleep">
      <button className={`mu-chip ${s.sleepAt ? 'on' : ''}`} aria-expanded={open} title="Sleep timer: the music fades out and stops" {...press(`${prefix}:sleep`, () => setOpen((x) => !x))}>
        <MuIcon d="moon" size={14} /> {s.sleepAt ? sleepLeft(now, s.sleepAt) : 'Sleep'}
      </button>
      {open && (
        <div className="mu-sleep-menu" role="menu">
          {SLEEP_CHOICES.map((m) => (
            <button key={m} role="menuitem" {...press(`${prefix}:sleep${m}`, () => (setOpen(false), ctl.run({ op: 'sleep', min: m })))}>{m} min</button>
          ))}
          {s.sleepAt && <button role="menuitem" {...press(`${prefix}:sleepoff`, () => (setOpen(false), ctl.run({ op: 'sleep', min: null })))}>Off</button>}
        </div>
      )}
    </div>
  )
}

/** A small track row (the queue, favourites, recently played). */
export function TrackRow({ t, on, playing, onPlay, press, id, right }: { t: { title: string; artist: string; artwork: string; dur?: number }; on?: boolean; playing?: boolean; onPlay: () => void; press: Press; id: string; right?: ReactNode }) {
  return (
    <li className={`mu-row ${on ? 'on' : ''}`}>
      <button className="mu-row-main" {...press(id, () => (uiTick(), onPlay()))} aria-label={`Play ${t.title}`}>
        <span className="mu-row-art">{t.artwork ? <img src={t.artwork} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer" /> : <i aria-hidden>♫</i>}{on && <Eq on={!!playing} className="mu-row-eq" />}</span>
        <span className="mu-row-t">
          <b>{t.title}</b>
          {t.artist && <small>{t.artist}</small>}
        </span>
        {!!t.dur && <em>{timeText(t.dur)}</em>}
      </button>
      {right}
    </li>
  )
}

/** What plays after this one, from the playlist (shuffle and repeat included). */
export function UpNext({ ctl, press, max = 8, prefix = 'mu' }: { ctl: MusicCtl; press: Press; max?: number; prefix?: string }) {
  const { s } = ctl
  const list: QItem[] = upNext(s.queue, { cur: s.index, shuffle: s.shuffle, order: s.order, repeat: s.repeat }, max)
  if (!list.length) return <p className="mu-empty">{s.queue.length > 1 ? 'That was the last one.' : 'A single track: nothing comes after it.'}</p>
  return (
    <ul className="mu-list">
      {list.map((t) => (
        <TrackRow key={t.i} t={t} press={press} id={`${prefix}:q:${t.i}`} onPlay={() => ctl.run({ op: 'skip', i: t.i })} />
      ))}
    </ul>
  )
}

/** A station as a square tile with its last artwork (or a colour from its name). */
export function StationTile({ st, on, playing, onPlay, press, id, focusMix }: { st: Station; on: boolean; playing: boolean; onPlay: () => void; press: Press; id: string; focusMix?: boolean }) {
  const arts = useStationArt()
  const art = arts[st.url]
  let h = 0
  for (const c of st.name) h = (h * 31 + c.charCodeAt(0)) % 360
  return (
    <button className={`mu-tile ${on ? 'on' : ''}`} style={{ ['--mu-h' as string]: h } as CSSProperties} aria-label={`Play ${st.name}`} {...press(id, () => (uiTick(), onPlay()))}>
      <span className="mu-tile-art">
        {art ? <img src={art} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <i aria-hidden>{st.name.slice(0, 1).toUpperCase()}</i>}
        {on && <Eq on={playing} className="mu-tile-eq" />}
      </span>
      <b>{st.name}</b>
      <small>
        {STATION_KIND_LABEL[st.kind]}
        {focusMix ? ' · focus mix' : ''}
      </small>
    </button>
  )
}

/** Favourites or recently played as rows. */
export function TrackList({ list, ctl, press, prefix, empty, right }: { list: (Fav | Recent)[]; ctl: MusicCtl; press: Press; prefix: string; empty: string; right?: (f: Fav | Recent) => ReactNode }) {
  if (!list.length) return <p className="mu-empty">{empty}</p>
  return (
    <ul className="mu-list">
      {list.map((f) => (
        <TrackRow key={f.url} t={f} on={ctl.s.url === f.url} playing={ctl.s.playing} press={press} id={`${prefix}:${f.url}`} onPlay={() => ctl.run({ op: 'play', station: { id: 'sfav', name: f.title, url: f.url, kind: 'track' } })} right={right?.(f)} />
      ))}
    </ul>
  )
}

/** Keeps a station's artwork for its tile, while a view is open. */
export function useRememberArt(s: ScState, remember: (url: string, art: string) => void) {
  useEffect(() => {
    if (s.station && s.artwork) remember(s.station.url, s.artwork)
  }, [s.station?.url, s.artwork])
}

/**
 * Synced lyrics: the line playing now is bright, the list slides up with it
 * (transform only). `lines` null: nothing found (or lyrics are off).
 */
export function Lyrics({ s, lines, rows = 5, className = '' }: { s: ScState; lines: LyricLine[] | null; rows?: number; className?: string }) {
  const [, tick] = useState(0)
  // Between readings of the position, step on with the clock while it plays (4 times a second).
  useEffect(() => {
    if (!s.playing || !lines) return
    let raf = 0
    let last = 0
    const loop = (t: number) => {
      if (t - last > 250) {
        last = t
        tick((x) => x + 1)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [s.playing, lines])
  if (!lines) return null
  const cur = lineAt(lines, posNow(s))
  const lh = 30
  const shift = Math.max(0, cur) * lh - Math.floor(rows / 2) * lh
  return (
    <div className={`mu-lyrics ${className}`} style={{ height: rows * lh, ['--mu-lh' as string]: `${lh}px` } as CSSProperties} aria-label="Lyrics">
      <ol style={{ transform: `translateY(${-Math.max(0, shift)}px)` }}>
        {lines.map((l, i) => (
          <li key={i} className={i === cur ? 'on' : i < cur ? 'past' : ''}>{l.text || '♪'}</li>
        ))}
      </ol>
    </div>
  )
}
/** The lyric line playing now (the pill's), or ''. */
export function lyricNow(s: ScState, lines: LyricLine[] | null): string {
  if (!lines) return ''
  const i = lineAt(lines, posNow(s))
  return i >= 0 ? lines[i].text : ''
}

/** The equalizer in its mode: 'beat' bars, or a 'pitch' shape from low (left) to high (right). Both are drawn, not measured. */
export function EqMode({ on, mode, className = '' }: { on: boolean; mode: 'beat' | 'pitch'; className?: string }) {
  if (mode === 'beat') return <Eq on={on} className={className} />
  return (
    <i className={`mu-eq pitch ${on ? 'on' : ''} ${className}`} aria-hidden>
      {[1, 0.86, 0.95, 0.7, 0.62, 0.5, 0.42, 0.3].map((k, i) => <b key={i} style={{ ['--k' as string]: k } as CSSProperties} />)}
    </i>
  )
}

/** The players to follow (SoundCloud, Spotify, a browser…) and the pin. */
export function PlayerPicker({ players, current, pin, onPin, press, prefix = 'mu' }: { players: PlayerInfo[]; current: PlayerInfo | null; pin: string | null; onPin: (id: string | null) => void; press: Press; prefix?: string }) {
  if (players.length < 2 && !pin) return null
  return (
    <div className="mu-players" role="group" aria-label="Players">
      {players.map((p) => (
        <button key={p.id} className={`mu-chip ${current?.id === p.id ? 'on' : ''}`} title={pin === p.id ? `${p.name} is pinned: tap to follow whatever plays` : `Follow ${p.name} (pin it)`} {...press(`${prefix}:pin:${p.id}`, () => onPin(pin === p.id ? null : p.id))}>
          {p.playing && <Eq on className="mu-chip-eq" />}
          {p.name}
          {pin === p.id && <span aria-label="pinned"> 📌</span>}
        </button>
      ))}
    </div>
  )
}

/** A thin progress line (PC players: Windows gives no waveform). */
export function ThinBar({ s }: { s: ScState }) {
  const p = s.dur ? Math.min(1, posNow(s) / s.dur) : 0
  return (
    <div className={`mu-thin ${s.playing ? 'playing' : ''}`} aria-hidden>
      <i style={{ transform: `translateX(${(p - 1) * 100}%)` }} />
    </div>
  )
}

/** A PC player: previous, play / pause, next (Windows offers no more to other apps). */
export function SysTransport({ ctl, press, size = 56, prefix = 'mu' }: { ctl: MusicCtl; press: Press; size?: number; prefix?: string }) {
  return (
    <div className="mu-transport">
      <button className="mu-ic big" aria-label="Previous" title="Previous" {...press(`${prefix}:sys:prev`, () => (uiTick(), ctl.run({ op: 'prev' })))}>
        <MuIcon d="prev" size={22} fill />
      </button>
      <PlayButton ctl={ctl} press={press} size={size} id={`${prefix}:sys:toggle`} />
      <button className="mu-ic big" aria-label="Next" title="Next" {...press(`${prefix}:sys:next`, () => (uiTick(), ctl.run({ op: 'next' })))}>
        <MuIcon d="next" size={22} fill />
      </button>
    </div>
  )
}
