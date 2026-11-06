// Starter stations that SoundCloud won't play on this device: when the player
// reports an error on one, or never shows a track, it is marked unavailable
// (localStorage, shared by the island and the app window) and hidden from the
// "Pick a vibe" grid. It is tried again after a week. The rules are in
// core/starterStations.ts (stationVerdict); this file only watches the player.
import { useSyncExternalStore } from 'react'
import { cleanUnavailable, isStarterUrl, stationVerdict, type Unavailable } from '@core/starterStations'

const KEY = 'ls.musicUnavail'
const subs = new Set<() => void>()
const load = (): Unavailable => {
  try {
    return cleanUnavailable(JSON.parse(localStorage.getItem(KEY) || '{}'), Date.now())
  } catch {
    return {}
  }
}
let list: Unavailable = load()
const save = (next: Unavailable) => {
  list = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* private window */
  }
  subs.forEach((f) => f())
}
if (typeof window !== 'undefined') {
  // The island marked one (the app window shares this storage).
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return
    list = load()
    subs.forEach((f) => f())
  })
}
export const getUnavailable = () => list
export const useUnavailable = () => useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), getUnavailable, getUnavailable)
export function markUnavailable(url: string): void {
  if (isStarterUrl(url) && !(url in list)) save({ ...list, [url]: Date.now() })
}
function markOk(url: string): void {
  if (!(url in list)) return
  const next = { ...list }
  delete next[url]
  save(next)
}
/** Settings: show every starter again on this device. */
export const clearUnavailable = () => save({})

interface Watched { url: string; since: number; readyAt: number | null; done: boolean }
interface PlayerView { station: { url: string } | null; loaded: boolean; ready: boolean; playing: boolean; title: string; error: string }

/**
 * Watches the player (engine.ts calls this once): a starter that fails is
 * marked, and `onBad` lets the player say so and stop.
 */
export function watchStationHealth(get: () => PlayerView, subscribe: (f: () => void) => () => void, onBad: (url: string) => void): void {
  let w: Watched | null = null
  let timer = 0
  const check = () => {
    const s = get()
    const url = s.loaded && s.station && isStarterUrl(s.station.url) ? s.station.url : null
    if (!url) {
      w = null
      clearTimeout(timer)
      return
    }
    const now = Date.now()
    if (!w || w.url !== url) w = { url, since: now, readyAt: s.ready ? now : null, done: false }
    if (w.done) return
    if (s.ready && w.readyAt == null) w.readyAt = now
    const v = stationVerdict({ since: w.since, now, ready: s.ready, readyAt: w.readyAt, title: s.title, error: s.error })
    clearTimeout(timer)
    if (v === 'ok') {
      w.done = true
      return markOk(url)
    }
    if (v === 'bad') {
      w.done = true
      markUnavailable(url)
      return onBad(url)
    }
    // Look again when the wait could be over.
    timer = window.setTimeout(check, 5000)
  }
  subscribe(check)
}
