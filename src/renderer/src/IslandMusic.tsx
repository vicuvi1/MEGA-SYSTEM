// IN-SC: SoundCloud on the island. Your stations (pasted track, playlist or
// likes addresses) play through SoundCloud's own free embed player and its
// Widget API (w.soundcloud.com): no key, no login. The player lives hidden
// in the island window (ScHost, outside the panel), so it keeps playing when
// the panel closes. Nothing loads until you press play on a station; it
// pauses by itself in a call, when the PC locks, and when a focus timer
// starts (with "Pause music during focus" on). The island's media row drives
// it while it plays. Light: progress is read at most once a second and only
// while the panel is open.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { addStation, removeStation, shouldPause, timeText, widgetSrc, WIDGET_API, type Station } from '@core/soundcloud'
import { tp } from './islandTap'
import { onKitEvent, type KitState } from './IslandTiles'

interface ScState { station: Station | null; loaded: boolean; ready: boolean; playing: boolean; title: string; artwork: string; pos: number; dur: number; vol: number; error: string }
let st: ScState = { station: null, loaded: false, ready: false, playing: false, title: '', artwork: '', pos: 0, dur: 0, vol: 70, error: '' }
const subs = new Set<() => void>()
const set = (p: Partial<ScState>) => {
  st = { ...st, ...p }
  subs.forEach((f) => f())
}
export const useSc = () => useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => st)

// The Widget API (loaded once, only when you first press play).
let widget: any = null
let apiP: Promise<any> | null = null
function loadApi(): Promise<any> {
  const w = window as any
  if (w.SC?.Widget) return Promise.resolve(w.SC)
  apiP ??= new Promise((ok, no) => {
    const el = document.createElement('script')
    el.src = WIDGET_API
    el.async = true
    el.onload = () => (w.SC?.Widget ? ok(w.SC) : no(new Error('no widget')))
    el.onerror = () => no(new Error('SoundCloud did not load'))
    document.head.appendChild(el)
  }).catch((e) => {
    apiP = null
    throw e
  })
  return apiP
}
let watchProgress = false
let lastPosAt = 0
function readSound() {
  widget?.getCurrentSound?.((s: any) => {
    if (!s) return
    const art = typeof s.artwork_url === 'string' && /^https:\/\/i\d?\.sndcdn\.com\//.test(s.artwork_url) ? s.artwork_url : ''
    set({ title: String(s.title ?? '').slice(0, 120), artwork: art, dur: Number(s.duration) || 0 })
  })
}
function bind(iframe: HTMLIFrameElement) {
  void loadApi()
    .then((SC) => {
      widget = SC.Widget(iframe)
      const E = SC.Widget.Events
      widget.bind(E.READY, () => {
        set({ ready: true, error: '' })
        widget.setVolume(st.vol)
        widget.play()
        readSound()
      })
      widget.bind(E.PLAY, () => (set({ playing: true }), readSound()))
      widget.bind(E.PAUSE, () => set({ playing: false }))
      widget.bind(E.FINISH, () => set({ playing: false }))
      widget.bind(E.ERROR, () => set({ error: 'SoundCloud could not play that', playing: false }))
      widget.bind(E.PLAY_PROGRESS, (e: any) => {
        if (!watchProgress) return
        const t = Date.now()
        if (t - lastPosAt < 1000) return
        lastPosAt = t
        set({ pos: Number(e?.currentPosition) || 0 })
      })
    })
    .catch((e) => set({ error: String(e?.message ?? e), loaded: false }))
}

/** Play a station (the player loads now, the first time). */
export function playStation(s: Station) {
  if (st.station?.url === s.url && widget && st.ready) return widget.play()
  if (widget && st.ready) {
    set({ station: s, title: '', artwork: '', pos: 0, dur: 0 })
    widget.load(s.url, { auto_play: true, visual: false, show_comments: false, hide_related: true })
    return
  }
  set({ station: s, loaded: true, ready: false, title: '', artwork: '', pos: 0, dur: 0 })
}
export const sc = {
  toggle: () => (st.playing ? widget?.pause() : widget?.play()),
  pause: () => widget?.pause(),
  next: () => widget?.next(),
  prev: () => (st.pos > 3000 ? widget?.seekTo(0) : widget?.prev()),
  seek: (ms: number) => widget?.seekTo(Math.max(0, ms)),
  volume: (v: number) => {
    const n = Math.max(0, Math.min(100, Math.round(v)))
    set({ vol: n })
    widget?.setVolume(n)
  },
  stop: () => {
    try { widget?.pause() } catch { /* fine */ }
    widget = null
    set({ loaded: false, ready: false, playing: false, station: null, title: '', artwork: '', pos: 0, dur: 0 })
  }
}

/**
 * The hidden player, in the island window (outside the panel, so it never
 * reloads), and the pauses: a call, the PC locking, a focus timer starting.
 */
export function ScHost({ call, running, pauseInFocus }: { call: boolean; running: boolean; pauseInFocus: boolean }) {
  const s = useSc()
  const ref = useRef<HTMLIFrameElement>(null)
  const wasRunning = useRef(running)
  const [locked, setLocked] = useState(false)
  useEffect(() => onKitEvent((ev) => { if (ev.type === 'lock') setLocked(true) }), [])
  useEffect(() => {
    if (!locked) return
    const t = window.setTimeout(() => setLocked(false), 1500)
    return () => clearTimeout(t)
  }, [locked])
  useEffect(() => {
    const focusStarted = running && !wasRunning.current
    wasRunning.current = running
    if (shouldPause({ playing: st.playing, call, locked, focusStarted, pauseInFocus })) sc.pause()
  }, [call, locked, running, pauseInFocus])
  const src = s.loaded && s.station ? widgetSrc(s.station.url) : null
  // Bound once per player (a station change loads into the same one).
  const bound = useRef<string | null>(null)
  useEffect(() => {
    if (src && ref.current && !bound.current) {
      bound.current = src
      bind(ref.current)
    }
    if (!src) bound.current = null
  }, [src])
  if (!src) return null
  return <iframe ref={ref} className="di-sc-host" src={bound.current ?? src} title="SoundCloud player" allow="autoplay" aria-hidden tabIndex={-1} />
}

/** The pill's now playing: a small equalizer (moves only while it plays) and the title. */
export function ScPillBadge() {
  const s = useSc()
  if (!s.loaded || !s.station) return null
  return (
    <span className={`di-sc-pill ${s.playing ? 'playing' : ''}`} title={s.title || s.station.name} aria-label={s.playing ? `Playing ${s.title || s.station.name}` : 'Music paused'}>
      <i className="di-eq" aria-hidden><b /><b /><b /></i>
    </span>
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
    </div>
  )
}

/** The music tile and panel: your stations, what plays, the buttons, the volume. */
export function MusicPanel({ k }: { k: KitState }) {
  const s = useSc()
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    watchProgress = true
    return () => void (watchProgress = false)
  }, [])
  const stations = k.kit.music.stations
  if (!stations.length && !adding) {
    return <button className="di-kit-start" {...tp('sc:start', () => setAdding(true))}>♫ Add a SoundCloud station</button>
  }
  const add = () => {
    const r = addStation(stations, url)
    if (r.error) return setErr(r.error)
    setErr('')
    setUrl('')
    setAdding(false)
    k.save({ ...k.kit, music: { stations: r.list } })
  }
  const pct = s.dur ? Math.min(100, (s.pos / s.dur) * 100) : 0
  return (
    <section className="di-kit di-music" aria-label="Music">
      <div className="di-kit-head">
        <b>♫ SoundCloud</b>
        <button className="di-kit-edit" {...tp('sc:add', () => setAdding((x) => !x))}>{adding ? 'Cancel' : '＋ Station'}</button>
      </div>
      {s.loaded && s.station && (
        <div className="di-sc-now">
          {s.artwork ? <img src={s.artwork} alt="" width={44} height={44} referrerPolicy="no-referrer" /> : <span className="di-sc-art" aria-hidden>♫</span>}
          <div className="di-sc-mid">
            <b title={s.title}>{s.title || (s.ready ? s.station.name : 'Loading…')}</b>
            <div
              className="di-sc-bar"
              role="slider"
              aria-label="Position"
              aria-valuemin={0}
              aria-valuemax={Math.round(s.dur / 1000)}
              aria-valuenow={Math.round(s.pos / 1000)}
              onPointerUp={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                if (s.dur) sc.seek(((e.clientX - r.left) / Math.max(1, r.width)) * s.dur)
              }}
            >
              <i style={{ transform: `scaleX(${pct / 100})` }} />
            </div>
            <small>{timeText(s.pos)} / {timeText(s.dur)}</small>
          </div>
        </div>
      )}
      {s.loaded && (
        <div className="di-sc-ctl">
          <button className="di-icon" {...tp('sc:prev', () => sc.prev())} aria-label="Previous">⏮</button>
          <button className="di-icon" {...tp('sc:toggle', () => sc.toggle())} aria-label={s.playing ? 'Pause' : 'Play'}>{s.playing ? '⏸' : '▶'}</button>
          <button className="di-icon" {...tp('sc:next', () => sc.next())} aria-label="Next">⏭</button>
          <input type="range" min={0} max={100} value={s.vol} aria-label="Volume" onChange={(e) => sc.volume(Number(e.target.value))} />
          <button className="di-icon" {...tp('sc:stop', () => sc.stop())} aria-label="Stop the player" title="Stop (unloads the player)">⏹</button>
        </div>
      )}
      {s.error && <p className="di-kit-warn">{s.error}</p>}
      {adding && (
        <div className="di-kit-add">
          <label className="di-kit-field">
            <span>SoundCloud address</span>
            <input value={url} placeholder="https://soundcloud.com/artist/sets/playlist" style={{ width: 230 }} onPointerDown={() => window.desktop?.islandFocus?.()} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          </label>
          <button className="di-kit-plus" {...tp('sc:addgo', add)}>Add</button>
          {err && <em className="di-kit-warn">{err}</em>}
        </div>
      )}
      <ul className="di-kit-list">
        {stations.map((x) => (
          <li key={x.id} className={s.station?.url === x.url ? 'pinned' : ''}>
            <span>{x.name}</span>
            <button aria-label={`Play ${x.name}`} {...tp(`sc:play:${x.id}`, () => playStation(x))}>▶</button>
            <button aria-label={`Remove ${x.name}`} {...tp(`sc:del:${x.id}`, () => k.save({ ...k.kit, music: { stations: removeStation(stations, x.id) } }))}>✕</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
