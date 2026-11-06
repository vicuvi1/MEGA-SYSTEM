// The island's sounds: open and close whooshes, a glassy page tick that leans
// the way you swiped, a muted tap, a bright "done" chime, a soft error thud, a
// gentle alert bell and a short level-up arpeggio. All synthesized through the
// one sound engine (soundKit.ts: one AudioContext, the limiter and buses), so
// your sound switches, volume and quiet hours apply. Settings → Sound →
// Island sounds picks Off / Subtle / Full. While music plays the island ducks
// to very quiet; in a call it is silent (and in focus, if you want). Nothing
// starts the audio engine before your first click or key, and a rate limit
// keeps a burst of taps from rattling. The notes and rules: core/islandSound.ts.
import { useEffect, useRef } from 'react'
import { createIslandGate, islandGain, islandRecipe, ISLAND_SOUND_CATEGORY, ISLAND_SOUND_NAMES, pagePan, soundForAction, soundsFromSnapshots, viewSound, type IslandSoundName } from '@core/islandSound'
import type { IslandAction, IslandSnapshot } from '@core/islandModel'
import { playVoices, soundPrefs } from './soundKit'
import { getState as musicState } from './music/engine'

export type { IslandSoundName } from '@core/islandSound'

/** What the island knows right now (a call, a focus timer), set by useIslandSounds. */
const ctx = { call: false, focus: false }
const gate = createIslandGate()

/** Plays one island sound if it may. `dir`: the swipe's direction for a page tick. */
export function play(name: IslandSoundName, opts: { dir?: number; preview?: boolean } = {}): void {
  try {
    const p = soundPrefs()
    const gain = islandGain(name, { mode: p.island, musicPlaying: musicState().playing, call: ctx.call, focus: ctx.focus, quietInFocus: p.islandFocusQuiet, preview: opts.preview })
    if (gain <= 0) return
    if (!opts.preview && !gate(name, Date.now())) return
    playVoices(islandRecipe(name), ISLAND_SOUND_CATEGORY[name], { gain, pan: name === 'page' ? pagePan(opts.dir ?? 0) : 0, preview: opts.preview })
  } catch {
    /* no audio here */
  }
}

/** Settings' Sound check: each island sound in turn. Returns a stop function. */
export function soundCheck(onStep?: (name: IslandSoundName | null) => void): () => void {
  const ts: number[] = []
  ISLAND_SOUND_NAMES.forEach((n, i) => {
    ts.push(window.setTimeout(() => (onStep?.(n), play(n, { preview: true, dir: i % 2 ? 1 : -1 })), i * 900))
  })
  ts.push(window.setTimeout(() => onStep?.(null), ISLAND_SOUND_NAMES.length * 900))
  return () => ts.forEach(clearTimeout)
}

/** A button on the island was pressed (one call in its `send`). */
export function islandActionSound(a: IslandAction, s?: Pick<IslandSnapshot, 'mustdos'> | null): void {
  const n = soundForAction(a, s)
  if (n) play(n)
}

/** The island's pages moved (+1 right, -1 left). */
export const islandPageSound = (dir: number) => play('page', { dir })

/**
 * The island's events, from what it shows (one call in DesktopIsland):
 * opening and closing, a new alert while the panel is open, an automation finishing, a celebration,
 * an error toast, and the hover breath (Full only).
 */
export function useIslandSoundEvents(o: { view: string; snap: IslandSnapshot; momentId?: string | null; toastErr?: string | null; over?: boolean }): void {
  const { view, snap, momentId, toastErr, over } = o
  ctx.call = !!snap.call || !!snap.inMeeting
  ctx.focus = !!snap.running && !snap.running.brk && !snap.running.pausedAt
  const lastView = useRef<string | null>(null)
  useEffect(() => {
    const n = viewSound(lastView.current, view)
    lastView.current = view
    if (n) play(n)
  }, [view])
  const lastSnap = useRef<IslandSnapshot | null>(null)
  useEffect(() => {
    const before = lastSnap.current
    lastSnap.current = snap
    // A new alert that peeks already rings its own reminder sound: the bell is for when the panel is open (and silent otherwise).
    for (const n of soundsFromSnapshots(before, snap)) if (n !== 'notify' || lastView.current === 'expanded') play(n)
  }, [snap])
  useEffect(() => {
    if (momentId) play('levelup')
  }, [momentId])
  useEffect(() => {
    if (toastErr) play('error')
  }, [toastErr])
  useEffect(() => {
    if (over && view === 'compact') play('hover')
  }, [over])
}
