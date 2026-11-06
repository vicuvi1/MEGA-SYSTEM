// "Sign in to SoundCloud" (desktop), the page side: what the signed-in view
// plays (sent by the desktop, src/desktop/scWeb.ts), as one small store, and
// that player dressed like our others (artwork, title, progress, lyrics).
// On the website, or before you sign in, this is null and nothing runs.
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { cleanScWebState, SCWEB_OFF, type ScWebState } from '@core/scAccount'
import { shouldPause } from '@core/soundcloud'
import { IDLE, type MusicOp, type ScState } from './engine'

export const SCWEB_NAME = 'SoundCloud (signed in)'
const api = () => (typeof window !== 'undefined' ? window.desktop : undefined)
export const hasScWeb = () => typeof api()?.scweb === 'function'

let st: ScWebState = SCWEB_OFF
const subs = new Set<() => void>()
const set = (s: ScWebState) => {
  st = s
  subs.forEach((f) => f())
}
let started = false
function start() {
  const d = api()
  if (started || !d?.scweb) return
  started = true
  d.onScWeb?.((s) => set(cleanScWebState(s)))
  void d.scweb('status').then((s) => set(cleanScWebState(s))).catch(() => {})
}
const subscribe = (f: () => void) => {
  start()
  subs.add(f)
  return () => void subs.delete(f)
}
const get = () => st

/** The signed-in player's state (null on the website). */
export function useScWeb(): ScWebState | null {
  const s = useSyncExternalStore(subscribe, get, get)
  return hasScWeb() ? s : null
}

/** Ask the desktop's SoundCloud view to do something. */
export function scWebOp(op: string, arg?: unknown): Promise<any> {
  try {
    return Promise.resolve(api()?.scweb?.(op, arg)).catch(() => null)
  } catch {
    return Promise.resolve(null)
  }
}

/** Is there something to show from it? */
export const scWebHas = (w: ScWebState | null): w is ScWebState => !!w && w.on && w.live && !!w.now.title

/** The signed-in player in the shape our views draw. */
export function scWebAsSc(w: ScWebState): ScState {
  return {
    ...IDLE,
    loaded: true,
    ready: true,
    playing: w.now.playing,
    title: w.now.title,
    artist: w.now.artist,
    artwork: w.now.artwork,
    url: w.now.url,
    pos: w.now.pos,
    posAt: w.at,
    dur: w.now.dur,
    station: { id: 'scweb', name: SCWEB_NAME, url: '', kind: 'track' }
  }
}

/** Our buttons → the view's. */
export function scWebRun(c: MusicOp): boolean {
  const op = c.op === 'toggle' ? 'toggle' : c.op === 'next' ? 'next' : c.op === 'prev' ? 'prev' : c.op === 'pause' || c.op === 'stop' ? 'pause' : c.op === 'resume' ? 'play' : null
  if (op) void scWebOp('op', op)
  return !!op
}

/**
 * The island's rules for it (as for our own player): pause in a call, when
 * the PC locks, when a focus timer starts (with "Pause music during focus",
 * or when your focus mix starts), and when our own player starts (never two
 * at once; and ours pauses when it starts).
 */
export function useScWebRules(o: { call: boolean; locked: boolean; running: boolean; pauseInFocus: boolean; mix: boolean; ourPlaying: boolean; pauseOurs: () => void }) {
  const w = useScWeb()
  const wasRunning = useRef(o.running)
  const wasOurs = useRef(o.ourPlaying)
  const playing = !!w?.live && w.now.playing
  const wasPlaying = useRef(playing)
  // It started while our own player plays: ours pauses.
  useEffect(() => {
    if (playing && !wasPlaying.current && o.ourPlaying) o.pauseOurs()
    wasPlaying.current = playing
  }, [playing])
  useEffect(() => {
    const focusStarted = o.running && !wasRunning.current
    const oursStarted = o.ourPlaying && !wasOurs.current
    wasRunning.current = o.running
    wasOurs.current = o.ourPlaying
    if (!playing) return
    if (shouldPause({ playing, call: o.call, locked: o.locked, focusStarted, pauseInFocus: o.pauseInFocus || o.mix }) || oursStarted) void scWebOp('op', 'pause')
  }, [o.call, o.locked, o.running, o.pauseInFocus, o.mix, o.ourPlaying, playing])
}
