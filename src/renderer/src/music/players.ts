// MU: several players. SoundCloud (ours) and the players Windows knows
// (Spotify, a browser tab, Media Player…, read by the desktop through the
// media controls: src/core/pcMedia.ts). The views follow the pinned player,
// or whatever plays. The PC's players are asked every 3 s only while a Music
// view is open and the window is shown; never on the website.
// Also here: synced lyrics (LRCLIB) and covers for PC players (iTunes search).
import { useEffect, useMemo, useRef, useState } from 'react'
import { pickPlayer, type PlayerInfo } from '@core/music'
import type { MediaOp, MediaSession } from '@core/pcMedia'
import { itunesArt, itunesUrl, lyricsFrom, lrclibGetUrl, lrclibSearchUrl, safeCover, songOf, type LyricLine } from '@core/lyrics'
import { IDLE, type MusicOp, type ScState } from './engine'
import type { MusicCtl } from './remote'

const pcx = () => (typeof window !== 'undefined' ? window.desktop?.pcx : undefined)

/** The PC's players, while `on` (a Music view is open). */
export function useSystemPlayers(on: boolean, every = 3000): { list: MediaSession[]; at: number; act: (app: string, op: MediaOp) => void; allowed: boolean } {
  const [list, setList] = useState<MediaSession[]>([])
  const [at, setAt] = useState(0)
  const [allowed, setAllowed] = useState(true)
  const busy = useRef(false)
  const ask = async (op: MediaOp = 'get', app: string | null = null) => {
    const f = pcx()
    if (!f || (busy.current && op === 'get')) return
    busy.current = true
    try {
      const r = await f('mediaList', { op, app }).catch(() => null)
      if (r === null) return setAllowed(false)
      if (Array.isArray(r?.list)) {
        setList(r.list as MediaSession[])
        setAt(Date.now())
      }
    } finally {
      busy.current = false
    }
  }
  useEffect(() => {
    if (!on || !pcx()) return
    void ask()
    const t = window.setInterval(() => !document.hidden && void ask(), every)
    return () => clearInterval(t)
  }, [on, every])
  return { list: allowed ? list : [], at, act: (app, op) => void ask(op, app), allowed }
}

// ---- covers for PC players (iTunes search), cached ----
const covers = new Map<string, string>()
export function useCover(title: string, artist: string, on: boolean): string {
  const key = `${artist}|${title}`
  const [c, setC] = useState(() => covers.get(key) ?? '')
  useEffect(() => {
    if (!on || !title) return setC('')
    if (covers.has(key)) return setC(covers.get(key)!)
    const url = itunesUrl(songOf(title, artist))
    if (!url) return
    const ac = new AbortController()
    fetch(url, { signal: ac.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const a = safeCover(itunesArt(j))
        if (covers.size > 80) covers.clear()
        covers.set(key, a)
        setC(a)
      })
      .catch(() => {
        if (!ac.signal.aborted) covers.set(key, '')
      })
    return () => ac.abort()
  }, [key, on])
  return on ? c : ''
}

// ---- synced lyrics (LRCLIB), cached per track ----
const lyricCache = new Map<string, LyricLine[] | null>()
/** The song's synced lyrics, or null (none found, off, or not asked yet). */
export function useLyrics(title: string, artist: string, durMs: number, on: boolean): LyricLine[] | null {
  const song = songOf(title, artist)
  const key = `${song.artist}|${song.title}|${Math.round(durMs / 2000)}`
  const [l, setL] = useState<LyricLine[] | null>(() => lyricCache.get(key) ?? null)
  useEffect(() => {
    if (!on || !song.title) return setL(null)
    if (lyricCache.has(key)) return setL(lyricCache.get(key) ?? null)
    setL(null)
    const ac = new AbortController()
    const get = (u: string | null) => (u ? fetch(u, { signal: ac.signal, credentials: 'omit', referrerPolicy: 'no-referrer' }).then((r) => (r.ok ? r.json() : null)) : Promise.resolve(null))
    // Wait a moment: skipping through tracks doesn't ask for each one.
    const t = window.setTimeout(() => {
      void get(lrclibGetUrl(song, durMs))
        .then((j) => lyricsFrom(j, durMs) ?? get(lrclibSearchUrl(song)).then((x) => lyricsFrom(x, durMs)))
        .then((lines) => {
          if (lyricCache.size > 60) lyricCache.clear()
          lyricCache.set(key, lines)
          setL(lines)
        })
        .catch(() => {
          if (!ac.signal.aborted) lyricCache.set(key, null)
        })
    }, 600)
    return () => {
      clearTimeout(t)
      ac.abort()
    }
  }, [key, on])
  return on ? l : null
}

export interface Followed {
  /** What the views show and drive. */
  ctl: MusicCtl
  kind: 'sc' | 'sys' | 'none'
  players: PlayerInfo[]
  current: PlayerInfo | null
}

/**
 * The player the views follow, as one controller: SoundCloud's own, or a PC
 * player dressed the same way (no waveform, queue, shuffle or volume: Windows
 * doesn't offer those to other apps).
 */
export function useFollowed(sc: MusicCtl, sys: ReturnType<typeof useSystemPlayers>, pin: string | null): Followed {
  const scOn = sc.s.loaded && !!sc.s.station
  const players: PlayerInfo[] = useMemo(
    () => [
      ...(scOn ? [{ id: 'sc', name: 'SoundCloud', playing: sc.s.playing, title: sc.s.title || sc.s.station?.name || '', artist: sc.s.artist }] : []),
      ...sys.list.filter((x) => x.title || x.playing).map((x) => ({ id: `sys:${x.id}`, name: x.app || 'Player', playing: x.playing, title: x.title, artist: x.artist }))
    ],
    [scOn, sc.s.playing, sc.s.title, sc.s.artist, sc.s.station?.name, sys.list]
  )
  const current = pickPlayer(players, pin)
  const sess = current?.id.startsWith('sys:') ? sys.list.find((x) => `sys:${x.id}` === current.id) ?? null : null
  const cover = useCover(sess?.title ?? '', sess?.artist ?? '', !!sess)
  if (!sess) return { ctl: sc, kind: scOn ? 'sc' : 'none', players, current }
  const s: ScState = {
    ...IDLE,
    loaded: true,
    ready: true,
    playing: sess.playing,
    title: sess.title,
    artist: sess.artist,
    artwork: cover,
    pos: sess.pos,
    posAt: sys.at,
    dur: sess.dur,
    station: { id: 'sys', name: sess.app, url: '', kind: 'track' }
  }
  const run = (c: MusicOp) => {
    const op: MediaOp | null = c.op === 'toggle' ? 'toggle' : c.op === 'next' ? 'next' : c.op === 'prev' ? 'prev' : c.op === 'pause' ? 'pause' : c.op === 'resume' ? 'play' : null
    if (op) sys.act(sess.id, op)
    else sc.run(c)
  }
  return { ctl: { s, run, remote: sc.remote, probing: false }, kind: 'sys', players, current }
}
