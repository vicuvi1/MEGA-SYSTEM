// The island's own sounds, the pure part: what each one is made of (notes and
// soft noise, no audio files), how loud it may be (Off / Subtle / Full, much
// quieter while music plays, silent in a call or, if you want, in focus), a
// rate limit so a burst of taps never turns into a rattle, and which sound
// goes with which island event. The renderer's islandSounds.ts plays them
// through the one sound engine (soundKit.ts). Tested in islandSound.test.ts.
import type { IslandAction, IslandSnapshot } from './islandModel'
import type { SoundCategory, Voice } from './sounds'
import { DEFAULT_MOMENTS, momentRecipe, type MomentId, type MomentSound } from './soundMoments'

export type IslandSoundName = 'open' | 'close' | 'page' | 'tap' | 'done' | 'error' | 'hover' | 'notify' | 'levelup'
export const ISLAND_SOUND_NAMES: IslandSoundName[] = ['open', 'close', 'page', 'tap', 'hover', 'done', 'levelup', 'notify', 'error']
export const ISLAND_SOUND_LABEL: Record<IslandSoundName, string> = { open: 'Open', close: 'Close', page: 'Page', tap: 'Tap', hover: 'Hover', done: 'Done', levelup: 'Level up', notify: 'Alert', error: 'Error' }

export type IslandSoundMode = 'off' | 'subtle' | 'full'
export const ISLAND_SOUND_MODES: [IslandSoundMode, string][] = [['off', 'Off'], ['subtle', 'Subtle'], ['full', 'Full']]
export const cleanIslandMode = (v: unknown): IslandSoundMode => (v === 'off' || v === 'full' ? v : 'subtle')

/** Which of your sound switches (Settings → Sound) each one follows. */
export const ISLAND_SOUND_CATEGORY: Record<IslandSoundName, SoundCategory> = {
  open: 'ui', close: 'ui', page: 'ui', tap: 'ui', hover: 'ui',
  done: 'success', levelup: 'success',
  notify: 'alerts', error: 'alerts'
}

const v = (f: number, at: number, len: number, gain: number, more: Partial<Voice> = {}): Voice => ({ f, at, len, gain, fixed: true, ...more })
/** A soft bell: the note plus a quiet glassy overtone. */
const bell = (f: number, at: number, len: number, gain: number): Voice[] => [v(f, at, len, gain, { attack: 0.004 }), v(f * 2.76, at, len * 0.45, gain * 0.22, { attack: 0.002 }), v(f * 2, at, len * 0.6, gain * 0.3, { attack: 0.003 })]

/**
 * The notes of each island sound. Noise voices are filtered "air" (a band
 * that sweeps from f to f2: a whoosh). Everything is quiet on purpose: the
 * loudest peak is about a third of the app's "done" chime.
 */
export function islandRecipe(name: IslandSoundName): Voice[] {
  switch (name) {
    // A rising whoosh, then a soft high chime.
    case 'open': return [v(420, 0, 0.3, 0.07, { f2: 2600, noise: true, attack: 0.14 }), ...bell(1318.5, 0.15, 0.55, 0.03), ...bell(1975.5, 0.21, 0.5, 0.018)]
    // A falling whoosh with a low hint under it.
    case 'close': return [v(2400, 0, 0.26, 0.06, { f2: 380, noise: true, attack: 0.03 }), v(523.25, 0.02, 0.16, 0.014, { f2: 392, attack: 0.01 })]
    // A short glassy tick.
    case 'page': return [v(2349.3, 0, 0.05, 0.028, { attack: 0.002 }), v(3520, 0, 0.03, 0.01, { attack: 0.001 })]
    // A muted click: a soft knock and a whisper of noise.
    case 'tap': return [v(220, 0, 0.03, 0.045, { wave: 'triangle', lp: [1400, 400], attack: 0.002 }), v(2200, 0, 0.012, 0.012, { noise: true, attack: 0.001 })]
    // Barely there: air brushing past.
    case 'hover': return [v(1760, 0, 0.035, 0.007, { attack: 0.006 })]
    // A bright two-note chime.
    case 'done': return [...bell(1046.5, 0, 0.22, 0.05), ...bell(1568, 0.085, 0.42, 0.05)]
    // A low, soft thud (not a buzzer).
    case 'error': return [v(130, 0, 0.22, 0.11, { f2: 62, lp: [520, 150], attack: 0.004 })]
    // A gentle bell, two notes ringing out.
    case 'notify': return [...bell(880, 0, 0.9, 0.045), ...bell(1318.5, 0.13, 0.85, 0.032)]
    // A short rising arpeggio with a shimmer on top.
    case 'levelup': return [...[523.25, 659.25, 783.99, 1046.5, 1318.5].flatMap((f, i) => bell(f, i * 0.065, i === 4 ? 0.65 : 0.2, 0.038)), v(5274, 0.3, 0.4, 0.004, { attack: 0.08 })]
  }
}

/** The island sounds that follow "Which sound for what" (Settings → Sound). */
export const ISLAND_MOMENT: Partial<Record<IslandSoundName, MomentId>> = { done: 'done', notify: 'reminder', error: 'error' }
/** Another pick plays quieter on the island (its own sounds are about a third of the app's). */
export const ISLAND_PICK_GAIN = 0.45

/**
 * The notes for an island sound with your picks: its own soft notes while the
 * moment keeps its default, your pick (quieter) when you chose another, null for None.
 */
export function islandVoices(name: IslandSoundName, moments?: Partial<Record<MomentId, MomentSound>>): { voices: Voice[]; gain: number } | null {
  const m = ISLAND_MOMENT[name]
  const pick = m ? moments?.[m] ?? DEFAULT_MOMENTS[m] : null
  if (!m || !pick || pick === DEFAULT_MOMENTS[m]) return { voices: islandRecipe(name), gain: 1 }
  if (pick === 'none') return null
  return { voices: momentRecipe(pick), gain: ISLAND_PICK_GAIN }
}

/** How far left (-) or right (+) a page tick sits: the way you swiped. */
export const pagePan = (dir: number) => (dir > 0 ? 0.35 : dir < 0 ? -0.35 : 0)

// ---- how loud ----

export interface IslandSoundCtx {
  mode: IslandSoundMode
  /** SoundCloud (or a PC player) is playing: the island ducks under it. */
  musicPlaying: boolean
  /** A call or meeting is on. */
  call: boolean
  /** A focus timer runs (not a break). */
  focus: boolean
  /** "Quiet during focus" is on. */
  quietInFocus: boolean
  /** Settings' Sound check: plays whatever the moment. */
  preview?: boolean
}
export const SUBTLE_GAIN = 0.5
/** While music plays the island is very quiet, never on top of the song. */
export const DUCK_GAIN = 0.15

/** The loudness for one island sound right now, 0 (silent) to 1. Quiet hours and the main switch are checked by the sound engine. */
export function islandGain(name: IslandSoundName, c: IslandSoundCtx): number {
  if (c.mode === 'off') return 0
  if (c.preview) return c.mode === 'full' ? 1 : SUBTLE_GAIN
  if (c.call) return 0
  if (c.focus && c.quietInFocus && name !== 'error') return 0
  // The hover breath is for Full only.
  if (name === 'hover' && c.mode !== 'full') return 0
  const base = c.mode === 'full' ? 1 : SUBTLE_GAIN
  return c.musicPlaying ? base * DUCK_GAIN : base
}

// ---- the rate limit ----

/** The same sound again within this many ms is dropped. */
export const MIN_GAP: Record<IslandSoundName, number> = { tap: 60, hover: 160, page: 80, open: 300, close: 300, done: 150, error: 400, notify: 1500, levelup: 1500 }
/** At most this many island sounds in any one second. */
export const MAX_PER_SECOND = 6

/** A gate: true when the sound may play now (and counts it). */
export function createIslandGate(maxPerSecond = MAX_PER_SECOND) {
  const last = new Map<IslandSoundName, number>()
  let recent: number[] = []
  return (name: IslandSoundName, now: number): boolean => {
    const t = last.get(name)
    if (t !== undefined && now - t < MIN_GAP[name]) return false
    recent = recent.filter((x) => now - x < 1000)
    // A celebration or an error always gets through the crowd; clicks don't.
    if (recent.length >= maxPerSecond && !(name === 'levelup' || name === 'error')) return false
    last.set(name, now)
    recent.push(now)
    return true
  }
}

// ---- which sound for which island event ----

/** The sound for a button on the island (what the action does), or null (it has its own, like water's glug). */
export function soundForAction(a: IslandAction, s?: Pick<IslandSnapshot, 'mustdos'> | null): IslandSoundName | null {
  switch (a.kind) {
    case 'water': return null // the water glug plays already
    case 'mustdo': return s?.mustdos.find((m) => m.i === a.i)?.done ? 'tap' : 'done'
    case 'todoDone':
    case 'reps':
    case 'moveBreak':
    case 'kitCount':
      return 'done'
    case 'blockResult': return a.result === 'done' ? 'done' : 'tap'
    case 'undo': return 'close'
    case 'chat':
    case 'voice':
      return null
    default: return 'tap'
  }
}

/** Sounds from what changed between two island pictures: a new alert, an automation finishing. */
export function soundsFromSnapshots(prev: IslandSnapshot | null, cur: IslandSnapshot): IslandSoundName[] {
  if (!prev || !prev.at || prev.locked || !cur.at || cur.locked) return []
  const out: IslandSoundName[] = []
  if (cur.alert && cur.alert.id !== prev.alert?.id) out.push('notify')
  const before = new Map((prev.auto?.runs ?? []).map((r) => [r.run, r.state]))
  for (const r of cur.auto?.runs ?? []) {
    if (before.get(r.run) !== 'running') continue
    if (r.state === 'ok') out.push('done')
    if (r.state === 'failed') out.push('error')
  }
  return out
}

/** The island opened or closed (the panel), or null. */
export function viewSound(prev: string | null, cur: string): IslandSoundName | null {
  if (prev == null || prev === cur) return null
  if (cur === 'expanded') return 'open'
  if (prev === 'expanded') return 'close'
  return null
}
