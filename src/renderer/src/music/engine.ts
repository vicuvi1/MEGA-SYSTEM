// MU: the one SoundCloud player of a window (IN-SC's player, grown up).
// It drives SoundCloud's own embed player through its Widget API
// (w.soundcloud.com): no key, no login. On the desktop it lives in the island
// window (the app's Music page controls it from afar, music/remote.ts); on
// the website it lives in the page (MusicHost in App). Nothing loads until
// you press play. Light: the position is read twice a second only while a
// Music view is open, every 5 s otherwise; nothing runs while it's stopped.
import { WIDGET_API, type Station } from '@core/soundcloud'
import { addRecent, cleanRecents, nextIndex, prevIndex, queueFrom, REPEAT_NEXT, safeArt, shuffleOrder, sleepVolume, type QItem, type Recent, type Repeat } from '@core/music'
import { parseSoundCloud } from '@core/soundcloud'
import { play as playSound } from '../soundKit'
import { watchStationHealth } from './stationHealth'

export interface ScState {
  station: Station | null
  /** The player frame is on the page. */
  loaded: boolean
  ready: boolean
  playing: boolean
  title: string
  artist: string
  artwork: string
  /** The track's own SoundCloud address (for the star). */
  url: string
  waveUrl: string
  pos: number
  /** When `pos` was read (the view moves on from there). */
  posAt: number
  dur: number
  vol: number
  error: string
  queue: QItem[]
  index: number
  shuffle: boolean
  order: number[]
  repeat: Repeat
  /** The sleep timer's end, or null. */
  sleepAt: number | null
  /** The last change went forward (1) or back (-1): the artwork slides that way. */
  dir: 1 | -1
}

const VOL_KEY = 'ls.musicVol'
const MODE_KEY = 'ls.musicMode'
const RECENT_KEY = 'ls.musicRecent'
const read = <T>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k)
    return v == null ? d : (JSON.parse(v) as T)
  } catch {
    return d
  }
}
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
  } catch {
    /* private window */
  }
}
const mode = read<{ shuffle?: boolean; repeat?: Repeat }>(MODE_KEY, {})

export const IDLE: ScState = {
  station: null, loaded: false, ready: false, playing: false, title: '', artist: '', artwork: '', url: '', waveUrl: '', pos: 0, posAt: 0, dur: 0,
  vol: Math.max(0, Math.min(100, Number(read(VOL_KEY, 70)) || 70)), error: '', queue: [], index: 0,
  shuffle: mode.shuffle === true, order: [], repeat: mode.repeat === 'all' || mode.repeat === 'one' ? mode.repeat : 'off', sleepAt: null, dir: 1
}
let st: ScState = IDLE
const subs = new Set<() => void>()
export function set(p: Partial<ScState>) {
  st = { ...st, ...p }
  subs.forEach((f) => f())
}
export const getState = () => st
export const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f))

// ---- recently played (this device; the island and the app window share it) ----
const recentSubs = new Set<() => void>()
let recents: Recent[] = cleanRecents(read(RECENT_KEY, []))
export const getRecents = () => recents
export const subscribeRecents = (f: () => void) => (recentSubs.add(f), () => void recentSubs.delete(f))
function noteRecent() {
  if (!st.url || !st.title) return
  recents = addRecent(recents, { url: st.url, title: st.title, artist: st.artist, artwork: st.artwork }, Date.now())
  write(RECENT_KEY, recents)
  recentSubs.forEach((f) => f())
}
/** Another window wrote the list (the island played something). */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== RECENT_KEY) return
    recents = cleanRecents(read(RECENT_KEY, []))
    recentSubs.forEach((f) => f())
  })
}

// ---- how often the position is read ----
let watchers = 0
/** A Music view is open: the position moves smoothly (call the return to stop). */
export function watch(): () => void {
  watchers++
  return () => void (watchers = Math.max(0, watchers - 1))
}

// ---- the Widget API (loaded once, only when you first press play) ----
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

let lastPosAt = 0
let recentTimer = 0
function readSound() {
  widget?.getCurrentSound?.((s: any) => {
    if (!s) return
    const url = parseSoundCloud(s.permalink_url)?.url ?? ''
    const changed = url !== st.url
    set({
      title: String(s.title ?? '').slice(0, 120),
      artist: String(s.user?.username ?? '').slice(0, 60),
      artwork: safeArt(s.artwork_url) || safeArt(s.user?.avatar_url),
      waveUrl: typeof s.waveform_url === 'string' ? s.waveform_url : '',
      url,
      dur: Number(s.duration) || 0
    })
    // Counted as played after 20 s of it.
    if (changed) {
      clearTimeout(recentTimer)
      recentTimer = window.setTimeout(() => st.playing && st.url === url && noteRecent(), 20_000)
    }
  })
  widget?.getCurrentSoundIndex?.((i: number) => Number.isInteger(i) && i !== st.index && set({ index: i }))
}
function readQueue() {
  widget?.getSounds?.((list: unknown) => {
    const queue = queueFrom(list)
    const order = st.shuffle && st.order.length !== queue.length ? shuffleOrder(queue.length, st.index) : st.order
    set({ queue, order })
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
        readQueue()
      })
      widget.bind(E.PLAY, () => {
        set({ playing: true, error: '' })
        readSound()
        readQueue()
      })
      widget.bind(E.PAUSE, () => set({ playing: false }))
      widget.bind(E.FINISH, () => {
        const n = st.queue.length
        const nx = nextIndex({ n, cur: st.index, shuffle: st.shuffle, order: st.order, repeat: st.repeat, auto: true })
        if (nx == null) return set({ playing: false })
        if (nx === st.index) {
          widget.seekTo(0)
          widget.play()
        } else widget.skip(nx)
      })
      widget.bind(E.ERROR, () => set({ error: 'SoundCloud could not play that', playing: false }))
      widget.bind(E.PLAY_PROGRESS, (e: any) => {
        const t = Date.now()
        if (t - lastPosAt < (watchers > 0 ? 450 : 5000)) return
        lastPosAt = t
        set({ pos: Number(e?.currentPosition) || 0, posAt: t })
      })
      widget.bind(E.SEEK, (e: any) => set({ pos: Number(e?.currentPosition) || 0, posAt: Date.now() }))
    })
    .catch((e) => set({ error: String(e?.message ?? e), loaded: false }))
}

/** The player frame calls this once it is on the page. */
export function attachFrame(iframe: HTMLIFrameElement) {
  bind(iframe)
}

/** Play a station (the player loads now, the first time). */
export function playStation(s: Station) {
  if (st.station?.url === s.url && widget && st.ready) return widget.play()
  const fresh = { station: s, title: '', artist: '', artwork: '', url: '', waveUrl: '', pos: 0, posAt: Date.now(), dur: 0, queue: [], index: 0, order: [], error: '', dir: 1 as const }
  if (widget && st.ready) {
    set(fresh)
    widget.load(s.url, { auto_play: true, visual: false, show_comments: false, hide_related: true })
    return
  }
  set({ ...fresh, loaded: true, ready: false })
}

// ---- the sleep timer: a 1 s step, only while it runs ----
let sleepTick = 0
function runSleep() {
  clearInterval(sleepTick)
  if (!st.sleepAt) return
  sleepTick = window.setInterval(() => {
    if (!st.sleepAt) return clearInterval(sleepTick)
    const now = Date.now()
    if (now >= st.sleepAt) {
      clearInterval(sleepTick)
      try {
        widget?.pause()
        widget?.setVolume(st.vol)
      } catch {
        /* gone */
      }
      return set({ sleepAt: null })
    }
    if (st.playing) widget?.setVolume(sleepVolume(now, st.sleepAt, st.vol))
  }, 1000)
}

const saveMode = () => write(MODE_KEY, { shuffle: st.shuffle, repeat: st.repeat })
const skipTo = (i: number, dir: 1 | -1) => {
  if (!widget || i < 0) return
  set({ dir })
  if (i === st.index) widget.seekTo(0)
  else widget.skip(i)
}

export const sc = {
  play: () => widget?.play(),
  toggle: () => (st.playing ? widget?.pause() : widget?.play()),
  pause: () => widget?.pause(),
  next: () => {
    const n = st.queue.length
    if (n <= 1) return void (set({ dir: 1 }), widget?.next())
    const nx = nextIndex({ n, cur: st.index, shuffle: st.shuffle, order: st.order, repeat: st.repeat === 'one' ? 'all' : st.repeat, auto: false })
    skipTo(nx ?? 0, 1)
  },
  prev: () => {
    if (st.pos > 3000 || st.queue.length <= 1) return widget?.seekTo(0)
    skipTo(prevIndex({ n: st.queue.length, cur: st.index, shuffle: st.shuffle, order: st.order }), -1)
  },
  skip: (i: number) => skipTo(Math.max(0, Math.min(st.queue.length - 1, Math.round(i))), i < st.index ? -1 : 1),
  seek: (ms: number) => {
    const p = Math.max(0, Math.min(st.dur || Infinity, ms))
    set({ pos: p, posAt: Date.now() })
    widget?.seekTo(p)
  },
  volume: (v: number) => {
    const n = Math.max(0, Math.min(100, Math.round(v)))
    set({ vol: n })
    write(VOL_KEY, n)
    widget?.setVolume(st.sleepAt ? sleepVolume(Date.now(), st.sleepAt, n) : n)
  },
  shuffle: (on?: boolean) => {
    const v = on ?? !st.shuffle
    set({ shuffle: v, order: v ? shuffleOrder(st.queue.length, st.index) : [] })
    saveMode()
  },
  repeat: (r?: Repeat) => {
    set({ repeat: r ?? REPEAT_NEXT[st.repeat] })
    saveMode()
  },
  sleep: (min: number | null) => {
    set({ sleepAt: min && min > 0 ? Date.now() + Math.min(180, min) * 60_000 : null })
    if (!st.sleepAt) widget?.setVolume(st.vol)
    runSleep()
  },
  stop: () => {
    try {
      widget?.pause()
    } catch {
      /* fine */
    }
    widget = null
    clearInterval(sleepTick)
    clearTimeout(recentTimer)
    set({ ...IDLE, vol: st.vol, shuffle: st.shuffle, repeat: st.repeat })
  }
}

export type MusicOp =
  | { op: 'play'; station: Station }
  | { op: 'toggle' | 'pause' | 'resume' | 'next' | 'prev' | 'stop' }
  | { op: 'skip'; i: number }
  | { op: 'seek'; ms: number }
  | { op: 'volume'; v: number }
  | { op: 'shuffle'; on?: boolean }
  | { op: 'repeat'; r?: Repeat }
  | { op: 'sleep'; min: number | null }

/** One way in for every command (this window's buttons and the remote ones). */
export function run(c: MusicOp): void {
  switch (c.op) {
    case 'play': {
      const p = parseSoundCloud(c.station?.url)
      if (p) playStation({ id: String(c.station.id ?? 'sx').slice(0, 21), name: String(c.station.name ?? '').slice(0, 40), url: p.url, kind: p.kind })
      return
    }
    case 'toggle': return void sc.toggle()
    case 'pause': return void sc.pause()
    case 'resume': return void sc.play()
    case 'next': return sc.next()
    case 'prev': return void sc.prev()
    case 'stop': return sc.stop()
    case 'skip': return sc.skip(Number(c.i) || 0)
    case 'seek': return sc.seek(Number(c.ms) || 0)
    case 'volume': return sc.volume(Number(c.v))
    case 'shuffle': return sc.shuffle(c.on)
    case 'repeat': return sc.repeat(c.r)
    case 'sleep': return sc.sleep(c.min == null ? null : Number(c.min))
  }
}

/**
 * A soft tick for the player's buttons, through the app's sound engine (so
 * your sound settings and quiet hours apply), and much softer while music
 * plays so it never sits on top of the song.
 */
export function uiTick(): void {
  try {
    playSound('tick', { gain: st.playing ? 0.12 : 0.35 })
  } catch {
    /* no audio */
  }
}

// A starter station SoundCloud won't play here: say so, stop, and it hides from the grid (music/stationHealth.ts).
if (typeof window !== 'undefined') {
  watchStationHealth(getState, subscribe, (url) => {
    if (getState().station?.url !== url) return
    try {
      widget?.pause()
    } catch {
      /* gone */
    }
    set({ playing: false, error: "That station isn't available on SoundCloud right now, so it's hidden. Pick another vibe." })
  })
}
