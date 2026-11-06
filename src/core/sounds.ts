// The app's sounds as data (SO2, SO3, SO8, SO9): which sound each action
// makes, which switch it belongs to, when it may play, three themes, the
// phone buzz that goes with it and the focus background noise. Pure: the
// renderer's soundKit.ts turns these notes into WebAudio. No audio files.
import { inQuietHours } from './notifyRules'
import { cleanMoments, DEFAULT_MOMENTS, type MomentId, type MomentSound } from './soundMoments'

export type SoundCategory = 'ui' | 'success' | 'money' | 'focus' | 'alerts'
export const SOUND_CATEGORIES: { id: SoundCategory; label: string; hint: string }[] = [
  { id: 'success', label: 'Done things', hint: 'Habits, must-dos, water, level up' },
  { id: 'money', label: 'Points', hint: 'Points in, rewards bought' },
  { id: 'focus', label: 'Focus', hint: 'Start swell, end gong, last 10 seconds' },
  { id: 'alerts', label: 'Alerts', hint: 'Reminders, Ben, errors' },
  { id: 'ui', label: 'Clicks', hint: 'Quiet ticks for buttons and menus' }
]

export type SoundThemeId = 'soft' | 'arcade' | 'glass'
export type BedKind = 'off' | 'brown' | 'rain' | 'tick'

/** Sound choices on this device (Settings → Sound). */
export interface SoundPrefs {
  cats: Record<SoundCategory, boolean>
  theme: SoundThemeId
  /** Phone buzz with the sounds (phones only). */
  haptics: boolean
  /** Focus background sound and its volume (0–100). */
  bed: BedKind
  bedVolume: number
  /** A very quiet tick in the last 10 seconds of a focus timer. */
  lastTen: boolean
  /** The desktop island's own sounds (open, close, pages, taps, done…): off, subtle or full. */
  island: 'off' | 'subtle' | 'full'
  /** The island stays silent while a focus timer runs. */
  islandFocusQuiet: boolean
  /** Which sound for what (Ben, reminders, water, timer…), or None (core/soundMoments.ts). */
  moments: Record<MomentId, MomentSound>
}
export const DEFAULT_SOUND_PREFS: SoundPrefs = { cats: { ui: true, success: true, money: true, focus: true, alerts: true }, theme: 'soft', haptics: true, bed: 'off', bedVolume: 40, lastTen: true, island: 'subtle', islandFocusQuiet: false, moments: { ...DEFAULT_MOMENTS } }

export function cleanSoundPrefs(p: unknown): SoundPrefs {
  const o = (p && typeof p === 'object' ? p : {}) as Partial<SoundPrefs>
  const cats = { ...DEFAULT_SOUND_PREFS.cats }
  for (const c of Object.keys(cats) as SoundCategory[]) if (typeof o.cats?.[c] === 'boolean') cats[c] = o.cats[c]
  return {
    cats,
    theme: o.theme && o.theme in SOUND_THEMES ? o.theme : 'soft',
    haptics: o.haptics !== false,
    bed: o.bed === 'brown' || o.bed === 'rain' || o.bed === 'tick' ? o.bed : 'off',
    bedVolume: typeof o.bedVolume === 'number' ? Math.max(0, Math.min(100, o.bedVolume)) : 40,
    lastTen: o.lastTen !== false,
    island: o.island === 'off' || o.island === 'full' ? o.island : 'subtle',
    islandFocusQuiet: o.islandFocusQuiet === true,
    moments: cleanMoments(o.moments)
  }
}

export type SoundName =
  | 'tick' | 'click'
  | 'habit' | 'mustDo' | 'success' | 'water' | 'levelUp'
  | 'coin' | 'spend' | 'reward'
  | 'focusStart' | 'focusEnd' | 'lastTick'
  | 'error' | 'notify' | 'ben'
  | 'remind' | 'remindWater' | 'remindMove' | 'remindEyes' | 'remindBed' | 'remindReward' | 'remindMeeting'

export const SOUND_CATEGORY: Record<SoundName, SoundCategory> = {
  tick: 'ui', click: 'ui',
  habit: 'success', mustDo: 'success', success: 'success', water: 'success', levelUp: 'success',
  coin: 'money', spend: 'money', reward: 'money',
  focusStart: 'focus', focusEnd: 'focus', lastTick: 'focus',
  error: 'alerts', notify: 'alerts', ben: 'alerts',
  remind: 'alerts', remindWater: 'alerts', remindMove: 'alerts', remindEyes: 'alerts', remindBed: 'alerts', remindReward: 'alerts', remindMeeting: 'alerts'
}
export const SOUND_NAMES = Object.keys(SOUND_CATEGORY) as SoundName[]
export const isSoundName = (x: unknown): x is SoundName => typeof x === 'string' && x in SOUND_CATEGORY

/** The phone buzz that goes with a sound (SO9); none for the rest. */
export const HAPTICS: Partial<Record<SoundName, number | number[]>> = { habit: 8, mustDo: [10, 30, 10], success: 8, error: [30], levelUp: [15, 30, 15, 30, 30], reward: [10, 30, 10] }

/** What the island's reminder kinds sound like (time up is the focus gong; `meeting`: a call starting soon). */
export function remindSound(kind: string, meeting = false): SoundName {
  if (meeting) return 'remindMeeting'
  if (kind === 'winddown' || kind === 'sleep' || kind === 'bed' || kind === 'late') return 'remindBed'
  const m: Record<string, SoundName> = { ben: 'ben', water: 'remindWater', move: 'remindMove', eyes: 'remindEyes', reward: 'remindReward', over: 'focusEnd' }
  return m[kind] ?? 'remind'
}

// ---- when a sound may play (SO3) ----

export interface PlayCheck {
  /** The main Sounds switch and volume (0–100). */
  sound: boolean
  volume: number
  cats: Record<SoundCategory, boolean>
  /** Quiet hours (the same ones notifications use). */
  quiet: { on: boolean; from: string; to: string }
  /** "HH:MM" now. */
  time: string
  /** In a meeting (calendar), or the island says a call is on. */
  meeting: boolean
  /** The system says audio is off (where it can be told). */
  muted: boolean
}

/** Why a sound can't play now, or null when it can. A preview skips quiet hours and meetings. */
export function soundBlock(cat: SoundCategory, s: PlayCheck, opts: { preview?: boolean; ownSwitch?: boolean } = {}): string | null {
  if (!opts.ownSwitch && !s.sound) return 'sounds are off'
  if (!(s.volume > 0)) return 'volume is 0'
  if (!opts.ownSwitch && !s.cats[cat]) return 'this kind is off'
  if (s.muted) return 'the system is muted'
  if (opts.preview) return null
  if (s.quiet.on && inQuietHours(s.time, s.quiet.from, s.quiet.to)) return 'quiet hours'
  if (s.meeting) return 'in a meeting'
  return null
}
export const canPlay = (cat: SoundCategory, s: PlayCheck, opts?: { preview?: boolean; ownSwitch?: boolean }) => soundBlock(cat, s, opts) === null

/** The same sound twice within `ms` plays once (two handlers for one tap, a double click). */
export function createDebounce(ms = 60) {
  const last = new Map<string, number>()
  return (key: string, now: number): boolean => {
    const t = last.get(key)
    if (t !== undefined && now - t < ms) return false
    last.set(key, now)
    return true
  }
}

/** The island's side of the screen moves its sounds a little left or right (SO5). */
export function panFor(place: string): number {
  if (place === 'left' || place === 'top-left') return -0.4
  if (place === 'right' || place === 'top-right') return 0.4
  return 0
}

// ---- the notes ----

/** One note: frequency (Hz) gliding to f2, start and length (s), peak gain. */
export interface Voice {
  f: number
  f2?: number
  at: number
  len: number
  gain: number
  wave?: OscillatorType
  attack?: number
  /** A lowpass sweep (Hz), for the glug and the thud. */
  lp?: [number, number]
  /** Noise instead of a tone (band around f). */
  noise?: boolean
  /** Kept as is by every theme (the gong, the thud, the noise). */
  fixed?: boolean
}

export interface SoundTheme {
  id: SoundThemeId
  label: string
  /** Replaces each note's wave (null: keep the note's own). */
  wave: OscillatorType | null
  attack: number
  /** Length multiplier: bells ring longer, arcade blips are short. */
  decay: number
  gain: number
  /** Extra partials (frequency ratio, gain ratio): bells. */
  partials: [number, number][]
}
export const SOUND_THEMES: Record<SoundThemeId, SoundTheme> = {
  soft: { id: 'soft', label: 'Soft', wave: null, attack: 0.008, decay: 1, gain: 1, partials: [] },
  arcade: { id: 'arcade', label: 'Arcade', wave: 'square', attack: 0.002, decay: 0.6, gain: 0.4, partials: [] },
  glass: { id: 'glass', label: 'Glass', wave: 'sine', attack: 0.002, decay: 1.8, gain: 0.75, partials: [[2.76, 0.35], [5.4, 0.15]] }
}

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]
const v = (f: number, at: number, len: number, gain: number, more: Partial<Voice> = {}): Voice => ({ f, at, len, gain, ...more })
const shift = (vs: Voice[], by: number) => vs.map((x) => ({ ...x, at: x.at + by }))

/** The notes of a sound before the theme. `step`: how many habits are done today (the pluck climbs). */
export function recipe(name: SoundName, step = 0): Voice[] {
  switch (name) {
    case 'tick': return [v(1800, 0, 0.03, 0.03, { wave: 'triangle' })]
    case 'click': return [v(180, 0, 0.03, 0.05, { wave: 'triangle', fixed: true }), v(3400, 0, 0.012, 0.05, { noise: true, fixed: true })]
    case 'habit': {
      const f = 392 * 2 ** (PENTA[Math.max(0, Math.min(PENTA.length - 1, step))] / 12)
      return [v(f, 0, 0.32, 0.12, { wave: 'triangle', attack: 0.003 }), v(f * 2, 0, 0.1, 0.03)]
    }
    case 'mustDo': return [v(659.25, 0, 0.16, 0.09), v(987.77, 0.09, 0.3, 0.1)]
    case 'success': return [v(880, 0, 0.1, 0.06), v(1318.5, 0.07, 0.22, 0.07)]
    case 'water': return [v(900, 0, 0.2, 0.13, { f2: 280, lp: [2400, 500], fixed: true }), v(720, 0.13, 0.18, 0.09, { f2: 240, lp: [1800, 400], fixed: true })]
    case 'levelUp': return [523.25, 659.25, 783.99, 1046.5, 1318.51].map((f, i) => v(f, i * 0.085, i === 4 ? 0.45 : 0.16, 0.08))
    case 'coin': return [v(1567.98, 0, 0.08, 0.07, { wave: 'triangle' }), v(2093, 0.06, 0.24, 0.07, { wave: 'triangle' })]
    case 'spend': return [v(783.99, 0, 0.15, 0.07, { wave: 'triangle' }), v(523.25, 0.08, 0.25, 0.08, { wave: 'triangle' })]
    case 'reward': return [...recipe('coin'), ...shift(recipe('spend'), 0.24)]
    case 'focusStart': return [v(196, 0, 1.3, 0.09, { attack: 0.5 }), v(293.66, 0.05, 1.3, 0.06, { attack: 0.55 })]
    case 'focusEnd': {
      // A gong: a few inharmonic partials, a long fade.
      const parts: [number, number, number][] = [[1, 0.14, 3.6], [2.32, 0.08, 2.6], [4.25, 0.05, 1.8], [6.63, 0.035, 1.2], [9.38, 0.02, 0.8]]
      return parts.map(([r, g, len]) => v(160 * r, 0, len, g, { attack: 0.006, fixed: true }))
    }
    case 'lastTick': return [v(2000, 0, 0.025, 0.02, { wave: 'sine', fixed: true })]
    case 'error': return [v(150, 0, 0.18, 0.18, { f2: 70, lp: [600, 200], fixed: true })]
    case 'notify': return [v(880, 0, 0.32, 0.12), v(1760, 0, 0.18, 0.025), v(1174.66, 0.13, 0.5, 0.12), v(2349.32, 0.13, 0.25, 0.022)]
    case 'ben': return [1046.5, 1318.5, 1567.98, 1975.53, 2093].map((f, i) => v(f, i * 0.06, 0.22 + i * 0.05, 0.08))
    case 'remindWater': return [v(880, 0, 0.12, 0.1), v(520, 0.08, 0.22, 0.1)]
    case 'remindMove': return [v(523, 0, 0.14, 0.1, { wave: 'triangle' }), v(659, 0.1, 0.14, 0.1, { wave: 'triangle' }), v(784, 0.2, 0.22, 0.1, { wave: 'triangle' })]
    case 'remindEyes': return [v(700, 0, 0.18, 0.1), v(700, 0.25, 0.18, 0.1)]
    case 'remindBed': return [v(330, 0, 0.7, 0.1)]
    case 'remindMeeting': return [0, 0.17, 0.34].map((t) => v(987.77, t, 0.09, 0.08, { attack: 0.004 }))
    case 'remindReward': return [1046, 1318, 1568, 2093].map((f, i) => v(f, i * 0.07, i === 3 ? 0.25 : 0.1, 0.09, { wave: 'triangle' }))
    default: return [v(660, 0, 0.35, 0.1), v(880, 0.12, 0.35, 0.1)]
  }
}

/** The notes of a sound in a theme: its wave, attack, length and bells (SO8). */
export function themed(name: SoundName, theme: SoundThemeId = 'soft', step = 0): Voice[] {
  return themeVoices(recipe(name, step), theme)
}

/** Any notes in a theme (the "fixed" ones stay as they are). */
export function themeVoices(voices: Voice[], theme: SoundThemeId = 'soft'): Voice[] {
  const t = SOUND_THEMES[theme] ?? SOUND_THEMES.soft
  const out: Voice[] = []
  for (const x of voices) {
    if (x.fixed) {
      out.push(x)
      continue
    }
    const base: Voice = { ...x, wave: t.wave ?? x.wave ?? 'sine', attack: Math.max(x.attack ?? 0, t.attack), len: x.len * t.decay, gain: x.gain * t.gain }
    out.push(base)
    for (const [r, g] of t.partials) out.push({ ...base, f: x.f * r, f2: x.f2 ? x.f2 * r : undefined, gain: base.gain * g, len: base.len * 0.6, wave: 'sine' })
  }
  return out
}

/** How long a sound rings (s), for the idle timer. */
export const soundLength = (vs: Voice[]) => vs.reduce((m, x) => Math.max(m, x.at + x.len + (x.attack ?? 0)), 0)

// ---- focus background (SO6) ----

/**
 * A loop of background sound, as samples: brown noise (deep, steady), rain
 * (brighter noise with soft drops) or a soft clock tick once a second.
 */
export function bedSamples(kind: Exclude<BedKind, 'off'>, rate: number, seconds = 2, rand: () => number = Math.random): Float32Array {
  const n = Math.max(1, Math.floor(rate * seconds))
  const out = new Float32Array(n)
  if (kind === 'tick') {
    // One quiet click at the start of each second.
    const click = Math.floor(rate * 0.012)
    for (let s = 0; s < seconds; s++) for (let i = 0; i < click; i++) out[s * rate + i] = (rand() * 2 - 1) * 0.5 * Math.exp(-i / (click * 0.2))
    return out
  }
  let last = 0
  for (let i = 0; i < n; i++) {
    const white = rand() * 2 - 1
    if (kind === 'brown') {
      last = (last + 0.02 * white) / 1.02
      out[i] = last * 3.5
    } else {
      // Rain: lightly smoothed noise with an occasional drop.
      last = 0.6 * last + 0.4 * white
      out[i] = last * 0.35 + (rand() < 0.0004 ? (rand() * 2 - 1) * 0.6 : 0)
    }
  }
  // Ends meet: a short crossfade so the loop doesn't click.
  const fade = Math.min(n >> 2, Math.floor(rate * 0.05))
  for (let i = 0; i < fade; i++) {
    const k = i / fade
    out[i] = out[i] * k + out[n - fade + i] * (1 - k)
  }
  return out
}
/** The lowpass for each background (Hz). */
export const BED_LOWPASS: Record<Exclude<BedKind, 'off'>, number> = { brown: 500, rain: 3200, tick: 2600 }

/** Which of the last 10 seconds of a timer gets a tick now (10…1), or null. */
export function lastTenSecond(msLeft: number): number | null {
  if (msLeft <= 0 || msLeft > 10_000) return null
  return Math.ceil(msLeft / 1000)
}
