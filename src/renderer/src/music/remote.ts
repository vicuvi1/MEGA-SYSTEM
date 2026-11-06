// MU: one player, not two. On the desktop the music lives in the island
// window; the app window's Music page drives it over a BroadcastChannel
// (same origin, the same PC). The island answers only while a Music page
// says hello (every 20 s), so nothing is sent while nobody looks. When no
// island answers (it's off, or this is the website), the page plays itself.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getState, IDLE, run, subscribe, watch, type MusicOp, type ScState } from './engine'

const CH = 'life-music'
type Msg = { t: 'hello' } | { t: 'state'; s: ScState } | { t: 'cmd'; c: MusicOp } | { t: 'track'; k: TrackNote }
/** A small note sent on every track change, play or pause (for Ben's "now playing" line in the app window). */
export interface TrackNote { title: string; artist: string; station: string; playing: boolean }
export const CHANNEL = CH

export const isIslandPage = () => typeof location !== 'undefined' && /[?&]island=1\b/.test(location.search)

/** The island's side: answer Music pages and run what they ask. */
let served = false
export function serveRemote(): void {
  if (served || typeof BroadcastChannel === 'undefined') return
  served = true
  const ch = new BroadcastChannel(CH)
  let seen = 0
  let unwatch: (() => void) | null = null
  let gone = 0
  let queued = 0
  const send = () => {
    queued = 0
    if (Date.now() - seen > 45_000) {
      unwatch?.()
      unwatch = null
      return
    }
    try {
      ch.postMessage({ t: 'state', s: getState() } satisfies Msg)
    } catch {
      /* closed */
    }
  }
  let lastNote = ''
  subscribe(() => {
    if (!queued && Date.now() - seen < 45_000) queued = window.setTimeout(send, 150)
    const st = getState()
    const k: TrackNote = { title: st.title, artist: st.artist, station: st.station?.name ?? '', playing: st.playing }
    const key = JSON.stringify(k)
    if (key !== lastNote) {
      lastNote = key
      try {
        ch.postMessage({ t: 'track', k } satisfies Msg)
      } catch {
        /* closed */
      }
    }
  })
  ch.onmessage = (e: MessageEvent<Msg>) => {
    const m = e.data
    if (m?.t === 'hello') {
      seen = Date.now()
      unwatch ??= watch()
      clearTimeout(gone)
      gone = window.setTimeout(() => (unwatch?.(), (unwatch = null)), 46_000)
      send()
    } else if (m?.t === 'cmd' && m.c && typeof m.c.op === 'string') run(m.c)
  }
}

export interface MusicCtl {
  s: ScState
  run: (c: MusicOp) => void
  /** Driving the island's player (desktop). */
  remote: boolean
  /** Still asking whether an island is there. */
  probing: boolean
}

const useLocal = () => useSyncExternalStore(subscribe, getState, getState)

/**
 * The player for a Music view: the island's (desktop app window, while the
 * island answers) or this page's own. Also marks the view as watching, so the
 * position moves smoothly while it is open.
 */
export function useMusic(): MusicCtl {
  const local = useLocal()
  const tryRemote = typeof window !== 'undefined' && !!window.desktop && !isIslandPage() && typeof BroadcastChannel !== 'undefined'
  const [remote, setRemote] = useState<ScState | null>(null)
  const [probing, setProbing] = useState(tryRemote)
  const ch = useRef<BroadcastChannel | null>(null)
  useEffect(() => watch(), [])
  useEffect(() => {
    if (!tryRemote) return
    const c = new BroadcastChannel(CH)
    ch.current = c
    let answered = false
    c.onmessage = (e: MessageEvent<Msg>) => {
      if (e.data?.t !== 'state') return
      answered = true
      setProbing(false)
      setRemote(e.data.s)
    }
    const hello = () => {
      if (!document.hidden) c.postMessage({ t: 'hello' } satisfies Msg)
    }
    hello()
    const probe = window.setTimeout(() => !answered && setProbing(false), 1500)
    const t = window.setInterval(hello, 20_000)
    const vis = () => hello()
    document.addEventListener('visibilitychange', vis)
    return () => {
      clearTimeout(probe)
      clearInterval(t)
      document.removeEventListener('visibilitychange', vis)
      c.close()
      ch.current = null
    }
  }, [tryRemote])
  if (remote) return { s: remote, remote: true, probing: false, run: (c) => ch.current?.postMessage({ t: 'cmd', c } satisfies Msg) }
  return { s: probing ? IDLE : local, remote: false, probing, run }
}
