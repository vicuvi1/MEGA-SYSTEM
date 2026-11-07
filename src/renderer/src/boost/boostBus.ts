// Focus boost's small shared parts: the settings cache (one read, refreshed
// when they change or new data arrives), the events other pages send
// ("why I'm stalling", Dojo, a big win), and the music commands that reach
// the one SoundCloud player (the island's on the desktop, the page's own on
// the website: music/remote.ts).
import { useEffect, useState } from 'react'
import { DEFAULT_BOOST, type BoostPrefs } from '@core/focusBoost'
import type { StallReason } from '@core/stallFix'
import type { WinKind } from '@core/winMoments'
import type { Station } from '@core/soundcloud'
import { parseSoundCloud } from '@core/soundcloud'
import { life } from '../bridge'
import { getState, run, type MusicOp } from '../music/engine'
import { CHANNEL, type TrackNote } from '../music/remote'

// ---- settings ----

let cache: BoostPrefs = DEFAULT_BOOST
let loadedAt = 0
const subs = new Set<(p: BoostPrefs) => void>()
export const boostNow = () => cache
export async function loadBoost(force = false): Promise<BoostPrefs> {
  if (!life.boost) return cache
  if (!force && Date.now() - loadedAt < 30_000) return cache
  loadedAt = Date.now()
  const p = await life.boost.get().catch(() => null)
  if (p) {
    cache = p
    subs.forEach((f) => f(p))
  }
  return cache
}
export async function saveBoost(patch: Partial<BoostPrefs>): Promise<BoostPrefs> {
  const next = { ...cache, ...patch }
  cache = next
  subs.forEach((f) => f(next))
  const saved = await life.boost?.save(next).catch(() => null)
  if (saved) {
    cache = saved
    subs.forEach((f) => f(saved))
  }
  return cache
}
if (typeof window !== 'undefined') window.addEventListener('life-data-changed', () => void loadBoost(true).catch(() => {}))

/** The settings in a component (live). */
export function useBoost(): [BoostPrefs, (p: Partial<BoostPrefs>) => Promise<BoostPrefs>] {
  const [p, setP] = useState(cache)
  useEffect(() => {
    subs.add(setP)
    void loadBoost(true)
    return () => void subs.delete(setP)
  }, [])
  return [p, saveBoost]
}

// ---- events ----

export const STALL_EVENT = 'life-stall'
export const DOJO_EVENT = 'life-dojo'
export const WIN_EVENT = 'life-win'
/** Ask "why I'm stalling" in the app window (a snoozed or skipped block). */
export const askWhyStalling = (subject: string) => window.dispatchEvent(new CustomEvent(STALL_EVENT, { detail: { subject } }))
/** Open Dojo mode (with the running timer). */
export const openDojo = () => window.dispatchEvent(new CustomEvent(DOJO_EVENT))
/**
 * A big win happened: the victory clip may play (core/winMoments.ts decides).
 * Other parts of the app call this too, e.g. a season ending or a boss beaten:
 * `window.dispatchEvent(new CustomEvent('life-win', { detail: { kind: 'season' } }))`.
 */
export const winMoment = (kind: WinKind) => window.dispatchEvent(new CustomEvent(WIN_EVENT, { detail: { kind } }))
export type { StallReason }

// ---- the one music player ----

let note: TrackNote | null = null
let ch: BroadcastChannel | null = null
const useIsland = () => typeof window !== 'undefined' && !!window.desktop && typeof BroadcastChannel !== 'undefined'
function channel(): BroadcastChannel | null {
  if (!useIsland()) return null
  if (!ch) {
    ch = new BroadcastChannel(CHANNEL)
    ch.onmessage = (e: MessageEvent<{ t: string; k?: TrackNote }>) => {
      if (e.data?.t === 'track' && e.data.k) note = e.data.k
    }
  }
  return ch
}
if (typeof window !== 'undefined') channel()

/** Music plays now (the island's player on the desktop, this page's on the website). */
export const musicPlaying = () => (useIsland() ? !!note?.playing : getState().playing)

/** One command to the player. */
export function musicCmd(c: MusicOp): void {
  const c2 = channel()
  if (c2) c2.postMessage({ t: 'cmd', c })
  else run(c)
}
/** Play a SoundCloud address (a station, likes or a track). */
export function playUrl(url: string, name = 'Focus boost'): boolean {
  const p = parseSoundCloud(url)
  if (!p) return false
  const station: Station = { id: 'sboost', name: name.slice(0, 40), url: p.url, kind: p.kind }
  musicCmd({ op: 'play', station })
  return true
}
