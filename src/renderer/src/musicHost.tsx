// MU: the app window's part of the music. On the website (or a desktop app
// with the island off) the SoundCloud player lives here, hidden, so it keeps
// playing while you move between pages; it appears only once you press play.
// And Ben's "now playing" line: written to the synced `music_now` setting on
// a track change, only while "Ben can see what's playing" is on.
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { nowPlayingLine } from '@core/music'
import { widgetSrc } from '@core/soundcloud'
import { attachFrame, getState, playStation, subscribe } from './music/engine'
import type { Station } from '@core/soundcloud'
import { CHANNEL, isIslandPage, type TrackNote } from './music/remote'
import { life } from './bridge'

let benSees: { at: number; on: boolean } = { at: 0, on: false }
async function benMaySee(): Promise<boolean> {
  if (Date.now() - benSees.at < 60_000) return benSees.on
  const kit = await life.islandKit?.get().catch(() => null)
  benSees = { at: Date.now(), on: !!kit?.music?.benSees }
  return benSees.on
}
let lastLine = ''
async function noteTrack(k: TrackNote) {
  if (!life.musicNow) return
  const line = k.playing ? nowPlayingLine(k) : ''
  if (line === lastLine) return
  if (!(await benMaySee())) {
    if (lastLine) await life.musicNow.set(null).catch(() => {})
    lastLine = ''
    return
  }
  lastLine = line
  await life.musicNow.set(line ? { line, at: Date.now() } : null).catch(() => {})
}

/** A station by its id, name or address (for automations: "play station Deep focus"). */
async function findStation(q: string): Promise<Station | null> {
  const kit = await life.islandKit?.get().catch(() => null)
  const list = kit?.music?.stations ?? []
  const k = String(q ?? '').trim().toLowerCase()
  return list.find((x) => x.id.toLowerCase() === k) ?? list.find((x) => x.name.toLowerCase() === k) ?? list.find((x) => x.url === k) ?? list.find((x) => x.name.toLowerCase().includes(k)) ?? null
}
/** Is the island's player there to answer (desktop)? */
function islandAnswers(ms = 800): Promise<BroadcastChannel | null> {
  if (typeof BroadcastChannel === 'undefined' || !window.desktop) return Promise.resolve(null)
  const ch = new BroadcastChannel(CHANNEL)
  return new Promise((ok) => {
    const t = window.setTimeout(() => (ch.close(), ok(null)), ms)
    ch.onmessage = (e) => {
      if (e.data?.t !== 'state') return
      clearTimeout(t)
      ok(ch)
    }
    ch.postMessage({ t: 'hello' })
  })
}
/** Plays a station: on the island's player when it answers, else in this window. */
export async function playStationByName(q: string): Promise<boolean> {
  const st = await findStation(q)
  if (!st) return false
  const ch = await islandAnswers()
  if (ch) {
    ch.postMessage({ t: 'cmd', c: { op: 'play', station: st } })
    ch.close()
  } else playStation(st)
  return true
}

export function MusicHost() {
  // Automations ("When X, do Y → play a station") call this, or send the event.
  useEffect(() => {
    if (isIslandPage()) return
    const w = window as unknown as { lifeMusic?: { playStation: (q: string) => Promise<boolean> } }
    w.lifeMusic = { playStation: playStationByName }
    const onEv = (e: Event) => void playStationByName(String((e as CustomEvent<{ station?: string }>).detail?.station ?? ''))
    window.addEventListener('life-music-station', onEv)
    return () => {
      delete w.lifeMusic
      window.removeEventListener('life-music-station', onEv)
    }
  }, [])
  const s = useSyncExternalStore(subscribe, getState, getState)
  const ref = useRef<HTMLIFrameElement>(null)
  const bound = useRef<string | null>(null)
  // This window's own player (the island's is reported over the channel).
  useEffect(() => {
    if (isIslandPage()) return
    let t = 0
    const off = subscribe(() => {
      clearTimeout(t)
      t = window.setTimeout(() => {
        const st = getState()
        if (st.loaded) void noteTrack({ title: st.title, artist: st.artist, station: st.station?.name ?? '', playing: st.playing })
      }, 1500)
    })
    if (typeof BroadcastChannel === 'undefined') return off
    const ch = new BroadcastChannel(CHANNEL)
    ch.onmessage = (e) => e.data?.t === 'track' && e.data.k && void noteTrack(e.data.k as TrackNote)
    return () => (off(), ch.close())
  }, [])
  const src = !isIslandPage() && s.loaded && s.station ? widgetSrc(s.station.url) : null
  useEffect(() => {
    if (src && ref.current && !bound.current) {
      bound.current = src
      attachFrame(ref.current)
    }
    if (!src) bound.current = null
  }, [src])
  if (!src) return null
  return <iframe ref={ref} className="mu-host" style={{ position: 'fixed', left: -4000, top: 0, width: 320, height: 120, border: 0, opacity: 0, pointerEvents: 'none' }} src={bound.current ?? src} title="SoundCloud player" allow="autoplay" aria-hidden tabIndex={-1} />
}
